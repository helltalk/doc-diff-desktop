'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLineOps,
  buildDiffs,
  commonPrefix,
  commonSuffix,
  charLcs,
  charDiff,
  escapeHtml
} = require('../src/shared/diff-core');

function diffOf(oldLines, newLines) {
  return buildDiffs(computeLineOps(oldLines, newLines));
}

test('纯新增：空文档 → 两行', function () {
  const diffs = diffOf([], ['第一行', '第二行']);
  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs.map(function (d) { return d.type; }), ['added', 'added']);
  assert.equal(diffs[0].newLine, 1);
  assert.equal(diffs[1].newLine, 2);
  assert.equal(diffs[0].oldLine, null);
});

test('纯删除：两行 → 空文档', function () {
  const diffs = diffOf(['第一行', '第二行'], []);
  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs.map(function (d) { return d.type; }), ['removed', 'removed']);
  assert.equal(diffs[0].oldLine, 1);
  assert.equal(diffs[1].oldLine, 2);
});

test('中间修改成对配对为 modified', function () {
  const diffs = diffOf(['甲', '乙', '丙'], ['甲', '乙改', '丙']);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].type, 'modified');
  assert.equal(diffs[0].oldLine, 2);
  assert.equal(diffs[0].newLine, 2);
  assert.equal(diffs[0].oldText, '乙');
  assert.equal(diffs[0].newText, '乙改');
});

test('混合增删改：结果按新文档行号有序', function () {
  const oldLines = ['A', 'B', 'C', 'D'];
  const newLines = ['A', 'B2', 'C', 'D', 'E'];
  const diffs = diffOf(oldLines, newLines);
  assert.equal(diffs.length, 2);
  assert.equal(diffs[0].type, 'modified');
  assert.equal(diffs[1].type, 'added');
  const lineNumbers = diffs.map(function (d) { return d.newLine == null ? d.oldLine : d.newLine; });
  assert.deepEqual(lineNumbers, [2, 5]);
});

test('完全相同的文档无差异', function () {
  const lines = ['一', '二', '三', '', '五'];
  assert.deepEqual(diffOf(lines, lines.slice()), []);
});

test('空文档对空文档无差异', function () {
  assert.deepEqual(diffOf([], []), []);
});

test('一方为空文档时全部记为新增或删除', function () {
  const content = ['', '', '只有内容'];
  assert.equal(diffOf(content, []).length, 3);
  assert.equal(diffOf([], content).length, 3);
});

test('超大文档降级为整体替换且不崩溃', function () {
  // 中间段 2100 × 2100 = 4,410,000 > 4,000,000，触发降级分支。
  const oldLines = Array.from({ length: 2100 }, function (_v, i) { return 'A' + i; });
  const newLines = Array.from({ length: 2100 }, function (_v, i) { return 'B' + i; });
  const ops = computeLineOps(oldLines, newLines);
  const diffs = buildDiffs(ops);
  assert.equal(ops.length, 4200);
  // 降级产生等量 delete/insert，buildDiffs 会将其两两配成 modified。
  assert.equal(diffs.length, 2100);
  assert.equal(diffs.filter(function (d) { return d.type === 'modified'; }).length, 2100);
  assert.ok(diffs.every(function (d) { return d.oldText.startsWith('A') && d.newText.startsWith('B'); }));
});

test('首尾公共行在降级时仍然保留', function () {
  const midA = Array.from({ length: 2100 }, function (_v, i) { return 'A' + i; });
  const midB = Array.from({ length: 2100 }, function (_v, i) { return 'B' + i; });
  const oldLines = ['HEAD'].concat(midA, ['TAIL']);
  const newLines = ['HEAD'].concat(midB, ['TAIL']);
  const diffs = diffOf(oldLines, newLines);
  assert.equal(diffs.length, 2100);
  assert.ok(!diffs.some(function (d) { return (d.oldText || d.newText) === 'HEAD'; }));
  assert.ok(!diffs.some(function (d) { return (d.oldText || d.newText) === 'TAIL'; }));
});

test('commonPrefix / commonSuffix 边界', function () {
  assert.equal(commonPrefix('abcdef', 'abcxyz'), 3);
  assert.equal(commonPrefix('', 'abc'), 0);
  assert.equal(commonSuffix('abcdef', 'xyzdef', 0), 3);
  // prefixLen 只缩小比较窗口，不影响尾部相同字符的计数。
  assert.equal(commonSuffix('abcdef', 'xyzdef', 3), 3);
  assert.equal(commonSuffix('abcdef', 'xyzabc', 0), 0);
});

test('charLcs 返回按序字符操作', function () {
  const ops = charLcs('abc', 'ac');
  assert.deepEqual(ops.map(function (op) { return op.type; }), ['equal', 'delete', 'equal']);
  assert.deepEqual(ops.map(function (op) { return op.ch; }), ['a', 'b', 'c']);
});

test('charDiff 生成 ins/del 高亮 HTML', function () {
  const result = charDiff('你好世界', '你好祖国');
  assert.match(result.oldHtml, /<del>世界<\/del>/);
  assert.match(result.newHtml, /<ins>祖国<\/ins>/);
  assert.ok(result.oldHtml.startsWith('你好'));
  assert.ok(result.newHtml.startsWith('你好'));
});

test('charDiff 超长中段降级为整段标记', function () {
  const oldText = 'a'.repeat(300) + 'OLD';
  const newText = 'a'.repeat(300) + 'NEW';
  const result = charDiff(oldText, newText);
  assert.match(result.oldHtml, /<del>OLD<\/del>/);
  assert.match(result.newHtml, /<ins>NEW<\/ins>/);
});

test('escapeHtml 转义五种特殊字符', function () {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});
