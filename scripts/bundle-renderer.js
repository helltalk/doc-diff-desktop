'use strict';

/**
 * 把 shared/* 纯函数打包为渲染进程可直接引用的 IIFE。
 * npm 的 prestart / predist:win 钩子会自动调用本脚本。
 */

const path = require('node:path');
const fs = require('node:fs');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (err) {
  console.error('[bundle-renderer] 缺少依赖 esbuild，请先运行 npm install。');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const entry = path.join(root, 'src', 'renderer', 'shared-entry.js');
const outfile = path.join(root, 'src', 'renderer', 'shared.bundle.js');

esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  outfile: outfile,
  legalComments: 'none',
  logLevel: 'warning'
});

if (!fs.existsSync(outfile)) {
  console.error('[bundle-renderer] 打包产物未生成：' + outfile);
  process.exit(1);
}

console.log('[bundle-renderer] 已生成 ' + path.relative(root, outfile));
