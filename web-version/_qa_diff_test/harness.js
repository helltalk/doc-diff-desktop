'use strict';
/**
 * 轻量测试台：Node vm 加载单文件 HTML 的内联 JS + 手写 DOM/BOM mock。
 * 目标：能真实执行被测代码路径，而不是只看文件文本。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', '文档差异对比工具.html');
const INLINE_PATH = path.join(__dirname, 'inline.js');

const ALL_IDS = [
  'dropOld', 'inputOld', 'fileOld', 'dropNew', 'inputNew', 'fileNew',
  'btnCompare', 'viewSwitch', 'searchBox', 'btnCopy', 'btnExportHtml',
  'btnExportTxt', 'btnExportCsv', 'btnPrint', 'filters', 'stats',
  'statAdded', 'statRemoved', 'statModified', 'statTotal', 'status',
  'listView', 'diffList', 'sideView', 'syncScrollToggle',
  'sideLeft', 'sideRight', 'toast'
];

class ClassList {
  constructor() { this.items = new Set(); }
  add(...cs) { cs.forEach(c => this.items.add(c)); }
  remove(...cs) { cs.forEach(c => this.items.delete(c)); }
  contains(c) { return this.items.has(c); }
  toggle(c, force) {
    if (force === undefined) force = !this.items.has(c);
    if (force) this.items.add(c); else this.items.delete(c);
    return force;
  }
  toString() { return Array.from(this.items).join(' '); }
}

class El {
  constructor(id, tagName) {
    this.id = id || '';
    this.tagName = (tagName || 'div').toUpperCase();
    this.listeners = Object.create(null);
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList();
    this.attrs = Object.create(null);
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = null;
    this.style = {};
    this.href = '';
    this.download = '';
    this._scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.scrollWrites = 0;
    this._autoScrollEvents = false;
    this._className = '';
  }
  get className() { return this._className; }
  set className(v) { this._className = String(v); this.classList = new ClassList(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); /* 容器本身不变，监听器必须保留 */ }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(v) {
    this._scrollTop = Number(v);
    this.scrollWrites++;
    if (this._autoScrollEvents) harnessState.scrollQueue.push(this);
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const arr = this.listeners[t] || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatch(t, ev) {
    ev = ev || {};
    if (ev.target === undefined) ev.target = this;
    const arr = (this.listeners[t] || []).slice();
    for (const fn of arr) fn.call(this, ev);
    return arr.length;
  }
  listenerCount(t) { return (this.listeners[t] || []).length; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  click() { this.dispatch('click'); }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  matches(sel) {
    if (sel.charAt(0) === '.') return this.classList.contains(sel.slice(1));
    if (sel.charAt(0) === '#') return this.id === sel.slice(1);
    const m = /^([A-Za-z][\w-]*)\[([^\]=]+?)(?:=["']?([^\]"']*)["']?)?\]$/.exec(sel);
    if (m) {
      if (this.tagName !== m[1].toUpperCase()) return false;
      const v = this.getAttribute(m[2]);
      return m[3] === undefined ? v !== null : v === m[3];
    }
    return this.tagName === sel.toUpperCase();
  }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parentNode; }
    return null;
  }
  querySelectorAll(sel) {
    const parts = sel.split(',').map(s => s.trim());
    return this.children.filter(c => parts.some(p => c.matches(p)));
  }
  select() { this.selected = true; }
}

const harnessState = { scrollQueue: [] };

function createHarness(options) {
  options = options || {};
  const ids = Object.create(null);
  for (const id of ALL_IDS) {
    const el = new El(id, id.startsWith('input') ? 'input' : 'div');
    ids[id] = el;
  }
  ids.syncScrollToggle.checked = options.syncChecked !== false;
  for (const hiddenId of ['toast', 'listView', 'sideView', 'stats']) ids[hiddenId].classList.add('hidden');

  const blobs = [];
  class MockBlob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = (opts && opts.type) || '';
      blobs.push(this);
    }
    text() { return Promise.resolve(String(this.parts[0])); }
  }

  const rafQueue = [];
  const timerQueue = [];
  let timerId = 0;
  const log = { toasts: [], objectUrls: [], revoked: [], downloads: [], prints: 0, created: [] };
  let toastText = '';
  Object.defineProperty(ids.toast, 'textContent', {
    get() { return toastText; },
    set(v) { toastText = String(v); log.toasts.push(toastText); },
    configurable: true
  });

  const document = {
    body: new El('', 'body'),
    getElementById(id) { return ids[id] || null; },
    createElement(tag) { const el = new El('', tag); log.created.push(el); return el; },
    execCommand() { return true; },
    querySelectorAll() { return []; }
  };

  const windowObj = {
    showSaveFilePicker: options.showSaveFilePicker,
    print() { log.prints++; }
  };
  if (options.noShowSaveFilePicker) delete windowObj.showSaveFilePicker;

  const ctx = {
    document, window: windowObj, navigator: { clipboard: { writeText: async () => {} } },
    Blob: MockBlob,
    URL: {
      createObjectURL(blob) { const u = 'blob:mock/' + log.objectUrls.length; log.objectUrls.push({ url: u, blob }); return u; },
      revokeObjectURL(u) { log.revoked.push(u); }
    },
    setTimeout(fn, ms) { timerQueue.push({ id: ++timerId, fn, ms: ms || 0 }); return timerId; },
    clearTimeout(id) { const i = timerQueue.findIndex(t => t.id === id); if (i >= 0) timerQueue.splice(i, 1); },
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    TextDecoder, TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer,
    Date, Math, JSON, Promise, Set, Map, RegExp, Error, String, Number, Boolean,
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(INLINE_PATH, 'utf8'), ctx, { filename: 'inline.js' });

  // toast() 改写 textContent；用读取函数收集历史（通过包装 textContent setter 不便，改在 flush 时读取当前值）
  function currentToast() { return ids.toast.textContent; }

  const api = {
    ctx, ids, document, window: windowObj, blobs, log, rafQueue, timerQueue,
    run: code => vm.runInContext(code, ctx),
    flushRAF() { const q = rafQueue.splice(0); q.forEach(fn => fn(0)); return q.length; },
    flushTimers(maxMs) {
      const lim = maxMs === undefined ? 0 : maxMs;
      const q = timerQueue.filter(t => t.ms <= lim);
      for (let i = timerQueue.length - 1; i >= 0; i--) if (timerQueue[i].ms <= lim) timerQueue.splice(i, 1);
      q.forEach(t => t.fn());
      return q.length;
    },
    queueScroll(el) { harnessState.scrollQueue.push(el); },
    flushScroll() {
      const q = harnessState.scrollQueue.splice(0);
      const uniq = Array.from(new Set(q));
      uniq.forEach(el => el.dispatch('scroll'));
      return uniq.length;
    },
    clearScrollQueue() { harnessState.scrollQueue.length = 0; },
    autoScroll(el, on) { el._autoScrollEvents = on !== false; },
    currentToast,
    htmlSource() { return fs.readFileSync(HTML_PATH, 'utf8'); }
  };
  return api;
}

module.exports = { createHarness, El, ClassList };
