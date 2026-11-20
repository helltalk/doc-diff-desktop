'use strict';
/* 静态检查：DOM id、外部依赖、选路径 API 防护、新增函数 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', '文档差异对比工具.html');
const s = fs.readFileSync(htmlPath, 'utf8');
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!ok) failed++;
}

console.log('=== DOM id 定义与引用一致性 ===');
for (const id of ['syncScrollToggle', 'sideLeft', 'sideRight']) {
  const defCount = (s.match(new RegExp('id=["\']' + id + '["\']', 'g')) || []).length;
  const needle = "$('" + id + "')";
  const refCount = s.split(needle).length - 1;
  check('id ' + id + ' 唯一定义', defCount === 1, 'defs=' + defCount);
  check('id ' + id + ' 被 JS 引用', refCount >= 1, 'refs=' + refCount + ' (' + needle + ')');
}

console.log('=== 外部依赖 ===');
const srcHrefs = Array.from(s.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)).map(m => m[1]);
check('无 src/href 外部引用', srcHrefs.length === 0, JSON.stringify(srcHrefs));
check('无 CDN/URL 关键词', !/https?:\/\/|cdn\.|unpkg|jsdelivr/i.test(s));

console.log('=== 选路径 API 防护 ===');
check('typeof 特征检测', /typeof\s+window\.showSaveFilePicker\s*===\s*'function'/.test(s));
check('AbortError 静默处理', /err\s*&&\s*err\.name\s*===\s*'AbortError'/.test(s));
check('createWritable/write/close', /createWritable\(\)[\s\S]*?writable\.write\(blob\)[\s\S]*?writable\.close\(\)/.test(s));
check('降级 createObjectURL', /URL\.createObjectURL\(blob\)/.test(s));
check('降级 revokeObjectURL', /URL\.revokeObjectURL\(url\)/.test(s));
check('showSaveFilePicker 位于 try 内', /try\s*\{[\s\S]{0,300}window\.showSaveFilePicker\(options\)[\s\S]{0,300}\}\s*catch/.test(s));
check('降级分支 toast 提示', /已保存到默认下载目录/.test(s));

console.log('=== 新增函数与调用点 ===');
for (const f of ['bindSideSyncScroll', 'buildSaveTypes', 'downloadBlob', 'requireCompared']) {
  check('定义 ' + f, new RegExp('function\\s+' + f + '\\s*\\(').test(s));
}
check('init() 调用 bindSideSyncScroll', /function init\(\)\s*\{[\s\S]*?bindSideSyncScroll\(\);[\s\S]*?\}/.test(s));
check('print 隐藏同步开关栏', /\.side-sync-bar\{display:none!important\}/.test(s));
check('三个导出均 await downloadBlob', (s.match(/await downloadBlob\(/g) || []).length === 3,
  'count=' + (s.match(/await downloadBlob\(/g) || []).length);

console.log('\n静态检查失败数：' + failed);
process.exit(failed ? 1 : 0);
