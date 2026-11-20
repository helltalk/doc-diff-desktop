'use strict';

/**
 * 共享常量：IPC 通道、错误码、文件类型映射、超时配置。
 * 本文件是通道名与错误码的唯一定义处，主进程与 preload 均从此导入，
 * 严禁在其它文件中硬编码通道字符串或错误码字面量。
 */

/** IPC 通道常量。 */
const IPC = Object.freeze({
  DIALOG_SELECT_FILE: 'dialog:select-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',
  FILE_READ_BUFFER: 'file:read-buffer',
  CONVERT_RUN: 'convert:run',
  PARSE_XLSX: 'parse:xlsx',
  PARSE_DOC: 'parse:doc',
  PARSE_PDF: 'parse:pdf',
  LIBREOFFICE_CHECK: 'libreoffice:check',
  EXPORT_WRITE: 'export:write',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
  CONVERT_PROGRESS: 'convert:progress',
  HELP_SHOW: 'help:show'
});

/** 统一错误码。 */
const ERR = Object.freeze({
  DIALOG_FAILED: 'E_DIALOG_FAILED',
  FILE_NOT_FOUND: 'E_FILE_NOT_FOUND',
  FILE_READ: 'E_FILE_READ',
  FILE_TOO_LARGE: 'E_FILE_TOO_LARGE',
  LO_MISSING: 'E_LO_MISSING',
  CONVERT_FAILED: 'E_CONVERT_FAILED',
  CONVERT_TIMEOUT: 'E_CONVERT_TIMEOUT',
  CONVERT_NO_OUTPUT: 'E_CONVERT_NO_OUTPUT',
  EXPORT_WRITE: 'E_EXPORT_WRITE',
  EXTERNAL_BLOCKED: 'E_EXTERNAL_BLOCKED',
  PDF_NO_TEXT: 'E_PDF_NO_TEXT'
});

/**
 * 文件扩展名到处理类型的映射。
 * - text: 渲染进程可直接解码为文本行
 * - docx: 渲染进程用内联 ZIP+DOMParser 解析
 * - doc/xls: 主进程专用解析器直读（doc→word-extractor，xls→SheetJS），无需 LibreOffice
 * - xlsx/pdf: 主进程专用解析器
 */
const FILE_KIND_MAP = Object.freeze({
  txt: 'text', text: 'text', md: 'text', markdown: 'text', csv: 'text',
  log: 'text', json: 'text', xml: 'text', ini: 'text', yaml: 'text', yml: 'text',
  docx: 'docx',
  doc: 'doc',
  xlsx: 'xlsx',
  xls: 'xls',
  pdf: 'pdf'
});

/** 打开对话框的 7 类格式过滤器（Electron 规则：name + extensions）。 */
const FILE_FILTERS = Object.freeze([
  { name: '全部支持格式', extensions: ['docx', 'doc', 'xlsx', 'xls', 'pdf', 'txt', 'md', 'csv', 'text', 'log', 'json', 'xml', 'ini', 'yaml', 'yml'] },
  { name: 'Word 文档 (*.docx;*.doc)', extensions: ['docx', 'doc'] },
  { name: 'Excel 表格 (*.xlsx;*.xls)', extensions: ['xlsx', 'xls'] },
  { name: 'PDF 文档 (*.pdf)', extensions: ['pdf'] },
  { name: '文本文件 (*.txt;*.md;*.csv)', extensions: ['txt', 'md', 'csv', 'text', 'log'] }
]);

/** 保存对话框按扩展名给出的过滤器。 */
const SAVE_FILTERS = Object.freeze({
  html: [{ name: 'HTML 网页 (*.html)', extensions: ['html'] }],
  txt: [{ name: '文本文件 (*.txt)', extensions: ['txt'] }],
  csv: [{ name: 'CSV 表格 (*.csv)', extensions: ['csv'] }]
});

/** LibreOffice 转换超时（毫秒）。 */
const CONVERT_TIMEOUT_MS = 60000;

/** 单文件读取上限（字节）：超过则拒绝，防止大文件导致渲染进程卡死。 */
const MAX_FILE_SIZE = 200 * 1024 * 1024;

module.exports = {
  IPC,
  ERR,
  FILE_KIND_MAP,
  FILE_FILTERS,
  SAVE_FILTERS,
  CONVERT_TIMEOUT_MS,
  MAX_FILE_SIZE
};
