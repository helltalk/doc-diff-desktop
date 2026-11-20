'use strict';

/** 生成含 2 个工作表、中文表头与公式的 sample.xlsx 测试夹具。 */

const path = require('node:path');
const XLSX = require('xlsx');

const target = path.join(__dirname, 'sample.xlsx');
const workbook = XLSX.utils.book_new();

const sheet1 = XLSX.utils.aoa_to_sheet([
  ['月份', '产品', '销售额', '占比'],
  ['一月', '中文产品A', 1200, null],
  ['二月', '中文产品B', 1800, null],
  ['三月', '中文产品A', 900, null]
]);
sheet1['D2'] = { t: 'n', f: 'C2/SUM(C2:C4)', v: 1200 / 3900 };
sheet1['D3'] = { t: 'n', f: 'C3/SUM(C2:C4)', v: 1800 / 3900 };
sheet1['D4'] = { t: 'n', f: 'C4/SUM(C2:C4)', v: 900 / 3900 };
sheet1['!ref'] = 'A1:D4';
XLSX.utils.book_append_sheet(workbook, sheet1, '销售数据');

const sheet2 = XLSX.utils.aoa_to_sheet([
  ['汇总项', '数值', '备注'],
  ['总销售额', 3900, '含中文备注'],
  ['平均值', 1300, '=SUM/3'],
  ['是否达标', '是', '阈值 1000']
]);
sheet2['B5'] = { t: 'n', f: 'SUM(B2:B4)', v: 6200 };
sheet2['!ref'] = 'A1:C5';
XLSX.utils.book_append_sheet(workbook, sheet2, '汇总');

XLSX.writeFile(workbook, target);
console.log('generated ' + target);
