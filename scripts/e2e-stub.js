'use strict';

/* 仅供 scripts/e2e-app.js 加载的无界面验收桩：用真实主进程解析器替代 IPC。 */

const fs = require('node:fs');
const path = require('node:path');
// 本文件被注入到 src/renderer/__e2e_harness.html，nodeIntegration 下 __dirname 为页面所在目录。
const root = path.join(__dirname, '..', '..');
const { parseXlsx } = require(path.join(root, 'src', 'main', 'parsers', 'parse-xlsx'));
const { parseDoc } = require(path.join(root, 'src', 'main', 'parsers', 'parse-doc'));
const { parsePdf } = require(path.join(root, 'src', 'main', 'parsers', 'parse-pdf'));

function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function fail(code, message) { return { ok: false, code: code, message: message }; }

// 隐藏窗口下 rAF 可能被节流，用宏任务替代以保证 nextFrame() 立即完成。
window.requestAnimationFrame = function (callback) {
  return setTimeout(function () { callback(Date.now()); }, 0);
};

window.__e2eWrites = [];
window.__e2ePaths = {
  docxOld: path.join(root, 'tests', 'fixtures', 'sample.docx'),
  docxNew: path.join(root, 'tests', 'fixtures', '中文 路径 测试', '修改版 sample.docx'),
  xlsxOld: path.join(root, 'tests', 'fixtures', 'sample.xlsx'),
  xlsxNew: path.join(root, 'tests', 'fixtures', '中文 路径 测试', '修改版 sample.xlsx'),
  docOld: path.join(root, 'tests', 'fixtures', '中文 路径 测试', '旧格式 示例.doc'),
  docNew: path.join(root, 'tests', 'fixtures', '中文 路径 测试', '修改版 旧格式 示例.doc'),
  xlsOld: path.join(root, 'tests', 'fixtures', '中文 路径 测试', '旧格式 示例.xls'),
  xlsNew: path.join(root, 'tests', 'fixtures', '中文 路径 测试', '修改版 旧格式 示例.xls'),
  scanPdf: path.join(root, 'tests', 'fixtures', 'sample-scan.pdf')
};

window.electronAPI = {
  selectFile: async function () { return ok(null); },
  saveFile: async function (options) {
    return ok(path.join(root, 'tests', 'fixtures', '__e2e_out_' + options.suggestedName));
  },
  // 与真实 preload 的原始契约保持一致：只接受字符串路径。
  // 旧桩按 {path} 对象实现，掩盖了渲染层与真实 preload 的契约差异，
  // 导致线上 '[object Object]' 缺陷漏检。若渲染层回退为对象入参，
  // fs.readFileSync 会直接报错，从而在 E2E 中暴露回归。
  readBuffer: async function (filePath) {
    try { return ok(new Uint8Array(fs.readFileSync(filePath))); }
    catch (err) { return fail('E_FILE_READ', err.message); }
  },
  parseXlsx: async function (options) {
    try { return ok(parseXlsx(options.path, options.meta || {})); }
    catch (err) { return fail('E_FILE_READ', err.message); }
  },
  parseDoc: async function (options) {
    try { return ok(await parseDoc(options.path, options.meta || {})); }
    catch (err) { return fail(err.code || 'E_FILE_READ', err.message); }
  },
  parsePdf: async function (options) {
    try { return ok(await parsePdf(options.path, options.meta || {})); }
    catch (err) { return fail(err.code || 'E_FILE_READ', err.message); }
  },
  checkLibreOffice: async function () { return ok({ installed: false }); },
  convert: async function () { return fail('E_LO_MISSING', '未检测到 LibreOffice'); },
  writeExport: async function (options) {
    window.__e2eWrites.push({
      path: options.path,
      encoding: options.encoding,
      length: options.content.length
    });
    return ok(null);
  },
  openExternal: async function () { return ok(null); },
  showHelp: async function () { return ok(null); },
  getPathForFile: function (file) { return file.path || ''; },
  onConvertProgress: function () { return function () {}; }
};
