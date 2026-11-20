'use strict';

/**
 * 生成端到端验收夹具：位于「中文 + 空格」路径下的修改版 docx / xlsx，
 * 以及一个用于验证 LibreOffice 缺失提示的占位 .doc。
 */

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const XLSX = require('xlsx');

const root = path.join(__dirname, '..');
const fixtures = path.join(root, 'tests', 'fixtures');
const targetDir = path.join(fixtures, '中文 路径 测试');

fs.mkdirSync(targetDir, { recursive: true });

// 1) 修改版 docx（中文 + 空格路径）
execFileSync('python', [path.join(__dirname, 'make-e2e-docx.py')], {
  cwd: root,
  stdio: 'inherit'
});

// 2) 修改版 xlsx：改值、改公式、插入一行
const workbook = XLSX.readFile(path.join(fixtures, 'sample.xlsx'), { cellFormula: true });
const sales = workbook.Sheets['销售数据'];
sales['C2'].v = 1500;                       // 仅值变化
sales['D2'].f = 'C2/SUM(C2:C5)';             // 公式变化
sales['A5'] = { t: 's', v: '四月' };
sales['B5'] = { t: 's', v: '中文产品C' };
sales['C5'] = { t: 'n', v: 700 };
sales['!ref'] = 'A1:D5';
const summary = workbook.Sheets['汇总'];
summary['B2'].v = 4200;                      // 汇总值变化
summary['B3'].t = 's';                       // 类型变化：数值 → 文本
summary['B3'].v = '约 1300';
delete summary['B3'].f;

const xlsxTarget = path.join(targetDir, '修改版 sample.xlsx');
XLSX.writeFile(workbook, xlsxTarget);
console.log('generated ' + xlsxTarget + ' (' + fs.statSync(xlsxTarget).size + ' bytes)');

// 3) 占位 .doc：仅需触发「LibreOffice 缺失」提示，不参与真实解析。
const docTarget = path.join(targetDir, '旧格式 示例.doc');
fs.writeFileSync(docTarget, Buffer.from('dummy binary doc placeholder for LO-missing e2e check'));
console.log('generated ' + docTarget);
