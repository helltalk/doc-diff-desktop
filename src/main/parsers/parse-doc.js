'use strict';

/**
 * 老式 .doc（OLE2 二进制）解析：word-extractor 纯 JS 直提正文。
 *
 * 与 parse-pdf.js 返回契约一致：{kind:'text', meta, lines:string[]}。
 * word-extractor 的 extract() 是异步 Promise，因此 parseDoc 也是 async。
 * 全程不调用 LibreOffice / Word，中文、Tab、换行按原文保留。
 */

const WordExtractor = require('word-extractor');
const { ERR } = require('../../shared/constants');
const { serviceError } = require('../service-error');

/**
 * 将正文文本拆为行数组：保留行序与制表符，仅去掉结尾换行产生的空行。
 * @param {string} body word-extractor 的 getBody() 结果
 * @returns {string[]} 逐行文本
 */
function bodyToLines(body) {
  const text = typeof body === 'string' ? body : '';
  const lines = text.split(/\r\n|\r|\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * 解析 .doc 为 TextDocument。
 * @param {string} filePath .doc 文件路径（可含中文/空格，可为 UNC）
 * @param {FileMeta} meta 文件元信息
 * @returns {Promise<TextDocument>}
 */
async function parseDoc(filePath, meta) {
  const target = String(filePath || '');
  if (!target) throw serviceError(ERR.FILE_READ, '未提供 .doc 文件路径。');

  let extracted;
  try {
    extracted = await new WordExtractor().extract(target);
  } catch (err) {
    throw serviceError(ERR.FILE_READ,
      '读取 .doc 文件失败（' + target + '，文件可能已损坏、加密或不是有效的 Word 97 文档）：'
      + (err && err.message ? err.message : String(err)), err);
  }

  let body;
  try {
    body = extracted.getBody();
  } catch (err) {
    throw serviceError(ERR.FILE_READ,
      '提取 .doc 正文失败：' + (err && err.message ? err.message : String(err)), err);
  }

  return {
    kind: 'text',
    meta: Object.assign({}, meta, { viaConversion: false }),
    lines: bodyToLines(body)
  };
}

module.exports = { parseDoc, bodyToLines };
