'use strict';

/**
 * 并排视图「同步滚动」按行号对齐实现。
 *
 * 背景：旧实现按 scrollTop / scrollRange 的比例同步两栏。行高因长文本折行、
 * 公式换行而不一致时，相同比例并不代表相同行号，导致屏幕上同一行号错开。
 *
 * 本模块利用 linesHtml() 产生的 DOM 结构：每一行都是容器的一个直接子元素，
 * 两栏按行顺序一一对应。因此同步时先求源栏「顶部可见行索引 + 行内偏移」，
 * 再把目标栏同索引行放到相同垂直位置。
 *
 * 兼容两种加载方式：
 *   - 浏览器：<script src="sync-scroll.js"></script> 暴露全局 SyncScroll；
 *   - node:test：require() 直接拿到同一份实现，用真实行元素 mock 驱动。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncScroll = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 小于 1px 的差异不写回，避免无意义的 scroll 事件。 */
  const EPSILON = 1;

  /**
   * 取容器的行元素数组。容器可能是 null，或 children 为 HTMLCollection。
   * @param {Object} container 滚动容器
   * @returns {Array<Object>} 行元素数组
   */
  function lineElements(container) {
    const children = (container && container.children) || [];
    return Array.prototype.slice.call(children);
  }

  /**
   * 行的布局顶端。使用 offsetTop（相对于 offsetParent），调用方只使用
   * 「该行 offsetTop - 首行 offsetTop」的相对值，因此不依赖 offsetParent 是谁。
   * @param {Object} line 行元素
   * @returns {number} 布局顶端，非法值按 0 处理
   */
  function lineTop(line) {
    const top = Number(line && line.offsetTop);
    return Number.isFinite(top) ? top : 0;
  }

  /**
   * 求滚动容器当前顶部可见的「行锚点」。
   * 锚点定义为 offsetTop 不超过 scrollTop 的最后一行，以及 scrollTop 超出该行顶部的距离。
   * 所有 offsetTop 均以首行为基准做相对化，兼容容器有内边距、offsetParent 不是容器本身的情况。
   * @param {Object} container 滚动容器
   * @param {number} scrollTop 当前纵向滚动位置
   * @returns {{index: number, offset: number, line: Object|null, lines: Array<Object>}} 行锚点
   */
  function findLineAnchor(container, scrollTop) {
    const lines = lineElements(container);
    if (lines.length === 0) {
      return { index: -1, offset: 0, line: null, lines: lines };
    }

    const top = Number.isFinite(Number(scrollTop)) ? Math.max(0, Number(scrollTop)) : 0;
    const base = lineTop(lines[0]);
    let index = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lineTop(lines[i]) - base <= top) index = i;
      else break;
    }

    const anchorTop = lineTop(lines[index]) - base;
    return {
      index: index,
      offset: Math.max(0, top - anchorTop),
      line: lines[index],
      lines: lines
    };
  }

  /**
   * 计算目标容器应滚动到的位置，使源、目标两栏顶部落在同一行索引与同一行内偏移。
   * 目标行数较少时把索引钳制到末行；结果再钳制到目标可滚动范围内。
   * @param {Object} source 源滚动容器
   * @param {Object} target 目标滚动容器
   * @returns {number|null} 目标 scrollTop；不可同步时返回 null
   */
  function computeSyncedScrollTop(source, target) {
    if (!source || !target) return null;

    const sourceRange = Number(source.scrollHeight) - Number(source.clientHeight);
    const targetRange = Number(target.scrollHeight) - Number(target.clientHeight);
    // 源不可滚时无需处理；目标不可滚时写 scrollTop 也不会生效。
    if (!Number.isFinite(sourceRange) || !Number.isFinite(targetRange)) return null;
    if (sourceRange <= 0 || targetRange <= 0) return null;

    const anchor = findLineAnchor(source, source.scrollTop);
    const targetLines = lineElements(target);
    if (anchor.index < 0 || targetLines.length === 0) return null;

    const targetIndex = Math.min(anchor.index, targetLines.length - 1);
    const targetBase = lineTop(targetLines[0]);
    const wanted = lineTop(targetLines[targetIndex]) - targetBase + anchor.offset;
    return Math.max(0, Math.min(targetRange, wanted));
  }

  /**
   * 把目标栏直接对齐到源栏当前所在行（用于首次进入并排视图）。
   * @param {Object} source 源滚动容器
   * @param {Object} target 目标滚动容器
   * @returns {boolean} 是否真的写入了 scrollTop
   */
  function alignScroll(source, target) {
    const wanted = computeSyncedScrollTop(source, target);
    if (wanted === null || Math.abs(Number(target.scrollTop || 0) - wanted) < EPSILON) return false;
    target.scrollTop = wanted;
    return true;
  }

  /**
   * 给左右两栏绑定同步滚动监听。只绑定在容器自身，innerHTML 重写不会移除监听器。
   * @param {Object} options 配置
   * @param {Object} options.left 左栏容器
   * @param {Object} options.right 右栏容器
   * @param {Function} options.getToggle 返回同步开关对象的函数（需有 checked 属性）
   * @param {Function} options.schedule 安排解锁回调的函数（默认 requestAnimationFrame）
   * @returns {{onLeftScroll: Function, onRightScroll: Function, detach: Function, isSyncing: Function}}
   */
  function attachSideSyncScroll(options) {
    const config = options || {};
    const left = config.left;
    const right = config.right;
    if (!left || !right || typeof left.addEventListener !== 'function'
        || typeof right.addEventListener !== 'function') {
      return {
        onLeftScroll: function () {},
        onRightScroll: function () {},
        detach: function () {},
        isSyncing: function () { return false; }
      };
    }

    const getToggle = typeof config.getToggle === 'function'
      ? config.getToggle
      : function () { return { checked: true }; };
    const schedule = typeof config.schedule === 'function'
      ? config.schedule
      : function (callback) { return requestAnimationFrame(callback); };

    // 防止 A → B → A 循环抖动：写入期间忽略反向 scroll，下一帧解锁。
    let syncingScroll = false;

    function makeHandler(source, target) {
      return function () {
        const toggle = getToggle();
        if (!toggle || !toggle.checked || syncingScroll) return;
        const wanted = computeSyncedScrollTop(source, target);
        if (wanted === null) return;
        if (Math.abs(Number(target.scrollTop || 0) - wanted) < EPSILON) return;
        syncingScroll = true;
        target.scrollTop = wanted;
        schedule(function () { syncingScroll = false; });
      };
    }

    const onLeftScroll = makeHandler(left, right);
    const onRightScroll = makeHandler(right, left);
    left.addEventListener('scroll', onLeftScroll);
    right.addEventListener('scroll', onRightScroll);

    return {
      onLeftScroll: onLeftScroll,
      onRightScroll: onRightScroll,
      detach: function () {
        if (typeof left.removeEventListener === 'function') left.removeEventListener('scroll', onLeftScroll);
        if (typeof right.removeEventListener === 'function') right.removeEventListener('scroll', onRightScroll);
      },
      isSyncing: function () { return syncingScroll; }
    };
  }

  return {
    EPSILON: EPSILON,
    lineElements: lineElements,
    findLineAnchor: findLineAnchor,
    computeSyncedScrollTop: computeSyncedScrollTop,
    alignScroll: alignScroll,
    attachSideSyncScroll: attachSideSyncScroll
  };
});
