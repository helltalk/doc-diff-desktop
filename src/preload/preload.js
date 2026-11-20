'use strict';

/**
 * 预加载脚本：通过 contextBridge 暴露最小白名单 API。
 * 本文件由 scripts/bundle-preload.js 打包为 preload.bundle.js 后再被主进程加载，
 * 以便在 sandbox:true 的限制下仍可复用 ../shared/constants.js 的通道常量。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { IPC } = require('../shared/constants');

/** 统一调用：所有 invoke 都经过此函数，便于错误处理归一化。 */
function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

/**
 * 入参归一化：兼容「字符串」与「{key: 字符串}」两种调用形式。
 *
 * 兼容原因（线上 bug hotfix）：本 preload 的原始契约是「字符串」，由 preload 自行
 * 包装成 {path}/{url} 再发往主进程；但渲染层曾按 E2E 桩 API 的对象形式调用，导致
 * 主进程收到 { path: { path: 'E:\\...' } }，String() 后变成字面量 '[object Object]'，
 * fs.stat 失败并抛出 E_FILE_NOT_FOUND。此处同时接受两种形式，既能修复线上问题，
 * 也能防止渲染层再次回退到错误调用方式时复发。
 *
 * @param {*} value 入参（字符串或包含指定键的对象）
 * @param {string} key 对象形式下的属性名（'path' 或 'url'）
 * @returns {*} 归一化后的值；合法入参下必为字符串
 */
function unwrapString(value, key) {
  if (value && typeof value === 'object' && typeof value[key] === 'string') {
    return value[key];
  }
  return value;
}

const electronAPI = Object.freeze({
  /** 选择文件：入参 {filters?} → {ok,data:FileMeta|null,...} */
  selectFile: function (options) {
    return invoke(IPC.DIALOG_SELECT_FILE, options || {});
  },

  /** 保存文件：入参 {suggestedName,filters?} → {ok,data:string|null,...} */
  saveFile: function (options) {
    return invoke(IPC.DIALOG_SAVE_FILE, options || {});
  },

  /** 读取文件为 Uint8Array：入参字符串路径或 {path}（兼容历史对象形式） */
  readBuffer: function (filePath) {
    return invoke(IPC.FILE_READ_BUFFER, { path: unwrapString(filePath, 'path') });
  },

  /** 运行 LibreOffice 转换：入参 {inputPath,targetFormat,jobId} */
  convert: function (options) {
    return invoke(IPC.CONVERT_RUN, options || {});
  },

  /** 解析 xls/xlsx 为 SheetDocument：入参 {path,meta} */
  parseXlsx: function (options) {
    return invoke(IPC.PARSE_XLSX, options || {});
  },

  /** 解析老式 .doc 为 TextDocument（word-extractor 直提，无需 LibreOffice）：入参 {path,meta} */
  parseDoc: function (options) {
    return invoke(IPC.PARSE_DOC, options || {});
  },

  /** 解析 pdf 文本层为 TextDocument：入参 {path,meta} */
  parsePdf: function (options) {
    return invoke(IPC.PARSE_PDF, options || {});
  },

  /** 检测 LibreOffice 安装状态 */
  checkLibreOffice: function () {
    return invoke(IPC.LIBREOFFICE_CHECK);
  },

  /** 写入导出文件：入参 {path,content,encoding} */
  writeExport: function (options) {
    return invoke(IPC.EXPORT_WRITE, options || {});
  },

  /** 打开外部链接（仅 https）：入参字符串 URL 或 {url}（兼容历史对象形式） */
  openExternal: function (url) {
    return invoke(IPC.SHELL_OPEN_EXTERNAL, { url: unwrapString(url, 'url') });
  },

  /** 显示帮助 / 关于对话框：入参 {kind:'help'|'about'} */
  showHelp: function (options) {
    return invoke(IPC.HELP_SHOW, options || {});
  },

  /** 从 File 对象取真实路径（网络映射盘场景必须） */
  getPathForFile: function (file) {
    return webUtils.getPathForFile(file);
  },

  /**
   * 订阅转换进度事件。
   * @param {Function} callback 接收 {jobId,phase,percent,message}
   * @returns {Function} 取消订阅函数
   */
  onConvertProgress: function (callback) {
    if (typeof callback !== 'function') return function () {};
    const listener = function (_event, payload) { callback(payload); };
    ipcRenderer.on(IPC.CONVERT_PROGRESS, listener);
    return function () {
      ipcRenderer.removeListener(IPC.CONVERT_PROGRESS, listener);
    };
  }
});

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
