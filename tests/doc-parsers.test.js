'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { MiniDOMParser } = require('./helpers/dom-shim');

// Node 环境没有 DOMParser，注入测试用兼容层；渲染进程使用浏览器原生实现。
if (typeof globalThis.DOMParser === 'undefined') globalThis.DOMParser = MiniDOMParser;

const {
  fileKind,
  decodeTextBuffer,
  findZipEntry,
  inflateRawJS,
  inflateRawAsync,
  parseDocumentXml,
  parseDocx
} = require('../src/shared/doc-parsers');

const FIXTURES = path.join(__dirname, 'fixtures');

function fixture(name) {
  return path.join(FIXTURES, name);
}

test('fileKind 覆盖桌面版 7 类格式', function () {
  assert.equal(fileKind('报告.docx'), 'docx');
  assert.equal(fileKind('报告.DOC'), 'doc');
  assert.equal(fileKind('表格.xlsx'), 'xlsx');
  assert.equal(fileKind('表格.xls'), 'xls');
  assert.equal(fileKind('扫描.PDF'), 'pdf');
  assert.equal(fileKind('notes.md'), 'text');
  assert.equal(fileKind('日志.log'), 'text');
  assert.equal(fileKind('无扩展名'), 'text');
});

test('decodeTextBuffer 识别 UTF-8 BOM', async function () {
  const body = Buffer.from('中文测试 UTF8 BOM', 'utf8');
  const bytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body]);
  assert.equal(await decodeTextBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), '中文测试 UTF8 BOM');
});

test('decodeTextBuffer 识别 UTF-16LE BOM', async function () {
  const body = Buffer.from('中文LE', 'utf16le');
  const bytes = Buffer.concat([Buffer.from([0xFF, 0xFE]), body]);
  assert.equal(await decodeTextBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), '中文LE');
});

test('decodeTextBuffer 识别 UTF-16BE BOM', async function () {
  const body = Buffer.from([0x4E, 0x2D, 0x65, 0x87]); // 中文
  const bytes = Buffer.concat([Buffer.from([0xFE, 0xFF]), body]);
  assert.equal(await decodeTextBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), '中文');
});

test('decodeTextBuffer 回退到 GBK 解码', async function () {
  const gbkBytes = Uint8Array.from([0xD6, 0xD0, 0xCE, 0xC4]); // 中文
  assert.equal(await decodeTextBuffer(gbkBytes.buffer), '中文');
});

test('decodeTextBuffer 纯 ASCII 走 UTF-8', async function () {
  assert.equal(await decodeTextBuffer(Buffer.from('hello world', 'utf8')), 'hello world');
});

test('inflateRawJS 与 Node zlib.deflateRawSync 互操作', function () {
  const original = Buffer.from('重复的重复的重复的中文文本 ABC ABC ABC '.repeat(20), 'utf8');
  const compressed = zlib.deflateRawSync(original);
  const inflated = inflateRawJS(new Uint8Array(compressed), original.length);
  assert.deepEqual(Buffer.from(inflated), original);
});

test('inflateRawAsync 结果与纯 JS 实现一致', async function () {
  const original = Buffer.from('一致性校验：ABC中文ABC'.repeat(30), 'utf8');
  const compressed = new Uint8Array(zlib.deflateRawSync(original));
  const viaStream = await inflateRawAsync(compressed, original.length);
  assert.deepEqual(Buffer.from(viaStream), original);
});

test('findZipEntry 损坏 ZIP 抛中文错误', function () {
  const garbage = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
  assert.throws(function () { findZipEntry(garbage, 'word/document.xml'); }, /无法识别 DOCX/);
});

test('parseDocumentXml 提取段落、tab 与换行', function () {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + '<w:p><w:r><w:t>第一段中文</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t></w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const lines = parseDocumentXml(xml);
  assert.deepEqual(lines, ['第一段中文', 'A\tB', 'C', '']);
});

test('parseDocx 从 sample.docx 提取中文段落与制表符', async function () {
  const buffer = fs.readFileSync(fixture('sample.docx'));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const lines = await parseDocx(arrayBuffer);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length >= 4, '至少应有 4 行');
  assert.equal(lines[0], '文档差异对比测试样例');
  assert.ok(lines.some(function (line) { return line.includes('中文段落'); }));
  assert.ok(lines.some(function (line) { return line.includes('\t'); }), '应包含 tab 字符');
});

test('parseDocx 损坏文件报错', async function () {
  const broken = Uint8Array.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x01, 0x02]);
  await assert.rejects(
    function () { return parseDocx(broken.buffer); },
    function (err) { return err instanceof Error && /无法识别 DOCX|损坏|未在/.test(err.message); }
  );
});

test('parseDocx 合法 ZIP 但缺少 document.xml 时报错', async function () {
  const zipPath = fixture('no-document.docx');
  if (!fs.existsSync(zipPath)) return;
  const buffer = fs.readFileSync(zipPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await assert.rejects(
    function () { return parseDocx(arrayBuffer); },
    /未在 .docx 中找到 word\/document.xml/
  );
});

test('中文路径占位目录存在', function () {
  assert.ok(fs.existsSync(path.join(FIXTURES, '中文 路径 测试')));
});
