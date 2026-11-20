# -*- coding: utf-8 -*-
"""生成位于「中文 + 空格」路径下的修改版 docx，供端到端验收使用。"""

import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures')
SOURCE = os.path.join(FIXTURES, 'sample.docx')
TARGET_DIR = os.path.join(FIXTURES, '中文 路径 测试')
TARGET = os.path.join(TARGET_DIR, '修改版 sample.docx')

with zipfile.ZipFile(SOURCE, 'r') as archive:
    parts = {name: archive.read(name) for name in archive.namelist()}

xml = parts['word/document.xml'].decode('utf-8')
xml = xml.replace('这是第一段中文段落。', '这是第一段中文段落（已修改）。')
xml = xml.replace('最后一段：ABC 123', '最后一段：ABC 456')
xml = xml.replace('</w:body>', '<w:p><w:r><w:t>新增的段落：端到端验收。</w:t></w:r></w:p></w:body>')
parts['word/document.xml'] = xml.encode('utf-8')

os.makedirs(TARGET_DIR, exist_ok=True)
with zipfile.ZipFile(TARGET, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)

print('generated %s (%d bytes)' % (TARGET, os.path.getsize(TARGET)))
