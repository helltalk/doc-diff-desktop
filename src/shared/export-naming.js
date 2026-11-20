'use strict';

/**
 * 导出文件命名：默认按两份源文件的主文件名生成，便于归档时一一对应。
 * 纯函数，不依赖 Node/Electron API，可同时用于渲染层与单元测试。
 */

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const DEFAULT_MAX_LENGTH = 120;
const DEFAULT_STEM = '未命名';

/**
 * 取可用于文件名的主文件名（不含扩展名）。
 * - 兼容传入完整路径；
 * - 去掉 Windows 非法字符与结尾的空格/点；
 * - 超长时截断并以 ~ 标记，避免保存对话框因文件名过长失败。
 */
function safeStem(name, maxLength) {
  let text = String(name == null ? '' : name).trim();
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  if (slash >= 0) text = text.slice(slash + 1);

  const dot = text.lastIndexOf('.');
  if (dot > 0) text = text.slice(0, dot);

  text = text.replace(ILLEGAL_CHARS, '_').replace(/\s+/g, ' ').trim();
  text = text.replace(/[. ]+$/, '');
  if (!text) text = DEFAULT_STEM;

  if (text.length > maxLength) {
    text = text.slice(0, Math.max(1, maxLength - 1)) + '~';
  }
  return text;
}

/**
 * 生成导出文件名。
 *
 * 规则：
 * - 两个主文件名不同：`旧名_vs_新名_差异清单.csv`
 * - 两个主文件名相同（仅格式/后缀不同）：`旧名_差异清单.csv`
 * - 总长度默认不超过 120 个字符；非法字符会被替换为下划线。
 *
 * @param {string} oldName 原文档文件名或路径
 * @param {string} newName 新文档文件名或路径
 * @param {string} suffix  导出后缀，如 `差异清单.csv` / `差异报告.html`
 * @param {{maxLength?: number}} [options]
 * @returns {string}
 */
function buildExportFileName(oldName, newName, suffix, options) {
  const maxLength = options && Number(options.maxLength) > 0
    ? Math.floor(Number(options.maxLength))
    : DEFAULT_MAX_LENGTH;
  const tail = '_' + String(suffix == null || suffix === '' ? '差异清单' : suffix);
  const budget = Math.max(20, maxLength - tail.length);
  const each = Math.max(8, Math.floor((budget - 4) / 2));

  const oldStem = safeStem(oldName, each);
  const newStem = safeStem(newName, each);
  const pair = oldStem === newStem ? oldStem : oldStem + '_vs_' + newStem;

  if (pair.length + tail.length <= maxLength) return pair + tail;
  return pair.slice(0, Math.max(1, maxLength - tail.length)) + tail;
}

module.exports = { buildExportFileName, safeStem };
