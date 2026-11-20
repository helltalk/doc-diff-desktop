'use strict';

/**
 * 渲染层共享模块适配入口。
 *
 * 渲染进程处于 contextIsolation + sandbox 环境，无法直接 require CommonJS。
 * scripts/bundle-renderer.js 用 esbuild 把本文件与 shared/* 纯函数打成一个
 * 浏览器可用的 IIFE（shared.bundle.js），再挂到 window 上供 app.js 调用。
 *
 * 之所以不通过 contextBridge 暴露这些函数：contextBridge 对函数有代理限制，
 * 且这些是纯计算逻辑，放在渲染层可减少 IPC 往返。
 */

const diffCore = require('../shared/diff-core');
const docParsers = require('../shared/doc-parsers');
const cellDiff = require('../shared/cell-diff');
const constants = require('../shared/constants');
const exportNaming = require('../shared/export-naming');

window.diffCore = Object.freeze(diffCore);
window.docParsers = Object.freeze(docParsers);
window.cellDiff = Object.freeze(cellDiff);
window.exportNaming = Object.freeze(exportNaming);
// 错误码与保存过滤器沿用唯一定义处，避免渲染层硬编码 'E_XXX' 字面量。
window.appConstants = Object.freeze({
  ERR: constants.ERR,
  FILE_FILTERS: constants.FILE_FILTERS,
  SAVE_FILTERS: constants.SAVE_FILTERS
});
