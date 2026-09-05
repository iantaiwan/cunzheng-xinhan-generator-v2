'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Render = require('../render.js');
const Logic = require('../logic.js');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const INPUTS = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, '_input.json'), 'utf8'));

// fixtures/*.html 是瀏覽器序列化後的 DOM（見 fixtures/README.md）。
// 瀏覽器在「文字節點」中會把 &quot; 與 &#039; 還原成 " 與 '，
// 兩種寫法語意完全相同，因此比對前在雙方套用同一組還原規則。
// 這只是比對用的正規化，不是安全性判準；逸出行為另有專門測試把關。
function normalize(html) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/>\s+</g, '><')
    .trim();
}

function toRenderData(raw) {
  return {
    ...raw,
    copyCount: Number(raw.copyCount),
    attachCount: Number(raw.attachCount),
    extraOriginal: Number(raw.extraOriginal),
    extraCopy: Number(raw.extraCopy)
  };
}

test('渲染輸出與官方版面基準完全相同（格式回歸防護）', () => {
  for (const [name, raw] of Object.entries(INPUTS)) {
    const golden = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.html`), 'utf8');
    const actual = Render.buildDocument(toRenderData(raw)).html;
    assert.equal(normalize(actual), normalize(golden), `版面 fixture「${name}」已改變`);
  }
});

test('份數決定列印的正副本序列', () => {
  const base = { copyCount: 0, extraOriginal: 0, extraCopy: 0 };
  assert.deepEqual(Render.buildCopySets(base), ['正本']);
  assert.deepEqual(
    Render.buildCopySets({ copyCount: 2, extraOriginal: 1, extraCopy: 1 }),
    ['正本', '副本', '副本', '正本', '副本']
  );
});

test('總張數等於份數乘以頁數', () => {
  const data = {
    senderName: '甲', senderPostalCode: '', senderAddr: '地址',
    recvName: '乙', recvPostalCode: '', recvAddr: '地址',
    ccName: '', ccPostalCode: '', ccAddr: '',
    copyCount: 2, attachCount: 0, extraOriginal: 0, extraCopy: 0,
    content: '甲'.repeat(201)
  };
  const result = Render.buildDocument(data);
  assert.equal(result.pageCount, 2);
  assert.equal(result.copySetCount, 3);
  assert.equal((result.html.match(/class="print-page"/g) || []).length, 6);
});

test('每頁字格為 10 行 × 20 格，且列標籤依序為一到十', () => {
  const pages = Logic.paginateContent('甲');
  const grid = Render.buildGrid(pages[0]);
  assert.equal((grid.match(/<tr>/g) || []).length, 11); // 1 列表頭 + 10 列內文
  Render.ROW_LABELS.forEach(label => {
    assert.ok(grid.includes(`<td class="row-label">${label}</td>`), `缺少列標籤 ${label}`);
  });
});

test('郵遞區號與地址之間以全形空白相接，留白時不留下多餘空白', () => {
  assert.equal(Render.addressText('100', '臺北市'), '100　臺北市');
  assert.equal(Render.addressText('', '臺北市'), '臺北市');
  assert.equal(Render.addressText('', ''), '');
});

test('寄件人欄位保留用印位置，收件人欄位則否', () => {
  assert.ok(Render.buildPartyRow('一', '寄件人', '甲', '', '地址', true).includes('　（印）'));
  assert.ok(!Render.buildPartyRow('二', '收件人', '乙', '', '地址', false).includes('（印）'));
});

test('字格內容一律經過 HTML 逸出，標籤不會注入 DOM', () => {
  const pages = Logic.paginateContent('<img src=x onerror=alert(1)>');
  const grid = Render.buildGrid(pages[0]);
  assert.ok(!/<img/i.test(grid), '字格內出現未逸出的標籤');
  assert.ok(grid.includes('<td>&lt;</td>'));
  assert.ok(grid.includes('<td>&gt;</td>'));
});

test('姓名、地址與 aria-label 都經過逸出', () => {
  const data = {
    senderName: '<script>alert(1)</script>', senderPostalCode: '', senderAddr: '"&<>\'',
    recvName: '乙', recvPostalCode: '', recvAddr: '地址',
    ccName: '', ccPostalCode: '', ccAddr: '',
    copyCount: 0, attachCount: 0, extraOriginal: 0, extraCopy: 0,
    content: '甲'
  };
  const { html } = Render.buildDocument(data);
  assert.ok(!/<script/i.test(html), '輸出含有未逸出的 script 標籤');
  assert.ok(html.includes('&lt;script&gt;'));
  // aria-label 內的引號必須逸出，否則屬性會被提前關閉
  assert.ok(/aria-label="[^"]*正本存證信函"/.test(html));
});

test('費用欄位反映實際份數與總頁數', () => {
  const lower = Render.buildLowerSection(
    { copyCount: 2, attachCount: 3, extraOriginal: 1, extraCopy: 4 },
    7
  );
  assert.ok(lower.includes('本存證信函共 7 頁，正本 1 份'));
  assert.ok(lower.includes('副本 2 份'));
  assert.ok(lower.includes('附件 3 張'));
  assert.ok(lower.includes('加具正本 1 份'));
  assert.ok(lower.includes('加具副本 4 份'));
});
