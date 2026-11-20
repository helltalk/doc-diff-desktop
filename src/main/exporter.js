'use strict';

/** 导出文件写入服务：统一处理 UTF-8 BOM 与 HTML charset 声明。 */

const path = require('node:path');
const fs = require('node:fs/promises');
const { ERR } = require('../shared/constants');
const { serviceError } = require('./service-error');

/**
 * 为 HTML 内容补齐 charset 声明。
 * @param {string} content 原始 HTML
 * @returns {string} 带 charset 的 HTML
 */
function ensureHtmlCharset(content) {
  if (/<meta[^>]+charset\s*=/i.test(content)) return content;
  const meta = '<meta charset="utf-8">';
  const headMatch = content.match(/<head[^>]*>/i);
  if (headMatch) {
    const index = headMatch.index + headMatch[0].length;
    return content.slice(0, index) + '\n' + meta + content.slice(index);
  }
  return meta + '\n' + content;
}

/**
 * 按指定编码写入文件。
 * @param {string} filePath 目标路径（可 UNC）
 * @param {string} content 文本正文
 * @param {'utf8'|'utf8bom'} encoding 编码
 * @returns {Promise<null>}
 */
async function writeExport(filePath, content, encoding) {
  if (!filePath || typeof filePath !== 'string') {
    throw serviceError(ERR.EXPORT_WRITE, '未提供导出文件路径。');
  }

  const mode = String(encoding || 'utf8').toLowerCase();
  let text = content == null ? '' : String(content);

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') text = ensureHtmlCharset(text);

  const data = (mode === 'utf8bom' || mode === 'utf-8-bom' || mode === 'bom')
    ? '\ufeff' + text
    : text;

  try {
    await fs.writeFile(filePath, data, { encoding: 'utf8', flag: 'w' });
  } catch (err) {
    throw serviceError(ERR.EXPORT_WRITE, '写入导出文件失败：' + err.message, err);
  }
  return null;
}

module.exports = { writeExport, ensureHtmlCharset };
