'use strict';

/**
 * 将 preload.js 与其依赖的 shared/constants.js 打包为单文件 CJS。
 * Electron 的 sandbox:true 预加载脚本只能 require 内置的 electron/events/timers/url，
 * 不能直接 require 本地模块；因此必须在启动前用 esbuild 内联共享常量。
 * npm 的 prestart / predist:win 钩子会自动调用本脚本。
 */

const path = require('node:path');
const fs = require('node:fs');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (err) {
  console.error('[bundle-preload] 缺少依赖 esbuild，请先运行 npm install。');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const entry = path.join(root, 'src', 'preload', 'preload.js');
const outfile = path.join(root, 'src', 'preload', 'preload.bundle.js');

esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: outfile,
  external: ['electron'],
  legalComments: 'none',
  logLevel: 'warning'
});

if (!fs.existsSync(outfile)) {
  console.error('[bundle-preload] 打包产物未生成：' + outfile);
  process.exit(1);
}

console.log('[bundle-preload] 已生成 ' + path.relative(root, outfile));
