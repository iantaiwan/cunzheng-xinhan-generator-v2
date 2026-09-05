'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Pdf = require('../importers/pdf-text.js');
const Parser = require('../importers/letter-parser.js');
const { makePdf, buildToUnicode, bytesFromLatin1 } = require('./helpers/make-pdf.js');

const INPUTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/_input.json'), 'utf8'));
const texts = blocks => blocks.map(block => block.text);

test('未壓縮與 FlateDecode 壓縮的內容串流都能讀取', async () => {
  for (const compress of [false, true]) {
    const bytes = await makePdf([{ text: '主旨：測試', y: 700 }, { text: '一、第一點', y: 680 }], { compress });
    const result = await Pdf.readBlocks(bytes);
    assert.deepEqual(texts(result.blocks), ['主旨：測試', '一、第一點'], `compress=${compress}`);
  }
});

test('同一個 y 座標的多段文字會併成同一行', async () => {
  const bytes = await makePdf([
    { text: '詳細地址：', y: 700 },
    { text: '臺北市', y: 700 },
    { text: '第二行', y: 680 }
  ]);
  assert.deepEqual(texts((await Pdf.readBlocks(bytes)).blocks), ['詳細地址：臺北市', '第二行']);
});

test('二進位資料不因編碼轉換而損毀（zlib 標頭 0x78 0x9C）', async () => {
  // TextDecoder('latin1') 實際上是 windows-1252，會把 0x9C 轉成 U+0153，
  // 寫回位元組時變成 0x53，剛好破壞 zlib 標頭。這個測試把該行為釘住。
  const bytes = await makePdf([{ text: '測試內容需要夠長才會壓出這個標頭'.repeat(20), y: 700 }], { compress: true });
  const source = new Uint8Array(bytes);
  const objects = Pdf.scanObjects(String.fromCharCode.apply(null, source));
  assert.ok(objects.size >= 6);
  const result = await Pdf.readBlocks(bytes);
  assert.ok(result.blocks[0].text.startsWith('測試內容需要夠長'));
});

test('CMap 的 bfchar 與 bfrange 兩種形式都解析得出', () => {
  const cmap = Pdf.parseCMap(`begincodespacerange
<0000> <FFFF>
endcodespacerange
beginbfchar
<0003> <0020>
endbfchar
beginbfrange
<0010> <0012> <0041>
<0020> <0021> [<4E00> <4E8C>]
endbfrange`);

  assert.equal(cmap.codeBytes, 2);
  assert.equal(cmap.map.get(0x0003), ' ');
  assert.equal(cmap.map.get(0x0010), 'A');
  assert.equal(cmap.map.get(0x0011), 'B');
  assert.equal(cmap.map.get(0x0012), 'C');
  assert.equal(cmap.map.get(0x0020), '一');
  assert.equal(cmap.map.get(0x0021), '二');
});

test('單位元組 codespace 的 CMap 依 1 位元組解碼', () => {
  const cmap = Pdf.parseCMap(`begincodespacerange
<00> <FF>
endcodespacerange
beginbfchar
<41> <4E00>
endbfchar`);
  assert.equal(cmap.codeBytes, 1);
  assert.equal(cmap.map.get(0x41), '一');
});

test('字面字串的跳脫序列與巢狀括號正確解析', () => {
  assert.equal(Pdf.parseLiteralString('abc)', 0).value, 'abc');
  assert.equal(Pdf.parseLiteralString('a\\(b\\)c)', 0).value, 'a(b)c');
  assert.equal(Pdf.parseLiteralString('a(b)c)', 0).value, 'a(b)c');
  assert.equal(Pdf.parseLiteralString('a\\101b)', 0).value, 'aAb');
  assert.equal(Pdf.parseLiteralString('a\\nb)', 0).value, 'a\nb');
});

test('非 PDF、加密 PDF 與無文字圖層都給出可辨識的錯誤', async () => {
  await assert.rejects(
    () => Pdf.readBlocks(new TextEncoder().encode('這不是 PDF')),
    error => error instanceof Pdf.PdfError && /不是 PDF/.test(error.message)
  );
  const encrypted = await makePdf([{ text: '甲', y: 700 }], { encrypted: true });
  await assert.rejects(
    () => Pdf.readBlocks(encrypted),
    error => /已加密/.test(error.message)
  );
  await assert.rejects(
    () => Pdf.readBlocks(bytesFromLatin1('%PDF-1.7\n1 0 obj\n<</Type /Catalog>>\nendobj\n%%EOF')),
    error => /沒有可讀取的文字圖層/.test(error.message)
  );
});

test('字型缺少 ToUnicode 時明確回報，不假裝成功', async () => {
  const bytes = await makePdf([{ text: '甲乙丙', y: 700 }], { omitToUnicode: true });
  await assert.rejects(
    () => Pdf.readBlocks(bytes),
    error => /無法對應到可讀字元|沒有可讀取的文字圖層/.test(error.message)
  );
});

test('buildToUnicode 產生的 CMap 可被自己的解析器讀回（往返一致）', () => {
  const charToCode = new Map([['甲', 0x0100], ['乙', 0x0101]]);
  const parsed = Pdf.parseCMap(buildToUnicode(charToCode));
  assert.equal(parsed.map.get(0x0100), '甲');
  assert.equal(parsed.map.get(0x0101), '乙');
});

test('實際列印出的 PDF 可完整還原正文與欄位', async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/printed-basic.pdf')));
  const extracted = await Pdf.readBlocks(bytes);
  const result = Parser.parseLetter(extracted.blocks);
  const expected = INPUTS.basic;

  assert.equal(result.source, 'grid');
  assert.equal(result.gridRows, 10);
  assert.equal(result.content, expected.content);
  assert.equal(result.fields.senderName, expected.senderName);
  assert.equal(result.fields.senderPostalCode, expected.senderPostalCode);
  assert.equal(result.fields.senderAddr, expected.senderAddr);
  assert.equal(result.fields.recvName, expected.recvName);
  assert.equal(result.fields.recvPostalCode, expected.recvPostalCode);
  assert.equal(result.fields.recvAddr, expected.recvAddr);
});

test('從文字行還原字格：標籤與內容同行或分行都能處理', () => {
  const { gridRows, other } = Parser.extractGridFromLines([
    '上方欄位文字',
    '1234567891011121314151617181920',
    '一主旨：測試',
    '二',                      // 空白列（下一行以「三」開頭）
    '三一、台端於民國一百一十四年一月十日向本人',
    '四',                      // 標籤自成一行，內容在下一行
    '借款新臺幣十萬元。',
    '五二、請於七日內清償。',
    '六', '七', '八', '九', '十',
    '本存證信函共 1 頁，正本 1 份'
  ]);

  assert.deepEqual(gridRows, [
    '主旨：測試', '', '一、台端於民國一百一十四年一月十日向本人',
    '借款新臺幣十萬元。', '二、請於七日內清償。', '', '', '', '', ''
  ]);
  assert.deepEqual(other, ['上方欄位文字', '本存證信函共 1 頁，正本 1 份']);
});

test('欄號表頭列辨識不受分隔符號影響', () => {
  assert.equal(Parser.isGridHeaderLine('1234567891011121314151617181920'), true);
  assert.equal(Parser.isGridHeaderLine('格行 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20'), true);
  assert.equal(Parser.isGridHeaderLine('一、台端於一月十日'), false);
  assert.equal(Parser.isGridHeaderLine('123'), false);
});
