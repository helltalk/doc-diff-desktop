// pdfjs-dist v6 在 Electron 内置 Node 环境下的 30 行可行性探针。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const fixture = path.join(root, 'tests', 'fixtures', 'sample.pdf');
const worker = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
console.log('[probe] version =', pdfjs.version);
console.log('[probe] workerSrc =', pdfjs.GlobalWorkerOptions.workerSrc);
const data = new Uint8Array(fs.readFileSync(fixture));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
console.log('[probe] numPages =', doc.numPages);
const page = await doc.getPage(1);
const content = await page.getTextContent();
const text = content.items.map((item) => item.str || '').join('');
console.log('[probe] items =', content.items.length, 'text =', JSON.stringify(text.slice(0, 120)));
if (!text.trim()) throw new Error('PROBE FAILED: no text layer');
console.log('[probe] SUCCESS');
await doc.cleanup(); // v6 将 destroy() 改名为 cleanup()
