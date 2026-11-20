'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExportFileName, safeStem } = require('../src/shared/export-naming');

test('不同主文件名：旧名_vs_新名_差异清单.csv', function () {
  assert.equal(
    buildExportFileName('合同A.docx', '合同B.docx', '差异清单.csv'),
    '合同A_vs_合同B_差异清单.csv'
  );
});

test('同主名不同格式：不重复拼接，直接加差异后缀', function () {
  assert.equal(
    buildExportFileName('报价单.xlsx', '报价单.pdf', '差异清单.txt'),
    '报价单_差异清单.txt'
  );
});

test('支持完整路径，并去掉 Windows 非法字符与结尾空格/点', function () {
  assert.equal(
    buildExportFileName('C:\\归档\\2026 预算(终).xlsx', '\\\\nas\\share\\2026 预算(终) v2.xls', '差异清单.csv'),
    '2026 预算(终)_差异清单.csv'
  );
  assert.equal(safeStem('C:\\归档\\a:b?*.txt', 50), 'a_b__');
});

test('导出文件名总长度受限，超长主文件名会截断', function () {
  const oldName = '旧'.repeat(200) + '.docx';
  const newName = '新'.repeat(200) + '.docx';
  const result = buildExportFileName(oldName, newName, '差异清单.csv');
  assert.ok(result.length <= 120, '实际长度：' + result.length);
  assert.ok(result.endsWith('_差异清单.csv'));
  assert.ok(result.indexOf('~') > 0, '截断应保留 ~ 标记');
});

test('仅 rev 版本不同：只保留公共主体名，不带 rev 与版本号', function () {
  assert.equal(
    buildExportFileName('OTM 7000 K产品技术要求 rev 1.4.docx', 'OTM 7000 K产品技术要求 rev 1.5.docx', '差异清单.txt'),
    'OTM 7000 K产品技术要求_差异清单.txt'
  );
  assert.equal(
    buildExportFileName('产品技术要求v1.4.pdf', '产品技术要求v1.5.pdf', '差异清单.txt'),
    '产品技术要求_差异清单.txt'
  );
});

test('版本标记词不同但主体相同：同样只保留主体名', function () {
  assert.equal(
    buildExportFileName('产品技术要求-终版.docx', '产品技术要求-发布版.docx', '差异清单.txt'),
    '产品技术要求_差异清单.txt'
  );
});

test('非版本差异仍保留两侧文件名，避免丢失区分信息', function () {
  assert.equal(
    buildExportFileName('型号7000 优化.xlsx', '型号7000 最终.xlsx', '差异清单.csv'),
    '型号7000 优化_vs_型号7000 最终_差异清单.csv'
  );
});

test('缺失文件名时仍生成可用的默认名', function () {
  assert.equal(buildExportFileName('', '', '差异清单.csv'), '未命名_差异清单.csv');
});

test('自定义 maxLength 生效', function () {
  const result = buildExportFileName('很久以前的报表.docx', '最新报表.docx', '差异清单.csv', { maxLength: 40 });
  assert.ok(result.length <= 40, '实际长度：' + result.length);
  assert.ok(result.endsWith('_差异清单.csv'));
});
