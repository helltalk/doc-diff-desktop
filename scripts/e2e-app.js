'use strict';

/**
 * 无界面端到端验收：加载真实 index.html（注入桩 API），验证
 *   1) 两份 docx（中文/空格路径）→ 文本差异清单；
 *   2) 两份 xlsx → 单元格差异表 + 第三 Tab 可见；
 *   3) 原生导出链路（saveFile → writeExport）；
 *   4) 扫描 PDF 无文本层 → 中文提示横幅；
 *   5) 真实 .doc（中文/空格路径，word-extractor 直读）→ 文本差异清单；
 *   6) 混合格式（docx vs xlsx）→ 强制通用清单、隐藏单元格 Tab；
 *   7) 真实 .xls（SheetJS 直读）→ 单元格差异表。
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const rendererDir = path.join(root, 'src', 'renderer');
const harnessPath = path.join(rendererDir, '__e2e_harness.html');

const sourceHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const harnessHtml = sourceHtml.replace(
  '<script src="shared.bundle.js"></script>',
  '<script src="../../scripts/e2e-stub.js"></script>\n<script src="shared.bundle.js"></script>'
);
if (harnessHtml === sourceHtml) {
  console.error('[e2e] 无法在 index.html 中定位 shared.bundle.js 引用');
  app.quit();
} else {
  fs.writeFileSync(harnessPath, harnessHtml, 'utf8');
}

function cleanup() {
  try {
    if (fs.existsSync(harnessPath)) fs.unlinkSync(harnessPath);
  } catch (err) {
    console.warn('[e2e] 清理临时页面失败：' + err.message);
  }
}

const scenarioScript = `(async function () {
  const results = {};
  const nodePath = require('node:path');
  function meta(p) {
    return { path: p, name: nodePath.basename(p), size: require('node:fs').statSync(p).size,
             ext: nodePath.extname(p).slice(1).toLowerCase() };
  }
  function shortStatus() {
    return document.getElementById('status').textContent.trim().replace(/\\s+/g, ' ').slice(0, 140);
  }

  // 1) DOCX（中文 + 空格路径）
  setFile('old', meta(window.__e2ePaths.docxOld));
  setFile('new', meta(window.__e2ePaths.docxNew));
  await runCompare();
  results.docx = {
    mode: state.mode,
    view: state.view,
    compared: state.compared,
    diffCount: state.diffs.length,
    types: Array.from(new Set(state.diffs.map(function (d) { return d.type; }))),
    hasCards: document.querySelectorAll('#diffList .diff-card').length > 0,
    status: shortStatus(),
    newPathHasChineseAndSpace: /中文 路径 测试/.test(state.files.new.path)
  };

  // 2) XLSX（中文 + 空格路径）→ 单元格差异表
  setFile('old', meta(window.__e2ePaths.xlsxOld));
  setFile('new', meta(window.__e2ePaths.xlsxNew));
  await runCompare();
  results.xlsx = {
    mode: state.mode,
    view: state.view,
    cellDiffCount: state.cellDiffs.length,
    tableRows: document.querySelectorAll('.cell-table tbody tr').length,
    cellTabVisible: !document.querySelector('button[data-view="cell"]').classList.contains('hidden'),
    changeKinds: Array.from(new Set(state.cellDiffs.map(function (d) { return d.changeKind; }))).sort(),
    firstCell: state.cellDiffs[0] || null,
    status: shortStatus(),
    newPathHasChineseAndSpace: /中文 路径 测试/.test(state.files.new.path)
  };

  // 3) 原生导出链路
  await exportCsv();
  results.export = window.__e2eWrites[window.__e2eWrites.length - 1] || null;

  // 4) 扫描 PDF 无文本层
  setFile('old', meta(window.__e2ePaths.docxOld));
  setFile('new', meta(window.__e2ePaths.scanPdf));
  await runCompare();
  results.scanPdf = {
    bannerVisible: !document.getElementById('pdfNotice').classList.contains('hidden'),
    status: shortStatus()
  };

  // 5) 真实 .doc 直读（中文 + 空格路径，word-extractor）
  setFile('old', meta(window.__e2ePaths.docOld));
  setFile('new', meta(window.__e2ePaths.docNew));
  await runCompare();
  results.doc = {
    mode: state.mode,
    compared: state.compared,
    diffCount: state.diffs.length,
    hasCards: document.querySelectorAll('#diffList .diff-card').length > 0,
    status: shortStatus(),
    pathsHaveChineseAndSpace: /中文 路径 测试/.test(state.files.old.path)
      && /中文 路径 测试/.test(state.files.new.path)
  };

  // 6) 混合格式：docx vs xlsx → 通用清单、隐藏单元格 Tab
  setFile('old', meta(window.__e2ePaths.docxOld));
  setFile('new', meta(window.__e2ePaths.xlsxOld));
  await runCompare();
  results.mixed = {
    mode: state.mode,
    view: state.view,
    cellTabHidden: document.querySelector('button[data-view="cell"]').classList.contains('hidden'),
    diffCount: state.diffs.length,
    listVisible: !document.getElementById('listView').classList.contains('hidden')
  };

  // 7) 真实 .xls 直读（SheetJS，无 LibreOffice 转换）
  setFile('old', meta(window.__e2ePaths.xlsOld));
  setFile('new', meta(window.__e2ePaths.xlsNew));
  await runCompare();
  results.xls = {
    mode: state.mode,
    view: state.view,
    cellDiffCount: state.cellDiffs.length,
    tableRows: document.querySelectorAll('.cell-table tbody tr').length,
    cellTabVisible: !document.querySelector('button[data-view="cell"]').classList.contains('hidden'),
    status: shortStatus(),
    newPathHasChineseAndSpace: /中文 路径 测试/.test(state.files.new.path)
  };

  return JSON.stringify(results);
})()`;

app.whenReady().then(function () {
  const window = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true
    }
  });

  window.webContents.on('did-finish-load', function () {
    window.webContents.executeJavaScript(scenarioScript).then(function (json) {
      console.log('E2E_RESULT=' + json);
      cleanup();
      app.quit();
    }).catch(function (err) {
      console.error('E2E_ERROR=' + (err && err.stack ? err.stack : err));
      cleanup();
      app.quit();
    });
  });

  window.webContents.on('console-message', function (_event, level, message) {
    if (level >= 2) console.error('[e2e-renderer] ' + message);
  });

  window.loadFile(harnessPath).catch(function (err) {
    console.error('E2E_LOAD_ERROR=' + err.message);
    cleanup();
    app.quit();
  });
});
