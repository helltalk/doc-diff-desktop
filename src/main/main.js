'use strict';

/**
 * Electron 主进程入口。
 * 职责：单实例锁、应用生命周期、创建窗口、注册 IPC。
 * 安全约束：contextIsolation / sandbox / webSecurity 全开，nodeIntegration 关闭，
 * 仅通过 contextBridge 暴露白名单 API，且只加载本地 index.html。
 */

const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');
const { registerIpc } = require('./ipc');

/** @type {BrowserWindow|null} 主窗口引用。 */
let mainWindow = null;

/** 单实例锁：重复启动时聚焦已有窗口。 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(function () {
    registerIpc();
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch(function (err) {
    console.error('[main] 应用启动失败：', err);
  });
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

/** 创建主窗口。 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '文档差异对比工具',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.bundle.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  // 只加载本地文件，禁止加载任何远程内容。
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 外链一律交给系统浏览器，且仅允许 https。
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    const url = String(details.url || '');
    if (url.startsWith('https://')) {
      shell.openExternal(url).catch(function (err) {
        console.error('[main] 打开外部链接失败：', err);
      });
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}
