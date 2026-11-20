'use strict';

/**
 * IPC 处理器注册中心。
 * 每个 handler 均经 wrap 统一包装：成功返回 {ok:true,data}，
 * 失败返回 {ok:false,code,message,detail?} 并把堆栈写入 console。
 * 所有通道名来自 shared/constants.js，禁止硬编码字符串。
 */

const fs = require('node:fs/promises');
const { ipcMain, shell, BrowserWindow } = require('electron');
const { IPC, ERR, MAX_FILE_SIZE } = require('../shared/constants');
const { serviceError } = require('./service-error');
const dialogs = require('./dialogs');
const converter = require('./converter');
const exporter = require('./exporter');
const { parseXlsx } = require('./parsers/parse-xlsx');
const { parseDoc } = require('./parsers/parse-doc');
const { parsePdf } = require('./parsers/parse-pdf');

/** 统一包装 IPC handler。 */
function wrap(handler, fallbackCode) {
  return async function (event, payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    try {
      const data = await handler(event, input);
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      const code = (err && typeof err.code === 'string' && err.code.indexOf('E_') === 0)
        ? err.code
        : fallbackCode;
      const message = (err && err.message) ? String(err.message) : '操作失败';
      console.error('[ipc] 处理失败，通道回退码 ' + fallbackCode + '，实际错误码 ' + code + '：' + message, err);
      const result = { ok: false, code: code, message: message };
      if (err && err.stack) result.detail = String(err.stack);
      return result;
    }
  };
}

/** 文件读取：返回 Uint8Array（结构化克隆，不走 base64）。 */
async function readBuffer(_event, payload) {
  const filePath = String(payload.path || '');
  if (!filePath) throw serviceError(ERR.FILE_NOT_FOUND, '未提供文件路径。');

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (err) {
    throw serviceError(ERR.FILE_NOT_FOUND, '文件不存在或不可访问：' + filePath, err);
  }
  if (!stats.isFile()) throw serviceError(ERR.FILE_READ, '指定路径不是文件：' + filePath);
  if (stats.size > MAX_FILE_SIZE) {
    throw serviceError(ERR.FILE_TOO_LARGE,
      '文件超过 ' + Math.round(MAX_FILE_SIZE / 1024 / 1024) + ' MB 上限，请先拆分后再对比。');
  }

  try {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer);
  } catch (err) {
    throw serviceError(ERR.FILE_READ, '读取文件失败：' + err.message, err);
  }
}

/** 转换：把进度事件推回发起请求的渲染进程。 */
async function runConvert(event, payload) {
  const sender = event.sender;
  const onProgress = function (progress) {
    try {
      if (!sender.isDestroyed()) sender.send(IPC.CONVERT_PROGRESS, progress);
    } catch (err) {
      console.warn('[ipc] 推送转换进度失败：', err.message);
    }
  };
  return converter.convert(payload.inputPath, payload.targetFormat, payload.jobId, onProgress);
}

/** Excel 解析：meta 缺失时由路径现场构造（xlsx 与 xls 均走 SheetJS 直读）。 */
async function parseWorkbook(_event, payload) {
  const filePath = String(payload.path || '');
  if (!filePath) throw serviceError(ERR.FILE_NOT_FOUND, '未提供 Excel 文件路径。');
  const meta = payload.meta || dialogs.toFileMeta(filePath);
  return parseXlsx(filePath, meta);
}

/** 老式 .doc 解析：word-extractor 纯 JS 直提正文，无需 LibreOffice。 */
async function parseLegacyDoc(_event, payload) {
  const filePath = String(payload.path || '');
  if (!filePath) throw serviceError(ERR.FILE_NOT_FOUND, '未提供 .doc 文件路径。');
  const meta = payload.meta || dialogs.toFileMeta(filePath);
  return parseDoc(filePath, meta);
}

/** PDF 解析：meta 缺失时由路径现场构造。 */
async function parseDocument(_event, payload) {
  const filePath = String(payload.path || '');
  if (!filePath) throw serviceError(ERR.FILE_NOT_FOUND, '未提供 PDF 文件路径。');
  const meta = payload.meta || dialogs.toFileMeta(filePath);
  return parsePdf(filePath, meta);
}

/** 外部链接：仅允许 https。 */
async function openExternal(_event, payload) {
  const url = String(payload.url || '');
  if (!/^https:\/\//i.test(url)) {
    throw serviceError(ERR.EXTERNAL_BLOCKED, '出于安全考虑，仅允许打开 https:// 开头的链接。');
  }
  try {
    await shell.openExternal(url);
  } catch (err) {
    throw serviceError(ERR.EXTERNAL_BLOCKED, '打开外部链接失败：' + err.message, err);
  }
  return null;
}

/**
 * 注册全部 IPC handler。可重复调用（先移除旧 handler）。
 */
function registerIpc() {
  const activeWindow = function (event) {
    return BrowserWindow.fromWebContents(event.sender);
  };

  const bindings = [
    [IPC.DIALOG_SELECT_FILE, wrap(function (event) {
      return dialogs.showOpenDialog(activeWindow(event));
    }, ERR.DIALOG_FAILED)],
    [IPC.DIALOG_SAVE_FILE, wrap(function (event, payload) {
      return dialogs.showSaveDialog(activeWindow(event), payload);
    }, ERR.DIALOG_FAILED)],
    [IPC.FILE_READ_BUFFER, wrap(readBuffer, ERR.FILE_READ)],
    [IPC.CONVERT_RUN, wrap(runConvert, ERR.CONVERT_FAILED)],
    [IPC.PARSE_XLSX, wrap(parseWorkbook, ERR.FILE_READ)],
    [IPC.PARSE_DOC, wrap(parseLegacyDoc, ERR.FILE_READ)],
    [IPC.PARSE_PDF, wrap(parseDocument, ERR.FILE_READ)],
    [IPC.LIBREOFFICE_CHECK, wrap(function () {
      return converter.detect();
    }, ERR.LO_MISSING)],
    [IPC.EXPORT_WRITE, wrap(function (_event, payload) {
      return exporter.writeExport(payload.path, payload.content, payload.encoding);
    }, ERR.EXPORT_WRITE)],
    [IPC.SHELL_OPEN_EXTERNAL, wrap(openExternal, ERR.EXTERNAL_BLOCKED)]
  ];

  for (const [channel, handler] of bindings) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}

module.exports = { registerIpc, wrap };
