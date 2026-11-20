'use strict';

/**
 * PDF 文本层提取（pdfjs-dist v6）。
 * 已通过 scripts/pdf-probe.mjs 实测：legacy/build/pdf.mjs 在 Electron 内置 Node 22
 * 中可直接 getDocument 并提取中文文本；v6 关闭文档使用 cleanup() 而非 destroy()。
 * worker 指向 asarUnpack 解包后的真实文件；若加载失败则退路为 workerPort。
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
// 仅在真正的 Electron 运行时加载 app；node:test 直接测解析逻辑时为 null。
const app = process.versions.electron ? require('electron').app : null;
const { ERR } = require('../../shared/constants');
const { serviceError } = require('../service-error');

/** @type {Promise<object>|null} pdfjs 模块缓存 */
let pdfjsPromise = null;
/** @type {object|null} 退路 worker 实例 */
let workerFallback = null;

const WORKER_RELATIVE = path.join('node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs');

/** 解析 worker 真实路径：打包后位于 app.asar.unpacked，开发时位于项目 node_modules。 */
function resolveWorkerPath() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', WORKER_RELATIVE);
  }
  // __dirname 为 src/main/parsers，需上溯三级到项目根目录。
  return path.join(__dirname, '..', '..', '..', WORKER_RELATIVE);
}

/** 懒加载 pdfjs 并配置 worker。 */
async function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = (async function () {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerPath = resolveWorkerPath();
    const workerUrl = pathToFileURL(workerPath).href;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    pdfjs.GlobalWorkerOptions.workerPort = null;
    return { pdfjs: pdfjs, workerUrl: workerUrl, workerPath: workerPath };
  })().catch(async function (err) {
    console.warn('[pdf] workerSrc 加载失败，尝试 workerPort 退路：', err.message);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { Worker } = require('node:worker_threads');
    workerFallback = new Worker(resolveWorkerPath(), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerSrc = '';
    pdfjs.GlobalWorkerOptions.workerPort = workerFallback;
    return { pdfjs: pdfjs, workerUrl: '(workerPort)', workerPath: resolveWorkerPath() };
  });

  return pdfjsPromise;
}

/**
 * 将文本项按 y 坐标聚合为行，同一行内按 x 间距补空格。
 * @param {Array<object>} items getTextContent().items
 * @returns {string[]} 逐行文本
 */
function itemsToLines(items) {
  const visible = (items || []).filter(function (item) {
    return item && typeof item.str === 'string' && item.str.length > 0;
  }).map(function (item) {
    const transform = item.transform || [0, 0, 0, 0, 0, 0];
    return { str: item.str, x: transform[4] || 0, y: transform[5] || 0, width: item.width || 0 };
  });

  visible.sort(function (a, b) {
    if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
    return a.x - b.x;
  });

  const lines = [];
  let current = null;
  for (const item of visible) {
    if (!current || Math.abs(current.y - item.y) > 3) {
      current = { y: item.y, parts: [], lastX: null, lastWidth: 0 };
      lines.push(current);
    }
    if (current.lastX !== null && item.x - (current.lastX + current.lastWidth) > 1.5) {
      current.parts.push(' ');
    }
    current.parts.push(item.str);
    current.lastX = item.x;
    current.lastWidth = item.width;
  }

  return lines.map(function (line) { return line.parts.join('').trim(); })
    .filter(function (line) { return line.length > 0; });
}

/**
 * 解析 PDF 文本层为 TextDocument。
 * @param {string} filePath PDF 路径（可 UNC）
 * @param {FileMeta} meta 文件元信息
 * @returns {Promise<TextDocument>}
 */
async function parsePdf(filePath, meta) {
  let bytes;
  try {
    bytes = new Uint8Array(await fs.readFile(filePath));
  } catch (err) {
    throw serviceError(ERR.FILE_READ, '读取 PDF 文件失败：' + err.message, err);
  }

  const loaded = await loadPdfjs();
  const options = { data: bytes, useSystemFonts: true, isEvalSupported: false };
  let doc = null;
  try {
    doc = await loaded.pdfjs.getDocument(options).promise;
  } catch (err) {
    // asar 内 workerSrc 可能加载失败（错误在 getDocument 时惰性抛出），
    // 此时切换到 workerPort 后重试一次，data 需重新拷贝防止 buffer 被转移。
    if (/worker/i.test(err.message || '')) {
      console.warn('[pdf] workerSrc 惰性加载失败，切换 workerPort 重试：', err.message);
      try {
        const { Worker } = require('node:worker_threads');
        loaded.pdfjs.GlobalWorkerOptions.workerSrc = '';
        if (!workerFallback) workerFallback = new Worker(loaded.workerPath, { type: 'module' });
        loaded.pdfjs.GlobalWorkerOptions.workerPort = workerFallback;
        doc = await loaded.pdfjs.getDocument({
          data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false
        }).promise;
      } catch (retryErr) {
        throw serviceError(ERR.FILE_READ, 'PDF 文件解析失败（worker 初始化失败）：' + retryErr.message, retryErr);
      }
    } else {
      throw serviceError(ERR.FILE_READ, 'PDF 文件解析失败（可能已加密或损坏）：' + err.message, err);
    }
  }

  const lines = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageLines = itemsToLines(content.items);
      for (const line of pageLines) lines.push(line);
      if (pageNumber < doc.numPages) lines.push(''); // 页间空行，保留原始分页感
    }
  } catch (err) {
    throw serviceError(ERR.FILE_READ, '提取 PDF 文本层失败：' + err.message, err);
  } finally {
    if (doc && typeof doc.cleanup === 'function') {
      doc.cleanup().catch(function (err) { console.warn('[pdf] 清理文档失败：', err.message); });
    } else if (doc && typeof doc.destroy === 'function') {
      doc.destroy();
    }
  }

  const charCount = lines.join('').replace(/\s/g, '').length;
  if (charCount === 0 || charCount < 10 * doc.numPages) {
    throw serviceError(ERR.PDF_NO_TEXT,
      '该 PDF 没有可提取的文本层（可能是扫描件或纯图片），无法进行文本差异对比。请先用 OCR 识别或转换为 docx/txt。');
  }

  return {
    kind: 'text',
    meta: Object.assign({}, meta, { viaConversion: false }),
    lines: lines
  };
}

module.exports = { parsePdf, itemsToLines, loadPdfjs, resolveWorkerPath };
