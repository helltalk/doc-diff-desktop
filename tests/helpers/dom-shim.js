'use strict';

/**
 * 极简 DOMParser 兼容层，仅供 node:test 环境验证 doc-parsers.js 的
 * parseDocumentXml / parseDocx。渲染进程使用浏览器原生 DOMParser，不加载此文件。
 */

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = decodeEntities(text);
  }
}

class ElementNode {
  constructor(name) {
    this.nodeType = 1;
    this.nodeName = name;
    const colon = name.indexOf(':');
    this.localName = colon >= 0 ? name.slice(colon + 1) : name;
    this.childNodes = [];
  }

  get textContent() {
    return this.childNodes.map(function (node) { return node.textContent || ''; }).join('');
  }
}

function parseXml(xml) {
  const root = new ElementNode('#document');
  const stack = [root];
  const pattern = /<([^!?][^>]*?)>|<\?[^>]*\?>|<!--[\s\S]*?-->|([^<]+)/g;
  let match = pattern.exec(xml);
  while (match !== null) {
    if (match[2] !== undefined) {
      if (match[2].trim().length > 0) {
        stack[stack.length - 1].childNodes.push(new TextNode(match[2]));
      }
    } else if (match[1]) {
      const tag = match[1];
      if (tag.charAt(0) === '/') {
        if (stack.length > 1) stack.pop();
      } else {
        const selfClosing = tag.slice(-1) === '/';
        const nameText = selfClosing ? tag.slice(0, -1) : tag;
        const name = nameText.trim().split(/\s+/)[0];
        if (name) {
          const element = new ElementNode(name);
          stack[stack.length - 1].childNodes.push(element);
          if (!selfClosing) stack.push(element);
        }
      }
    }
    match = pattern.exec(xml);
  }
  return root;
}

function collectByLocalName(node, localName, result) {
  const children = node.childNodes || [];
  for (const child of children) {
    if (child.nodeType !== 1) continue;
    if (child.localName === localName) result.push(child);
    collectByLocalName(child, localName, result);
  }
  return result;
}

class MiniDocument {
  constructor(xml) {
    this.root = parseXml(xml);
  }

  getElementsByTagName(name) {
    if (name === 'parsererror') return [];
    return collectByLocalName(this.root, name, []);
  }

  getElementsByTagNameNS(_namespace, localName) {
    return collectByLocalName(this.root, localName, []);
  }
}

class MiniDOMParser {
  parseFromString(xml) {
    if (typeof xml !== 'string' || xml.indexOf('<') < 0) {
      throw new Error('无效的 XML 内容');
    }
    return new MiniDocument(xml);
  }
}

module.exports = { MiniDOMParser };
