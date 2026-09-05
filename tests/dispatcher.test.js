'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Importer = require('../importers/index.js');
const Ocr = require('../importers/ocr.js');
const { makeDocx, makeOdt } = require('./helpers/make-zip.js');
const { makePdf } = require('./helpers/make-pdf.js');

const encode = text => new TextEncoder().encode(text);

test('格式依內容的 magic bytes 判斷，不只看副檔名', async () => {
  const docx = await makeDocx(['甲']);
  const pdf = await makePdf([{ text: '甲', y: 700 }]);

  assert.equal(Importer.detectKind(pdf, 'letter.docx'), Importer.KIND.PDF, '副檔名錯了也要看得出是 PDF');
  assert.equal(Importer.detectKind(docx, 'letter.pdf'), Importer.KIND.OFFICE);
  assert.equal(Importer.detectKind(encode('<!DOCTYPE html><html><body>x</body></html>'), 'a.txt'), Importer.KIND.HTML);
  assert.equal(Importer.detectKind(encode('純文字內容'), 'a.txt'), Importer.KIND.TEXT);
  assert.equal(Importer.detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'a.png'), Importer.KIND.IMAGE);
  assert.equal(Importer.detectKind(new Uint8Array([0xff, 0xd8, 0xff, 1]), 'a.jpg'), Importer.KIND.IMAGE);
  assert.equal(Importer.detectKind(new Uint8Array([0xff, 0xfe, 0x00, 0x01]), 'a.bin'), Importer.KIND.UNKNOWN);
});

test('每種支援的格式都走到對應的匯入路徑', async () => {
  const cases = [
    [await makeDocx(['主旨：測試']), Importer.KIND.OFFICE],
    [await makeOdt(['主旨：測試']), Importer.KIND.OFFICE],
    [await makePdf([{ text: '主旨：測試', y: 700 }]), Importer.KIND.PDF],
    [encode(fs.readFileSync(path.join(__dirname, 'fixtures/basic.html'), 'utf8')), Importer.KIND.HTML],
    [encode('主旨：測試'), Importer.KIND.TEXT]
  ];

  for (const [bytes, expectedKind] of cases) {
    const result = await Importer.importBytes(bytes, 'x');
    assert.equal(result.kind, expectedKind);
    assert.ok(result.content.includes('主旨：'), `${expectedKind} 沒有取得正文`);
    assert.ok(Array.isArray(result.notes) && result.notes.length > 0, `${expectedKind} 缺少判讀說明`);
  }
});

test('圖片與無法辨識的格式被明確擋下並指出下一步', async () => {
  await assert.rejects(
    () => Importer.importBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'a.png'),
    error => /需要 OCR/.test(error.message)
  );
  await assert.rejects(
    () => Importer.importBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x01]), 'a.bin'),
    error => /無法辨識這個檔案的格式/.test(error.message)
  );
});

test('空檔案與超過上限的檔案在讀取前就被拒絕', async () => {
  await assert.rejects(() => Importer.importBytes(new Uint8Array(0), 'a.txt'), /這個檔案是空的/);
  await assert.rejects(
    () => Importer.importBytes(new Uint8Array(Importer.MAX_BYTES + 1), 'a.txt'),
    /超過 20 MB 上限/
  );
});

test('轉出的純文字檔含所有欄位、正文與判讀說明', async () => {
  const result = await Importer.importBytes(
    encode(fs.readFileSync(path.join(__dirname, 'fixtures/basic.html'), 'utf8')),
    'basic.html'
  );
  const text = Importer.toPlainTextFile(result);

  assert.ok(text.includes('寄件人姓名：王小明'));
  assert.ok(text.includes('寄件人郵遞區號：100'));
  assert.ok(text.includes('收件人姓名：陳大華'));
  assert.ok(text.includes('# 正文'));
  assert.ok(text.includes('主旨：催告返還欠款'));
  assert.ok(text.includes('# 判讀說明'));
  assert.ok(text.endsWith('\n'));
});

test('未判讀出的欄位在文字檔中明確標示，不留下空白讓人誤以為正確', () => {
  const text = Importer.toPlainTextFile({
    fields: { senderName: '甲', recvName: '', copyCount: 0 },
    content: '正文',
    notes: []
  });
  assert.ok(text.includes('寄件人姓名：甲'));
  assert.ok(text.includes('收件人姓名：（未判讀）'));
  assert.ok(text.includes('副本份數：0'), '0 是有效值，不可標成未判讀');
});

test('OCR 引擎預設未註冊，且不會在載入時嘗試連線', () => {
  assert.equal(Ocr.isRegistered(), false);
  assert.equal(Ocr.VENDOR_ENTRY, 'vendor/ocr-engine.js');
  assert.match(Ocr.SETUP_HINT, /vendor\/README\.md/);
});

test('未安裝 OCR 引擎時給出安裝指引，而非無聲失敗', async () => {
  await assert.rejects(() => Ocr.ensureEngine(), error => /尚未安裝 OCR 引擎/.test(error.message));
});

test('註冊的 OCR 引擎會被使用，且結果一律附上核對提醒', async () => {
  Ocr.register({
    name: '測試引擎',
    async recognize() { return '主旨：測試\r\n一、第一點\n'; }
  });
  try {
    assert.equal(Ocr.isRegistered(), true);
    const result = await Ocr.recognize(null, {});
    assert.equal(result.text, '主旨：測試\n一、第一點');
    assert.equal(result.engine, '測試引擎');
    assert.ok(result.notes.some(note => /逐字核對/.test(note)));

    const imported = await Importer.importWithOcr(null, {});
    assert.equal(imported.kind, Importer.KIND.IMAGE);
    assert.equal(imported.content, '主旨：測試\n一、第一點');
    assert.ok(imported.notes.some(note => /逐字核對/.test(note)));
  } finally {
    Ocr.unregister();
  }
});

test('OCR 沒辨識出文字時明確說明，不回傳空結果了事', async () => {
  Ocr.register({ name: '空引擎', async recognize() { return '   '; } });
  try {
    const result = await Ocr.recognize(null, {});
    assert.equal(result.text, '');
    assert.ok(result.notes.some(note => /沒有辨識出任何文字/.test(note)));
  } finally {
    Ocr.unregister();
  }
});

test('不合規的 OCR 引擎會被拒絕註冊', () => {
  assert.throws(() => Ocr.register({}), TypeError);
  assert.throws(() => Ocr.register(null), TypeError);
  assert.equal(Ocr.isRegistered(), false);
});
