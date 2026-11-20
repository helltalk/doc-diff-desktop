'use strict';

/**
 * 差异计算核心纯函数。
 * 本文件中的函数体逐字复用自网页版「文档差异对比工具.html」，逻辑一字不改，
 * 以保证桌面版与网页版的对比结果完全一致。仅增加 module.exports 导出。
 */

function escapeHtml(value) {
  const s = value == null ? '' : String(value);
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
}

function lcsOps(a, b, offset) {
  const n = a.length, m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i * w + j] = dp[(i - 1) * w + j - 1] + 1;
      else dp[i * w + j] = Math.max(dp[(i - 1) * w + j], dp[i * w + j - 1]);
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', aIndex: offset + i - 1, bIndex: offset + j - 1, text: a[i - 1] });
      i--; j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + j - 1]) {
      ops.push({ type: 'delete', aIndex: offset + i - 1, text: a[i - 1] });
      i--;
    } else {
      ops.push({ type: 'insert', bIndex: offset + j - 1, text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ type: 'delete', aIndex: offset + i - 1, text: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ type: 'insert', bIndex: offset + j - 1, text: b[j - 1] }); j--; }
  ops.reverse();
  return ops;
}

function computeLineOps(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let midOps;
  if (midA.length * midB.length > 4000000) {
    // 超大文档保护：降级为整体替换，避免 O(n*m) 内存爆炸。
    midOps = [];
    for (let i = 0; i < midA.length; i++) midOps.push({ type: 'delete', aIndex: start + i, text: midA[i] });
    for (let j = 0; j < midB.length; j++) midOps.push({ type: 'insert', bIndex: start + j, text: midB[j] });
  } else {
    midOps = lcsOps(midA, midB, start);
  }

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', aIndex: i, bIndex: i, text: a[i] });
  for (let k = 0; k < midOps.length; k++) ops.push(midOps[k]);
  const bShift = b.length - a.length;
  for (let i = endA; i < a.length; i++) ops.push({ type: 'equal', aIndex: i, bIndex: i + bShift, text: a[i] });
  return ops;
}

function buildDiffs(ops) {
  const diffs = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { i++; continue; }
    const dels = [], ins = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') dels.push(ops[i]);
      else ins.push(ops[i]);
      i++;
    }
    const pairs = Math.min(dels.length, ins.length);
    for (let k = 0; k < pairs; k++) {
      diffs.push({
        type: 'modified',
        oldLine: dels[k].aIndex + 1,
        newLine: ins[k].bIndex + 1,
        oldText: dels[k].text,
        newText: ins[k].text
      });
    }
    for (let k = pairs; k < dels.length; k++) {
      diffs.push({ type: 'removed', oldLine: dels[k].aIndex + 1, newLine: null, oldText: dels[k].text, newText: null });
    }
    for (let k = pairs; k < ins.length; k++) {
      diffs.push({ type: 'added', oldLine: null, newLine: ins[k].bIndex + 1, oldText: null, newText: ins[k].text });
    }
  }
  diffs.sort(function (x, y) {
    const lx = x.newLine != null ? x.newLine : (x.oldLine != null ? x.oldLine : 0);
    const ly = y.newLine != null ? y.newLine : (y.oldLine != null ? y.oldLine : 0);
    return lx - ly;
  });
  return diffs;
}

function commonPrefix(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charAt(i) === b.charAt(i)) i++;
  return i;
}

function commonSuffix(a, b, prefixLen) {
  const max = Math.min(a.length, b.length) - prefixLen;
  let i = 0;
  while (i < max && a.charAt(a.length - 1 - i) === b.charAt(b.length - 1 - i)) i++;
  return i;
}

function charLcs(a, b) {
  const n = a.length, m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a.charAt(i - 1) === b.charAt(j - 1)) dp[i * w + j] = dp[(i - 1) * w + j - 1] + 1;
      else dp[i * w + j] = Math.max(dp[(i - 1) * w + j], dp[i * w + j - 1]);
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a.charAt(i - 1) === b.charAt(j - 1)) { ops.push({ type: 'equal', ch: a.charAt(i - 1) }); i--; j--; }
    else if (dp[(i - 1) * w + j] >= dp[i * w + j - 1]) { ops.push({ type: 'delete', ch: a.charAt(i - 1) }); i--; }
    else { ops.push({ type: 'insert', ch: b.charAt(j - 1) }); j--; }
  }
  while (i > 0) { ops.push({ type: 'delete', ch: a.charAt(i - 1) }); i--; }
  while (j > 0) { ops.push({ type: 'insert', ch: b.charAt(j - 1) }); j--; }
  ops.reverse();
  return ops;
}

function charDiff(oldStr, newStr) {
  const oldText = oldStr == null ? '' : String(oldStr);
  const newText = newStr == null ? '' : String(newStr);
  const prefix = commonPrefix(oldText, newText);
  const suffix = commonSuffix(oldText, newText, prefix);
  const oldHead = oldText.slice(0, prefix);
  const newHead = newText.slice(0, prefix);
  const oldTail = oldText.slice(oldText.length - suffix);
  const newTail = newText.slice(newText.length - suffix);
  const oldMid = oldText.slice(prefix, oldText.length - suffix);
  const newMid = newText.slice(prefix, newText.length - suffix);

  let oldHtml = escapeHtml(oldHead);
  let newHtml = escapeHtml(newHead);

  if (oldMid.length === 0 && newMid.length === 0) {
    oldHtml += escapeHtml(oldTail);
    newHtml += escapeHtml(newTail);
  } else if (oldMid.length * newMid.length > 20000) {
    oldHtml += '<del>' + escapeHtml(oldMid) + '</del>' + escapeHtml(oldTail);
    newHtml += '<ins>' + escapeHtml(newMid) + '</ins>' + escapeHtml(newTail);
  } else {
    const ops = charLcs(oldMid, newMid);
    let k = 0;
    while (k < ops.length) {
      const type = ops[k].type;
      let end = k;
      while (end < ops.length && ops[end].type === type) end++;
      const chunk = ops.slice(k, end).map(function (op) { return op.ch; }).join('');
      if (type === 'equal') { oldHtml += escapeHtml(chunk); newHtml += escapeHtml(chunk); }
      else if (type === 'delete') oldHtml += '<del>' + escapeHtml(chunk) + '</del>';
      else newHtml += '<ins>' + escapeHtml(chunk) + '</ins>';
      k = end;
    }
    oldHtml += escapeHtml(oldTail);
    newHtml += escapeHtml(newTail);
  }
  return { oldHtml: oldHtml, newHtml: newHtml };
}

module.exports = {
  lcsOps,
  computeLineOps,
  buildDiffs,
  commonPrefix,
  commonSuffix,
  charLcs,
  charDiff,
  escapeHtml
};
