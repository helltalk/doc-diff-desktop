'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  alignSheets,
  alignRows,
  compareCells,
  normalizeSheetName,
  rowFingerprint,
  diff
} = require('../src/shared/cell-diff');

/** 数字列号 → Excel 列字母（1 → A）。 */
function colLetter(index) {
  let n = index;
  let text = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    text = String.fromCharCode(65 + remainder) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

/**
 * 由二维数组构造 SheetDocument。
 * 传入对象可指定 {value,type,formula}，便于测试公式与类型差异。
 */
function sheet(name, matrix) {
  const rows = matrix.map(function (values, rowIndex) {
    return values.map(function (raw, colIndex) {
      const spec = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { value: raw };
      const cell = {
        ref: colLetter(colIndex + 1) + (rowIndex + 1),
        row: rowIndex + 1,
        col: colIndex + 1,
        value: spec.value === undefined ? null : spec.value,
        type: spec.type || (typeof spec.value === 'number' ? 'n' : 's')
      };
      if (spec.formula !== undefined) cell.formula = spec.formula;
      return cell;
    });
  });
  return {
    kind: 'sheet',
    meta: { path: name, name: name, size: 0, ext: 'xlsx' },
    sheets: [{
      name: name,
      rows: rows,
      rowCount: rows.length,
      colCount: matrix.length > 0 ? matrix[0].length : 0
    }]
  };
}

function docWithSheets(list) {
  return {
    kind: 'sheet',
    meta: { path: 'book.xlsx', name: 'book.xlsx', size: 0, ext: 'xlsx' },
    sheets: list
  };
}

test('normalizeSheetName 忽略大小写与首尾空格', function () {
  assert.equal(normalizeSheetName('  Sheet1 '), 'sheet1');
  assert.equal(normalizeSheetName('销售数据'), '销售数据');
  assert.equal(normalizeSheetName(null), '');
});

test('alignSheets 按名匹配（忽略大小写/空格），仅一侧的表整表标记', function () {
  const a = docWithSheets([{ name: ' Sheet1 ', rows: [[]], rowCount: 1, colCount: 0 }]);
  const b = docWithSheets([
    { name: 'sheet1', rows: [[]], rowCount: 1, colCount: 0 },
    { name: '新增表', rows: [[]], rowCount: 1, colCount: 0 }
  ]);
  const aligned = alignSheets(a, b);
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].status, 'both');
  assert.equal(aligned[0].name, 'sheet1');
  assert.equal(aligned[1].status, 'added');
  assert.equal(aligned[1].name, '新增表');

  const onlyOld = alignSheets(b, a);
  assert.equal(onlyOld.length, 2);
  assert.equal(onlyOld.filter(function (g) { return g.status === 'removed'; }).length, 1);
});

test('alignRows 中间插行后，后续内容未变的行只产生位移不产生伪差异', function () {
  const a = sheet('S', [['表头'], ['甲'], ['乙'], ['丙']]).sheets[0];
  const b = sheet('S', [['表头'], ['新插入'], ['甲'], ['乙'], ['丙']]).sheets[0];
  const alignment = alignRows(a, b);
  assert.deepEqual(alignment.addedRows.map(function (item) { return item.row[0].value; }), ['新插入']);
  assert.equal(alignment.removedRows.length, 0);
  assert.deepEqual(alignment.pairs.map(function (p) { return [p.aIndex, p.bIndex]; }), [[0, 0], [1, 2], [2, 3], [3, 4]]);
  // 唯一的差异就是被插入的那一行，后续内容相同的行不产生伪差异。
  const insertedDiffs = diff(sheet('S', [['表头'], ['甲'], ['乙'], ['丙']]), sheet('S', [['表头'], ['新插入'], ['甲'], ['乙'], ['丙']]));
  assert.equal(insertedDiffs.length, 1);
  assert.equal(insertedDiffs[0].type, 'added');
  assert.equal(insertedDiffs[0].ref, 'A2');
  assert.equal(insertedDiffs[0].newValue, '新插入');
});

test('新增行与删除行整行标 added / removed', function () {
  const oldDoc = sheet('S', [['A', 'B'], ['1', '2']]);
  const newDoc = sheet('S', [['A', 'B'], ['1', '2'], ['3', '4']]);
  const added = diff(oldDoc, newDoc);
  assert.equal(added.length, 2);
  assert.ok(added.every(function (d) { return d.type === 'added' && d.changeKind === 'added'; }));
  assert.deepEqual(added.map(function (d) { return d.ref; }), ['A3', 'B3']);

  const removed = diff(newDoc, oldDoc);
  assert.equal(removed.length, 2);
  assert.ok(removed.every(function (d) { return d.type === 'removed' && d.changeKind === 'removed'; }));
  assert.deepEqual(removed.map(function (d) { return d.ref; }), ['A3', 'B3']);
});

test('compareCells 同时比较公式与值：公式变更优先标记 formula', function () {
  const oldCell = { ref: 'C2', row: 2, col: 3, value: '100', type: 'formula', formula: 'A2+B2' };
  const newCell = { ref: 'C2', row: 2, col: 3, value: '100', type: 'formula', formula: 'A2*2' };
  const d = compareCells(oldCell, newCell);
  assert.equal(d.changeKind, 'formula');
  assert.equal(d.type, 'modified');
  assert.equal(d.oldFormula, 'A2+B2');
  assert.equal(d.newFormula, 'A2*2');
  assert.equal(d.oldValue, d.newValue);
});

test('compareCells 仅值不同标记 value，类型不同标记 type，完全相同返回 null', function () {
  const base = { ref: 'A1', row: 1, col: 1, value: 1, type: 'n' };
  assert.equal(compareCells(base, { ref: 'A1', row: 1, col: 1, value: 1, type: 'n' }), null);
  assert.equal(compareCells(base, { ref: 'A1', row: 1, col: 1, value: 2, type: 'n' }).changeKind, 'value');
  assert.equal(compareCells(base, { ref: 'A1', row: 1, col: 1, value: '1', type: 's' }).changeKind, 'type');
});

test('compareCells 空 ↔ 非空标记 added / removed，双空返回 null', function () {
  const blank = { ref: 'A1', row: 1, col: 1, value: null, type: 's' };
  const filled = { ref: 'A1', row: 1, col: 1, value: '内容', type: 's' };
  assert.equal(compareCells(blank, blank), null);
  assert.equal(compareCells(blank, filled).changeKind, 'added');
  assert.equal(compareCells(filled, blank).changeKind, 'removed');
});

test('行指纹只拼接非空单元格值，不含公式', function () {
  const row = [
    { ref: 'A1', row: 1, col: 1, value: '标题', type: 's' },
    { ref: 'B1', row: 1, col: 2, value: null, type: 'n' },
    { ref: 'C1', row: 1, col: 3, value: 12, type: 'formula', formula: '=SUM(X)' }
  ];
  assert.equal(rowFingerprint(row), '标题\u000112');
  const onlyFormulaChanged = row.map(function (cell) {
    return cell.formula ? Object.assign({}, cell, { formula: '=SUM(Y)' }) : cell;
  });
  assert.equal(rowFingerprint(row), rowFingerprint(onlyFormulaChanged));
});

test('中文表头 + 多 sheet：结果按 sheet → row → col 排序且 sheet 名保留中文', function () {
  const oldDoc = docWithSheets([
    { name: '销售数据', rows: sheet('销售数据', [['月份', '销售额'], ['一月', 100]]).sheets[0].rows, rowCount: 2, colCount: 2 },
    { name: '汇总', rows: sheet('汇总', [['项目', '值'], ['合计', 100]]).sheets[0].rows, rowCount: 2, colCount: 2 }
  ]);
  const newDoc = docWithSheets([
    { name: '销售数据', rows: sheet('销售数据', [['月份', '销售额'], ['一月', 200]]).sheets[0].rows, rowCount: 2, colCount: 2 },
    { name: '汇总', rows: sheet('汇总', [['项目', '值'], ['合计', 300]]).sheets[0].rows, rowCount: 2, colCount: 2 }
  ]);
  const diffs = diff(oldDoc, newDoc);
  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs.map(function (d) { return d.sheet; }), ['销售数据', '汇总']);
  assert.deepEqual(diffs.map(function (d) { return d.ref; }), ['B2', 'B2']);
  assert.deepEqual(diffs.map(function (d) { return d.newValue; }), [200, 300]);
});

test('整表只在单侧存在时，每个非空单元格都产生差异条目', function () {
  const oldDoc = sheet('仅有旧表', [['中文表头', 7]]);
  const newDoc = sheet('另一张表', [['另一表头', 8]]);
  const diffs = diff(oldDoc, newDoc);
  assert.equal(diffs.length, 4);
  assert.equal(diffs.filter(function (d) { return d.sheet === '仅有旧表' && d.type === 'removed'; }).length, 2);
  assert.equal(diffs.filter(function (d) { return d.sheet === '另一张表' && d.type === 'added'; }).length, 2);
});

test('超大表格降级为按位置对齐，不崩溃且能定位改动', function () {
  const build = function (changed) {
    const rows = [];
    for (let r = 0; r < 160; r++) {
      const row = [];
      for (let c = 0; c < 200; c++) {
        row.push({ ref: colLetter(c + 1) + (r + 1), row: r + 1, col: c + 1, value: r * 200 + c, type: 'n' });
      }
      rows.push(row);
    }
    if (changed) rows[0][0].value = -1;
    return { kind: 'sheet', meta: {}, sheets: [{ name: '大表', rows: rows, rowCount: 160, colCount: 200 }] };
  };
  const diffs = diff(build(false), build(true));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].ref, 'A1');
  assert.equal(diffs[0].changeKind, 'value');
});

test('空文档与 null 入参不抛异常', function () {
  assert.deepEqual(diff(null, null), []);
  assert.deepEqual(diff(sheet('S', [['A']]), null), [{ 
    type: 'removed', sheet: 'S', ref: 'A1', row: 1, col: 1,
    oldValue: 'A', newValue: null, oldType: 's', newType: null,
    oldFormula: null, newFormula: null, changeKind: 'removed'
  }]);
});
