'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const rendererDir = path.join(root, 'src', 'renderer');

/** 在隔离沙箱中执行 shared.bundle.js，模拟浏览器加载。 */
function loadSharedBundle() {
  const sandbox = { window: {}, console: console };
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(path.join(rendererDir, 'shared.bundle.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'shared.bundle.js' });
  return sandbox.window;
}

test('shared.bundle.js 暴露渲染层所需全部命名空间与方法', function () {
  const win = loadSharedBundle();
  assert.equal(typeof win.diffCore, 'object');
  assert.equal(typeof win.docParsers, 'object');
  assert.equal(typeof win.cellDiff, 'object');
  assert.equal(typeof win.appConstants, 'object');

  for (const name of ['computeLineOps', 'buildDiffs', 'charDiff', 'escapeHtml']) {
    assert.equal(typeof win.diffCore[name], 'function', 'diffCore.' + name);
  }
  for (const name of ['fileKind', 'decodeTextBuffer', 'parseDocx']) {
    assert.equal(typeof win.docParsers[name], 'function', 'docParsers.' + name);
  }
  assert.equal(typeof win.cellDiff.diff, 'function');
  assert.equal(typeof win.cellDiff.alignSheets, 'function');
  assert.equal(typeof win.appConstants.ERR.PDF_NO_TEXT, 'string');
  assert.equal(typeof win.appConstants.ERR.LO_MISSING, 'string');
  assert.ok(Array.isArray(win.appConstants.SAVE_FILTERS.csv));
});

test('app.js 引用的 DOM id 全部存在于 index.html', function () {
  const appJs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const used = new Set(Array.from(appJs.matchAll(/\$\('([^']+)'\)/g)).map(function (m) { return m[1]; }));
  const declared = new Set(Array.from(html.matchAll(/id="([^"]+)"/g)).map(function (m) { return m[1]; }));
  const missing = Array.from(used).filter(function (id) { return !declared.has(id); });
  assert.deepEqual(missing, []);
  assert.ok(declared.has('cellView'));
  assert.ok(declared.has('loBanner'));
  assert.ok(declared.has('pdfNotice'));
  assert.ok(declared.has('convertProgress'));
});

test('index.html 先加载 shared.bundle.js 再加载 app.js', function () {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const sharedIndex = html.indexOf('src="shared.bundle.js"');
  const appIndex = html.indexOf('src="app.js"');
  assert.ok(sharedIndex >= 0 && appIndex > sharedIndex);
});

test('app.js 中出现的 window 命名空间均由 bundle 或 preload 提供', function () {
  const appJs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
  const namespaces = Array.from(appJs.matchAll(/window\.([A-Za-z_$][\w$]*)/g))
    .map(function (m) { return m[1]; });
  const allowed = new Set(['electronAPI', 'diffCore', 'docParsers', 'cellDiff', 'appConstants', 'print']);
  const unknown = Array.from(new Set(namespaces)).filter(function (name) { return !allowed.has(name); });
  assert.deepEqual(unknown, []);
});

test('app.js 调用 readBuffer/openExternal 遵循 preload 字符串入参契约', function () {
  const appJs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
  // 禁止回退到对象入参：该形式曾导致 '[object Object]' 线上缺陷。
  assert.ok(!/api\.readBuffer\(\s*\{/.test(appJs), 'app.js 不应向 readBuffer 传 {path} 对象');
  assert.ok(!/api\.openExternal\(\s*\{/.test(appJs), 'app.js 不应向 openExternal 传 {url} 对象');
  // 必须保留正确的字符串调用点。
  assert.ok(/api\.readBuffer\(meta\.path\)/.test(appJs), '缺少 readBuffer(meta.path) 调用');
  assert.ok(/api\.readBuffer\(outputPath\)/.test(appJs), '缺少 readBuffer(outputPath) 调用');
  assert.ok(/api\.openExternal\(LO_DOWNLOAD_URL\)/.test(appJs), '缺少 openExternal(LO_DOWNLOAD_URL) 调用');
});

test('E2E 桩 readBuffer 只接受字符串路径，不再掩盖真实 preload 契约', function () {
  const stub = fs.readFileSync(path.join(root, 'scripts', 'e2e-stub.js'), 'utf8');
  assert.ok(/readBuffer:\s*async function \(filePath\)/.test(stub), '桩 readBuffer 应接收字符串路径');
  assert.ok(!/readBuffer:\s*async function \(options\)/.test(stub), '桩不应再按 {path} 对象实现');
  assert.ok(!/readFileSync\(options\.path\)/.test(stub), '桩不应再读取 options.path');
  assert.ok(/readFileSync\(filePath\)/.test(stub), '桩应读取字符串路径');
});
