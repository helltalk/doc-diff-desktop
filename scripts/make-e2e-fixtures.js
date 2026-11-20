'use strict';

/**
 * 生成端到端验收夹具：位于「中文 + 空格」路径下的修改版 docx / xlsx，
 * 以及真实的旧格式 doc / xls 夹具（OLE2 二进制）。
 *
 * 旧版脚本只写一个 dummy .doc 占位文件用于触发 LibreOffice 缺失横幅；
 * 新版 doc/xls 已改为纯 JS 直读，必须提供真实 OLE2 夹具，否则契约测试会失真。
 * LibreOffice 仅用于「生成夹具」，应用运行时完全不依赖它。
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

// 3) 真实旧格式夹具：若已是 OLE2 二进制则保留，否则用 LibreOffice 现场转换生成。
//    注意：绝不写回 dummy 占位文件——那会让「doc/xls 直读」契约测试失去意义。
const os = require('node:os');

function isOle2(filePath) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath).subarray(0, 4).toString('hex') === 'd0cf11e0';
}

function findSoffice() {
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ];
  return candidates.find(function (candidate) { return fs.existsSync(candidate); }) || '';
}

function resolveLegacySource(sourceName) {
  const direct = path.join(fixtures, sourceName);
  if (fs.existsSync(direct)) return direct;
  const nested = path.join(targetDir, sourceName);
  if (fs.existsSync(nested)) return nested;
  throw new Error('找不到旧格式夹具的源文件：' + sourceName);
}

function ensureLegacyFixture(sourceName, targetName, filter) {
  const target = path.join(targetDir, targetName);
  if (isOle2(target)) {
    console.log('kept real legacy fixture ' + targetName + ' (' + fs.statSync(target).size + ' bytes)');
    return;
  }
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error('缺少真实夹具 ' + targetName + ' 且未找到 LibreOffice；请安装 LibreOffice 后重新生成本夹具。');
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdiff-fixture-'));
  try {
    execFileSync(soffice, [
      '--headless', '--norestore', '--nolockcheck',
      '--convert-to', filter, '--outdir', tempDir, resolveLegacySource(sourceName)
    ], { stdio: 'inherit', timeout: 120000 });
    const stem = path.basename(sourceName, path.extname(sourceName));
    const produced = path.join(tempDir, stem + '.' + filter);
    if (!isOle2(produced)) throw new Error('LibreOffice 未生成有效的 OLE2 文件：' + produced);
    fs.copyFileSync(produced, target);
    console.log('generated real legacy fixture ' + targetName + ' (' + fs.statSync(target).size + ' bytes)');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

ensureLegacyFixture('sample.docx', '旧格式 示例.doc', 'doc');
ensureLegacyFixture('修改版 sample.docx', '修改版 旧格式 示例.doc', 'doc');
ensureLegacyFixture('sample.xlsx', '旧格式 示例.xls', 'xls');
ensureLegacyFixture('修改版 sample.xlsx', '修改版 旧格式 示例.xls', 'xls');
