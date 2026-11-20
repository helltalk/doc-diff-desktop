'use strict';
/* 导出选路径：逐个分支真实执行 downloadBlob / 三个导出函数 */
const { createHarness } = require('./harness');

let total = 0, pass = 0, fail = 0;
function check(name, ok, detail) {
  total++;
  if (ok) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(e));

function setData(h) {
  h.run('state.compared = true; state.filter = "all"; state.search = ""; '
      + 'state.oldLines = ["A","B","C"]; state.newLines = ["A","X","C"]; '
      + 'state.diffs = [{type:"modified",oldLine:2,newLine:2,oldText:"B",newText:"X"}]');
}
function successPicker() {
  const calls = [], writables = [];
  const fn = async function (opts) {
    calls.push(opts);
    const w = { writes: [], closed: false, write: async function (b) { w.writes.push(b); }, close: async function () { w.closed = true; } };
    writables.push(w);
    return { createWritable: async function () { return w; } };
  };
  return { fn, calls, writables };
}

(async function main() {
  console.log('=== E1 buildSaveTypes 过滤器 ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    const json = args => JSON.stringify(h.run('buildSaveTypes(' + args + ')'));
    check('HTML 过滤器', json('"文档差异报告.html","text/html;charset=utf-8"')
      === JSON.stringify([{ description: 'HTML 网页（*.html）', accept: { 'text/html': ['.html', '.htm'] } }]));
    check('CSV 过滤器', json('"文档差异清单.csv","text/csv;charset=utf-8"')
      === JSON.stringify([{ description: 'CSV 表格（*.csv）', accept: { 'text/csv': ['.csv'] } }]));
    check('TXT 过滤器', json('"文档差异清单.txt","text/plain;charset=utf-8"')
      === JSON.stringify([{ description: '文本文件（*.txt）', accept: { 'text/plain': ['.txt'] } }]));
    check('未知类型返回空数组', json('"x.bin","application/octet-stream"') === '[]');
  }

  console.log('=== E2 showSaveFilePicker 成功：三个导出 ===');
  const cases = [
    { name: 'HTML', fn: 'exportHtmlReport', expected: '文档差异报告.html', mimePart: 'charset=utf-8',
      contentCheck: b => b.indexOf('<meta charset="utf-8">') >= 0 && b.indexOf('文档差异报告') >= 0,
      toast: 'HTML 报告已导出（当前筛选结果）' },
    { name: 'TXT', fn: 'exportTxt', expected: '文档差异清单.txt', mimePart: 'charset=utf-8',
      contentCheck: b => b.charAt(0) === '\ufeff' && b.indexOf('【修改】') >= 0,
      toast: 'TXT 清单已导出（当前筛选结果）' },
    { name: 'CSV', fn: 'exportCsv', expected: '文档差异清单.csv', mimePart: 'charset=utf-8',
      contentCheck: b => b.charAt(0) === '\ufeff' && b.indexOf('类型,原行号,新行号,原文,新文') >= 0,
      toast: 'CSV 清单已导出（当前筛选结果）' }
  ];
  for (const c of cases) {
    const pk = successPicker();
    const h = createHarness({ showSaveFilePicker: pk.fn });
    setData(h);
    const pending = h.run(c.fn + '()'); // 不立即 await：验证用户手势栈内已调用 picker
    const syncCalls = pk.calls.length;
    await pending;
    check(c.name + ' picker 在同步调用栈内触发（保住用户手势）', syncCalls === 1, 'calls=' + syncCalls);
    check(c.name + ' picker 调用次数', pk.calls.length === 1, 'calls=' + pk.calls.length);
    check(c.name + ' suggestedName 正确', pk.calls[0].suggestedName === c.expected, 'actual=' + pk.calls[0].suggestedName);
    check(c.name + ' types 过滤器存在且合理', Array.isArray(pk.calls[0].types) && pk.calls[0].types.length === 1 && !!pk.calls[0].types[0].accept,
      JSON.stringify(pk.calls[0].types));
    const w = pk.writables[0];
    check(c.name + ' writable.write/close 均被调用', !!w && w.writes.length === 1 && w.closed === true,
      'writes=' + (w && w.writes.length) + ' closed=' + (w && w.closed));
    const blob = w && w.writes[0];
    check(c.name + ' Blob.type 含 charset', !!blob && blob.type.indexOf(c.mimePart) >= 0, blob && blob.type);
    check(c.name + ' Blob 内容正确（BOM/charset）', !!blob && c.contentCheck(String(blob.parts[0])),
      blob ? JSON.stringify(String(blob.parts[0]).slice(0, 45)) : 'no blob');
    check(c.name + ' 显示成功 toast', h.log.toasts.indexOf(c.toast) >= 0, JSON.stringify(h.log.toasts));
    check(c.name + ' 未走降级下载', h.log.objectUrls.length === 0 && h.log.created.filter(e => e.tagName === 'A').length === 0);
  }

  console.log('=== E3 downloadBlob 返回值 ===');
  {
    const pk = successPicker();
    const h = createHarness({ showSaveFilePicker: pk.fn });
    const r = await h.run('downloadBlob("x","文档差异报告.html","text/html;charset=utf-8")');
    check('成功返回 saved', r === 'saved', 'actual=' + r);
  }
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    const r = await h.run('downloadBlob("x","文档差异清单.txt","text/plain;charset=utf-8")');
    check('不支持时返回 fallback', r === 'fallback', 'actual=' + r);
  }

  console.log('=== E4 用户取消 AbortError ===');
  {
    const pk = successPicker();
    let calls = 0;
    pk.fn = async function (opts) { calls++; const e = new Error('user canceled'); e.name = 'AbortError'; throw e; };
    const h = createHarness({ showSaveFilePicker: pk.fn });
    setData(h);
    await h.run('exportCsv()'); // 不应抛未捕获异常
    check('picker 被调用', calls === 1);
    check('未调用 <a download> / createObjectURL', h.log.objectUrls.length === 0 && h.log.created.filter(e => e.tagName === 'A').length === 0);
    check('无任何 toast（静默取消）', h.log.toasts.length === 0, JSON.stringify(h.log.toasts));
    const r = await h.run('downloadBlob("x","文档差异清单.csv","text/csv;charset=utf-8")');
    check('取消返回 canceled', r === 'canceled', 'actual=' + r);
    check('取消后仍无降级下载', h.log.objectUrls.length === 0);
  }

  console.log('=== E5 showSaveFilePicker 不存在（降级）===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    setData(h);
    await h.run('exportTxt()');
    check('走 createObjectURL + <a download>', h.log.objectUrls.length === 1 && h.log.created.filter(e => e.tagName === 'A').length === 1,
      'urls=' + h.log.objectUrls.length + ' anchors=' + h.log.created.filter(e => e.tagName === 'A').length);
    const a = h.log.created.find(e => e.tagName === 'A');
    check('a.download 文件名正确', !!a && a.download === '文档差异清单.txt', a && a.download);
    check('降级 toast 正确', h.flushTimers(0) >= 1 && h.log.toasts.indexOf('当前环境不支持选路径，已保存到默认下载目录') >= 0,
      JSON.stringify(h.log.toasts));
    check('无成功 toast', h.log.toasts.indexOf('TXT 清单已导出（当前筛选结果）') < 0);
    const blob = h.log.objectUrls[0].blob;
    check('降级后 BOM 仍在', String(blob.parts[0]).charAt(0) === '\ufeff');
    check('Blob.type 仍含 charset', blob.type.indexOf('charset=utf-8') >= 0, blob.type);
    h.flushTimers(10000);
    check('revokeObjectURL 被调用', h.log.revoked.length >= 1, 'count=' + h.log.revoked.length);
  }

  console.log('=== E6 picker 其它异常：捕获并降级 ===');
  {
    const h = createHarness({ showSaveFilePicker: async () => { throw new Error('SecurityError: file:// blocked'); } });
    setData(h);
    await h.run('exportHtmlReport()'); // 不应抛
    check('异常被捕获，走降级', h.log.objectUrls.length === 1, 'urls=' + h.log.objectUrls.length);
    h.flushTimers(0);
    check('显示降级提示', h.log.toasts.indexOf('当前环境不支持选路径，已保存到默认下载目录') >= 0, JSON.stringify(h.log.toasts));
    check('无成功提示', h.log.toasts.indexOf('HTML 报告已导出（当前筛选结果）') < 0);
  }

  console.log('=== E7 createWritable 失败：捕获并降级 ===');
  {
    const h = createHarness({ showSaveFilePicker: async () => ({ createWritable: async () => { throw new Error('disk full'); } }) });
    setData(h);
    const r = await h.run('downloadBlob("x","文档差异清单.csv","text/csv;charset=utf-8")');
    check('返回 fallback', r === 'fallback', 'actual=' + r);
    check('走降级下载', h.log.objectUrls.length === 1);
  }

  console.log('=== E8 未对比时点导出 ===');
  {
    const pk = successPicker();
    const h = createHarness({ showSaveFilePicker: pk.fn });
    await h.run('exportHtmlReport()');
    await h.run('exportCsv()');
    await h.run('exportTxt()');
    check('三次均提示请先完成一次对比', h.log.toasts.filter(t => t === '请先完成一次对比').length === 3, JSON.stringify(h.log.toasts));
    check('picker 未被调用', pk.calls.length === 0);
    check('无降级下载', h.log.objectUrls.length === 0);
  }

  console.log('=== E9 未捕获 Promise rejection ===');
  check('全程无 unhandledRejection', unhandled.length === 0, 'count=' + unhandled.length);

  console.log('\n导出选路径测试：总计 ' + total + ' / 通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('TEST HARNESS ERROR:', err); process.exit(2); });
