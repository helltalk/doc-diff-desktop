'use strict';

/**
 * 真实 .doc 直读契约测试。
 *
 * 夹具由 LibreOffice 把 tests/fixtures/sample.docx 转成 OLE2 二进制（d0cf11e0），
 * 只在生成夹具时使用 LibreOffice；本测试与被测代码全程纯 JS，不依赖外部程序。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { ERR } = require('../src/shared/constants');
const { parseDoc, bodyToLines } = require('../src/main/parsers/parse-doc');

const LEGACY_DIR = path.join(__dirname, 'fixtures', '中文 路径 测试');
const REAL_DOC = path.join(LEGACY_DIR, '旧格式 示例.doc');
const REAL_DOC_NEW = path.join(LEGACY_DIR, '修改版 旧格式 示例.doc');

function makeMeta(filePath) {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    ext: 'doc'
  };
}

test('真实 .doc 是 OLE2 二进制夹具（非 dummy 占位文件）', function () {
  for (const filePath of [REAL_DOC, REAL_DOC_NEW]) {
    assert.ok(fs.existsSync(filePath), '缺少真实 .doc 夹具：' + filePath);
    assert.ok(fs.statSync(filePath).size > 4096, '.doc 夹具不应是占位文本');
    assert.equal(fs.readFileSync(filePath).subarray(0, 4).toString('hex'), 'd0cf11e0');
  }
});

test('parseDoc 从真实 .doc（中文+空格路径）提取中文、Tab 与换行', async function () {
  const doc = await parseDoc(REAL_DOC, makeMeta(REAL_DOC));
  assert.equal(doc.kind, 'text');
  assert.equal(doc.meta.path, REAL_DOC);
  assert.equal(doc.meta.viaConversion, false, 'doc 不再经过任何转换');
  assert.deepEqual(doc.lines, [
    '文档差异对比测试样例',
    '这是第一段中文段落。',
    '列A\t列B',
    '换行后内容',
    '最后一段：ABC 123'
  ]);
  assert.ok(doc.lines.some(function (line) { return line.indexOf('\t') >= 0; }), '制表符应保留');
});

test('parseDoc 两份真实 .doc 内容有差异，可直接用于文本对比', async function () {
  const oldDoc = await parseDoc(REAL_DOC, makeMeta(REAL_DOC));
  const newDoc = await parseDoc(REAL_DOC_NEW, makeMeta(REAL_DOC_NEW));
  assert.notDeepEqual(oldDoc.lines, newDoc.lines);
  assert.ok(newDoc.lines.some(function (line) { return line.indexOf('已修改') >= 0; }));
  assert.ok(newDoc.lines.some(function (line) { return line.indexOf('新增的段落') >= 0; }));
});

test('bodyToLines 兼容 CRLF / CR / LF 并去掉结尾换行的空行', function () {
  assert.deepEqual(bodyToLines('甲\r\n乙\r丙\n丁\n'), ['甲', '乙', '丙', '丁']);
  assert.deepEqual(bodyToLines('A\tB\nC'), ['A\tB', 'C']);
  assert.deepEqual(bodyToLines(''), []);
  assert.deepEqual(bodyToLines(null), []);
});

test('parseDoc 损坏文件抛中文 E_FILE_READ 错误', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdiff-doc-test-'));
  const broken = path.join(dir, '损坏 示例.doc');
  try {
    fs.writeFileSync(broken, 'dummy binary doc placeholder for e2e check');
    await assert.rejects(
      function () { return parseDoc(broken, makeMeta(broken)); },
      function (err) {
        return err.code === ERR.FILE_READ
          && /读取 \.doc 文件失败/.test(err.message)
          && err.message.indexOf(broken) >= 0;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseDoc UNC 路径原样传递（不做规范化改写）', async function () {
  const unc = '\\\\server\\share\\文档 目录\\旧格式 示例.doc';
  await assert.rejects(
    function () { return parseDoc(unc, { path: unc, name: '旧格式 示例.doc', ext: 'doc' }); },
    function (err) {
      return err.code === ERR.FILE_READ && err.message.indexOf(unc) >= 0;
    }
  );
});
