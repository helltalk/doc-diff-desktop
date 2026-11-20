'use strict';

/**
 * 打包后重命名免安装 zip。
 * electron-builder 26 的配置 schema 不支持在 zip target 上单独指定 artifactName，
 * 因此先用通用模板产出「文档差异对比工具-1.0.0-x64.zip」，再在此统一改为交付名称。
 *
 * 重要：必须无条件覆盖旧的交付 zip。若因目标已存在而跳过，会出现 exe 是本次新包、
 * zip 却是上次旧包的情况，导致用户重新打包后旧缺陷被重新引入。
 */

const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const version = require(path.join(root, 'package.json')).version;
const product = '文档差异对比工具';
const zipSource = path.join(distDir, product + '-' + version + '-x64.zip');
const zipTarget = path.join(distDir, product + '-免安装版-' + version + '-x64.zip');
const exeTarget = path.join(distDir, product + '-安装版-' + version + '-x64.exe');
const blockmapTarget = exeTarget + '.blockmap';

// 源 zip 不存在说明本次构建失败，必须明确报错，不能静默沿用旧产物。
if (!fs.existsSync(zipSource)) {
  console.error('[rename-artifacts] 缺少本次构建的 zip 源文件：' + path.basename(zipSource)
    + '，请确认 electron-builder 已成功生成免安装版。');
  process.exit(1);
}

// 无条件覆盖：先移除旧目标（force:true 表示不存在也不报错），再把新构建的 zip 改名。
try {
  fs.rmSync(zipTarget, { force: true });
  fs.renameSync(zipSource, zipTarget);
  console.log('[rename-artifacts] 已覆盖免安装 zip：' + path.basename(zipTarget));
} catch (err) {
  console.error('[rename-artifacts] 覆盖免安装 zip 失败：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}

// 安装版 exe / blockmap 由 electron-builder 直接写最终文件名，无需改名；
// 逐项确认它们确实由本次构建产出且大小正常，缺项同样明确报错。
for (const file of [exeTarget, zipTarget, blockmapTarget]) {
  if (!fs.existsSync(file)) {
    console.error('[rename-artifacts] 缺少构建产物：' + path.basename(file)
      + '，请确认 electron-builder 已成功生成该文件。');
    process.exit(1);
  }
  const size = fs.statSync(file).size;
  if (size < 1024) {
    console.error('[rename-artifacts] 产物大小异常：' + path.basename(file) + ' (' + size + ' bytes)');
    process.exit(1);
  }
  console.log('[rename-artifacts] ' + path.basename(file) + ' = ' + size + ' bytes (' + (size / 1024 / 1024).toFixed(2) + ' MB)');
}
