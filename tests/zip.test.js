'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Zip = require('../importers/zip.js');
const XmlScan = require('../importers/xml-scan.js');
const { makeZip } = require('./helpers/make-zip.js');

const decode = bytes => new TextDecoder('utf-8').decode(bytes);

test('讀得出 deflate 壓縮的項目', async () => {
  const zip = await makeZip([{ name: 'a.txt', content: '存證信函測試內容'.repeat(50), method: 8 }]);
  assert.equal(await Zip.readTextFile(zip, 'a.txt'), '存證信函測試內容'.repeat(50));
});

test('讀得出未壓縮（stored）的項目', async () => {
  const zip = await makeZip([{ name: 'mimetype', content: 'application/vnd.oasis.opendocument.text', method: 0 }]);
  assert.equal(await Zip.readTextFile(zip, 'mimetype'), 'application/vnd.oasis.opendocument.text');
});

test('同一個容器內可混用兩種壓縮方式', async () => {
  const zip = await makeZip([
    { name: 'mimetype', content: 'text/plain', method: 0 },
    { name: 'content.xml', content: '<x>甲乙丙</x>', method: 8 }
  ]);
  const archive = Zip.listEntries(zip);
  assert.deepEqual(archive.entries.map(entry => entry.name), ['mimetype', 'content.xml']);
  assert.equal(await Zip.readTextFile(zip, 'content.xml'), '<x>甲乙丙</x>');
});

test('中央目錄前有註解時仍能定位', async () => {
  const zip = await makeZip([{ name: 'a.txt', content: '內容' }], { comment: 'x'.repeat(500) });
  assert.equal(await Zip.readTextFile(zip, 'a.txt'), '內容');
});

test('UTF-8 檔名可正確解碼', async () => {
  const zip = await makeZip([{ name: '資料夾/檔案.xml', content: '內容' }]);
  const archive = Zip.listEntries(zip);
  assert.equal(archive.entries[0].name, '資料夾/檔案.xml');
});

test('CRC32 不符時明確報錯，不把損毀內容往下傳', async () => {
  const zip = await makeZip([{ name: 'a.txt', content: '原始內容' }], { corruptCrcFor: 'a.txt' });
  await assert.rejects(
    () => Zip.readTextFile(zip, 'a.txt'),
    error => error instanceof Zip.ZipError && /CRC32 校驗失敗/.test(error.message)
  );
});

test('CRC32 對已知輸入產生標準值', () => {
  assert.equal(Zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(Zip.crc32(new Uint8Array(0)), 0);
});

test('非 ZIP 檔案被明確拒絕', () => {
  const notZip = new TextEncoder().encode('這只是一個純文字檔');
  assert.equal(Zip.isZip(notZip), false);
  assert.throws(() => Zip.listEntries(notZip), Zip.ZipError);
});

test('找不到指定項目時報出項目名稱', async () => {
  const zip = await makeZip([{ name: 'a.txt', content: '內容' }]);
  await assert.rejects(
    () => Zip.readTextFile(zip, 'word/document.xml'),
    error => /word\/document\.xml/.test(error.message)
  );
});

test('尾端被截斷的檔案不會造成無窮迴圈或例外洩漏', async () => {
  const zip = await makeZip([{ name: 'a.txt', content: '內容' }]);
  assert.throws(() => Zip.listEntries(zip.subarray(0, zip.length - 10)), Zip.ZipError);
  assert.throws(() => Zip.listEntries(new Uint8Array(3)), Zip.ZipError);
});

test('XML 掃描器解出標籤、屬性與文字', () => {
  const events = [];
  XmlScan.scan('<a x="1"><b/>文字<c y=\'2\'>內</c></a>', {
    onOpen: (name, attributes) => events.push(['open', name, attributes]),
    onClose: name => events.push(['close', name]),
    onText: text => events.push(['text', text])
  });
  assert.deepEqual(events, [
    ['open', 'a', { x: '1' }],
    ['open', 'b', {}], ['close', 'b'],
    ['text', '文字'],
    ['open', 'c', { y: '2' }], ['text', '內'], ['close', 'c'],
    ['close', 'a']
  ]);
});

test('XML 掃描器略過註解、CDATA 與處理指令', () => {
  const texts = [];
  XmlScan.scan('<?xml version="1.0"?><!DOCTYPE x><a><!--註解-->甲<![CDATA[<乙>]]></a>', {
    onText: text => texts.push(text)
  });
  assert.deepEqual(texts, ['甲', '<乙>']);
});

test('XML 實體正確還原，未知實體原樣保留', () => {
  assert.equal(XmlScan.decodeEntities('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;'), '<a> & "b" \'c\'');
  assert.equal(XmlScan.decodeEntities('&#26085;&#x672C;'), '日本');
  assert.equal(XmlScan.decodeEntities('&nbsp;&unknown;'), '&nbsp;&unknown;');
});
