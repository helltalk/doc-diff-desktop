'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const { HELP_TEXT, ABOUT_TEXT } = require('../src/shared/help-text');

function loadMenu() {
  const installed = { value: null };
  const electronMock = {
    Menu: {
      buildFromTemplate: function (template) { return template; },
      setApplicationMenu: function (menu) { installed.value = menu; }
    }
  };
  const helpMock = { show: function () {} };
  const sandbox = {
    require: function (id) {
      if (id === 'electron') return electronMock;
      if (id === './help') return helpMock;
      throw new Error('未预期的 require: ' + id);
    },
    module: { exports: {} },
    exports: {},
    console: console
  };
  sandbox.globalThis = sandbox;
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'menu.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'menu.js' });
  return { api: sandbox.module.exports, installed: installed };
}

test('应用菜单顶层标签全部为中文，并包含帮助菜单', function () {
  const template = loadMenu().api.buildTemplate();
  assert.deepEqual(Array.from(template, function (item) { return item.label; }), ['文件', '编辑', '视图', '窗口', '帮助']);
  const helpItems = template.find(function (item) { return item.label === '帮助'; }).submenu;
  assert.deepEqual(Array.from(helpItems, function (item) { return item.label; }), ['使用说明', '关于']);
  for (const item of template) {
    for (const child of item.submenu || []) {
      if (child.type === 'separator') continue;
      assert.ok(!/\b(File|Edit|View|Window|Help|Quit|Copy|Paste)\b/.test(child.label), '菜单项应为中文：' + child.label);
    }
  }
});

test('installApplicationMenu 会安装中文菜单', function () {
  const loaded = loadMenu();
  loaded.api.installApplicationMenu();
  assert.ok(loaded.installed.value, '应调用 Menu.setApplicationMenu');
  assert.equal(loaded.installed.value[0].label, '文件');
});

test('帮助文案覆盖用法、格式、限制与版本信息', function () {
  assert.match(HELP_TEXT, /基本用法/);
  assert.match(HELP_TEXT, /开始对比/);
  assert.match(HELP_TEXT, /支持格式/);
  assert.match(HELP_TEXT, /docx \/ doc \/ xlsx \/ xls \/ pdf \/ txt \/ md/);
  assert.match(HELP_TEXT, /限制/);
  assert.match(HELP_TEXT, /扫描版 PDF/);
  assert.match(ABOUT_TEXT, /1\.0\.0/);
});

test('主进程启动即安装中文菜单，渲染层工具栏提供帮助入口', function () {
  const mainJs = fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainJs, /installApplicationMenu\(\)/);
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="btnHelp"/);
  const appJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(appJs, /\$\('btnHelp'\)\.addEventListener/);
  assert.match(appJs, /api\.showHelp\(\{ kind: 'help' \}\)/);
});
