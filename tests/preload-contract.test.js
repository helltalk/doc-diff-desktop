'use strict';

/**
 * 真实 preload 契约回归测试（非桩）。
 *
 * 背景：此前 E2E 使用 scripts/e2e-stub.js，桩按渲染层的对象形式实现 readBuffer，
 * 恰好掩盖了真实 preload「期望字符串」的契约，导致线上出现
 * '[E_FILE_NOT_FOUND] 文件不存在或不可访问: [object Object]'。
 * 本测试直接在 vm 沙箱中加载真实 src/preload/preload.js，捕获 contextBridge
 * 注册的 electronAPI，断言两种入参都归一化为正确的 IPC payload。
 * 注：vm 沙箱产生的对象属于不同 realm，断言前用 Object.assign 复制到本地再比较。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const { IPC } = require(path.join(root, 'src', 'shared', 'constants'));

/**
 * 在隔离沙箱中执行真实 preload.js，并拦截其 Electron 依赖。
 * @returns {{api: object, calls: Array, electron: object}} 注册的 API 与 invoke 调用记录
 */
function loadRealPreload() {
  const calls = [];
  let exposedKey = null;
  let exposedApi = null;

  const electronMock = {
    contextBridge: {
      exposeInMainWorld: function (key, api) {
        exposedKey = key;
        exposedApi = api;
      }
    },
    ipcRenderer: {
      invoke: function (channel, payload) {
        calls.push({ channel: channel, payload: payload });
        return Promise.resolve({ ok: true, data: null });
      },
      on: function () {},
      removeListener: function () {}
    },
    webUtils: {
      getPathForFile: function (file) { return (file && file.path) || ''; }
    }
  };

  function mockRequire(id) {
    if (id === 'electron') return electronMock;
    if (id === '../shared/constants') return { IPC: IPC };
    throw new Error('[preload-contract] 未预期的 require: ' + id);
  }

  const sandbox = {
    require: mockRequire,
    console: console,
    module: { exports: {} },
    exports: {}
  };
  sandbox.globalThis = sandbox;

  const source = fs.readFileSync(path.join(root, 'src', 'preload', 'preload.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'preload.js' });

  assert.equal(exposedKey, 'electronAPI', 'preload 必须注册 electronAPI');
  assert.ok(exposedApi, 'contextBridge 未注册 electronAPI');
  return { api: exposedApi, calls: calls, electron: electronMock };
}

test('真实 preload：readBuffer(字符串路径) → {path:字符串}', function () {
  const loaded = loadRealPreload();
  const result = loaded.api.readBuffer('E:\\path\\a.docx');

  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].channel, IPC.FILE_READ_BUFFER);
  assert.deepEqual(Object.assign({}, loaded.calls[0].payload),{ path: 'E:\\path\\a.docx' });
  assert.equal(typeof loaded.calls[0].payload.path, 'string');
  assert.ok(result && typeof result.then === 'function', 'readBuffer 应返回 Promise');
});

test('真实 preload：readBuffer({path:字符串}) 兼容 → {path:字符串}', function () {
  const loaded = loadRealPreload();
  const result = loaded.api.readBuffer({ path: 'E:\\path\\a.docx' });

  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].channel, IPC.FILE_READ_BUFFER);
  assert.deepEqual(Object.assign({}, loaded.calls[0].payload),{ path: 'E:\\path\\a.docx' });
  assert.equal(typeof loaded.calls[0].payload.path, 'string');
  assert.ok(result && typeof result.then === 'function', 'readBuffer 应返回 Promise');
});

test('真实 preload：openExternal(字符串 URL) → {url:字符串}', function () {
  const loaded = loadRealPreload();
  const result = loaded.api.openExternal('https://example.com');

  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].channel, IPC.SHELL_OPEN_EXTERNAL);
  assert.deepEqual(Object.assign({}, loaded.calls[0].payload),{ url: 'https://example.com' });
  assert.ok(result && typeof result.then === 'function', 'openExternal 应返回 Promise');
});

test('真实 preload：openExternal({url:字符串}) 兼容 → {url:字符串}', function () {
  const loaded = loadRealPreload();
  const result = loaded.api.openExternal({ url: 'https://example.com' });

  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].channel, IPC.SHELL_OPEN_EXTERNAL);
  assert.deepEqual(Object.assign({}, loaded.calls[0].payload),{ url: 'https://example.com' });
  assert.ok(result && typeof result.then === 'function', 'openExternal 应返回 Promise');
});

test('真实 preload：exposeInMainWorld 白名单方法名保持不变且 API 被冻结', function () {
  const loaded = loadRealPreload();
  const expected = [
    'selectFile', 'saveFile', 'readBuffer', 'convert', 'parseXlsx', 'parsePdf',
    'checkLibreOffice', 'writeExport', 'openExternal', 'getPathForFile', 'onConvertProgress'
  ];
  for (const name of expected) {
    assert.equal(typeof loaded.api[name], 'function', 'electronAPI.' + name);
  }
  assert.equal(Object.isFrozen(loaded.api), true, 'electronAPI 应保持冻结');
});
