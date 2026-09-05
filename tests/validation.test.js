'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Validation = require('../validation.js');

function makeData(overrides = {}) {
  return {
    senderName: '王小明', senderPostalCode: '', senderAddr: '臺北市中正區重慶南路一段2號',
    recvName: '陳大華', recvPostalCode: '', recvAddr: '臺中市中區民權路1號',
    ccName: '', ccPostalCode: '', ccAddr: '',
    copyCountRaw: '0', attachCountRaw: '0', extraOriginalRaw: '0', extraCopyRaw: '0',
    content: '主旨：測試',
    ...overrides
  };
}

const idsOf = result => result.errors.map(error => error.id);

test('完整且合法的資料不產生任何錯誤', () => {
  const result = Validation.validateData(makeData());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('四個必填欄位缺一不可', () => {
  const result = Validation.validateData(makeData({
    senderName: '', senderAddr: '', recvName: '', recvAddr: ''
  }));
  assert.deepEqual(idsOf(result), ['senderName', 'senderAddr', 'recvName', 'recvAddr']);
  result.errors.forEach(error => assert.match(error.message, /^請填寫.+。$/));
});

test('郵遞區號留白通過，格式錯誤時指出正確欄位', () => {
  assert.deepEqual(idsOf(Validation.validateData(makeData())), []);
  const result = Validation.validateData(makeData({
    senderPostalCode: '12', recvPostalCode: 'ABC'
  }));
  assert.deepEqual(idsOf(result), ['senderPostalCode', 'recvPostalCode']);
  assert.equal(result.errors[0].message, '寄件人郵遞區號須為 3、5 或 6 碼數字。');
});

test('副本收件人整組選填，但填了任一格就必須補齊姓名與地址', () => {
  assert.deepEqual(idsOf(Validation.validateData(makeData())), []);
  assert.deepEqual(
    idsOf(Validation.validateData(makeData({ ccPostalCode: '220' }))),
    ['ccName', 'ccAddr']
  );
  assert.deepEqual(
    idsOf(Validation.validateData(makeData({ ccName: '丙' }))),
    ['ccAddr']
  );
  assert.deepEqual(
    idsOf(Validation.validateData(makeData({ ccName: '丙', ccAddr: '地址', ccPostalCode: '220' }))),
    []
  );
});

test('空白或純空白的正文視為未填寫', () => {
  assert.deepEqual(idsOf(Validation.validateData(makeData({ content: '' }))), ['content']);
  assert.deepEqual(idsOf(Validation.validateData(makeData({ content: '   \n  ' }))), ['content']);
});

test('正文超過 5,000 字元時擋下', () => {
  const result = Validation.validateData(makeData({ content: '甲'.repeat(5001) }));
  assert.deepEqual(idsOf(result), ['content']);
  assert.equal(result.errors[0].message, '信函正文不得超過 5,000 個字元。');
  assert.deepEqual(idsOf(Validation.validateData(makeData({ content: '甲'.repeat(5000) }))), []);
});

test('份數欄位各自套用自己的上下界', () => {
  assert.deepEqual(idsOf(Validation.validateData(makeData({ copyCountRaw: '11' }))), ['copyCount']);
  assert.deepEqual(idsOf(Validation.validateData(makeData({ copyCountRaw: '10' }))), []);
  assert.deepEqual(idsOf(Validation.validateData(makeData({ attachCountRaw: '101' }))), ['attachCount']);
  assert.deepEqual(idsOf(Validation.validateData(makeData({ attachCountRaw: '100' }))), []);
  assert.deepEqual(idsOf(Validation.validateData(makeData({ extraOriginalRaw: '21' }))), ['extraOriginal']);
  assert.deepEqual(idsOf(Validation.validateData(makeData({ extraCopyRaw: '-1' }))), ['extraCopy']);
});

test('份數非整數或空白時給出可讀訊息', () => {
  const result = Validation.validateData(makeData({ copyCountRaw: '2.5' }));
  assert.equal(result.errors[0].message, '副本份數須為 0 至 10 的整數。');
  assert.deepEqual(idsOf(Validation.validateData(makeData({ attachCountRaw: '' }))), ['attachCount']);
});

test('正副本合計超過 20 份時擋下', () => {
  // 1 份正本 + 10 副本 + 5 加具正本 + 4 加具副本 = 20，剛好通過
  assert.deepEqual(idsOf(Validation.validateData(makeData({
    copyCountRaw: '10', extraOriginalRaw: '5', extraCopyRaw: '4'
  }))), []);
  const result = Validation.validateData(makeData({
    copyCountRaw: '10', extraOriginalRaw: '5', extraCopyRaw: '5'
  }));
  assert.deepEqual(idsOf(result), ['copyCount']);
  assert.equal(result.errors[0].message, '本次列印的正副本合計不得超過 20 份。');
});

test('份數本身無效時不重複報總份數錯誤', () => {
  const result = Validation.validateData(makeData({ copyCountRaw: 'x', extraOriginalRaw: '20' }));
  assert.deepEqual(idsOf(result), ['copyCount']);
});

test('殘留的中括號範本欄位只是警告，不擋列印', () => {
  const result = Validation.validateData(makeData({ content: '請於[天數]日內清償。' }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ['正文仍含有中括號範本欄位，請確認已全部替換。']);
});

test('normalized 會把份數轉成數字，無效值退回 0', () => {
  const ok = Validation.validateData(makeData({ copyCountRaw: '3', attachCountRaw: '7' }));
  assert.equal(ok.normalized.copyCount, 3);
  assert.equal(ok.normalized.attachCount, 7);
  assert.equal(ok.normalized.extraOriginal, 0);

  const bad = Validation.validateData(makeData({ copyCountRaw: 'abc' }));
  assert.equal(bad.normalized.copyCount, 0);
});

test('簽章能區分任何一個欄位的變動', () => {
  const base = makeData();
  assert.equal(Validation.signatureFor(base), Validation.signatureFor(makeData()));
  assert.notEqual(Validation.signatureFor(base), Validation.signatureFor(makeData({ content: '不同' })));
  assert.notEqual(Validation.signatureFor(base), Validation.signatureFor(makeData({ copyCountRaw: '1' })));
});

test('每個範本都可用，且都保留待替換的中括號欄位', () => {
  const keys = Object.keys(Validation.TEMPLATES);
  assert.deepEqual(keys, ['debt', 'termination', 'refund', 'lease', 'labor']);
  keys.forEach(key => {
    const text = Validation.TEMPLATES[key];
    assert.ok(text.startsWith('主旨：'), `${key} 缺少主旨`);
    assert.match(text, /\[[^\]]+\]/, `${key} 沒有待替換欄位`);
    // 範本一旦被套用就應觸發「尚未替換」警告
    const result = Validation.validateData(makeData({ content: text }));
    assert.equal(result.warnings.length, 1, `${key} 未觸發替換提醒`);
  });
});

test('FIELD_IDS 涵蓋所有會被標記錯誤的欄位', () => {
  const everyErrorId = new Set();
  [
    makeData({ senderName: '', senderAddr: '', recvName: '', recvAddr: '', content: '' }),
    makeData({ senderPostalCode: '1', recvPostalCode: '1', ccPostalCode: '1', ccName: '丙', ccAddr: '地址' }),
    makeData({ ccName: '丙' }),
    makeData({ copyCountRaw: 'x', attachCountRaw: 'x', extraOriginalRaw: 'x', extraCopyRaw: 'x' })
  ].forEach(data => {
    Validation.validateData(data).errors.forEach(error => everyErrorId.add(error.id));
  });
  everyErrorId.forEach(id => {
    assert.ok(Validation.FIELD_IDS.includes(id), `FIELD_IDS 缺少 ${id}，該欄位的錯誤標記無法被清除`);
  });
});
