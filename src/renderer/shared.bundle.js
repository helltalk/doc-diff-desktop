"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/shared/diff-core.js
  var require_diff_core = __commonJS({
    "src/shared/diff-core.js"(exports, module) {
      "use strict";
      function escapeHtml(value) {
        const s = value == null ? "" : String(value);
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }
      function lcsOps(a, b, offset) {
        const n = a.length, m = b.length;
        const w = m + 1;
        const dp = new Uint32Array((n + 1) * w);
        for (let i2 = 1; i2 <= n; i2++) {
          for (let j2 = 1; j2 <= m; j2++) {
            if (a[i2 - 1] === b[j2 - 1]) dp[i2 * w + j2] = dp[(i2 - 1) * w + j2 - 1] + 1;
            else dp[i2 * w + j2] = Math.max(dp[(i2 - 1) * w + j2], dp[i2 * w + j2 - 1]);
          }
        }
        const ops = [];
        let i = n, j = m;
        while (i > 0 && j > 0) {
          if (a[i - 1] === b[j - 1]) {
            ops.push({ type: "equal", aIndex: offset + i - 1, bIndex: offset + j - 1, text: a[i - 1] });
            i--;
            j--;
          } else if (dp[(i - 1) * w + j] >= dp[i * w + j - 1]) {
            ops.push({ type: "delete", aIndex: offset + i - 1, text: a[i - 1] });
            i--;
          } else {
            ops.push({ type: "insert", bIndex: offset + j - 1, text: b[j - 1] });
            j--;
          }
        }
        while (i > 0) {
          ops.push({ type: "delete", aIndex: offset + i - 1, text: a[i - 1] });
          i--;
        }
        while (j > 0) {
          ops.push({ type: "insert", bIndex: offset + j - 1, text: b[j - 1] });
          j--;
        }
        ops.reverse();
        return ops;
      }
      function computeLineOps(a, b) {
        let start = 0;
        while (start < a.length && start < b.length && a[start] === b[start]) start++;
        let endA = a.length, endB = b.length;
        while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
          endA--;
          endB--;
        }
        const midA = a.slice(start, endA);
        const midB = b.slice(start, endB);
        let midOps;
        if (midA.length * midB.length > 4e6) {
          midOps = [];
          for (let i = 0; i < midA.length; i++) midOps.push({ type: "delete", aIndex: start + i, text: midA[i] });
          for (let j = 0; j < midB.length; j++) midOps.push({ type: "insert", bIndex: start + j, text: midB[j] });
        } else {
          midOps = lcsOps(midA, midB, start);
        }
        const ops = [];
        for (let i = 0; i < start; i++) ops.push({ type: "equal", aIndex: i, bIndex: i, text: a[i] });
        for (let k = 0; k < midOps.length; k++) ops.push(midOps[k]);
        const bShift = b.length - a.length;
        for (let i = endA; i < a.length; i++) ops.push({ type: "equal", aIndex: i, bIndex: i + bShift, text: a[i] });
        return ops;
      }
      function buildDiffs(ops) {
        const diffs = [];
        let i = 0;
        while (i < ops.length) {
          if (ops[i].type === "equal") {
            i++;
            continue;
          }
          const dels = [], ins = [];
          while (i < ops.length && ops[i].type !== "equal") {
            if (ops[i].type === "delete") dels.push(ops[i]);
            else ins.push(ops[i]);
            i++;
          }
          const pairs = Math.min(dels.length, ins.length);
          for (let k = 0; k < pairs; k++) {
            diffs.push({
              type: "modified",
              oldLine: dels[k].aIndex + 1,
              newLine: ins[k].bIndex + 1,
              oldText: dels[k].text,
              newText: ins[k].text
            });
          }
          for (let k = pairs; k < dels.length; k++) {
            diffs.push({ type: "removed", oldLine: dels[k].aIndex + 1, newLine: null, oldText: dels[k].text, newText: null });
          }
          for (let k = pairs; k < ins.length; k++) {
            diffs.push({ type: "added", oldLine: null, newLine: ins[k].bIndex + 1, oldText: null, newText: ins[k].text });
          }
        }
        diffs.sort(function(x, y) {
          const lx = x.newLine != null ? x.newLine : x.oldLine != null ? x.oldLine : 0;
          const ly = y.newLine != null ? y.newLine : y.oldLine != null ? y.oldLine : 0;
          return lx - ly;
        });
        return diffs;
      }
      function commonPrefix(a, b) {
        const max = Math.min(a.length, b.length);
        let i = 0;
        while (i < max && a.charAt(i) === b.charAt(i)) i++;
        return i;
      }
      function commonSuffix(a, b, prefixLen) {
        const max = Math.min(a.length, b.length) - prefixLen;
        let i = 0;
        while (i < max && a.charAt(a.length - 1 - i) === b.charAt(b.length - 1 - i)) i++;
        return i;
      }
      function charLcs(a, b) {
        const n = a.length, m = b.length;
        const w = m + 1;
        const dp = new Uint32Array((n + 1) * w);
        for (let i2 = 1; i2 <= n; i2++) {
          for (let j2 = 1; j2 <= m; j2++) {
            if (a.charAt(i2 - 1) === b.charAt(j2 - 1)) dp[i2 * w + j2] = dp[(i2 - 1) * w + j2 - 1] + 1;
            else dp[i2 * w + j2] = Math.max(dp[(i2 - 1) * w + j2], dp[i2 * w + j2 - 1]);
          }
        }
        const ops = [];
        let i = n, j = m;
        while (i > 0 && j > 0) {
          if (a.charAt(i - 1) === b.charAt(j - 1)) {
            ops.push({ type: "equal", ch: a.charAt(i - 1) });
            i--;
            j--;
          } else if (dp[(i - 1) * w + j] >= dp[i * w + j - 1]) {
            ops.push({ type: "delete", ch: a.charAt(i - 1) });
            i--;
          } else {
            ops.push({ type: "insert", ch: b.charAt(j - 1) });
            j--;
          }
        }
        while (i > 0) {
          ops.push({ type: "delete", ch: a.charAt(i - 1) });
          i--;
        }
        while (j > 0) {
          ops.push({ type: "insert", ch: b.charAt(j - 1) });
          j--;
        }
        ops.reverse();
        return ops;
      }
      function charDiff(oldStr, newStr) {
        const oldText = oldStr == null ? "" : String(oldStr);
        const newText = newStr == null ? "" : String(newStr);
        const prefix = commonPrefix(oldText, newText);
        const suffix = commonSuffix(oldText, newText, prefix);
        const oldHead = oldText.slice(0, prefix);
        const newHead = newText.slice(0, prefix);
        const oldTail = oldText.slice(oldText.length - suffix);
        const newTail = newText.slice(newText.length - suffix);
        const oldMid = oldText.slice(prefix, oldText.length - suffix);
        const newMid = newText.slice(prefix, newText.length - suffix);
        let oldHtml = escapeHtml(oldHead);
        let newHtml = escapeHtml(newHead);
        if (oldMid.length === 0 && newMid.length === 0) {
          oldHtml += escapeHtml(oldTail);
          newHtml += escapeHtml(newTail);
        } else if (oldMid.length * newMid.length > 2e4) {
          oldHtml += "<del>" + escapeHtml(oldMid) + "</del>" + escapeHtml(oldTail);
          newHtml += "<ins>" + escapeHtml(newMid) + "</ins>" + escapeHtml(newTail);
        } else {
          const ops = charLcs(oldMid, newMid);
          let k = 0;
          while (k < ops.length) {
            const type = ops[k].type;
            let end = k;
            while (end < ops.length && ops[end].type === type) end++;
            const chunk = ops.slice(k, end).map(function(op) {
              return op.ch;
            }).join("");
            if (type === "equal") {
              oldHtml += escapeHtml(chunk);
              newHtml += escapeHtml(chunk);
            } else if (type === "delete") oldHtml += "<del>" + escapeHtml(chunk) + "</del>";
            else newHtml += "<ins>" + escapeHtml(chunk) + "</ins>";
            k = end;
          }
          oldHtml += escapeHtml(oldTail);
          newHtml += escapeHtml(newTail);
        }
        return { oldHtml, newHtml };
      }
      module.exports = {
        lcsOps,
        computeLineOps,
        buildDiffs,
        commonPrefix,
        commonSuffix,
        charLcs,
        charDiff,
        escapeHtml
      };
    }
  });

  // src/shared/doc-parsers.js
  var require_doc_parsers = __commonJS({
    "src/shared/doc-parsers.js"(exports, module) {
      "use strict";
      function fileKind(name) {
        const lower = String(name || "").toLowerCase();
        const dot = lower.lastIndexOf(".");
        const ext = dot >= 0 ? lower.slice(dot + 1) : "";
        if (ext === "docx") return "docx";
        if (ext === "doc") return "doc";
        if (ext === "xlsx") return "xlsx";
        if (ext === "xls") return "xls";
        if (ext === "pdf") return "pdf";
        if (["txt", "md", "csv", "text", "log", "json", "xml", "ini", "yaml", "yml"].indexOf(ext) >= 0) return "text";
        return "text";
      }
      async function decodeTextBuffer(buffer) {
        const bytes = new Uint8Array(buffer);
        if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
          return new TextDecoder("utf-8").decode(bytes);
        }
        if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) {
          return new TextDecoder("utf-16le").decode(bytes);
        }
        if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) {
          return new TextDecoder("utf-16be").decode(bytes);
        }
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (err) {
          try {
            return new TextDecoder("gbk", { fatal: false }).decode(bytes);
          } catch (err2) {
            return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          }
        }
      }
      function findZipEntry(buf, targetName) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        let eocd = -1;
        const minPos = Math.max(0, buf.length - 22 - 65535);
        for (let i = buf.length - 22; i >= minPos; i--) {
          if (dv.getUint32(i, true) === 101010256) {
            eocd = i;
            break;
          }
        }
        if (eocd < 0) throw new Error("\u65E0\u6CD5\u8BC6\u522B DOCX \u7684 ZIP \u7ED3\u6784\uFF08\u672A\u627E\u5230\u4E2D\u592E\u76EE\u5F55\u7ED3\u675F\u6807\u8BB0\uFF09\u3002");
        let entries = dv.getUint16(eocd + 10, true);
        let cd = dv.getUint32(eocd + 16, true);
        const utf8 = new TextDecoder("utf-8");
        for (let k = 0; k < entries; k++) {
          if (cd + 46 > buf.length || dv.getUint32(cd, true) !== 33639248) break;
          const method = dv.getUint16(cd + 10, true);
          const compressedSize = dv.getUint32(cd + 20, true);
          const uncompressedSize = dv.getUint32(cd + 24, true);
          const nameLen = dv.getUint16(cd + 28, true);
          const extraLen = dv.getUint16(cd + 30, true);
          const commentLen = dv.getUint16(cd + 32, true);
          const localOffset = dv.getUint32(cd + 42, true);
          const name = utf8.decode(buf.subarray(cd + 46, cd + 46 + nameLen));
          if (name === targetName) {
            if (localOffset + 30 > buf.length || dv.getUint32(localOffset, true) !== 67324752) {
              throw new Error("DOCX \u672C\u5730\u6587\u4EF6\u5934\u5F02\u5E38\uFF0C\u6587\u4EF6\u53EF\u80FD\u5DF2\u635F\u574F\u3002");
            }
            const localNameLen = dv.getUint16(localOffset + 26, true);
            const localExtraLen = dv.getUint16(localOffset + 28, true);
            const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
            if (dataOffset + compressedSize > buf.length) {
              throw new Error("DOCX \u6570\u636E\u533A\u8D8A\u754C\uFF0C\u6587\u4EF6\u53EF\u80FD\u5DF2\u635F\u574F\u3002");
            }
            return { method, compressedSize, uncompressedSize, dataOffset };
          }
          cd += 46 + nameLen + extraLen + commentLen;
        }
        return null;
      }
      async function inflateRawAsync(bytes, expectedSize) {
        if (typeof DecompressionStream === "function" && typeof Blob !== "undefined" && Blob.prototype.stream) {
          try {
            const ds = new DecompressionStream("deflate-raw");
            const stream = new Blob([bytes]).stream().pipeThrough(ds);
            return new Uint8Array(await new Response(stream).arrayBuffer());
          } catch (err) {
          }
        }
        return inflateRawJS(bytes, expectedSize);
      }
      function inflateRawJS(data, expectedSize) {
        const MAXBITS = 15;
        const cursor = { i: 0, bitbuf: 0, bitcnt: 0 };
        function bits(need) {
          while (cursor.bitcnt < need) {
            if (cursor.i >= data.length) throw new Error("DEFLATE \u6570\u636E\u610F\u5916\u7ED3\u675F\u3002");
            cursor.bitbuf |= data[cursor.i++] << cursor.bitcnt;
            cursor.bitcnt += 8;
          }
          const val = cursor.bitbuf & (1 << need) - 1;
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
          throw new Error("\u65E0\u6548\u7684 Huffman \u7F16\u7801\u3002");
        }
        const lencode = newHuff(288);
        const distcode = newHuff(32);
        function fixedTables() {
          for (let i = 0; i < 288; i++) lencode.length[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
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
              if (n === 0) throw new Error("\u65E0\u6548\u7684\u91CD\u590D\u7F16\u7801\u3002");
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
              throw new Error("\u65E0\u6548\u7684\u7F16\u7801\u957F\u5EA6\u7B26\u53F7\u3002");
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
        const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
        const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
        const distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
        const distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
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
            if ((len ^ 65535) !== nlen) throw new Error("\u5B58\u50A8\u7684 DEFLATE \u5757\u957F\u5EA6\u6821\u9A8C\u5931\u8D25\u3002");
            for (let i = 0; i < len; i++) {
              if (cursor.i >= data.length) throw new Error("DEFLATE \u6570\u636E\u610F\u5916\u7ED3\u675F\u3002");
              out.push(data[cursor.i++]);
            }
          } else if (type === 1 || type === 2) {
            if (type === 1) fixedTables();
            else dynamicTables();
            while (true) {
              const sym = decode(lencode);
              if (sym < 256) {
                out.push(sym);
              } else if (sym === 256) {
                break;
              } else {
                const idx = sym - 257;
                if (idx < 0 || idx >= lengthBase.length) throw new Error("\u65E0\u6548\u7684\u957F\u5EA6\u7F16\u7801\u3002");
                const len = lengthBase[idx] + bits(lengthExtra[idx]);
                const dsym = decode(distcode);
                if (dsym < 0 || dsym >= distBase.length) throw new Error("\u65E0\u6548\u7684\u8DDD\u79BB\u7F16\u7801\u3002");
                const dist = distBase[dsym] + bits(distExtra[dsym]);
                if (dist > out.length) throw new Error("\u8DDD\u79BB\u8D85\u51FA\u53EF\u7528\u6570\u636E\u8303\u56F4\u3002");
                for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
              }
            }
          } else {
            throw new Error("\u4FDD\u7559\u7684 DEFLATE \u5757\u7C7B\u578B\uFF0C\u65E0\u6CD5\u89E3\u538B\u3002");
          }
        } while (!last);
        if (expectedSize && out.length !== expectedSize) {
        }
        return new Uint8Array(out);
      }
      function collectParagraphText(node, out) {
        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.nodeType !== 1) continue;
          const local = child.localName || String(child.nodeName).replace(/^.*:/, "");
          if (local === "p") continue;
          if (local === "t") out.push(child.textContent || "");
          else if (local === "tab") out.push("	");
          else if (local === "br" || local === "cr") out.push("\n");
          else collectParagraphText(child, out);
        }
      }
      function parseDocumentXml(xml) {
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        const errors = doc.getElementsByTagName("parsererror");
        if (errors.length) throw new Error("word/document.xml \u89E3\u6790\u5931\u8D25\uFF0C\u6587\u4EF6\u53EF\u80FD\u5DF2\u635F\u574F\u3002");
        const paras = doc.getElementsByTagNameNS("*", "p");
        const lines = [];
        for (let i = 0; i < paras.length; i++) {
          const parts = [];
          collectParagraphText(paras[i], parts);
          const text = parts.join("");
          const segments = text.split("\n");
          for (let k = 0; k < segments.length; k++) lines.push(segments[k]);
        }
        return lines;
      }
      async function parseDocx(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const entry = findZipEntry(bytes, "word/document.xml");
        if (!entry) throw new Error("\u672A\u5728 .docx \u4E2D\u627E\u5230 word/document.xml\uFF0C\u6587\u4EF6\u53EF\u80FD\u4E0D\u662F\u6709\u6548\u7684 Word \u6587\u6863\u3002");
        let xmlBytes;
        const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
        if (entry.method === 0) {
          xmlBytes = compressed;
        } else if (entry.method === 8) {
          xmlBytes = await inflateRawAsync(compressed, entry.uncompressedSize);
        } else {
          throw new Error("\u4E0D\u652F\u6301\u7684 DOCX \u538B\u7F29\u65B9\u5F0F\uFF08method=" + entry.method + "\uFF09\u3002");
        }
        const xml = new TextDecoder("utf-8", { fatal: false }).decode(xmlBytes);
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
    }
  });

  // src/shared/cell-diff.js
  var require_cell_diff = __commonJS({
    "src/shared/cell-diff.js"(exports, module) {
      "use strict";
      var { lcsOps } = require_diff_core();
      var MAX_ROW_LCS_PRODUCT = 4 * 1e3 * 1e3;
      var MAX_CELL_PAIRS_FOR_LCS = 2e4;
      function normalizeSheetName(name) {
        return String(name == null ? "" : name).trim().toLowerCase();
      }
      function isBlankCell(cell) {
        if (!cell || typeof cell !== "object") return true;
        const hasValue = cell.value !== null && cell.value !== void 0 && String(cell.value).trim() !== "";
        const hasFormula = cell.formula !== null && cell.formula !== void 0 && String(cell.formula).trim() !== "";
        return !hasValue && !hasFormula;
      }
      function cellValueText(value) {
        if (value === null || value === void 0) return "";
        if (value instanceof Date) return value.toISOString();
        return String(value);
      }
      function rowFingerprint(row) {
        const parts = [];
        const cells = Array.isArray(row) ? row : [];
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          if (!cell || cell.value === null || cell.value === void 0) continue;
          const text = cellValueText(cell.value);
          if (text.trim() === "") continue;
          parts.push(text);
        }
        return parts.join("");
      }
      function cellMap(row) {
        const map = /* @__PURE__ */ new Map();
        const cells = Array.isArray(row) ? row : [];
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          if (!cell || typeof cell !== "object") continue;
          const col = Number(cell.col) > 0 ? Number(cell.col) : i + 1;
          map.set(col, cell);
        }
        return map;
      }
      function alignSheets(a, b) {
        const listA = a && Array.isArray(a.sheets) ? a.sheets : [];
        const listB = b && Array.isArray(b.sheets) ? b.sheets : [];
        const groups = /* @__PURE__ */ new Map();
        function addList(list, slot) {
          for (const sheet of list) {
            if (!sheet || typeof sheet !== "object") continue;
            const base = normalizeSheetName(sheet.name) || "__unnamed__";
            let key = base;
            let seq = 1;
            while (groups.has(key) && groups.get(key)[slot]) {
              seq += 1;
              key = base + "#" + seq;
            }
            if (!groups.has(key)) {
              groups.set(key, {
                key,
                name: String(sheet.name == null ? "" : sheet.name),
                sheetA: null,
                sheetB: null,
                status: "both",
                order: groups.size
              });
            }
            const group = groups.get(key);
            group[slot] = sheet;
            if (slot === "sheetB") group.name = String(sheet.name == null ? "" : sheet.name);
          }
        }
        addList(listA, "sheetA");
        addList(listB, "sheetB");
        const result = [];
        for (const group of groups.values()) {
          group.status = group.sheetA && group.sheetB ? "both" : group.sheetA ? "removed" : "added";
          result.push(group);
        }
        return result;
      }
      function estimateCellPairs(sheetA, sheetB) {
        const cellsA = Number(sheetA && sheetA.rowCount || 0) * Number(sheetA && sheetA.colCount || 0);
        const cellsB = Number(sheetB && sheetB.rowCount || 0) * Number(sheetB && sheetB.colCount || 0);
        return Math.max(cellsA, cellsB);
      }
      function alignRows(sheetA, sheetB) {
        const rowsA = sheetA && Array.isArray(sheetA.rows) ? sheetA.rows : [];
        const rowsB = sheetB && Array.isArray(sheetB.rows) ? sheetB.rows : [];
        const result = { pairs: [], removedRows: [], addedRows: [] };
        if (rowsA.length === 0) {
          for (let j = 0; j < rowsB.length; j++) result.addedRows.push({ index: j, row: rowsB[j] });
          return result;
        }
        if (rowsB.length === 0) {
          for (let i2 = 0; i2 < rowsA.length; i2++) result.removedRows.push({ index: i2, row: rowsA[i2] });
          return result;
        }
        const useLcs = rowsA.length * rowsB.length <= MAX_ROW_LCS_PRODUCT && estimateCellPairs(sheetA, sheetB) <= MAX_CELL_PAIRS_FOR_LCS;
        if (!useLcs) {
          const shared = Math.min(rowsA.length, rowsB.length);
          for (let k = 0; k < shared; k++) result.pairs.push({ aIndex: k, bIndex: k });
          for (let k = shared; k < rowsA.length; k++) result.removedRows.push({ index: k, row: rowsA[k] });
          for (let k = shared; k < rowsB.length; k++) result.addedRows.push({ index: k, row: rowsB[k] });
          return result;
        }
        const fingerprintsA = rowsA.map(rowFingerprint);
        const fingerprintsB = rowsB.map(rowFingerprint);
        const ops = lcsOps(fingerprintsA, fingerprintsB, 0);
        let i = 0;
        while (i < ops.length) {
          if (ops[i].type === "equal") {
            result.pairs.push({ aIndex: ops[i].aIndex, bIndex: ops[i].bIndex });
            i += 1;
            continue;
          }
          const dels = [];
          const ins = [];
          while (i < ops.length && ops[i].type !== "equal") {
            if (ops[i].type === "delete") dels.push(ops[i]);
            else ins.push(ops[i]);
            i += 1;
          }
          const paired = Math.min(dels.length, ins.length);
          for (let k = 0; k < paired; k++) {
            result.pairs.push({ aIndex: dels[k].aIndex, bIndex: ins[k].bIndex });
          }
          for (let k = paired; k < dels.length; k++) {
            result.removedRows.push({ index: dels[k].aIndex, row: rowsA[dels[k].aIndex] });
          }
          for (let k = paired; k < ins.length; k++) {
            result.addedRows.push({ index: ins[k].bIndex, row: rowsB[ins[k].bIndex] });
          }
        }
        return result;
      }
      function compareCells(oldCell, newCell) {
        const oldBlank = isBlankCell(oldCell);
        const newBlank = isBlankCell(newCell);
        if (oldBlank && newBlank) return null;
        const base = {
          type: "modified",
          sheet: "",
          ref: "",
          row: 0,
          col: 0,
          oldValue: null,
          newValue: null,
          oldType: null,
          newType: null,
          oldFormula: null,
          newFormula: null,
          changeKind: "value"
        };
        if (oldBlank) {
          base.type = "added";
          base.changeKind = "added";
          base.ref = String(newCell.ref || "");
          base.row = Number(newCell.row) || 0;
          base.col = Number(newCell.col) || 0;
          base.newValue = newCell.value === void 0 ? null : newCell.value;
          base.newType = String(newCell.type || "s");
          base.newFormula = newCell.formula == null ? null : String(newCell.formula);
          return base;
        }
        if (newBlank) {
          base.type = "removed";
          base.changeKind = "removed";
          base.ref = String(oldCell.ref || "");
          base.row = Number(oldCell.row) || 0;
          base.col = Number(oldCell.col) || 0;
          base.oldValue = oldCell.value === void 0 ? null : oldCell.value;
          base.oldType = String(oldCell.type || "s");
          base.oldFormula = oldCell.formula == null ? null : String(oldCell.formula);
          return base;
        }
        const oldValue = oldCell.value === void 0 ? null : oldCell.value;
        const newValue = newCell.value === void 0 ? null : newCell.value;
        const oldType = String(oldCell.type || "s");
        const newType = String(newCell.type || "s");
        const oldFormula = oldCell.formula == null ? null : String(oldCell.formula);
        const newFormula = newCell.formula == null ? null : String(newCell.formula);
        let changeKind = null;
        if (oldFormula !== newFormula) changeKind = "formula";
        else if (oldType !== newType) changeKind = "type";
        else if (!valuesEqual(oldValue, newValue)) changeKind = "value";
        if (!changeKind) return null;
        base.type = "modified";
        base.changeKind = changeKind;
        base.ref = String(newCell.ref || oldCell.ref || "");
        base.row = Number(newCell.row || oldCell.row) || 0;
        base.col = Number(newCell.col || oldCell.col) || 0;
        base.oldValue = oldValue;
        base.newValue = newValue;
        base.oldType = oldType;
        base.newType = newType;
        base.oldFormula = oldFormula;
        base.newFormula = newFormula;
        return base;
      }
      function valuesEqual(a, b) {
        if (a === b) return true;
        if (a === null || a === void 0 || b === null || b === void 0) return false;
        const textA = cellValueText(a);
        const textB = cellValueText(b);
        if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
        return textA === textB;
      }
      function entriesForRow(row, kind, sheet) {
        const entries = [];
        const cells = Array.isArray(row) ? row : [];
        for (const cell of cells) {
          if (!cell || typeof cell !== "object") continue;
          const entry = kind === "added" ? compareCells(null, cell) : compareCells(cell, null);
          if (!entry) continue;
          entry.sheet = sheet;
          entries.push(entry);
        }
        return entries;
      }
      function diff(oldSheetDoc, newSheetDoc) {
        const aligned = alignSheets(oldSheetDoc, newSheetDoc);
        const all = [];
        for (const group of aligned) {
          const sheetEntries = [];
          if (group.status === "removed") {
            const rows = group.sheetA && group.sheetA.rows || [];
            for (const row of rows) {
              for (const entry of entriesForRow(row, "removed", group.name)) sheetEntries.push(entry);
            }
          } else if (group.status === "added") {
            const rows = group.sheetB && group.sheetB.rows || [];
            for (const row of rows) {
              for (const entry of entriesForRow(row, "added", group.name)) sheetEntries.push(entry);
            }
          } else {
            const alignment = alignRows(group.sheetA, group.sheetB);
            for (const item of alignment.removedRows) {
              for (const entry of entriesForRow(item.row, "removed", group.name)) sheetEntries.push(entry);
            }
            for (const item of alignment.addedRows) {
              for (const entry of entriesForRow(item.row, "added", group.name)) sheetEntries.push(entry);
            }
            for (const pair of alignment.pairs) {
              const rowA = group.sheetA.rows && group.sheetA.rows[pair.aIndex] || [];
              const rowB = group.sheetB.rows && group.sheetB.rows[pair.bIndex] || [];
              const mapA = cellMap(rowA);
              const mapB = cellMap(rowB);
              let maxCol = Math.max(rowA.length, rowB.length);
              for (const col of mapA.keys()) if (col > maxCol) maxCol = col;
              for (const col of mapB.keys()) if (col > maxCol) maxCol = col;
              for (let col = 1; col <= maxCol; col++) {
                const entry = compareCells(mapA.get(col) || null, mapB.get(col) || null);
                if (!entry) continue;
                entry.sheet = group.name;
                sheetEntries.push(entry);
              }
            }
          }
          sheetEntries.sort(function(x, y) {
            if (x.row !== y.row) return x.row - y.row;
            if (x.col !== y.col) return x.col - y.col;
            return x.ref.localeCompare(y.ref);
          });
          for (const entry of sheetEntries) all.push(entry);
        }
        return all;
      }
      module.exports = {
        MAX_ROW_LCS_PRODUCT,
        MAX_CELL_PAIRS_FOR_LCS,
        normalizeSheetName,
        isBlankCell,
        cellValueText,
        rowFingerprint,
        cellMap,
        alignSheets,
        alignRows,
        compareCells,
        valuesEqual,
        diff
      };
    }
  });

  // src/shared/constants.js
  var require_constants = __commonJS({
    "src/shared/constants.js"(exports, module) {
      "use strict";
      var IPC = Object.freeze({
        DIALOG_SELECT_FILE: "dialog:select-file",
        DIALOG_SAVE_FILE: "dialog:save-file",
        FILE_READ_BUFFER: "file:read-buffer",
        CONVERT_RUN: "convert:run",
        PARSE_XLSX: "parse:xlsx",
        PARSE_DOC: "parse:doc",
        PARSE_PDF: "parse:pdf",
        LIBREOFFICE_CHECK: "libreoffice:check",
        EXPORT_WRITE: "export:write",
        SHELL_OPEN_EXTERNAL: "shell:open-external",
        CONVERT_PROGRESS: "convert:progress"
      });
      var ERR = Object.freeze({
        DIALOG_FAILED: "E_DIALOG_FAILED",
        FILE_NOT_FOUND: "E_FILE_NOT_FOUND",
        FILE_READ: "E_FILE_READ",
        FILE_TOO_LARGE: "E_FILE_TOO_LARGE",
        LO_MISSING: "E_LO_MISSING",
        CONVERT_FAILED: "E_CONVERT_FAILED",
        CONVERT_TIMEOUT: "E_CONVERT_TIMEOUT",
        CONVERT_NO_OUTPUT: "E_CONVERT_NO_OUTPUT",
        EXPORT_WRITE: "E_EXPORT_WRITE",
        EXTERNAL_BLOCKED: "E_EXTERNAL_BLOCKED",
        PDF_NO_TEXT: "E_PDF_NO_TEXT"
      });
      var FILE_KIND_MAP = Object.freeze({
        txt: "text",
        text: "text",
        md: "text",
        markdown: "text",
        csv: "text",
        log: "text",
        json: "text",
        xml: "text",
        ini: "text",
        yaml: "text",
        yml: "text",
        docx: "docx",
        doc: "doc",
        xlsx: "xlsx",
        xls: "xls",
        pdf: "pdf"
      });
      var FILE_FILTERS = Object.freeze([
        { name: "\u5168\u90E8\u652F\u6301\u683C\u5F0F", extensions: ["docx", "doc", "xlsx", "xls", "pdf", "txt", "md", "csv", "text", "log", "json", "xml", "ini", "yaml", "yml"] },
        { name: "Word \u6587\u6863 (*.docx;*.doc)", extensions: ["docx", "doc"] },
        { name: "Excel \u8868\u683C (*.xlsx;*.xls)", extensions: ["xlsx", "xls"] },
        { name: "PDF \u6587\u6863 (*.pdf)", extensions: ["pdf"] },
        { name: "\u6587\u672C\u6587\u4EF6 (*.txt;*.md;*.csv)", extensions: ["txt", "md", "csv", "text", "log"] }
      ]);
      var SAVE_FILTERS = Object.freeze({
        html: [{ name: "HTML \u7F51\u9875 (*.html)", extensions: ["html"] }],
        txt: [{ name: "\u6587\u672C\u6587\u4EF6 (*.txt)", extensions: ["txt"] }],
        csv: [{ name: "CSV \u8868\u683C (*.csv)", extensions: ["csv"] }]
      });
      var CONVERT_TIMEOUT_MS = 6e4;
      var MAX_FILE_SIZE = 200 * 1024 * 1024;
      module.exports = {
        IPC,
        ERR,
        FILE_KIND_MAP,
        FILE_FILTERS,
        SAVE_FILTERS,
        CONVERT_TIMEOUT_MS,
        MAX_FILE_SIZE
      };
    }
  });

  // src/renderer/shared-entry.js
  var diffCore = require_diff_core();
  var docParsers = require_doc_parsers();
  var cellDiff = require_cell_diff();
  var constants = require_constants();
  window.diffCore = Object.freeze(diffCore);
  window.docParsers = Object.freeze(docParsers);
  window.cellDiff = Object.freeze(cellDiff);
  window.appConstants = Object.freeze({
    ERR: constants.ERR,
    FILE_FILTERS: constants.FILE_FILTERS,
    SAVE_FILTERS: constants.SAVE_FILTERS
  });
})();
