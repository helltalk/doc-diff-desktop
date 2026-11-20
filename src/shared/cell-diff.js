'use strict';

/**
 * Excel 单元格差异引擎（零第三方依赖）。
 *
 * 数据源是主进程 parse-xlsx.js 产出的 SheetDocument：
 *   SheetDocument = { kind:'sheet', meta, sheets:[{name,rows:Cell[][],rowCount,colCount}] }
 *   Cell          = { ref,row,col,value,type,formula? }
 *
 * 产出 CellDiffEntry[]：
 *   { type:'added'|'removed'|'modified', sheet, ref, row, col,
 *     oldValue,newValue,oldType,newType,oldFormula,newFormula,
 *     changeKind:'value'|'formula'|'type'|'added'|'removed' }
 *
 * 对齐策略：
 *   1. sheet 按名匹配（忽略大小写与首尾空格），仅一侧存在的整表标记 added/removed；
 *   2. 行先用「非空格子值拼接」的行指纹做 LCS 求位移，残余区块按位置两两配对，
 *      这样插行后内容未变的行只产生位移而不产生伪差异；
 *   3. 配对行按列号（1 基）逐格比较 value 与 formula；
 *   4. 超大表格降级为按位置对齐，不做 O(n*m) 的 LCS，保证不崩溃。
 */

const { lcsOps } = require('./diff-core');

/** 行指纹 LCS 的硬上限：超过则直接按位置对齐，避免 O(n*m) 内存爆炸。 */
const MAX_ROW_LCS_PRODUCT = 4 * 1000 * 1000;
/** 单元格对超过该阈值时放弃行指纹 LCS，降级为按位置对齐（约 2 万对即可降级）。 */
const MAX_CELL_PAIRS_FOR_LCS = 20000;

/**
 * 规范化工作表名：去首尾空白、转小写，用于跨大小写/空格匹配。
 * @param {string} name 原始表名
 * @returns {string} 规范化键
 */
function normalizeSheetName(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

/**
 * 判断单元格是否为空（无值且无公式）。
 * @param {Cell|null} cell 单元格
 * @returns {boolean}
 */
function isBlankCell(cell) {
  if (!cell || typeof cell !== 'object') return true;
  const hasValue = cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '';
  const hasFormula = cell.formula !== null && cell.formula !== undefined && String(cell.formula).trim() !== '';
  return !hasValue && !hasFormula;
}

/**
 * 把单元格值转成可比较/可显示的字符串。Date 统一为 ISO，避免跨进程序列化差异。
 * @param {*} value 原始值
 * @returns {string}
 */
function cellValueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * 计算行指纹：只拼接非空单元格的值（不含公式），使「仅公式变化」仍能被识别为单元格级公式差异。
 * @param {Cell[]} row 一行单元格
 * @returns {string}
 */
function rowFingerprint(row) {
  const parts = [];
  const cells = Array.isArray(row) ? row : [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell || cell.value === null || cell.value === undefined) continue;
    const text = cellValueText(cell.value);
    if (text.trim() === '') continue;
    parts.push(text);
  }
  return parts.join('\u0001');
}

/**
 * 把一行单元格转成「列号 → 单元格」映射，兼容稀疏数组。
 * @param {Cell[]} row 一行单元格
 * @returns {Map<number,Cell>}
 */
function cellMap(row) {
  const map = new Map();
  const cells = Array.isArray(row) ? row : [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell || typeof cell !== 'object') continue;
    const col = Number(cell.col) > 0 ? Number(cell.col) : i + 1;
    map.set(col, cell);
  }
  return map;
}

/**
 * 对齐两个 SheetDocument 的工作表。
 * @param {SheetDocument} a 旧文档
 * @param {SheetDocument} b 新文档
 * @returns {Array<{key:string,name:string,sheetA:object|null,sheetB:object|null,status:string,order:number}>}
 */
function alignSheets(a, b) {
  const listA = (a && Array.isArray(a.sheets)) ? a.sheets : [];
  const listB = (b && Array.isArray(b.sheets)) ? b.sheets : [];
  const groups = new Map();

  function addList(list, slot) {
    for (const sheet of list) {
      if (!sheet || typeof sheet !== 'object') continue;
      const base = normalizeSheetName(sheet.name) || '__unnamed__';
      let key = base;
      let seq = 1;
      // 同一侧出现同名（忽略大小写后）工作表时追加序号，避免相互覆盖。
      while (groups.has(key) && groups.get(key)[slot]) {
        seq += 1;
        key = base + '#' + seq;
      }
      if (!groups.has(key)) {
        groups.set(key, {
          key: key,
          name: String(sheet.name == null ? '' : sheet.name),
          sheetA: null,
          sheetB: null,
          status: 'both',
          order: groups.size
        });
      }
      const group = groups.get(key);
      group[slot] = sheet;
      if (slot === 'sheetB') group.name = String(sheet.name == null ? '' : sheet.name);
    }
  }

  addList(listA, 'sheetA');
  addList(listB, 'sheetB');

  const result = [];
  for (const group of groups.values()) {
    group.status = group.sheetA && group.sheetB
      ? 'both'
      : (group.sheetA ? 'removed' : 'added');
    result.push(group);
  }
  return result;
}

/**
 * 估算两张表待比较的单元格对数，用于超大表降级判定。
 * @param {object} sheetA 旧工作表
 * @param {object} sheetB 新工作表
 * @returns {number}
 */
function estimateCellPairs(sheetA, sheetB) {
  const cellsA = Number(sheetA && sheetA.rowCount || 0) * Number(sheetA && sheetA.colCount || 0);
  const cellsB = Number(sheetB && sheetB.rowCount || 0) * Number(sheetB && sheetB.colCount || 0);
  return Math.max(cellsA, cellsB);
}

/**
 * 对齐两张工作表的行。
 *
 * 指纹 LCS 找出真正相同的行；两个相同行之间的残余区块按位置两两配对，
 * 从而把「原地改了一行的值」识别为逐格差异，而非整行删除+整行新增。
 *
 * @param {object} sheetA 旧工作表
 * @param {object} sheetB 新工作表
 * @returns {{pairs:Array<{aIndex:number,bIndex:number}>,removedRows:Array<{index:number,row:Cell[]}>,addedRows:Array<{index:number,row:Cell[]}>}}
 */
function alignRows(sheetA, sheetB) {
  const rowsA = (sheetA && Array.isArray(sheetA.rows)) ? sheetA.rows : [];
  const rowsB = (sheetB && Array.isArray(sheetB.rows)) ? sheetB.rows : [];
  const result = { pairs: [], removedRows: [], addedRows: [] };

  if (rowsA.length === 0) {
    for (let j = 0; j < rowsB.length; j++) result.addedRows.push({ index: j, row: rowsB[j] });
    return result;
  }
  if (rowsB.length === 0) {
    for (let i = 0; i < rowsA.length; i++) result.removedRows.push({ index: i, row: rowsA[i] });
    return result;
  }

  // 超大表降级：直接按行号对齐，用 O(n) 换取稳定性。
  const useLcs = rowsA.length * rowsB.length <= MAX_ROW_LCS_PRODUCT
    && estimateCellPairs(sheetA, sheetB) <= MAX_CELL_PAIRS_FOR_LCS;

  if (!useLcs) {
    const shared = Math.min(rowsA.length, rowsB.length);
    for (let k = 0; k < shared; k++) result.pairs.push({ aIndex: k, bIndex: k });
    for (let k = shared; k < rowsA.length; k++) result.removedRows.push({ index: k, row: rowsA[k] });
    for (let k = shared; k < rowsB.length; k++) result.addedRows.push({ index: k, row: rowsB[k] });
    return result;
  }

  const fingerprintsA = rowsA.map(rowFingerprint);
  const fingerprintsB = rowsB.map(rowFingerprint);
  const ops = lcsOps(fingerprintsA, fingerprintsB, 0);

  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      result.pairs.push({ aIndex: ops[i].aIndex, bIndex: ops[i].bIndex });
      i += 1;
      continue;
    }
    const dels = [];
    const ins = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') dels.push(ops[i]);
      else ins.push(ops[i]);
      i += 1;
    }
    const paired = Math.min(dels.length, ins.length);
    for (let k = 0; k < paired; k++) {
      result.pairs.push({ aIndex: dels[k].aIndex, bIndex: ins[k].bIndex });
    }
    for (let k = paired; k < dels.length; k++) {
      result.removedRows.push({ index: dels[k].aIndex, row: rowsA[dels[k].aIndex] });
    }
    for (let k = paired; k < ins.length; k++) {
      result.addedRows.push({ index: ins[k].bIndex, row: rowsB[ins[k].bIndex] });
    }
  }
  return result;
}

/**
 * 比较两个单元格。null 表示无差异。
 *
 * 判定优先级：公式不同 → 'formula'；类型不同 → 'type'；仅值不同 → 'value'。
 * 空 ↔ 非空分别记为 'added' / 'removed'。
 *
 * @param {Cell|null} oldCell 旧单元格
 * @param {Cell|null} newCell 新单元格
 * @returns {CellDiffEntry|null}
 */
function compareCells(oldCell, newCell) {
  const oldBlank = isBlankCell(oldCell);
  const newBlank = isBlankCell(newCell);
  if (oldBlank && newBlank) return null;

  const base = {
    type: 'modified',
    sheet: '',
    ref: '',
    row: 0,
    col: 0,
    oldValue: null,
    newValue: null,
    oldType: null,
    newType: null,
    oldFormula: null,
    newFormula: null,
    changeKind: 'value'
  };

  if (oldBlank) {
    base.type = 'added';
    base.changeKind = 'added';
    base.ref = String(newCell.ref || '');
    base.row = Number(newCell.row) || 0;
    base.col = Number(newCell.col) || 0;
    base.newValue = newCell.value === undefined ? null : newCell.value;
    base.newType = String(newCell.type || 's');
    base.newFormula = newCell.formula == null ? null : String(newCell.formula);
    return base;
  }

  if (newBlank) {
    base.type = 'removed';
    base.changeKind = 'removed';
    base.ref = String(oldCell.ref || '');
    base.row = Number(oldCell.row) || 0;
    base.col = Number(oldCell.col) || 0;
    base.oldValue = oldCell.value === undefined ? null : oldCell.value;
    base.oldType = String(oldCell.type || 's');
    base.oldFormula = oldCell.formula == null ? null : String(oldCell.formula);
    return base;
  }

  const oldValue = oldCell.value === undefined ? null : oldCell.value;
  const newValue = newCell.value === undefined ? null : newCell.value;
  const oldType = String(oldCell.type || 's');
  const newType = String(newCell.type || 's');
  const oldFormula = oldCell.formula == null ? null : String(oldCell.formula);
  const newFormula = newCell.formula == null ? null : String(newCell.formula);

  let changeKind = null;
  if (oldFormula !== newFormula) changeKind = 'formula';
  else if (oldType !== newType) changeKind = 'type';
  else if (!valuesEqual(oldValue, newValue)) changeKind = 'value';
  if (!changeKind) return null;

  base.type = 'modified';
  base.changeKind = changeKind;
  base.ref = String(newCell.ref || oldCell.ref || '');
  base.row = Number(newCell.row || oldCell.row) || 0;
  base.col = Number(newCell.col || oldCell.col) || 0;
  base.oldValue = oldValue;
  base.newValue = newValue;
  base.oldType = oldType;
  base.newType = newType;
  base.oldFormula = oldFormula;
  base.newFormula = newFormula;
  return base;
}

/**
 * 值相等判定：Date 先归一化，NaN 与 NaN 视为相等。
 * @param {*} a 旧值
 * @param {*} b 新值
 * @returns {boolean}
 */
function valuesEqual(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const textA = cellValueText(a);
  const textB = cellValueText(b);
  if (typeof a === 'number' && typeof b === 'number'
      && Number.isNaN(a) && Number.isNaN(b)) return true;
  return textA === textB;
}

/**
 * 把一行的非空单元格全部转成差异条目（新增行 / 删除行 / 整表新增 / 整表删除）。
 * @param {Cell[]} row 单元格行
 * @param {string} kind 'added' 或 'removed'
 * @param {string} sheet 工作表名
 * @returns {CellDiffEntry[]}
 */
function entriesForRow(row, kind, sheet) {
  const entries = [];
  const cells = Array.isArray(row) ? row : [];
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object') continue;
    const entry = kind === 'added'
      ? compareCells(null, cell)
      : compareCells(cell, null);
    if (!entry) continue;
    entry.sheet = sheet;
    entries.push(entry);
  }
  return entries;
}

/**
 * 计算两个 SheetDocument 的单元格差异。
 * 结果按「工作表顺序 → 行号 → 列号」稳定排序。
 *
 * @param {SheetDocument} oldSheetDoc 旧表格文档
 * @param {SheetDocument} newSheetDoc 新表格文档
 * @returns {CellDiffEntry[]}
 */
function diff(oldSheetDoc, newSheetDoc) {
  const aligned = alignSheets(oldSheetDoc, newSheetDoc);
  const all = [];

  for (const group of aligned) {
    const sheetEntries = [];

    if (group.status === 'removed') {
      const rows = (group.sheetA && group.sheetA.rows) || [];
      for (const row of rows) {
        for (const entry of entriesForRow(row, 'removed', group.name)) sheetEntries.push(entry);
      }
    } else if (group.status === 'added') {
      const rows = (group.sheetB && group.sheetB.rows) || [];
      for (const row of rows) {
        for (const entry of entriesForRow(row, 'added', group.name)) sheetEntries.push(entry);
      }
    } else {
      const alignment = alignRows(group.sheetA, group.sheetB);

      for (const item of alignment.removedRows) {
        for (const entry of entriesForRow(item.row, 'removed', group.name)) sheetEntries.push(entry);
      }
      for (const item of alignment.addedRows) {
        for (const entry of entriesForRow(item.row, 'added', group.name)) sheetEntries.push(entry);
      }

      for (const pair of alignment.pairs) {
        const rowA = (group.sheetA.rows && group.sheetA.rows[pair.aIndex]) || [];
        const rowB = (group.sheetB.rows && group.sheetB.rows[pair.bIndex]) || [];
        const mapA = cellMap(rowA);
        const mapB = cellMap(rowB);
        let maxCol = Math.max(rowA.length, rowB.length);
        for (const col of mapA.keys()) if (col > maxCol) maxCol = col;
        for (const col of mapB.keys()) if (col > maxCol) maxCol = col;

        for (let col = 1; col <= maxCol; col++) {
          const entry = compareCells(mapA.get(col) || null, mapB.get(col) || null);
          if (!entry) continue;
          entry.sheet = group.name;
          sheetEntries.push(entry);
        }
      }
    }

    sheetEntries.sort(function (x, y) {
      if (x.row !== y.row) return x.row - y.row;
      if (x.col !== y.col) return x.col - y.col;
      return x.ref.localeCompare(y.ref);
    });
    for (const entry of sheetEntries) all.push(entry);
  }

  return all;
}

module.exports = {
  MAX_ROW_LCS_PRODUCT,
  MAX_CELL_PAIRS_FOR_LCS,
  normalizeSheetName,
  isBlankCell,
  cellValueText,
  rowFingerprint,
  cellMap,
  alignSheets,
  alignRows,
  compareCells,
  valuesEqual,
  diff
};
