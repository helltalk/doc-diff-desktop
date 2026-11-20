# -*- coding: utf-8 -*-
"""Generate binary test fixtures for the doc-diff-desktop test suite."""

import os
import zipfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))

DOCUMENT_XML = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>文档差异对比测试样例</w:t></w:r></w:p>
<w:p><w:r><w:t>这是第一段中文段落。</w:t></w:r></w:p>
<w:p><w:r><w:t>列A</w:t><w:tab/><w:t>列B</w:t><w:br/><w:t>换行后内容</w:t></w:r></w:p>
<w:p><w:r><w:t>最后一段：ABC 123</w:t></w:r></w:p>
</w:body></w:document>'''

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''


def write_docx(path, include_document=True):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', CONTENT_TYPES.encode('utf-8'))
        archive.writestr('_rels/.rels', RELS.encode('utf-8'))
        if include_document:
            archive.writestr('word/document.xml', DOCUMENT_XML.encode('utf-8'))
        archive.writestr('docProps/app.xml', '<Properties/>'.encode('utf-8'))


def write_scan_pdf(path):
    """A minimal one-page PDF containing only a filled rectangle (no text layer)."""
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /ProcSet [/PDF] >> /Contents 4 0 R >>',
    ]
    stream = b'0 0 0 rg\n100 100 200 200 re f\n'
    objects.append(b'<< /Length ' + str(len(stream)).encode('ascii') + b' >>\nstream\n' + stream + b'endstream')

    output = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += str(index).encode('ascii') + b' 0 obj\n' + body + b'\nendobj\n'

    xref_offset = len(output)
    output += b'xref\n0 ' + str(len(objects) + 1).encode('ascii') + b'\n'
    output += b'0000000000 65535 f \n'
    for offset in offsets:
        output += ('%010d 00000 n \n' % offset).encode('ascii')
    output += b'trailer\n<< /Size ' + str(len(objects) + 1).encode('ascii') + b' /Root 1 0 R >>\n'
    output += b'startxref\n' + str(xref_offset).encode('ascii') + b'\n%%EOF\n'
    with open(path, 'wb') as handle:
        handle.write(output)


def make_pdf_from_docx():
    """Use installed LibreOffice to build a genuine PDF with Chinese text layer."""
    soffice = r'C:\Program Files\LibreOffice\program\soffice.exe'
    target = os.path.join(HERE, 'sample.pdf')
    if os.path.exists(target) and os.path.getsize(target) > 0:
        return
    if not os.path.exists(soffice):
        print('[skip] LibreOffice not found, sample.pdf will be generated as fallback')
        write_scan_pdf(target)
        return
    try:
        result = subprocess.run(
            [soffice, '--headless', '--norestore', '--nolockcheck',
             '--convert-to', 'pdf', '--outdir', HERE,
             os.path.join(HERE, 'sample.docx')],
            capture_output=True, timeout=120
        )
        print('[libreoffice] rc=%s stdout=%s' % (
            result.returncode, result.stdout.decode('utf-8', 'replace').strip()))
    except Exception as exc:  # noqa: BLE001 - fixture generation is best-effort
        print('[warn] LibreOffice conversion failed: %s' % exc)
    if not os.path.exists(target) or os.path.getsize(target) == 0:
        write_scan_pdf(target)


def main():
    write_docx(os.path.join(HERE, 'sample.docx'))
    write_docx(os.path.join(HERE, 'no-document.docx'), include_document=False)
    write_scan_pdf(os.path.join(HERE, 'sample-scan.pdf'))
    placeholder = os.path.join(HERE, '中文 路径 测试')
    os.makedirs(placeholder, exist_ok=True)
    with open(os.path.join(placeholder, '占位文件.txt'), 'w', encoding='utf-8') as handle:
        handle.write('用于验证中文/空格路径下的文件读写。\n')
    make_pdf_from_docx()
    for name in ('sample.docx', 'no-document.docx', 'sample.pdf', 'sample-scan.pdf'):
        full = os.path.join(HERE, name)
        print('%-20s %d bytes' % (name, os.path.getsize(full) if os.path.exists(full) else -1))


if __name__ == '__main__':
    main()
