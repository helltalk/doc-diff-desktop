'use strict';
/* 并排视图同步滚动：真实执行 DOM 事件处理器 */
const { createHarness } = require('./harness');

let total = 0, pass = 0, fail = 0;
function check(name, ok, detail) {
  total++;
  if (ok) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }

function setup() {
  const h = createHarness({ noShowSaveFilePicker: true });
  const L = h.ids.sideLeft, R = h.ids.sideRight;
  L.scrollHeight = 2000; L.clientHeight = 500;  // 可滚范围 1500
  R.scrollHeight = 1000; R.clientHeight = 400;  // 可滚范围 600
  L.scrollWrites = 0; R.scrollWrites = 0;
  return { h, L, R, T: h.ids.syncScrollToggle };
}

console.log('=== T1 左→右按滚动比例同步 ===');
{
  const { h, L, R } = setup();
  L.scrollTop = 750; // 50%
  L.dispatch('scroll');
  check('右栏 scrollTop = 50% * 600 = 300', near(R.scrollTop, 300), 'actual=' + R.scrollTop);
  check('进入防循环锁（syncingScroll=true）', h.run('syncingScroll') === true);
  check('排入 1 个 rAF 解锁回调', h.rafQueue.length === 1, 'len=' + h.rafQueue.length);
  h.flushRAF();
  check('rAF 后解锁', h.run('syncingScroll') === false);
}

console.log('=== T2 右→左按滚动比例同步 ===');
{
  const { h, L, R } = setup();
  R.scrollTop = 150; // 25%
  R.dispatch('scroll');
  check('左栏 scrollTop = 25% * 1500 = 375', near(L.scrollTop, 375), 'actual=' + L.scrollTop);
  h.flushRAF();
}

console.log('=== T3 防 A→B→A 循环（scroll 事件早于 rAF，浏览器常见顺序）===');
{
  const { h, L, R } = setup();
  h.autoScroll(L); h.autoScroll(R);
  L.scrollTop = 600; // 40% -> 右应为 240
  h.clearScrollQueue(); // 去掉赋值自身产生的 scroll 事件，只保留同步引发的反向事件
  L.dispatch('scroll');
  check('首次同步右栏为 240', near(R.scrollTop, 240), 'actual=' + R.scrollTop);
  const writesBefore = L.scrollWrites;
  const scrolls = h.flushScroll(); // 右栏 scroll 事件进入，此时锁仍为 true
  check('右栏反向 scroll 事件被派发', scrolls === 1, 'count=' + scrolls);
  check('锁生效：左栏未被回写', L.scrollWrites === writesBefore, 'writes=' + L.scrollWrites);
  h.flushRAF();
  check('rAF 后锁释放', h.run('syncingScroll') === false);
  // 解锁后用户真实滚动右栏，仍能同步回来
  R.scrollTop = 480; // 80%
  h.clearScrollQueue();
  R.dispatch('scroll');
  check('解锁后右→左恢复正常（80% -> 1200）', near(L.scrollTop, 1200), 'actual=' + L.scrollTop);
  h.flushRAF();
}

console.log('=== T4 <1px 差异跳过，避免抖动 ===');
{
  const { h, L, R } = setup();
  L.scrollTop = 750; // 右目标 300
  R.scrollTop = 300.5;
  L.dispatch('scroll');
  check('差异 0.5px 时不同步', near(R.scrollTop, 300.5), 'actual=' + R.scrollTop);
  check('未设置防循环锁', h.run('syncingScroll') === false);
  check('未排入 rAF', h.rafQueue.length === 0, 'len=' + h.rafQueue.length);

  // 反向也验证：right=300.2 -> 左目标 750.5，差 0.5px
  L.scrollTop = 750; R.scrollTop = 300.2;
  R.dispatch('scroll');
  check('反向差异 0.5px 时不同步', near(L.scrollTop, 750), 'actual=' + L.scrollTop);
  check('反向也未排入 rAF', h.rafQueue.length === 0, 'len=' + h.rafQueue.length);
}

console.log('=== T5 开关 checked=false / true ===');
{
  const { h, L, R, T } = setup();
  T.checked = false;
  L.scrollTop = 1200;
  L.dispatch('scroll');
  check('关闭时右栏保持 0', R.scrollTop === 0, 'actual=' + R.scrollTop);
  check('关闭时不加锁', h.run('syncingScroll') === false);
  T.checked = true;
  L.scrollTop = 300; // 20% -> 120
  R.scrollWrites = 0;
  L.dispatch('scroll');
  check('重新开启后恢复同步（20% -> 120）', near(R.scrollTop, 120), 'actual=' + R.scrollTop);
  h.flushRAF();
}

console.log('=== T6 重新渲染 innerHTML 后监听器仍有效且未重复绑定 ===');
{
  const { h, L, R } = setup();
  check('左栏 1 个 scroll 监听器', L.listenerCount('scroll') === 1, 'count=' + L.listenerCount('scroll'));
  check('右栏 1 个 scroll 监听器', R.listenerCount('scroll') === 1, 'count=' + R.listenerCount('scroll'));
  h.run('state.oldLines = ["a","b","c"]; state.newLines = ["a","x","c"]; '
      + 'state.diffs = [{type:"modified",oldLine:2,newLine:2,oldText:"b",newText:"x"}]');
  h.run('renderSideBySide(); renderSideBySide();');
  check('左栏 innerHTML 已重写且含行内容/修改高亮', L.innerHTML.includes('side-line') && L.innerHTML.includes('side-line mod') && L.innerHTML.includes('>b<'), L.innerHTML.slice(0, 120));
  check('右栏 innerHTML 已重写', R.innerHTML.includes('side-line'), R.innerHTML.slice(0, 90));
  check('重写后左栏仍是 1 个监听器', L.listenerCount('scroll') === 1, 'count=' + L.listenerCount('scroll'));
  check('重写后右栏仍是 1 个监听器', R.listenerCount('scroll') === 1, 'count=' + R.listenerCount('scroll'));
  L.scrollTop = 1050; // 70% -> 420
  R.scrollWrites = 0;
  L.dispatch('scroll');
  check('重写后仍能同步', near(R.scrollTop, 420), 'actual=' + R.scrollTop);
  check('只同步一次（无重复绑定）', R.scrollWrites === 1, 'writes=' + R.scrollWrites);
  h.flushRAF();
}

console.log('=== T7 不可滚动容器不处理 ===');
{
  const { h, L, R } = setup();
  L.scrollHeight = 500; L.clientHeight = 500;
  L.scrollTop = 100;
  L.dispatch('scroll');
  check('源容器无滚动范围时不同步', R.scrollTop === 0, 'actual=' + R.scrollTop);
  check('未加锁', h.run('syncingScroll') === false);
  check('未排入 rAF', h.rafQueue.length === 0, 'len=' + h.rafQueue.length);
}

console.log('=== T8 浏览器另一顺序：rAF 先于反向 scroll（仍不应抖动）===');
{
  const { h, L, R } = setup();
  h.autoScroll(L); h.autoScroll(R);
  L.scrollTop = 900; // 60% -> 右 360
  L.dispatch('scroll');
  check('首次同步右栏为 360', near(R.scrollTop, 360), 'actual=' + R.scrollTop);
  h.flushRAF();                 // 先解锁
  const writesBefore = L.scrollWrites;
  h.flushScroll();              // 后派发右栏 scroll；反算左目标恰为 900
  check('反算差异为 0，左栏不回写', L.scrollWrites === writesBefore, 'writes=' + L.scrollWrites);
  check('右栏未被再次改动', near(R.scrollTop, 360), 'actual=' + R.scrollTop);
}

console.log('\n同步滚动测试：总计 ' + total + ' / 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
