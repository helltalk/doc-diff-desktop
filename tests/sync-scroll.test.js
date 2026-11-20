'use strict';

/**
 * 并排视图「同步滚动」回归测试。
 *
 * 重点：真实构造左右两栏的行元素（offsetTop / offsetHeight 不同，模拟折行、
 * 公式变成两行高），由 attachSideSyncScroll 注册的 scroll 监听器实际驱动，
 * 断言同一行索引落在同一垂直位置。不再使用「滚动百分比」简化模型自欺欺人。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SyncScroll = require('../src/renderer/sync-scroll.js');
const root = path.join(__dirname, '..');

/**
 * 简化但真实的滚动容器：children 是有序行元素，每行有 offsetTop / offsetHeight。
 * scrollTop 写入会被钳制到 [0, scrollHeight - clientHeight]，与浏览器一致。
 */
class MockContainer {
  constructor(heights, clientHeight) {
    this.clientHeight = clientHeight;
    this._scrollTop = 0;
    this._listeners = new Map();
    this.writes = 0;
    this.heightFor = function (_index) { return 20; };
    this.setHeights(heights || []);
  }

  /** 按行高列表重建行元素，offsetTop 为累计高度。 */
  setHeights(heights) {
    let top = 0;
    this._lines = heights.map(function (height, index) {
      const line = {
        index: index,
        offsetHeight: height,
        offsetTop: top,
        className: 'side-line',
        textContent: '行 ' + (index + 1)
      };
      top += height;
      return line;
    });
  }

  /** 模拟 renderSideBySide() 重写 innerHTML：按 linesHtml() 的真实结构重建 children。 */
  set innerHTML(html) {
    const count = (String(html).match(/class="side-line"/g) || []).length;
    const heights = [];
    for (let i = 0; i < count; i++) heights.push(this.heightFor(i));
    this.setHeights(heights);
  }

  get children() { return this._lines; }

  get scrollHeight() {
    return this._lines.reduce(function (sum, line) { return sum + line.offsetHeight; }, 0);
  }

  get scrollTop() { return this._scrollTop; }

  set scrollTop(value) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    const next = Math.max(0, Math.min(max, Number(value) || 0));
    if (next !== this._scrollTop) this.writes += 1;
    this._scrollTop = next;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    const pos = list.indexOf(fn);
    if (pos >= 0) list.splice(pos, 1);
  }

  listenerCount(type) { return (this._listeners.get(type) || []).length; }

  /** 触发 scroll 事件，完全走生产代码注册的真实监听器。 */
  dispatchScroll() {
    for (const fn of (this._listeners.get('scroll') || []).slice()) fn();
  }
}

/** 生成 linesHtml() 风格的 HTML，含 N 行「行号 + 内容」。 */
function linesHtmlOf(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="side-line"><span class="ln">' + (i + 1)
          + '</span><span class="txt">项目策划 / E49 内容 ' + (i + 1) + '</span></div>';
  }
  return html;
}

/** 左栏前 50 行因折行/公式变成 40px，右栏所有行都是 20px。 */
function makeUnequalHeights(count) {
  return Array.from({ length: count }, function (_v, i) { return i < 50 ? 40 : 20; });
}

function makeUniformHeights(count, height) {
  return Array.from({ length: count }, function () { return height || 20; });
}

function setup(leftHeights, rightHeights, clientHeight) {
  const left = new MockContainer(leftHeights, clientHeight);
  const right = new MockContainer(rightHeights, clientHeight);
  const toggle = { checked: true };
  const unlocks = [];
  const binding = SyncScroll.attachSideSyncScroll({
    left: left,
    right: right,
    getToggle: function () { return toggle; },
    schedule: function (fn) { unlocks.push(fn); }
  });
  return {
    left: left,
    right: right,
    toggle: toggle,
    binding: binding,
    flushUnlock: function () { while (unlocks.length) unlocks.shift()(); }
  };
}

test('左栏滚到第 N 行中部：右栏按同一行索引对齐，而不是按百分比', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(100, 20), 200);
  const anchorIndex = 37;
  const offsetWithinLine = 12;
  const leftTop = anchorIndex * 40 + offsetWithinLine; // 1492

  s.left.scrollTop = leftTop;
  s.left.dispatchScroll();

  // 同索引行的正确位置：37 * 20 + 12 = 752
  assert.equal(s.right.scrollTop, 752);
  // 旧比例算法会落到 ~959，必须不再出现该结果。
  const oldProportional = (leftTop / (4000 - 200)) * (2000 - 200);
  assert.ok(Math.abs(s.right.scrollTop - oldProportional) > 1);
  assert.equal(s.right.writes, 1);

  const anchor = SyncScroll.findLineAnchor(s.left, s.left.scrollTop);
  assert.equal(anchor.index, anchorIndex);
  assert.equal(anchor.offset, offsetWithinLine);
});

test('右栏滚到第 M 行：左栏同样对齐到第 M 行（反向同步）', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(100, 20), 200);
  const index = 60;
  const offsetWithinLine = 5;
  s.right.scrollTop = index * 20 + offsetWithinLine; // 1205

  s.right.dispatchScroll();

  // 左栏第 60 行 offsetTop = 50*40 + 10*20 = 2200
  assert.equal(s.left.scrollTop, 2205);
  assert.equal(s.left.writes, 1);
});

test('折叠行（高行 + 矮行混合）按 offsetTop 求锚点，不依赖等宽等高的假设', function () {
  const heights = [20, 40, 20, 60, 20, 30, 20];
  const container = new MockContainer(heights, 50);
  const anchor = SyncScroll.findLineAnchor(container, 85);
  // offsetTop: 0,20,60,80,140,160,190 → 不超过 85 的最后一行是 index 3 (top=80)
  assert.equal(anchor.index, 3);
  assert.equal(anchor.offset, 5);
  assert.equal(SyncScroll.findLineAnchor(container, 0).index, 0);
  assert.equal(SyncScroll.findLineAnchor(container, 1000).index, 6);
});

test('两栏行数不同：滚动到超过较短栏行数时钳制到末行，不越界不报错', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(30, 20), 200);
  s.left.scrollTop = 80 * 40; // 左栏第 80 行，右栏只有 30 行

  assert.doesNotThrow(function () { s.left.dispatchScroll(); });
  // 末行 offsetTop = 580，但目标可滚动范围上限为 600 - 200 = 400
  assert.equal(s.right.scrollTop, 400);
  assert.ok(s.right.scrollTop <= s.right.scrollHeight - s.right.clientHeight);

  const wanted = SyncScroll.computeSyncedScrollTop(s.left, s.right);
  assert.equal(wanted, 400);

  // 目标栏为空 / 不可滚时返回 null 且不写入。
  const empty = new MockContainer([], 200);
  assert.equal(SyncScroll.computeSyncedScrollTop(s.left, empty), null);
});

test('防循环：A→B 写入期间 B 反向触发只同步一次，解锁后不抖动', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(100, 20), 200);
  s.left.scrollTop = 1000;
  s.left.writes = 0; // 只统计由同步逻辑产生的写入

  s.left.dispatchScroll();
  assert.equal(s.right.writes, 1);
  assert.equal(s.left.writes, 0);
  assert.equal(s.binding.isSyncing(), true);

  // 浏览器会在写入后派发 B 的 scroll；此时锁未释放，不能回写 A。
  s.right.dispatchScroll();
  assert.equal(s.left.writes, 0);
  assert.equal(s.right.writes, 1);

  s.flushUnlock();
  assert.equal(s.binding.isSyncing(), false);

  // 同一位置再次触发，差异 <1px，不产生新写入。
  s.left.dispatchScroll();
  assert.equal(s.right.writes, 1);

  s.left.scrollTop = 1200;
  s.left.writes = 0;
  s.left.dispatchScroll();
  assert.equal(s.right.writes, 2);
  s.flushUnlock();
  s.right.dispatchScroll();
  assert.equal(s.left.writes, 0);
});

test('同步滚动开关 checked=false 时完全不联动', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(100, 20), 200);
  s.toggle.checked = false;
  s.left.scrollTop = 1000;

  s.left.dispatchScroll();
  assert.equal(s.right.writes, 0);
  assert.equal(s.right.scrollTop, 0);

  s.right.scrollTop = 600;
  s.right.dispatchScroll();
  assert.equal(s.left.scrollTop, 1000);
});

test('重渲染 innerHTML 后监听器仍生效，且不会重复绑定', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(100, 20), 200);
  assert.equal(s.left.listenerCount('scroll'), 1);
  assert.equal(s.right.listenerCount('scroll'), 1);

  s.left.heightFor = function () { return 40; };
  s.right.heightFor = function () { return 20; };
  // 与 renderSideBySide() 一样只改 innerHTML，容器本身不变。
  s.left.innerHTML = linesHtmlOf(60);
  s.right.innerHTML = linesHtmlOf(60);

  assert.equal(s.left.listenerCount('scroll'), 1, 'innerHTML 重写不应增加监听器');
  assert.equal(s.right.listenerCount('scroll'), 1, 'innerHTML 重写不应增加监听器');

  s.left.scrollTop = 10 * 40 + 7;
  s.left.dispatchScroll();
  assert.equal(s.right.scrollTop, 10 * 20 + 7);
  assert.equal(s.right.writes, 1, '一次滚动只应写入一次');
});

test('源容器不可滚动时不处理', function () {
  const s = setup(makeUniformHeights(5, 20), makeUniformHeights(100, 20), 200);
  assert.ok(s.left.scrollHeight <= s.left.clientHeight);
  s.left.dispatchScroll();
  assert.equal(s.right.writes, 0);
  assert.equal(SyncScroll.computeSyncedScrollTop(s.left, s.right), null);
});

test('目标位置差异小于 1px 时不写回；达到 1px 时才写回', function () {
  const s = setup(makeUnequalHeights(100), makeUniformHeights(100, 20), 200);
  s.left.scrollTop = 400; // 左栏第 10 行，右栏应为 200

  s.right.scrollTop = 199.6;
  s.right.writes = 0;
  s.left.dispatchScroll();
  assert.equal(s.right.writes, 0);

  s.right.scrollTop = 198;
  s.right.writes = 0;
  s.left.dispatchScroll();
  assert.equal(s.right.scrollTop, 200);
  assert.equal(s.right.writes, 1);
});

test('首次进入并排视图：alignScroll 把右栏拉到左栏同一行', function () {
  const left = new MockContainer(makeUnequalHeights(100), 200);
  const right = new MockContainer(makeUniformHeights(100, 20), 200);
  left.scrollTop = 37 * 40 + 12;
  right.scrollTop = 500;

  assert.equal(SyncScroll.alignScroll(left, right), true);
  assert.equal(right.scrollTop, 752);
  assert.equal(SyncScroll.alignScroll(left, right), false, '已对齐时不应再写');
});

test('app.js 委托给 SyncScroll，且保留开关 / rAF 解锁 / 只同步纵向', function () {
  const appJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(/SyncScroll\.attachSideSyncScroll/.test(appJs), 'app.js 应委托给 sync-scroll.js');
  assert.ok(/getToggle:\s*function \(\) \{ return \$\('syncScrollToggle'\); \}/.test(appJs));
  assert.ok(/requestAnimationFrame\(unlock\)/.test(appJs));
  assert.ok(!/source\.scrollTop\s*\/\s*sourceRange/.test(appJs), '旧的按百分比同步公式必须移除');
  assert.ok(!/addEventListener\('scroll'/.test(appJs), '监听器只应在 sync-scroll.js 中绑定一次');
  assert.ok(!/\.scrollLeft\s*=/.test(appJs), '不应同步横向滚动');
  const bindCalls = appJs.match(/bindSideSyncScroll\(\);/g) || [];
  assert.equal(bindCalls.length, 1, 'bindSideSyncScroll 应在 init 中绑定一次');
  assert.ok(/if \(view === 'side' && state\.compared\) alignSideColumnsToLeft\(\)/.test(appJs));
});

test('index.html 在 app.js 之前加载 sync-scroll.js', function () {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const syncIndex = html.indexOf('src="sync-scroll.js"');
  const appIndex = html.indexOf('src="app.js"');
  assert.ok(syncIndex >= 0 && appIndex > syncIndex);
});
