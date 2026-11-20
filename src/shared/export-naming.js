'use strict';

/**
 * 导出文件命名：按两份源文件生成适合归档的名字。
 * 纯函数，不依赖 Node/Electron API，可同时用于渲染层与单元测试。
 */

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const DEFAULT_MAX_LENGTH = 120;
const DEFAULT_STEM = '未命名';

/** 比较用词元：中文串、英文字母、数字/版本号；位置用于回切原始字符串。 */
const TOKEN_RE = /[\u3400-\u9FFF]+|[A-Za-z]+|\d+(?:\.\d+)*/g;

/** 版本标记词。两份文件名只在版本标记上不同时，可安全省略。 */
const VERSION_LABELS = new Set([
  'rev', 'revision', 'ver', 'version', 'v', 'r', 'rc', 'beta', 'alpha', 'final', 'draft', 'release',
  '版', '版本', '修订', '修订版', '终版', '最终版', '定稿', '草稿', '初稿', '发布版',
  '正式版', '预览版', '测试版', '第'
]);

const TRAILING_SEPARATORS = /[\s\-_—()（）\[\]【】.,;，。；:：]+$/;

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

/** 按词元切分，保留原始起止位置，便于取回未被改写的原始片段。 */
function tokenize(text) {
  const tokens = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      normalized: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tokens;
}

/** 剩余片段是否只由版本标记/数字组成（如 " rev 1.4"、"-终版"）。 */
function isVersionish(rest) {
  const tokens = tokenize(rest);
  if (tokens.length === 0) return true;
  return tokens.every(function (token) {
    return VERSION_LABELS.has(token.normalized) || /^\d+(?:\.\d+)*$/.test(token.text);
  });
}

/** 去掉公共前缀末尾的 "rev" / "v" 等版本引导词，保留产品/文档主体名。 */
function trimTrailingVersionLabels(prefix) {
  let end = prefix.length;
  let removed = false;
  const tokens = tokenize(prefix);
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (!VERSION_LABELS.has(last.normalized)) break;
    end = last.start;
    removed = true;
    tokens.pop();
  }
  if (!removed) return prefix;
  return prefix.slice(0, end).replace(TRAILING_SEPARATORS, '').trim();
}

/**
 * 选用于导出名的主体：
 * - 完全相同 → 直接用该主体；
 * - 只有版本号/rev 等不同 → 用公共主体名（去掉末尾的 rev/v 等引导词）；
 * - 其它差异 → 保留 `旧名_vs_新名`，避免丢失有意义的区分信息。
 */
function chooseStemPair(oldStem, newStem) {
  if (oldStem === newStem) return oldStem;

  const oldTokens = tokenize(oldStem);
  const newTokens = tokenize(newStem);
  let common = 0;
  while (common < oldTokens.length && common < newTokens.length
         && oldTokens[common].normalized === newTokens[common].normalized) {
    common += 1;
  }
  if (common === 0) return oldStem + '_vs_' + newStem;

  const oldEnd = oldTokens[common - 1].end;
  const newEnd = newTokens[common - 1].end;
  const oldRest = oldStem.slice(oldEnd);
  const newRest = newStem.slice(newEnd);
  // 若剩余部分只有标点（如结尾的 ")"），应把它算进公共前缀而不是丢掉。
  const prefixEnd = tokenize(oldRest).length === 0 ? oldStem.length : oldEnd;
  const prefixRaw = oldStem.slice(0, prefixEnd);

  if (!isVersionish(oldRest) || !isVersionish(newRest)) return oldStem + '_vs_' + newStem;

  const prefix = trimTrailingVersionLabels(prefixRaw);
  return prefix || (oldStem + '_vs_' + newStem);
}

/**
 * 生成导出文件名。
 *
 * 规则：
 * - `OTM 7000 K产品技术要求 rev 1.4` vs `... rev 1.5` → `OTM 7000 K产品技术要求_差异清单.txt`
 * - `合同A` vs `合同B` → `合同A_vs_合同B_差异清单.csv`（非版本差异不合并）
 * - 两个主文件名相同（仅格式不同）→ `报价单_差异清单.txt`
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
  const maxStemLength = Math.max(20, maxLength - tail.length);

  // 先保留完整主名做版本识别，最后再统一截断，避免截断提前抹掉版本差异。
  const oldStem = safeStem(oldName, 1000);
  const newStem = safeStem(newName, 1000);
  let pair = chooseStemPair(oldStem, newStem);

  if (pair.length > maxStemLength - 1) {
    pair = pair.slice(0, Math.max(1, maxStemLength - 1)) + '~';
  }
  return pair + tail;
}

module.exports = { buildExportFileName, safeStem, chooseStemPair };
