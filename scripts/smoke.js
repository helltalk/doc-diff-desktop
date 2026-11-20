'use strict';

/** 无界面冒烟测试：验证 sandbox 预加载桥接与渲染页 DOM 是否就绪。 */

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(function () {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'preload.bundle.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.webContents.on('did-finish-load', function () {
    window.webContents.executeJavaScript([
      'JSON.stringify({',
      '  title: document.title,',
      '  api: typeof window.electronAPI,',
      '  methods: window.electronAPI ? Object.keys(window.electronAPI) : [],',
      '  hasCompareButton: !!document.getElementById("btnCompare"),',
      '  hasDiffList: !!document.getElementById("diffList")',
      '})'
    ].join('')).then(function (result) {
      console.log('SMOKE_RESULT=' + result);
      app.quit();
    }).catch(function (err) {
      console.error('SMOKE_ERROR=' + err.message);
      app.quit();
    });
  });

  window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
});
