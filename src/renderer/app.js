'use strict';

/* ===================== 依赖（由 shared.bundle.js 注入 window） ===================== */
const api = window.electronAPI;
const diffCore = window.diffCore;
const docParsers = window.docParsers;
const cellEngine = window.cellDiff;
const exportNaming = window.exportNaming;
const APP_ERR = window.appConstants.ERR;
const SAVE_FILTERS = window.appConstants.SAVE_FILTERS;

const escapeHtml = diffCore.escapeHtml;
const computeLineOps = diffCore.computeLineOps;
const buildDiffs = diffCore.buildDiffs;
const charDiff = diffCore.charDiff;

const LO_DOWNLOAD_URL = 'https://www.libreoffice.org/download/download/';
const MAX_CELL_ROWS_RENDERED = 5000;

/* ===================== 全局状态 ===================== */
const state = {
  // 改造点 1：存 FileMeta（含真实 path），不再是浏览器的 File 对象。
  files: { old: null, new: null },
  oldDoc: null,
  newDoc: null,
  oldLines: [],
  newLines: [],
  diffs: [],       // TextDiffEntry[]
  cellDiffs: [],   // CellDiffEntry[]
  mode: 'text',    // 'text' | 'sheet'：决定统计/导出/默认视图
  view: 'list',    // 'list' | 'side' | 'cell'
  filter: 'all',
  search: '',
  busy: false,
  compared: false
};

/* ===================== 通用工具 ===================== */
function $(id) { return document.getElementById(id); }

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatSize(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function nextFrame() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(resolve); });
  });
}

let toastTimer = 0;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
}

function showStatus(type, message) {
  const el = $('status');
  el.className = 'status ' + (type || '');
  if (type === 'none') {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const icons = { empty: '&#128193;', loading: '&#8987;', error: '&#9888;&#65039;', ok: '&#9989;' };
  el.innerHTML = '<div class="status-icon">' + (icons[type] || '') + '</div><div>' + escapeHtml(message) + '</div>';
}

/** 统一横幅：扫描 PDF 无文本层等提示（doc/xls 直读后不再有 LibreOffice 缺失提示）。 */
function showBanner(kind, message) {
  const banner = $(kind === 'lo' ? 'loBanner' : 'pdfNotice');
  const text = $(kind === 'lo' ? 'loBannerText' : 'pdfNoticeText');
  if (!banner || !text) return;
  text.textContent = message;
  banner.classList.remove('hidden');
}

function hideBanners() {
  $('loBanner').classList.add('hidden');
  $('pdfNotice').classList.add('hidden');
}

/** 把 IPC 的统一返回解包；失败时抛出带 code 的 Error。 */
function call(result) {
  if (!result || typeof result !== 'object') throw new Error('接口返回无效结果，请重试。');
  if (result.ok) return result.data;
  const err = new Error(result.message || '操作失败');
  err.code = result.code || '';
  err.detail = result.detail || '';
  throw err;
}

function fileKindOf(meta) {
  return docParsers.fileKind(meta && (meta.name || meta.path));
}

/** 从拖拽 File 构造 FileMeta：网络映射盘必须用 getPathForFile 取真实路径。 */
function fileMetaFromFile(file) {
  let realPath = '';
  try {
    realPath = api.getPathForFile ? String(api.getPathForFile(file) || '') : '';
  } catch (err) {
    realPath = '';
  }
  const fallbackName = String(file.name || '');
  const name = fallbackName || baseName(realPath);
  const dot = name.toLowerCase().lastIndexOf('.');
  return {
    path: realPath,
    name: name,
    size: Number(file.size) || 0,
    ext: dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  };
}

/** 兼容 / 与 \ 两种分隔符的文件名提取（渲染层无 node:path）。 */
function baseName(filePath) {
  const text = String(filePath || '');
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return slash >= 0 ? text.slice(slash + 1) : text;
}

/** 导出文件名：按两份上传文件的主文件名生成，归档时可直接对应源文件。 */
function exportFileName(suffix) {
  return exportNaming.buildExportFileName(
    state.files.old && (state.files.old.name || state.files.old.path),
    state.files.new && (state.files.new.name || state.files.new.path),
    suffix
  );
}

/** 结构化克隆的 Uint8Array → ArrayBuffer（供 parseDocx 使用）。 */
function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes && bytes.buffer instanceof ArrayBuffer) {
    const offset = bytes.byteOffset || 0;
    const length = bytes.byteLength || 0;
    if (offset === 0 && length === bytes.buffer.byteLength) return bytes.buffer;
    return bytes.buffer.slice(offset, offset + length);
  }
  return new Uint8Array(bytes || []).buffer;
}

/* ===================== 文档读取与类型分流 ===================== */
/**
 * 把任意支持格式归一化为：
 *   {kind:'text', lines:string[]} 或 {kind:'sheet', sheetDoc:SheetDocument}
 * doc/xls 均为纯 JS 直读：doc → word-extractor，xls/xlsx → SheetJS，无需 LibreOffice。
 */
async function loadDocument(meta) {
  const kind = fileKindOf(meta);

  if (kind === 'text' || kind === 'docx') {
    const bytes = call(await api.readBuffer(meta.path));
    const buffer = toArrayBuffer(bytes);
    if (kind === 'docx') {
      return { kind: 'text', lines: await docParsers.parseDocx(buffer), meta: meta };
    }
    const text = await docParsers.decodeTextBuffer(buffer);
    return { kind: 'text', lines: String(text).split(/\r\n|\r|\n/), meta: meta };
  }

  if (kind === 'doc') {
    const doc = call(await api.parseDoc({ path: meta.path, meta: meta }));
    return { kind: 'text', lines: Array.isArray(doc.lines) ? doc.lines : [], meta: meta };
  }

  if (kind === 'pdf') {
    const doc = call(await api.parsePdf({ path: meta.path, meta: meta }));
    return { kind: 'text', lines: Array.isArray(doc.lines) ? doc.lines : [], meta: meta };
  }

  if (kind === 'xlsx' || kind === 'xls') {
    const doc = call(await api.parseXlsx({ path: meta.path, meta: meta }));
    return { kind: 'sheet', sheetDoc: doc, meta: meta };
  }

  throw new Error('暂不支持的文件类型：' + (meta.name || meta.path));
}

/** SheetDocument → 「Sheet名 / A1: 值」文本行，用于混合格式对比与通用清单。 */
function sheetToLines(sheetDoc) {
  const lines = [];
  const sheets = (sheetDoc && sheetDoc.sheets) || [];
  for (const sheet of sheets) {
    const name = String(sheet.name || 'Sheet');
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    for (let r = 0; r < rows.length; r++) {
      const row = Array.isArray(rows[r]) ? rows[r] : [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell) continue;
        const hasValue = cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '';
        if (!hasValue && !cell.formula) continue;
        let text = hasValue ? String(cell.value) : '（空）';
        if (cell.formula) text += ' [公式 =' + cell.formula + ']';
        lines.push(name + ' / ' + (cell.ref || '') + ': ' + text);
      }
    }
  }
  return lines;
}

function handleCompareError(err) {
  const message = err && err.message ? err.message : String(err);
  const code = err && err.code ? err.code : '';
  if (code === APP_ERR.PDF_NO_TEXT) {
    showBanner('pdf', message);
    showStatus('error', 'PDF 无可用文本层，无法对比。' + message);
  } else {
    showStatus('error', (code ? '[' + code + '] ' : '') + message);
  }
}

async function runCompare() {
  if (state.busy) return;
  if (!state.files.old || !state.files.new) {
    showStatus('error', '请先选择「原文档」和「新文档」，再点击「开始对比」。');
    return;
  }
  if (!state.files.old.path || !state.files.new.path) {
    showStatus('error', '未能获取所选文件的本地路径，请改用「点击选择」按钮重新选择。');
    return;
  }

  state.busy = true;
  $('btnCompare').disabled = true;
  hideBanners();
  showStatus('loading', '正在解析文档并计算差异，请稍候…');
  await nextFrame();

  try {
    const results = await Promise.all([
      loadDocument(state.files.old),
      loadDocument(state.files.new)
    ]);
    state.oldDoc = results[0];
    state.newDoc = results[1];

    const bothSheets = state.oldDoc.kind === 'sheet' && state.newDoc.kind === 'sheet';
    state.mode = bothSheets ? 'sheet' : 'text';

    if (bothSheets) {
      state.oldLines = sheetToLines(state.oldDoc.sheetDoc);
      state.newLines = sheetToLines(state.newDoc.sheetDoc);
      state.cellDiffs = cellEngine.diff(state.oldDoc.sheetDoc, state.newDoc.sheetDoc);
    } else {
      state.oldLines = state.oldDoc.lines || [];
      state.newLines = state.newDoc.lines || [];
      state.cellDiffs = [];
    }
    // 通用清单与并排视图始终基于归一化文本行，两种模式共用。
    state.diffs = buildDiffs(computeLineOps(state.oldLines, state.newLines));
    state.compared = true;

    updateTabAvailability();
    setActiveView(bothSheets ? 'cell' : (state.view === 'cell' ? 'list' : state.view));
    renderStats();
    renderAll();

    const total = computeStats().added + computeStats().removed + computeStats().modified;
    if (total === 0) showStatus('ok', '两个文档内容一致，未发现差异。');
    else showStatus('none');
  } catch (err) {
    state.compared = false;
    handleCompareError(err);
  } finally {
    state.busy = false;
    $('btnCompare').disabled = false;
  }
}

/* ===================== 渲染：统计 / 清单 / 并排 ===================== */
function activeDiffs() {
  return state.mode === 'sheet' ? state.cellDiffs : state.diffs;
}

function computeStats() {
  const counts = { added: 0, removed: 0, modified: 0 };
  const items = activeDiffs();
  for (let i = 0; i < items.length; i++) counts[items[i].type] += 1;
  return counts;
}

function renderStats() {
  const c = computeStats();
  $('statAdded').textContent = String(c.added);
  $('statRemoved').textContent = String(c.removed);
  $('statModified').textContent = String(c.modified);
  $('statTotal').textContent = String(c.added + c.removed + c.modified);
  $('stats').classList.remove('hidden');
}

function getFilteredDiffs() {
  const q = state.search.trim().toLowerCase();
  return state.diffs.filter(function (d) {
    if (state.filter !== 'all' && d.type !== state.filter) return false;
    if (!q) return true;
    const hay = (d.oldText || '') + '\n' + (d.newText || '');
    return hay.toLowerCase().indexOf(q) >= 0;
  });
}

function getFilteredCellDiffs() {
  const q = state.search.trim().toLowerCase();
  return state.cellDiffs.filter(function (d) {
    if (state.filter !== 'all' && d.type !== state.filter) return false;
    if (!q) return true;
    const hay = [d.sheet, d.ref, d.oldValue, d.newValue, d.oldFormula, d.newFormula, d.changeKind]
      .map(function (value) { return value == null ? '' : String(value); }).join('\n');
    return hay.toLowerCase().indexOf(q) >= 0;
  });
}

function renderDiffCard(d) {
  const badgeText = { added: '新增', removed: '删除', modified: '修改' }[d.type] || '差异';
  let lineNoText = '';
  if (d.type === 'added') lineNoText = '新文档第 ' + d.newLine + ' 行';
  else if (d.type === 'removed') lineNoText = '原文档第 ' + d.oldLine + ' 行';
  else lineNoText = '原文档第 ' + d.oldLine + ' 行 → 新文档第 ' + d.newLine + ' 行';

  let body = '';
  if (d.type === 'added') {
    body = '<div class="line-text added-text">' + escapeHtml(d.newText) + '</div>';
  } else if (d.type === 'removed') {
    body = '<div class="line-text removed-text">' + escapeHtml(d.oldText) + '</div>';
  } else {
    const cd = charDiff(d.oldText, d.newText);
    body = '<div class="pair">'
         + '<div class="pair-row"><span class="pair-label">原文</span><div class="line-text removed-text">' + cd.oldHtml + '</div></div>'
         + '<div class="pair-row"><span class="pair-label">新文</span><div class="line-text added-text">' + cd.newHtml + '</div></div>'
         + '</div>';
  }

  return '<div class="diff-card ' + d.type + '">'
       + '<span class="badge">' + badgeText + '</span><span class="line-no">' + escapeHtml(lineNoText) + '</span>'
       + body + '</div>';
}

function renderList() {
  const container = $('diffList');
  const items = getFilteredDiffs();
  if (items.length === 0) {
    container.innerHTML = '<div class="empty">没有匹配的差异条目，请调整筛选或搜索条件。</div>';
    return;
  }
  container.innerHTML = items.map(renderDiffCard).join('');
}

function linesHtml(lines, hiSet, modSet) {
  if (!lines.length) return '<div class="empty">（空文档）</div>';
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    let cls = 'side-line';
    if (modSet.has(ln)) cls += ' mod';
    else if (hiSet.has(ln)) cls += ' hi';
    html += '<div class="' + cls + '"><span class="ln">' + ln + '</span><span class="txt">'
          + (escapeHtml(lines[i]) || '&nbsp;') + '</span></div>';
  }
  return html;
}

function renderSideBySide() {
  const oldHi = new Set(), newHi = new Set(), oldMod = new Set(), newMod = new Set();
  for (const d of state.diffs) {
    if (d.oldLine != null) (d.type === 'modified' ? oldMod : oldHi).add(d.oldLine);
    if (d.newLine != null) (d.type === 'modified' ? newMod : newHi).add(d.newLine);
  }
  $('sideLeft').innerHTML = linesHtml(state.oldLines, oldHi, oldMod);
  $('sideRight').innerHTML = linesHtml(state.newLines, newHi, newMod);
}

/* ===================== 渲染：Excel 单元格差异表 ===================== */
const CHANGE_LABEL = Object.freeze({
  value: '值变更',
  formula: '公式变更',
  type: '类型变更',
  added: '新增单元格',
  removed: '删除单元格'
});

function cellValueHtml(value, formula) {
  const hasValue = value !== null && value !== undefined && String(value).trim() !== '';
  let html = hasValue
    ? escapeHtml(String(value))
    : '<span class="cell-empty">（空）</span>';
  if (formula) html += ' <span class="cell-formula">=' + escapeHtml(String(formula)) + '</span>';
  return html;
}

function typeLabel(d) {
  if (d.type === 'added') return String(d.newType || 's') + '（新增）';
  if (d.type === 'removed') return String(d.oldType || 's') + '（删除）';
  if (d.oldType === d.newType) return String(d.oldType || 's');
  return String(d.oldType || 's') + ' → ' + String(d.newType || 's');
}

function renderCellTable() {
  const wrap = $('cellTableWrap');
  const items = getFilteredCellDiffs();
  if (items.length === 0) {
    wrap.innerHTML = '<div class="empty">没有匹配的单元格差异，请调整筛选或搜索条件。</div>';
    return;
  }
  const visible = items.slice(0, MAX_CELL_ROWS_RENDERED);
  let html = '<table class="cell-table"><thead><tr>'
           + '<th>Sheet</th><th>坐标</th><th>旧值</th><th>新值</th><th>类型</th><th>变化</th>'
           + '</tr></thead><tbody>';
  for (const d of visible) {
    const badge = CHANGE_LABEL[d.changeKind] || CHANGE_LABEL[d.type] || '差异';
    html += '<tr class="' + d.type + '">'
          + '<td class="cell-sheet" title="' + escapeHtml(d.sheet) + '">' + escapeHtml(d.sheet) + '</td>'
          + '<td class="cell-ref">' + escapeHtml(d.ref) + '</td>'
          + '<td class="cell-old">' + cellValueHtml(d.oldValue, d.oldFormula) + '</td>'
          + '<td class="cell-new">' + cellValueHtml(d.newValue, d.newFormula) + '</td>'
          + '<td class="cell-type">' + escapeHtml(typeLabel(d)) + '</td>'
          + '<td><span class="cell-badge ' + d.type + '">' + escapeHtml(badge) + '</span></td>'
          + '</tr>';
  }
  html += '</tbody></table>';
  if (items.length > MAX_CELL_ROWS_RENDERED) {
    html += '<div class="cell-notice">共 ' + items.length + ' 条差异，表格仅显示前 '
          + MAX_CELL_ROWS_RENDERED + ' 条；导出文件包含全部结果。</div>';
  }
  wrap.innerHTML = html;
}

function renderAll() {
  renderList();
  renderSideBySide();
  renderCellTable();
}

/* ===================== 视图切换 ===================== */
function updateTabAvailability() {
  const cellTab = $('viewSwitch').querySelector('button[data-view="cell"]');
  if (cellTab) cellTab.classList.toggle('hidden', state.mode !== 'sheet');
}

function applyViewVisibility() {
  $('listView').classList.toggle('hidden', state.view !== 'list');
  $('sideView').classList.toggle('hidden', state.view !== 'side');
  $('cellView').classList.toggle('hidden', state.view !== 'cell');
  updateTabAvailability();
}

function setActiveView(view) {
  state.view = view;
  const buttons = $('viewSwitch').querySelectorAll('button[data-view]');
  for (let i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].getAttribute('data-view') === view);
  }
  applyViewVisibility();
  if (view === 'side' && state.compared) alignSideColumnsToLeft();
}

/* ===================== 并排视图：两栏同步滚动（按行号对齐） ===================== */
// 具体算法见 sync-scroll.js：按「行索引 + 行内偏移」对齐，而非按滚动比例。
let sideSyncBinding = null;
function bindSideSyncScroll() {
  const left = $('sideLeft');
  const right = $('sideRight');
  sideSyncBinding = SyncScroll.attachSideSyncScroll({
    left: left,
    right: right,
    getToggle: function () { return $('syncScrollToggle'); },
    schedule: function (unlock) { requestAnimationFrame(unlock); }
  });
}

/** 首次进入并排视图时，把右栏对齐到左栏当前所在行（开关关闭时不动）。 */
function alignSideColumnsToLeft() {
  if (!sideSyncBinding) return;
  const toggle = $('syncScrollToggle');
  if (!toggle || !toggle.checked) return;
  SyncScroll.alignScroll($('sideLeft'), $('sideRight'));
}

/* ===================== 文件选择与拖拽 ===================== */
function setFile(slot, meta) {
  state.files[slot] = meta;
  const el = $('file' + cap(slot));
  el.className = 'slot-file';
  el.textContent = meta.name + (meta.size ? '（' + formatSize(meta.size) + '）' : '')
                 + '\n' + meta.path;
  el.title = meta.path;
  const kind = fileKindOf(meta);
  if (!meta.path) {
    el.classList.add('err');
    toast('未能取得文件路径，建议使用「点击选择」按钮。');
  } else {
    el.classList.add('ok');
    if (kind === 'doc' || kind === 'xls') {
      toast('已识别旧格式（' + (kind === 'doc' ? '.doc' : '.xls') + '），将直接解析，无需安装外部软件。');
    }
  }
}

/** 点击卡片：优先用 Electron 原生对话框（UNC 路径可靠），失败时回退 <input>。 */
async function chooseFile(slot) {
  try {
    const res = await api.selectFile({});
    const meta = call(res);
    if (meta) setFile(slot, meta);
  } catch (err) {
    toast('选择文件失败：' + (err.message || String(err)));
  }
}

function bindDrop(slot) {
  const zone = $('drop' + cap(slot));
  const input = $('input' + cap(slot));

  // 改造点 4：拖拽使用 getPathForFile 取真实路径，构造 FileMeta。
  zone.addEventListener('click', function () { chooseFile(slot); });
  input.addEventListener('change', function () {
    if (input.files && input.files[0]) setFile(slot, fileMetaFromFile(input.files[0]));
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
  });
  zone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      e.preventDefault();
      e.stopPropagation();
      setFile(slot, fileMetaFromFile(e.dataTransfer.files[0]));
    }
  });
}

function bindToolbar() {
  $('btnCompare').addEventListener('click', runCompare);

  $('viewSwitch').addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-view]');
    if (!btn || btn.classList.contains('hidden')) return;
    setActiveView(btn.getAttribute('data-view'));
  });

  $('filters').addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.filter = btn.getAttribute('data-filter');
    const buttons = $('filters').querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) buttons[i].classList.toggle('active', buttons[i] === btn);
    if (state.compared) {
      renderList();
      renderCellTable();
    }
  });

  $('searchBox').addEventListener('input', function (e) {
    state.search = e.target.value;
    if (state.compared) {
      renderList();
      renderCellTable();
    }
  });

  $('btnCopy').addEventListener('click', copyAll);
  $('btnExportHtml').addEventListener('click', exportHtmlReport);
  $('btnExportTxt').addEventListener('click', exportTxt);
  $('btnExportCsv').addEventListener('click', exportCsv);
  $('btnPrint').addEventListener('click', function () { window.print(); });
  $('btnHelp').addEventListener('click', function () {
    api.showHelp({ kind: 'help' }).then(function (res) {
      if (res && !res.ok) toast('打开帮助失败：' + res.message);
    }).catch(function (err) {
      toast('打开帮助失败：' + (err.message || String(err)));
    });
  });
  $('btnLoDownload').addEventListener('click', function () {
    api.openExternal(LO_DOWNLOAD_URL).then(function (res) {
      if (res && !res.ok) toast('打开下载页失败：' + res.message);
    }).catch(function (err) {
      toast('打开下载页失败：' + (err.message || String(err)));
    });
  });
}

/* ===================== 导出与复制（改造点 3：原生保存） ===================== */
/**
 * 原生保存：saveFile 取路径（null = 取消，静默返回）→ writeExport 写入。
 * TXT/CSV 使用 utf8bom，HTML 使用 utf8；BOM 由主进程统一添加，避免重复。
 * @returns {Promise<boolean>} 是否成功写入
 */
async function saveNative(content, filename, encoding) {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const filters = SAVE_FILTERS[ext] || [];
  let chosen;
  try {
    chosen = await api.saveFile({ suggestedName: filename, filters: filters });
  } catch (err) {
    toast('选择保存位置失败：' + (err.message || String(err)));
    return false;
  }
  if (!chosen || !chosen.ok) {
    toast('保存失败：' + ((chosen && chosen.message) || '未知错误'));
    return false;
  }
  const targetPath = chosen.data;
  if (!targetPath) return false; // 用户取消：静默返回

  const written = await api.writeExport({ path: targetPath, content: content, encoding: encoding });
  if (!written || !written.ok) {
    toast('写入文件失败：' + ((written && written.message) || '未知错误'));
    return false;
  }
  return true;
}

function requireCompared() {
  if (!state.compared) { toast('请先完成一次对比'); return false; }
  return true;
}

function plainTextOf(items) {
  const lines = ['文档差异清单', ''];
  for (const d of items) {
    if (d.type === 'added') lines.push('【新增】新文档第 ' + d.newLine + ' 行：' + d.newText);
    else if (d.type === 'removed') lines.push('【删除】原文档第 ' + d.oldLine + ' 行：' + d.oldText);
    else lines.push(
      '【修改】原文档第 ' + d.oldLine + ' 行 → 新文档第 ' + d.newLine + ' 行',
      '  原文：' + d.oldText,
      '  新文：' + d.newText
    );
  }
  return lines.join('\n');
}

function plainTextOfCells(items) {
  const lines = ['Excel 单元格差异清单', ''];
  for (const d of items) {
    const label = CHANGE_LABEL[d.changeKind] || '差异';
    lines.push('【' + label + '】' + d.sheet + '!' + d.ref
      + '　旧值：' + (d.oldValue == null ? '（空）' : String(d.oldValue))
      + '　新值：' + (d.newValue == null ? '（空）' : String(d.newValue))
      + (d.oldFormula || d.newFormula
          ? '　公式：' + (d.oldFormula || '（无）') + ' → ' + (d.newFormula || '（无）') : ''));
  }
  return lines.join('\n');
}

function renderCellCard(d) {
  const badgeText = { added: '新增', removed: '删除', modified: '修改' }[d.type] || '差异';
  const label = CHANGE_LABEL[d.changeKind] || '差异';
  return '<div class="diff-card ' + d.type + '">'
       + '<span class="badge">' + badgeText + '</span>'
       + '<span class="line-no">' + escapeHtml(d.sheet + '!' + d.ref + ' · ' + label) + '</span>'
       + '<div class="pair">'
       + '<div class="pair-row"><span class="pair-label">旧值</span><div class="line-text removed-text">'
       + escapeHtml(d.oldValue == null ? '（空）' : String(d.oldValue))
       + (d.oldFormula ? ' [公式 =' + escapeHtml(d.oldFormula) + ']' : '') + '</div></div>'
       + '<div class="pair-row"><span class="pair-label">新值</span><div class="line-text added-text">'
       + escapeHtml(d.newValue == null ? '（空）' : String(d.newValue))
       + (d.newFormula ? ' [公式 =' + escapeHtml(d.newFormula) + ']' : '') + '</div></div>'
       + '</div></div>';
}

const REPORT_CSS = 'body{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#1f2329;max-width:980px;margin:32px auto;padding:0 20px;line-height:1.6}'
  + 'h1{font-size:22px} .summary{color:#646a73;margin-bottom:24px}'
  + '.diff-card{border:1px solid #e5e6eb;border-left-width:4px;border-radius:8px;padding:12px 16px;margin:10px 0;background:#fff}'
  + '.diff-card.added{border-left-color:#b7e2c7;background:linear-gradient(90deg,#e8f8ee 0%,#fff 30%)}'
  + '.diff-card.removed{border-left-color:#f2c4c0;background:linear-gradient(90deg,#fdeceb 0%,#fff 30%)}'
  + '.diff-card.modified{border-left-color:#f3d3a3;background:linear-gradient(90deg,#fff4e6 0%,#fff 30%)}'
  + '.badge{display:inline-block;font-size:12px;padding:2px 9px;border-radius:10px;margin-right:8px;font-weight:600}'
  + '.added .badge{background:#e8f8ee;color:#177245}.removed .badge{background:#fdeceb;color:#b32e26}.modified .badge{background:#fff4e6;color:#a85c00}'
  + '.line-no{color:#8a9099;font-size:12px}'
  + '.line-text{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:13px;margin-top:6px}'
  + '.added-text{color:#177245}.removed-text{color:#b32e26}'
  + 'ins{background:#c9f2d4;color:#0e6b2c;text-decoration:none;border-radius:2px;padding:0 1px}'
  + 'del{background:#ffd7d3;color:#a3281f;text-decoration:line-through;border-radius:2px;padding:0 1px}'
  + '.pair-row{display:flex;gap:10px;padding:3px 0}.pair-label{flex:0 0 34px;color:#8a9099;font-size:12px;padding-top:8px}'
  + '.empty{text-align:center;color:#646a73;padding:24px}';

async function exportHtmlReport() {
  if (!requireCompared()) return;
  const c = computeStats();
  const cards = state.mode === 'sheet'
    ? getFilteredCellDiffs().map(renderCellCard).join('')
    : getFilteredDiffs().map(renderDiffCard).join('');
  const body = cards || '<div class="empty">没有匹配的差异条目。</div>';
  const html = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>文档差异报告</title>'
    + '<style>' + REPORT_CSS + '</style></head><body>'
    + '<h1>文档差异报告</h1>'
    + '<div class="summary">统计：新增 ' + c.added + ' 处 · 删除 ' + c.removed + ' 处 · 修改 ' + c.modified
    + ' 处 · 共 ' + (c.added + c.removed + c.modified) + ' 处差异<br>生成时间：'
    + escapeHtml(new Date().toLocaleString('zh-CN')) + '</div>'
    + body + '</body></html>';
  if (await saveNative(html, exportFileName('差异报告.html'), 'utf8')) toast('HTML 报告已导出（当前筛选结果）');
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function displayCellText(value, formula) {
  const text = value == null ? '' : String(value);
  return formula ? text + (text ? ' ' : '') + '[=' + formula + ']' : text;
}

async function exportCsv() {
  if (!requireCompared()) return;
  const name = { added: '新增', removed: '删除', modified: '修改' };
  let rows;
  let filename;
  if (state.mode === 'sheet') {
    rows = [['类型', '工作表', '坐标', '旧值', '新值', '变化']];
    for (const d of getFilteredCellDiffs()) {
      rows.push([
        name[d.type] || '差异', d.sheet, d.ref,
        displayCellText(d.oldValue, d.oldFormula), displayCellText(d.newValue, d.newFormula),
        CHANGE_LABEL[d.changeKind] || ''
      ]);
    }
    filename = exportFileName('单元格差异清单.csv');
  } else {
    rows = [['类型', '原行号', '新行号', '原文', '新文']];
    for (const d of getFilteredDiffs()) {
      rows.push([
        name[d.type] || '差异', d.oldLine == null ? '' : d.oldLine, d.newLine == null ? '' : d.newLine,
        d.oldText == null ? '' : d.oldText, d.newText == null ? '' : d.newText
      ]);
    }
    filename = exportFileName('差异清单.csv');
  }
  const csv = rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
  if (await saveNative(csv, filename, 'utf8bom')) toast('CSV 清单已导出（当前筛选结果）');
}

async function exportTxt() {
  if (!requireCompared()) return;
  const text = state.mode === 'sheet'
    ? plainTextOfCells(getFilteredCellDiffs())
    : plainTextOf(getFilteredDiffs());
  if (await saveNative(text, exportFileName('差异清单.txt'), 'utf8bom')) toast('TXT 清单已导出（当前筛选结果）');
}

async function copyAll() {
  if (!requireCompared()) return;
  const text = state.mode === 'sheet'
    ? plainTextOfCells(getFilteredCellDiffs())
    : plainTextOf(getFilteredDiffs());
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制全部差异到剪贴板');
      return;
    } catch (err) { /* 降级到 execCommand */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  document.body.removeChild(ta);
  toast(ok ? '已复制全部差异到剪贴板' : '复制失败，请手动选择文本复制');
}

/* ===================== 初始化 ===================== */
function init() {
  bindDrop('old');
  bindDrop('new');
  bindToolbar();
  bindSideSyncScroll();
  updateTabAvailability();
  showStatus('empty', '请先选择「原文档」和「新文档」，然后点击「开始对比」。');
}
init();
