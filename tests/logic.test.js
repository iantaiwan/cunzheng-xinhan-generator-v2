'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Logic = require('../logic.js');

test('空白正文仍建立一張空白格式頁', () => {
  const pages = Logic.paginateContent('');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 10);
  assert.equal(pages[0][0].length, 20);
});

test('20、200 與 201 字的分頁邊界正確', () => {
  assert.equal(Logic.countPages('甲'.repeat(20)), 1);
  assert.equal(Logic.countPages('甲'.repeat(200)), 1);
  assert.equal(Logic.countPages('甲'.repeat(201)), 2);

  const pages = Logic.paginateContent('甲'.repeat(201));
  const filledCells = pages.map(page => page.flat().filter(Boolean).length);
  assert.deepEqual(filledCells, [200, 1]);
});

test('使用者換行會強制從下一列開始', () => {
  const [page] = Logic.paginateContent('第一行\n第二行');
  assert.equal(page[0].slice(0, 3).join(''), '第一行');
  assert.equal(page[1].slice(0, 3).join(''), '第二行');
});

test('CRLF 與 LF 的分頁結果一致', () => {
  assert.deepEqual(
    Logic.paginateContent('甲\r\n乙'),
    Logic.paginateContent('甲\n乙')
  );
});

test('支援 Unicode grapheme，組合字不會拆成兩格', () => {
  if (typeof Intl.Segmenter !== 'function') return;
  assert.equal(Logic.countCharacters('e\u0301'), 1);
  assert.equal(Logic.paginateContent('e\u0301')[0][0][0], 'e\u0301');
});

test('郵遞區號僅接受 3、5 或 6 碼數字', () => {
  assert.equal(Logic.isPostalCode('100'), true);
  assert.equal(Logic.isPostalCode('10001'), true);
  assert.equal(Logic.isPostalCode('100001'), true);
  assert.equal(Logic.isPostalCode('10'), false);
  assert.equal(Logic.isPostalCode('1000'), false);
  assert.equal(Logic.isPostalCode('ABC'), false);
});

test('選填郵遞區號可留白，填寫時仍檢查格式', () => {
  assert.equal(Logic.isOptionalPostalCode(''), true);
  assert.equal(Logic.isOptionalPostalCode('   '), true);
  assert.equal(Logic.isOptionalPostalCode('100'), true);
  assert.equal(Logic.isOptionalPostalCode('1000'), false);
});

test('整數欄位必須落在指定範圍', () => {
  assert.equal(Logic.parseBoundedInteger('0', 0, 10), 0);
  assert.equal(Logic.parseBoundedInteger('2', 1, 10), 2);
  assert.equal(Logic.parseBoundedInteger('-1', 0, 10), null);
  assert.equal(Logic.parseBoundedInteger('2.5', 0, 10), null);
  assert.equal(Logic.parseBoundedInteger('100', 0, 10), null);
  assert.equal(Logic.parseBoundedInteger('', 0, 10), null);
});

test('輸出文字會完整逸出 HTML 特殊字元', () => {
  assert.equal(
    Logic.escapeHtml('<script data-x="1">\'&'),
    '&lt;script data-x=&quot;1&quot;&gt;&#039;&amp;'
  );
});
