'use strict';

/**
 * 文本与 DOCX 解析层。
 * 除 fileKind 扩展到桌面版 7 类格式、parseDocx 入参改为 ArrayBuffer 外，
 * 其余函数体逐字复用自网页版「文档差异对比工具.html」，逻辑一字不改。
 * 本模块运行于渲染进程，依赖浏览器原生 DOMParser / TextDecoder / DecompressionStream。
 */

function fileKind(name) {
  const lower = String(name || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'xls') return 'xls';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'csv', 'text', 'log', 'json', 'xml', 'ini', 'yaml', 'yml'].indexOf(ext) >= 0) return 'text';
  return 'text';
}

async function decodeTextBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (err) {
    try {
      return new TextDecoder('gbk', { fatal: false }).decode(bytes);
    } catch (err2) {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  }
}

/* ===================== DOCX：ZIP 中央目录解析 ===================== */
function findZipEntry(buf, targetName) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('无法识别 DOCX 的 ZIP 结构（未找到中央目录结束标记）。');

  let entries = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');

  for (let k = 0; k < entries; k++) {
    if (cd + 46 > buf.length || dv.getUint32(cd, true) !== 0x02014b50) break;
    const method = dv.getUint16(cd + 10, true);
    const compressedSize = dv.getUint32(cd + 20, true);
    const uncompressedSize = dv.getUint32(cd + 24, true);
    const nameLen = dv.getUint16(cd + 28, true);
    const extraLen = dv.getUint16(cd + 30, true);
    const commentLen = dv.getUint16(cd + 32, true);
    const localOffset = dv.getUint32(cd + 42, true);
    const name = utf8.decode(buf.subarray(cd + 46, cd + 46 + nameLen));

    if (name === targetName) {
      if (localOffset + 30 > buf.length || dv.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error('DOCX 本地文件头异常，文件可能已损坏。');
      }
      const localNameLen = dv.getUint16(localOffset + 26, true);
      const localExtraLen = dv.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
      if (dataOffset + compressedSize > buf.length) {
        throw new Error('DOCX 数据区越界，文件可能已损坏。');
      }
      return { method: method, compressedSize: compressedSize, uncompressedSize: uncompressedSize, dataOffset: dataOffset };
    }
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function inflateRawAsync(bytes, expectedSize) {
  if (typeof DecompressionStream === 'function' && typeof Blob !== 'undefined' && Blob.prototype.stream) {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      /* 浏览器不支持或解压失败时，回退到内联纯 JS 实现 */
    }
  }
  return inflateRawJS(bytes, expectedSize);
}

/**
 * 纯 JavaScript 的 raw DEFLATE 解压（zlib puff 算法的移植）。
 * 作为 DecompressionStream 不可用时的降级方案，保证离线双击可用。
 */
function inflateRawJS(data, expectedSize) {
  const MAXBITS = 15;
  const cursor = { i: 0, bitbuf: 0, bitcnt: 0 };

  function bits(need) {
    while (cursor.bitcnt < need) {
      if (cursor.i >= data.length) throw new Error('DEFLATE 数据意外结束。');
      cursor.bitbuf |= data[cursor.i++] << cursor.bitcnt;
      cursor.bitcnt += 8;
    }
    const val = cursor.bitbuf & ((1 << need) - 1);
    cursor.bitbuf >>>= need;
    cursor.bitcnt -= need;
    return val;
  }

  function newHuff(nsym) {
    return {
      count: new Array(MAXBITS + 1).fill(0),
      length: new Array(nsym).fill(0),
      symbol: new Array(nsym).fill(0)
    };
  }

  function construct(h) {
    h.count[0] = 0;
    // 符号表按码长分组、组内按符号升序；decode() 依此偏移直接索引。
    const offs = new Array(MAXBITS + 2).fill(0);
    for (let len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + h.count[len];
    for (let sym = 0; sym < h.length.length; sym++) {
      const l = h.length[sym];
      if (l) h.symbol[offs[l]++] = sym;
    }
  }

  function decode(h) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= MAXBITS; len++) {
      code |= bits(1);
      const count = h.count[len] || 0;
      if (code - first < count) return h.symbol[index + code - first];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('无效的 Huffman 编码。');
  }

  const lencode = newHuff(288);
  const distcode = newHuff(32);

  function fixedTables() {
    for (let i = 0; i < 288; i++) lencode.length[i] = i < 144 ? 8 : (i < 256 ? 9 : (i < 280 ? 7 : 8));
    lencode.count.fill(0);
    for (let i = 0; i < 288; i++) lencode.count[lencode.length[i]]++;
    construct(lencode);
    for (let i = 0; i < 32; i++) distcode.length[i] = 5;
    distcode.count.fill(0);
    distcode.count[5] = 32;
    construct(distcode);
  }

  function dynamicTables() {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const codeLengths = new Array(19).fill(0);
    for (let i = 0; i < ncode; i++) codeLengths[order[i]] = bits(3);
    const codecode = newHuff(19);
    for (let i = 0; i < 19; i++) codecode.length[i] = codeLengths[i];
    for (let i = 0; i < 19; i++) codecode.count[codeLengths[i]]++;
    construct(codecode);

    const lengths = new Array(nlen + ndist).fill(0);
    let n = 0;
    while (n < nlen + ndist) {
      const sym = decode(codecode);
      if (sym < 16) {
        lengths[n++] = sym;
      } else if (sym === 16) {
        if (n === 0) throw new Error('无效的重复编码。');
        const repeat = 3 + bits(2);
        const prev = lengths[n - 1];
        for (let j = 0; j < repeat && n < nlen + ndist; j++) lengths[n++] = prev;
      } else if (sym === 17) {
        const repeat = 3 + bits(3);
        for (let j = 0; j < repeat && n < nlen + ndist; j++) lengths[n++] = 0;
      } else if (sym === 18) {
        const repeat = 11 + bits(7);
        for (let j = 0; j < repeat && n < nlen + ndist; j++) lengths[n++] = 0;
      } else {
        throw new Error('无效的编码长度符号。');
      }
    }

    for (let i = 0; i < nlen; i++) lencode.length[i] = lengths[i];
    lencode.count.fill(0);
    for (let i = 0; i < nlen; i++) lencode.count[lencode.length[i]]++;
    construct(lencode);

    for (let i = 0; i < ndist; i++) distcode.length[i] = lengths[nlen + i];
    distcode.count.fill(0);
    for (let i = 0; i < ndist; i++) distcode.count[distcode.length[i]]++;
    construct(distcode);
  }

  const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

  const out = [];
  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      cursor.bitbuf = 0;
      cursor.bitcnt = 0;
      const len = bits(16);
      const nlen = bits(16);
      if ((len ^ 0xffff) !== nlen) throw new Error('存储的 DEFLATE 块长度校验失败。');
      for (let i = 0; i < len; i++) {
        if (cursor.i >= data.length) throw new Error('DEFLATE 数据意外结束。');
        out.push(data[cursor.i++]);
      }
    } else if (type === 1 || type === 2) {
      if (type === 1) fixedTables(); else dynamicTables();
      while (true) {
        const sym = decode(lencode);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const idx = sym - 257;
          if (idx < 0 || idx >= lengthBase.length) throw new Error('无效的长度编码。');
          const len = lengthBase[idx] + bits(lengthExtra[idx]);
          const dsym = decode(distcode);
          if (dsym < 0 || dsym >= distBase.length) throw new Error('无效的距离编码。');
          const dist = distBase[dsym] + bits(distExtra[dsym]);
          if (dist > out.length) throw new Error('距离超出可用数据范围。');
          for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
        }
      }
    } else {
      throw new Error('保留的 DEFLATE 块类型，无法解压。');
    }
  } while (!last);

  if (expectedSize && out.length !== expectedSize) {
    // 尺寸不一致不视为致命错误，仅在结果层交由上层继续处理。
  }
  return new Uint8Array(out);
}

/* ===================== DOCX：document.xml 段落提取 ===================== */
function collectParagraphText(node, out) {
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType !== 1) continue;
    const local = child.localName || String(child.nodeName).replace(/^.*:/, '');
    if (local === 'p') continue;
    if (local === 't') out.push(child.textContent || '');
    else if (local === 'tab') out.push('\t');
    else if (local === 'br' || local === 'cr') out.push('\n');
    else collectParagraphText(child, out);
  }
}

function parseDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length) throw new Error('word/document.xml 解析失败，文件可能已损坏。');
  const paras = doc.getElementsByTagNameNS('*', 'p');
  const lines = [];
  for (let i = 0; i < paras.length; i++) {
    const parts = [];
    collectParagraphText(paras[i], parts);
    const text = parts.join('');
    const segments = text.split('\n');
    for (let k = 0; k < segments.length; k++) lines.push(segments[k]);
  }
  return lines;
}

async function parseDocx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entry = findZipEntry(bytes, 'word/document.xml');
  if (!entry) throw new Error('未在 .docx 中找到 word/document.xml，文件可能不是有效的 Word 文档。');
  let xmlBytes;
  const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) {
    xmlBytes = compressed;
  } else if (entry.method === 8) {
    xmlBytes = await inflateRawAsync(compressed, entry.uncompressedSize);
  } else {
    throw new Error('不支持的 DOCX 压缩方式（method=' + entry.method + '）。');
  }
  const xml = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
  return parseDocumentXml(xml);
}

module.exports = {
  fileKind,
  decodeTextBuffer,
  findZipEntry,
  inflateRawAsync,
  inflateRawJS,
  collectParagraphText,
  parseDocumentXml,
  parseDocx
};
