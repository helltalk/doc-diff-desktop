'use strict';

/**
 * 真实链路最小验收：真实 preload.bundle.js + 真实主进程 IPC + 真实 sandbox 窗口。
 * 不使用 scripts/e2e-stub.js，专门验证线上缺陷 '[object Object]' 已消除：
 *   - readBuffer(字符串路径) 与 readBuffer({path:字符串}) 均返回 {ok:true}；
 *   - data 为 Uint8Array 且首字节为 0x50（PK zip 头，docx 为 zip 容器）。
 *
 * 运行方式：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/e2e-preload.js
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const preloadPath = path.join(root, 'src', 'preload', 'preload.bundle.js');
const pagePath = path.join(root, 'src', 'renderer', '__e2e_preload_probe.html');
const fixturePath = path.join(root, 'tests', 'fixtures', 'sample.docx');

fs.writeFileSync(pagePath, '<!DOCTYPE html><html><body>preload probe</body></html>', 'utf8');

function cleanup() {
  try {
    if (fs.existsSync(pagePath)) fs.unlinkSync(pagePath);
  } catch (err) {
    console.warn('[e2e-preload] 清理临时页面失败：' + err.message);
  }
}

function finish(passed) {
  if (!passed) process.exitCode = 1;
  cleanup();
  app.quit();
}

app.whenReady().then(function () {
  // 注册与生产环境完全一致的 IPC handler。
  require(path.join(root, 'src', 'main', 'ipc')).registerIpc();

  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.on('did-finish-load', function () {
    const probe = `(async function () {
      const p = ${JSON.stringify(fixturePath)};
      function summarize(r) {
        return {
          ok: !!(r && r.ok === true),
          code: r ? r.code : null,
          message: r ? r.message : null,
          isUint8Array: !!(r && r.data instanceof Uint8Array),
          length: r && r.data ? r.data.length : 0,
          firstByte: r && r.data && r.data.length ? r.data[0] : null
        };
      }
      const out = { hasApi: !!window.electronAPI };
      if (out.hasApi) {
        out.stringArg = summarize(await window.electronAPI.readBuffer(p));
        out.objectArg = summarize(await window.electronAPI.readBuffer({ path: p }));
      }
      return JSON.stringify(out);
    })()`;

    win.webContents.executeJavaScript(probe).then(function (json) {
      console.log('PRELOAD_E2E_RESULT=' + json);
      let parsed = null;
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        console.error('PRELOAD_E2E_PARSE_ERROR=' + err.message);
        finish(false);
        return;
      }
      const valid = function (r) {
        return r && r.ok === true && r.isUint8Array === true && r.length > 0 && r.firstByte === 0x50;
      };
      const passed = parsed.hasApi === true && valid(parsed.stringArg) && valid(parsed.objectArg);
      console.log(passed ? 'PRELOAD_E2E_PASS' : 'PRELOAD_E2E_FAIL');
      finish(passed);
    }).catch(function (err) {
      console.error('PRELOAD_E2E_ERROR=' + (err && err.stack ? err.stack : String(err)));
      finish(false);
    });
  });

  win.loadFile(pagePath).catch(function (err) {
    console.error('PRELOAD_E2E_LOAD_ERROR=' + err.message);
    finish(false);
  });
}).catch(function (err) {
  console.error('PRELOAD_E2E_READY_ERROR=' + (err && err.stack ? err.stack : String(err)));
  finish(false);
});
