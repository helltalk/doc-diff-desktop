'use strict';
/* 存量功能冒烟：编码解析 / DOCX 解压解析 / LCS diff / 字符高亮 / 筛选 / 渲染 / 对比主流程 */
const zlib = require('zlib');
const { createHarness } = require('./harness');

let total = 0, pass = 0, fail = 0;
function check(name, ok, detail) {
  total++;
  if (ok) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ---------- 构造真实 ZIP（含 deflate-raw 压缩的 word/document.xml） ---------- */
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function makeDocx(xml, method) {
  const name = Buffer.from('word/document.xml', 'utf8');
  const raw = Buffer.from(xml, 'utf8');
  const payload = method === 8 ? zlib.deflateRawSync(raw) : raw;
  const lh = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0),
    u32(payload.length), u32(raw.length), u16(name.length), u16(0), name
  ]);
  const cdOffset = lh.length + payload.length;
  const cd = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0),
    u32(payload.length), u32(raw.length), u16(name.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(0), name
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cd.length), u32(cdOffset), u16(0)
  ]);
  return Buffer.concat([lh, payload, cd, eocd]);
}

/* ---------- 极简 XML DOM mock（只覆盖 parseDocumentXml 用到的接口） ---------- */
function installDomParser(h) {
  h.ctx.DOMParser = class DOMParser {
    parseFromString(xml) {
      const root = { nodeType: 1, nodeName: '#root', localName: '#root', childNodes: [], textContent: '' };
      const stack = [root];
      const re = /<\/?([\w:]+)[^>]*>|([^<]+)/g;
      let m;
      const paras = [];
      while ((m = re.exec(xml)) !== null) {
        if (m[1]) {
          const closing = m[0][1] === '/';
          if (closing) { stack.pop(); continue; }
          const node = { nodeType: 1, nodeName: m[1], localName: m[1].replace(/^.*:/, ''), childNodes: [], textContent: '' };
          stack[stack.length - 1].childNodes.push(node);
          if (node.localName === 'p') paras.push(node);
          if (!/\/\s*>$/.test(m[0])) stack.push(node); // 自闭合标签不再入栈
        } else if (m[2] && m[2].trim()) {
          const t = { nodeType: 3, nodeName: '#text', localName: '#text', childNodes: [], textContent: m[2] };
          stack[stack.length - 1].childNodes.push(t);
        }
      }
      function calcText(n) {
        let s = '';
        for (const c of n.childNodes) s += c.nodeType === 3 ? c.textContent : calcText(c);
        n.textContent = s;
        return s;
      }
      calcText(root);
      return {
        getElementsByTagName(tag) { return tag === 'parsererror' ? [] : []; },
        getElementsByTagNameNS(ns, local) { return local === 'p' ? paras : []; }
      };
    }
  };
}

function bytes(arr) { return new Uint8Array(arr).buffer; }

(async function main() {
  console.log('=== C1 fileKind ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    const cases = { 'a.docx': 'docx', 'a.DOCX': 'docx', 'a.doc': 'doc-unsupported', 'a.pdf': 'pdf-unsupported',
      'a.txt': 'text', 'a.MD': 'text', 'a.csv': 'text', 'a': 'text' };
    for (const k of Object.keys(cases)) check('fileKind ' + k, h.run('fileKind(' + JSON.stringify(k) + ')') === cases[k]);
  }

  console.log('=== C2 decodeTextBuffer 编码 ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    h.ctx.__b = bytes([0xEF, 0xBB, 0xBF, 0x41, 0x42]);
    check('UTF-8 BOM', await h.run('decodeTextBuffer(__b)') === 'AB');
    h.ctx.__b = bytes([0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]);
    check('UTF-16LE BOM', await h.run('decodeTextBuffer(__b)') === 'AB');
    h.ctx.__b = bytes([0xFE, 0xFF, 0x00, 0x41, 0x00, 0x42]);
    check('UTF-16BE BOM', await h.run('decodeTextBuffer(__b)') === 'AB');
    h.ctx.__b = bytes(Array.from(Buffer.from('你好', 'utf8')));
    check('UTF-8 无 BOM 中文', await h.run('decodeTextBuffer(__b)') === '你好');
    h.ctx.__b = bytes([0xC4, 0xE3]);
    check('非法 UTF-8 回退 GBK', await h.run('decodeTextBuffer(__b)') === '你');
  }

  console.log('=== C3 readDocument（TXT 按行切分）===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    h.ctx.__f = { name: 'a.txt', arrayBuffer: async () => bytes(Array.from(Buffer.from('A\r\nB\nC', 'utf8'))) };
    const lines = await h.run('readDocument(__f)');
    check('CRLF/LF 混用切分为 3 行', eq(lines, ['A', 'B', 'C']), JSON.stringify(lines));
  }

  console.log('=== C4 DOCX：ZIP 中央目录 + raw DEFLATE + XML 段落提取 ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    installDomParser(h);
    const xml = '<?xml version="1.0"?><w:document><w:body>'
      + '<w:p><w:r><w:t>第一行</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>第二</w:t></w:r><w:r><w:tab/><w:t>行</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>第三行</w:t></w:r></w:p>'
      + '</w:body></w:document>';
    const doc = makeDocx(xml, 8);
    h.ctx.__bytes = new Uint8Array(doc);
    const entry = h.run('findZipEntry(__bytes, "word/document.xml")');
    check('找到 word/document.xml 条目', !!entry && entry.method === 8, JSON.stringify(entry));
    h.ctx.__entry = entry;
    h.ctx.__comp = h.run('__bytes.subarray(__entry.dataOffset, __entry.dataOffset + __entry.compressedSize)');
    h.ctx.__entrySize = entry.uncompressedSize;
    const inflated = await h.run('inflateRawJS(__comp, __entrySize)');
    check('inflateRawJS 解压得到原始 XML', new TextDecoder().decode(inflated) === xml,
      new TextDecoder().decode(inflated).slice(0, 50));
    h.ctx.__f = { name: 'a.docx', arrayBuffer: async () => bytes(Array.from(doc)) };
    const lines = await h.run('parseDocx(__f)');
    check('parseDocx 提取 3 段', eq(lines, ['第一行', '第二\t行', '第三行']), JSON.stringify(lines));

    const doc0 = makeDocx(xml.replace('第一行', '第一行0'), 0);
    h.ctx.__f = { name: 'a.docx', arrayBuffer: async () => bytes(Array.from(doc0)) };
    const lines0 = await h.run('parseDocx(__f)');
    check('method=0（Stored）DOCX 也能解析', lines0[0] === '第一行0', JSON.stringify(lines0));
  }

  console.log('=== C5 LCS diff / buildDiffs ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    const diffs = (a, b) => h.run('buildDiffs(computeLineOps(__a, __b))', {});
    h.ctx.__a = ['A', 'B', 'C']; h.ctx.__b = ['A', 'X', 'C'];
    let d = diffs();
    check('单行修改 -> 1 条 modified', d.length === 1 && d[0].type === 'modified' && d[0].oldText === 'B' && d[0].newText === 'X', JSON.stringify(d));
    h.ctx.__a = ['A', 'C']; h.ctx.__b = ['A', 'B', 'C'];
    d = diffs();
    check('纯新增 -> 1 条 added 第2行', d.length === 1 && d[0].type === 'added' && d[0].newLine === 2, JSON.stringify(d));
    h.ctx.__a = ['A', 'B', 'C']; h.ctx.__b = ['A', 'C'];
    d = diffs();
    check('纯删除 -> 1 条 removed 第2行', d.length === 1 && d[0].type === 'removed' && d[0].oldLine === 2, JSON.stringify(d));
    h.ctx.__a = ['A', 'B']; h.ctx.__b = ['A', 'B'];
    d = diffs();
    check('相同文档 -> 0 差异', d.length === 0);
    h.ctx.__a = Array.from({ length: 2001 }, (_, i) => 'o' + i);
    h.ctx.__b = Array.from({ length: 2001 }, (_, i) => 'n' + i);
    d = diffs();
    check('超大差异保护路径可用（2001 对配对为 modified，无 OOM）', d.length === 2001 && d.every(x => x.type === 'modified'),
      'count=' + d.length + ' types=' + Array.from(new Set(d.map(x => x.type))).join(','));
  }

  console.log('=== C6 字符级高亮 charDiff / escapeHtml ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    h.ctx.__x = h.run('charDiff("abcdef", "abXdef")', {});
    const x = h.ctx.__x;
    check('删除段 <del>c</del>', x.oldHtml.indexOf('<del>c</del>') >= 0, x.oldHtml);
    check('插入段 <ins>X</ins>', x.newHtml.indexOf('<ins>X</ins>') >= 0, x.newHtml);
    h.ctx.__y = h.run('charDiff("<b>&", "<b>&")', {});
    check('HTML 转义保持', h.ctx.__y.oldHtml.indexOf('&lt;b&gt;&amp;') >= 0, h.ctx.__y.oldHtml);
  }

  console.log('=== C7 筛选 + 搜索 + 渲染 ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    h.run('state.compared = true; state.diffs = ['
      + '{type:"added",oldLine:null,newLine:2,oldText:null,newText:"新增苹果"},'
      + '{type:"removed",oldLine:3,newLine:null,oldText:"删除香蕉",newText:null},'
      + '{type:"modified",oldLine:5,newLine:5,oldText:"旧橙子",newText:"新橙子"}];');
    h.run('state.filter="added"; state.search="";');
    check('仅新增 -> 1 条', h.run('getFilteredDiffs().length') === 1);
    h.run('state.filter="all"; state.search="橙子";');
    check('搜索命中修改项 -> 1 条', h.run('getFilteredDiffs().length') === 1);
    h.run('state.search="不存在";');
    check('无匹配 -> 0 条', h.run('getFilteredDiffs().length') === 0);
    h.run('renderList()');
    check('空结果渲染 empty 提示', h.ids.diffList.innerHTML.includes('没有匹配的差异条目'));
    h.run('state.search=""; renderList();');
    check('有结果渲染 3 张卡片', (h.ids.diffList.innerHTML.match(/class="diff-card/g) || []).length === 3);
    h.run('renderStats()');
    check('统计 1/1/1/3', h.ids.statAdded.textContent === '1' && h.ids.statRemoved.textContent === '1'
      && h.ids.statModified.textContent === '1' && h.ids.statTotal.textContent === '3',
      [h.ids.statAdded.textContent, h.ids.statRemoved.textContent, h.ids.statModified.textContent, h.ids.statTotal.textContent].join('/'));
  }

  console.log('=== C8 视图切换 / 打印 / 复制 ===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    const btn = h.document.createElement('button');
    btn.setAttribute('data-view', 'side');
    h.ids.viewSwitch.appendChild(btn);
    h.ids.viewSwitch.dispatch('click', { target: btn });
    check('切到并排视图', h.run('state.view') === 'side');
    check('sideView 可见 / listView 隐藏', !h.ids.sideView.classList.contains('hidden') && h.ids.listView.classList.contains('hidden'));
    h.ids.btnPrint.click();
    check('打印按钮调用 window.print', h.log.prints === 1);
    h.run('state.compared = true; state.diffs = [{type:"added",newLine:1,newText:"X"}];');
    await h.run('copyAll()');
    check('复制成功提示', h.log.toasts.indexOf('已复制全部差异到剪贴板') >= 0, JSON.stringify(h.log.toasts));
  }

  console.log('=== C9 runCompare 主流程（含双 rAF 载入态）===');
  {
    const h = createHarness({ noShowSaveFilePicker: true });
    h.ctx.__old = { name: 'old.txt', arrayBuffer: async () => bytes(Array.from(Buffer.from('A\nB\nC', 'utf8'))) };
    h.ctx.__new = { name: 'new.txt', arrayBuffer: async () => bytes(Array.from(Buffer.from('A\nX\nC', 'utf8'))) };
    h.run('state.files.old = __old; state.files.new = __new;');
    const p = h.run('runCompare()');
    h.flushRAF(); h.flushRAF();
    await p;
    check('对比完成 compared=true', h.run('state.compared') === true);
    check('识别 1 处修改', h.run('state.diffs.length') === 1 && h.run('state.diffs[0].type') === 'modified', h.run('JSON.stringify(state.diffs)'));
    check('统计已渲染', h.ids.statModified.textContent === '1');
    check('按钮恢复可用', h.ids.btnCompare.disabled === false);
  }

  console.log('\n存量冒烟测试：总计 ' + total + ' / 通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
