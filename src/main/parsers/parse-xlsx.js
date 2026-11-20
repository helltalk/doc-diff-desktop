'use strict';

/**
 * Excel 解析：SheetJS → SheetDocument。
 * 每个单元格统一为 Cell{ref,row,col,value,type,formula?}，空单元格也保留，
 * 以便 T04 逐单元格对齐比较。
 */

const XLSX = require('xlsx');
const { ERR } = require('../../shared/constants');
const { serviceError } = require('../service-error');

/**
 * 将 SheetJS 单元格类型映射为契约中的 type。
 * @param {object} cell SheetJS 单元格对象
 * @returns {'s'|'n'|'b'|'d'|'formula'}
 */
function cellType(cell) {
  if (cell.f !== undefined && cell.f !== null && cell.f !== '') return 'formula';
  if (cell.t === 'b') return 'b';
  if (cell.t === 'd') return 'd';
  if (cell.t === 'n') return 'n';
  return 's';
}

/**
 * 读取 xlsx/xls 文件并转换为 SheetDocument。
 * @param {string} filePath 文件路径（可 UNC）
 * @param {FileMeta} meta 文件元信息
 * @returns {SheetDocument}
 */
function parseXlsx(filePath, meta) {
  let workbook;
  try {
    workbook = XLSX.readFile(filePath, { cellFormula: true, cellDates: true });
  } catch (err) {
    throw serviceError(ERR.FILE_READ, '读取 Excel 文件失败：' + err.message, err);
  }

  const sheets = workbook.SheetNames.map(function (name) {
    const worksheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const rowCount = range.e.r + 1;
    const colCount = range.e.c + 1;
    const rows = [];

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row = [];
      for (let colIndex = 0; colIndex < colCount; colIndex++) {
        const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const source = worksheet[ref];
        if (!source) {
          row.push({ ref: ref, row: rowIndex + 1, col: colIndex + 1, value: null, type: 's' });
          continue;
        }
        const type = cellType(source);
        const cell = {
          ref: ref,
          row: rowIndex + 1,
          col: colIndex + 1,
          value: source.v === undefined ? null : source.v,
          type: type
        };
        if (type === 'formula') cell.formula = String(source.f);
        if (type === 'formula' && source.w !== undefined) cell.value = source.w;
        if (type === 'd' && cell.value instanceof Date) cell.value = cell.value.toISOString();
        row.push(cell);
      }
      rows.push(row);
    }

    return { name: name, rows: rows, rowCount: rowCount, colCount: colCount };
  });

  return { kind: 'sheet', meta: meta, sheets: sheets };
}

module.exports = { parseXlsx, cellType };
