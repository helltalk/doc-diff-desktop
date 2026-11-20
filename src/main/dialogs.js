'use strict';

/**
 * 原生对话框服务。
 * 关键约束：UNC 路径（\\server\share\xxx）原样保留，不做 path.resolve，
 * 否则会破坏 \\ 前缀导致网络映射盘文件无法读取。
 */

const path = require('node:path');
const fs = require('node:fs');
const { ERR, FILE_FILTERS, SAVE_FILTERS } = require('../shared/constants');
const { serviceError } = require('./service-error');

/** 惰性获取原生 dialog：node:test 直接测 toFileMeta 时无需 Electron 运行时。 */
function getDialog() {
  return process.versions.electron ? require('electron').dialog : null;
}

/**
 * 构造 FileMeta。
 * @param {string} filePath 原始路径（可为 UNC）
 * @returns {{path:string,name:string,size:number,ext:string}}
 */
function toFileMeta(filePath) {
  const original = String(filePath || '');
  const name = path.basename(original);
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  let size = 0;
  try {
    size = fs.statSync(original).size;
  } catch (err) {
    console.warn('[dialogs] 无法读取文件信息：' + original, err.message);
  }
  return { path: original, name: name, size: size, ext: ext };
}

/**
 * 打开文件选择对话框（支持多选，返回第一个文件的 FileMeta）。
 * @param {BrowserWindow|null} parentWindow 父窗口
 * @returns {Promise<FileMeta|null>} 用户取消时返回 null
 */
async function showOpenDialog(parentWindow) {
  const dialog = getDialog();
  if (!dialog) throw serviceError(ERR.DIALOG_FAILED, '当前环境不支持原生文件对话框。');
  let result;
  try {
    result = await dialog.showOpenDialog(parentWindow || undefined, {
      title: '选择要对比的文档',
      properties: ['openFile', 'multiSelections'],
      filters: FILE_FILTERS.slice()
    });
  } catch (err) {
    throw serviceError(ERR.DIALOG_FAILED, '打开文件选择对话框失败：' + err.message, err);
  }
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
  return toFileMeta(result.filePaths[0]);
}

/**
 * 打开保存对话框。
 * @param {BrowserWindow|null} parentWindow 父窗口
 * @param {{suggestedName?:string,filters?:Array}} options 选项
 * @returns {Promise<string|null>} 用户取消时返回 null
 */
async function showSaveDialog(parentWindow, options) {
  const opts = options || {};
  const suggestedName = String(opts.suggestedName || '文档差异清单.txt');
  const ext = path.extname(suggestedName).replace(/^\./, '').toLowerCase();
  const filters = Array.isArray(opts.filters) && opts.filters.length
    ? opts.filters
    : (SAVE_FILTERS[ext] || []);

  const dialog = getDialog();
  if (!dialog) throw serviceError(ERR.DIALOG_FAILED, '当前环境不支持原生保存对话框。');
  let result;
  try {
    result = await dialog.showSaveDialog(parentWindow || undefined, {
      title: '选择保存位置',
      defaultPath: suggestedName,
      filters: filters,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
  } catch (err) {
    throw serviceError(ERR.DIALOG_FAILED, '打开保存对话框失败：' + err.message, err);
  }
  if (result.canceled || !result.filePath) return null;
  return String(result.filePath);
}

module.exports = { showOpenDialog, showSaveDialog, toFileMeta };
