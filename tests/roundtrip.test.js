'use strict';

// 往返測試：本工具印出的版面，再匯入回來後必須還原出完全相同的正文與欄位。
// 這是整個匯入功能最強的驗證——它同時檢查渲染、字格還原與欄位判讀。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Html = require('../importers/html-letter.js');
const Parser = require('../importers/letter-parser.js');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const INPUTS = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, '_input.json'), 'utf8'));

function importFixture(name) {
  const html = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.html`), 'utf8');
  return Parser.parseLetter(Html.readBlocks(html));
}

for (const [name, expected] of Object.entries(INPUTS)) {
  test(`「${name}」版面匯入後正文完全還原`, () => {
    assert.equal(importFixture(name).content, expected.content);
  });

  test(`「${name}」版面匯入後欄位完全還原`, () => {
    const { fields } = importFixture(name);
    assert.equal(fields.senderName, expected.senderName);
    assert.equal(fields.senderPostalCode, expected.senderPostalCode);
    assert.equal(fields.senderAddr, expected.senderAddr);
    assert.equal(fields.recvName, expected.recvName);
    assert.equal(fields.recvPostalCode, expected.recvPostalCode);
    assert.equal(fields.recvAddr, expected.recvAddr);
    assert.equal(fields.ccName, expected.ccName);
    assert.equal(fields.ccAddr, expected.ccAddr);
    assert.equal(String(fields.copyCount ?? 0), expected.copyCount);
    assert.equal(String(fields.attachCount ?? 0), expected.attachCount);
    assert.equal(String(fields.extraOriginal ?? 0), expected.extraOriginal);
    assert.equal(String(fields.extraCopy ?? 0), expected.extraCopy);
  });
}

test('多份副本不會讓正文被重複串接', () => {
  // withCopies 共 5 份（正本 1、副本 2、加具正副本各 1），每份 1 頁
  const result = importFixture('withCopies');
  assert.equal(result.content, INPUTS.withCopies.content);
  assert.equal(result.gridRows, 10, '應只取第一份的 10 列字格');
});

test('跨頁信函的兩頁字格會接續成完整正文', () => {
  const result = importFixture('multipage');
  assert.equal(result.gridRows, 20, '兩頁共 20 列字格');
  assert.equal(result.content, '甲'.repeat(201));
});

test('官方樣板文字不會混進還原後的正文', () => {
  const result = importFixture('basic');
  ['郵局存證信函用紙', '騎縫郵戳', '存證費', '備', '黏', '郵票或郵資券', '另紙聯記']
    .forEach(word => assert.ok(!result.content.includes(word), `正文混入樣板文字「${word}」`));
});

test('匯入結果一律附帶判讀說明，供介面標示待人工核對', () => {
  const result = importFixture('basic');
  assert.ok(result.notes.length > 0);
  assert.ok(result.notes.some(note => /字格/.test(note)));
  assert.equal(result.source, 'grid');
});
