'use strict';

/**
 * IPC 契约测试（非桩）：在 vm 沙箱中加载真实 src/main/ipc.js，
 * 拦截 electron 与各服务依赖，断言 parse:doc 通道确实注册并正确调用解析器。
 * 最后一项用真实 parseDoc + 真实 .doc 夹具走完整 handler 链路。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const { IPC, ERR } = require(path.join(root, 'src', 'shared', 'constants'));
const { parseDoc: realParseDoc } = require(path.join(root, 'src', 'main', 'parsers', 'parse-doc'));

const FIXTURE_DOC = path.join(root, 'tests', 'fixtures', '中文 路径 测试', '旧格式 示例.doc');

/**
 * 加载真实 ipc.js 并捕获注册的 handler。
 * @param {object} stubs 依赖桩（parseDoc / parseXlsx / parsePdf / toFileMeta）
 * @returns {{handlers: Map, registerIpc: Function, calls: object}} 注册中心与调用记录
 */
function loadIpc(stubs) {
  const handlers = new Map();
  const calls = { parseDoc: [], toFileMeta: [] };
  const electronMock = {
    ipcMain: {
      removeHandler: function (channel) { handlers.delete(channel); },
      handle: function (channel, handler) { handlers.set(channel, handler); }
    },
    shell: { openExternal: async function () {} },
    BrowserWindow: { fromWebContents: function () { return {}; } }
  };

  function mockRequire(id) {
    if (id === 'electron') return electronMock;
    if (id === 'node:fs/promises') return { stat: async function () { return { size: 1, isFile: function () { return true; } }; }, readFile: async function () { return Buffer.alloc(0); } };
    if (id === '../shared/constants') {
      return { IPC: IPC, ERR: ERR, MAX_FILE_SIZE: 200 * 1024 * 1024 };
    }
    if (id === './service-error') {
      return {
        serviceError: function (code, message, cause) {
          const error = new Error(String(message));
          error.code = code;
          error.cause = cause;
          return error;
        }
      };
    }
    if (id === './dialogs') {
      return {
        toFileMeta: function (filePath) {
          calls.toFileMeta.push(filePath);
          return stubs.toFileMeta ? stubs.toFileMeta(filePath) : {
            path: filePath, name: path.basename(filePath), ext: 'doc'
          };
        },
        showOpenDialog: async function () { return { ok: true, data: null }; },
        showSaveDialog: async function () { return { ok: true, data: null }; }
      };
    }
    if (id === './converter') {
      return { convert: async function () { return { outputPath: '' }; }, detect: function () { return { installed: false }; } };
    }
    if (id === './exporter') return { writeExport: async function () { return null; } };
    if (id === './parsers/parse-xlsx') return { parseXlsx: stubs.parseXlsx || function () { return { kind: 'sheet' }; } };
    if (id === './parsers/parse-pdf') return { parsePdf: stubs.parsePdf || async function () { return { kind: 'text' }; } };
    if (id === './parsers/parse-doc') {
      return {
        parseDoc: stubs.parseDoc || async function () {
          calls.parseDoc.push(arguments[0]);
          return { kind: 'text', lines: ['ok'] };
        }
      };
    }
    throw new Error('[ipc-contract] 未预期的 require: ' + id);
  }

  const sandbox = {
    require: mockRequire,
    console: { error: function () {}, warn: function () {} },
    module: { exports: {} },
    exports: {}
  };
  sandbox.globalThis = sandbox;
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'ipc.js' });
  return { handlers: handlers, registerIpc: sandbox.module.exports.registerIpc, calls: calls };
}

test('registerIpc 注册 parse:doc 通道（不再需要 LibreOffice 检测通道也可共存）', function () {
  const loaded = loadIpc({});
  loaded.registerIpc();
  assert.ok(loaded.handlers.has(IPC.PARSE_DOC), '缺少 parse:doc handler');
  assert.equal(typeof loaded.handlers.get(IPC.PARSE_DOC), 'function');
});

test('parse:doc handler 原样传递中文/空格路径与 meta 并返回 {ok:true,data}', async function () {
  const seen = [];
  const expectedDoc = { kind: 'text', lines: ['文档差异对比测试样例', '列A\t列B'] };
  const loaded = loadIpc({
    parseDoc: async function (filePath, meta) {
      seen.push({ path: filePath, meta: Object.assign({}, meta) });
      return expectedDoc;
    }
  });
  loaded.registerIpc();
  const meta = { path: FIXTURE_DOC, name: '旧格式 示例.doc', ext: 'doc' };
  const result = await loaded.handlers.get(IPC.PARSE_DOC)({}, { path: FIXTURE_DOC, meta: meta });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.assign({}, result.data), expectedDoc);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, FIXTURE_DOC, '路径应原样传递，含中文与空格');
  assert.equal(seen[0].meta.name, '旧格式 示例.doc');
});

test('parse:doc meta 缺失时由路径现场构造 FileMeta', async function () {
  const seen = [];
  const loaded = loadIpc({
    parseDoc: async function (filePath, meta) {
      seen.push({ path: filePath, meta: Object.assign({}, meta) });
      return { kind: 'text', lines: [] };
    }
  });
  loaded.registerIpc();
  await loaded.handlers.get(IPC.PARSE_DOC)({}, { path: FIXTURE_DOC });

  assert.equal(seen[0].path, FIXTURE_DOC);
  assert.equal(seen[0].meta.path, FIXTURE_DOC);
  assert.equal(seen[0].meta.ext, 'doc');
});

test('parse:doc 解析器抛错时统一包装为 {ok:false,code,message,detail}', async function () {
  const loaded = loadIpc({
    parseDoc: async function () {
      const err = new Error('读取 .doc 文件失败（文件可能已损坏）');
      err.code = ERR.FILE_READ;
      throw err;
    }
  });
  loaded.registerIpc();
  const result = await loaded.handlers.get(IPC.PARSE_DOC)({}, { path: FIXTURE_DOC });

  assert.equal(result.ok, false);
  assert.equal(result.code, ERR.FILE_READ);
  assert.match(result.message, /读取 \.doc 文件失败/);
  assert.equal(typeof result.detail, 'string', '带堆栈的错误应透传 detail');
});

test('parse:doc 未提供路径时抛 E_FILE_NOT_FOUND', async function () {
  const loaded = loadIpc({});
  loaded.registerIpc();
  const result = await loaded.handlers.get(IPC.PARSE_DOC)({}, {});
  assert.equal(result.ok, false);
  assert.equal(result.code, ERR.FILE_NOT_FOUND);
});

test('parse:doc handler 用真实 parseDoc 读取真实 .doc 夹具返回完整 TextDocument', async function () {
  const loaded = loadIpc({ parseDoc: realParseDoc });
  loaded.registerIpc();
  const result = await loaded.handlers.get(IPC.PARSE_DOC)({}, { path: FIXTURE_DOC });

  assert.equal(result.ok, true);
  assert.equal(result.data.kind, 'text');
  assert.deepEqual(Array.from(result.data.lines), [
    '文档差异对比测试样例', '这是第一段中文段落。', '列A\t列B', '换行后内容', '最后一段：ABC 123'
  ]);
});
