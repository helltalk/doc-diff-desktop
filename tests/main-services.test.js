'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { ERR } = require('../src/shared/constants');
const { parseXlsx } = require('../src/main/parsers/parse-xlsx');
const { parsePdf } = require('../src/main/parsers/parse-pdf');
const { writeExport, ensureHtmlCharset } = require('../src/main/exporter');
const { toFileMeta } = require('../src/main/dialogs');
const { findOutput } = require('../src/main/converter');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = function (name) { return path.join(FIXTURES, name); };

function makeMeta(filePath) {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    ext: path.extname(filePath).slice(1).toLowerCase()
  };
}

test('parseXlsx 返回两个工作表且中文表头与公式完整', function () {
  const filePath = fixture('sample.xlsx');
  const doc = parseXlsx(filePath, makeMeta(filePath));
  assert.equal(doc.kind, 'sheet');
  assert.equal(doc.sheets.length, 2);
  assert.deepEqual(doc.sheets.map(function (s) { return s.name; }), ['销售数据', '汇总']);

  const first = doc.sheets[0];
  assert.equal(first.rowCount, 4);
  assert.equal(first.colCount, 4);
  assert.equal(first.rows[0][0].value, '月份');
  assert.equal(first.rows[1][1].value, '中文产品A');

  const formulaCells = [];
  for (const row of first.rows) {
    for (const cell of row) if (cell.type === 'formula') formulaCells.push(cell);
  }
  assert.equal(formulaCells.length, 3);
  assert.equal(formulaCells[0].ref, 'D2');
  assert.equal(formulaCells[0].formula, 'C2/SUM(C2:C4)');
});

test('parseXlsx 空单元格保留为占位 Cell', function () {
  const filePath = fixture('sample.xlsx');
  const doc = parseXlsx(filePath, makeMeta(filePath));
  const allRefs = doc.sheets[0].rows.flat().map(function (cell) { return cell.ref; });
  assert.ok(allRefs.includes('A1'));
  assert.ok(allRefs.includes('D4'));
});

test('parsePdf 从有文本层的 PDF 提取中文行', async function () {
  const filePath = fixture('sample.pdf');
  const doc = await parsePdf(filePath, makeMeta(filePath));
  assert.equal(doc.kind, 'text');
  const text = doc.lines.join('');
  assert.ok(text.includes('文档差异对比测试样例'), '应提取到中文标题');
  assert.ok(text.includes('中文段落'), '应提取到中文段落');
});

test('parsePdf 对扫描件抛出 E_PDF_NO_TEXT', async function () {
  const filePath = fixture('sample-scan.pdf');
  await assert.rejects(
    function () { return parsePdf(filePath, makeMeta(filePath)); },
    function (err) {
      return err.code === ERR.PDF_NO_TEXT && /没有可提取的文本层/.test(err.message);
    }
  );
});

test('ensureHtmlCharset 仅在缺失时注入 meta', function () {
  assert.match(ensureHtmlCharset('<html><head></head></html>'), /<meta charset="utf-8">/);
  const already = '<html><head><meta charset="gbk"></head></html>';
  assert.equal(ensureHtmlCharset(already), already);
});

test('writeExport 按 utf8bom 写入 BOM，按 utf8 不写 BOM', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdiff-export-test-'));
  try {
    const bomPath = path.join(dir, '清单.txt');
    await writeExport(bomPath, '中文', 'utf8bom');
    assert.equal(fs.readFileSync(bomPath, 'utf8'), '\ufeff中文');

    const plainPath = path.join(dir, '报告.html');
    await writeExport(plainPath, '<html><head></head><body>中文</body></html>', 'utf8');
    const content = fs.readFileSync(plainPath, 'utf8');
    assert.equal(content.charAt(0), '<');
    assert.match(content, /<meta charset="utf-8">/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('toFileMeta 原样保留 UNC 路径', function () {
  const unc = '\\\\server\\share\\文档 目录\\报告.docx';
  const meta = toFileMeta(unc);
  assert.equal(meta.path, unc);
  assert.equal(meta.name, '报告.docx');
  assert.equal(meta.ext, 'docx');
});

test('findOutput 按扩展名在中文文件名中定位唯一输出', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdiff-findout-test-'));
  try {
    fs.writeFileSync(path.join(dir, '转换后 文档.docx'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'y');
    fs.mkdirSync(path.join(dir, 'profile'));
    const found = findOutput(dir, 'docx');
    assert.equal(path.basename(found), '转换后 文档.docx');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findOutput 无匹配输出时抛 E_CONVERT_NO_OUTPUT', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdiff-findout-empty-'));
  try {
    assert.throws(
      function () { findOutput(dir, 'xlsx'); },
      function (err) { return err.code === ERR.CONVERT_NO_OUTPUT && /未生成/.test(err.message); }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
