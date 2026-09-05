'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Ooxml = require('../importers/ooxml.js');
const Html = require('../importers/html-letter.js');
const Parser = require('../importers/letter-parser.js');
const { makeDocx, makeOdt, makeZip, DOCX_XML } = require('./helpers/make-zip.js');

const paragraphs = blocks => blocks.filter(b => b.kind === 'paragraph').map(b => b.text);

test('.docx 段落依序抽出', async () => {
  const { format, blocks } = await Ooxml.readBlocks(await makeDocx(['主旨：測試', '一、第一點']));
  assert.equal(format, 'docx');
  assert.deepEqual(paragraphs(blocks), ['主旨：測試', '一、第一點']);
});

test('.odt 段落依序抽出', async () => {
  const { format, blocks } = await Ooxml.readBlocks(await makeOdt(['主旨：測試', '一、第一點']));
  assert.equal(format, 'odt');
  assert.deepEqual(paragraphs(blocks), ['主旨：測試', '一、第一點']);
});

test('.docx 的換行與定位點轉成對應字元', () => {
  const blocks = Ooxml.extractDocxBlocks(DOCX_XML(
    '<w:p><w:r><w:t>甲</w:t><w:br/><w:t>乙</w:t><w:tab/><w:t>丙</w:t></w:r></w:p>'
  ));
  assert.deepEqual(paragraphs(blocks), ['甲\n乙\t丙']);
});

test('.docx 的追蹤修訂刪除文字與功能變數指令碼不會混入內容', () => {
  const blocks = Ooxml.extractDocxBlocks(DOCX_XML(
    '<w:p><w:r><w:t>保留</w:t></w:r>'
    + '<w:del><w:r><w:delText>已刪除</w:delText></w:r></w:del>'
    + '<w:r><w:instrText>PAGE \\* MERGEFORMAT</w:instrText></w:r>'
    + '<w:r><w:t>結尾</w:t></w:r></w:p>'
  ));
  assert.deepEqual(paragraphs(blocks), ['保留結尾']);
});

test('.docx 的 xml:space="preserve" 空白不被吃掉', () => {
  const blocks = Ooxml.extractDocxBlocks(DOCX_XML(
    '<w:p><w:r><w:t xml:space="preserve">甲 </w:t></w:r><w:r><w:t>乙</w:t></w:r></w:p>'
  ));
  assert.deepEqual(paragraphs(blocks), ['甲 乙']);
});

test('.docx 表格列保留為 row 區塊，儲存格不被串接', () => {
  const blocks = Ooxml.extractDocxBlocks(DOCX_XML(
    '<w:tbl><w:tr>'
    + '<w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc>'
    + '</w:tr></w:tbl>'
  ));
  const rows = blocks.filter(b => b.kind === 'row');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].cells, ['甲', '乙']);
});

test('.odt 的連續空白與換行標記正確還原', () => {
  const blocks = Ooxml.extractOdtBlocks(
    '<office:text xmlns:office="x" xmlns:text="y">'
    + '<text:p>甲<text:s text:c="3"/>乙<text:line-break/>丙</text:p></office:text>'
  );
  assert.deepEqual(paragraphs(blocks), ['甲   乙\n丙']);
});

test('非 ZIP 或缺少內容檔時給出可讀錯誤', async () => {
  await assert.rejects(
    () => Ooxml.readBlocks(new TextEncoder().encode('純文字')),
    error => error instanceof Ooxml.ExtractError && /不是 ZIP 容器/.test(error.message)
  );
  const emptyZip = await makeZip([{ name: 'readme.txt', content: '無關檔案' }]);
  await assert.rejects(
    () => Ooxml.readBlocks(emptyZip),
    error => /找不到 word\/document\.xml 或 content\.xml/.test(error.message)
  );
});

test('字格列辨識：滿版單字列是字格，一般文字列不是', () => {
  const gridCells = '甲'.repeat(20).split('');
  assert.equal(Parser.isGridRow(gridCells), true);
  assert.equal(Parser.isGridRow(['一', ...gridCells]), true);
  assert.equal(Parser.isGridRow(new Array(20).fill('')), true);
  assert.equal(Parser.isGridRow(['姓名', '王小明']), false);
  assert.equal(Parser.isGridRow(['甲', '乙']), false);
});

test('欄號表頭列被辨識並跳過', () => {
  const header = ['格行', ...Array.from({ length: 20 }, (_, i) => String(i + 1))];
  assert.equal(Parser.isGridHeaderRow(header), true);
  assert.equal(Parser.isGridHeaderRow('甲'.repeat(20).split('')), false);
});

test('字格列去掉列標籤欄並修掉尾端空格', () => {
  const cells = ['三', '甲', '乙', '丙', ...new Array(17).fill('')];
  assert.equal(Parser.gridRowToLine(cells), '甲乙丙');
});

test('滿 20 格視為軟換行並與下一列接續', () => {
  assert.deepEqual(Parser.joinWrappedLines(['甲'.repeat(20), '乙乙']), ['甲'.repeat(20) + '乙乙']);
  assert.deepEqual(Parser.joinWrappedLines(['甲甲', '乙乙']), ['甲甲', '乙乙']);
  assert.deepEqual(Parser.joinWrappedLines(['甲', '', '乙']), ['甲', '', '乙']);
  assert.deepEqual(
    Parser.joinWrappedLines(['甲'.repeat(20), '甲'.repeat(20), '甲']),
    ['甲'.repeat(41)]
  );
});

test('郵遞區號從地址開頭拆出，沒有時整串當地址', () => {
  assert.deepEqual(Parser.splitPostalCode('100　臺北市中正區'), { postalCode: '100', address: '臺北市中正區' });
  assert.deepEqual(Parser.splitPostalCode('10001 臺北市'), { postalCode: '10001', address: '臺北市' });
  assert.deepEqual(Parser.splitPostalCode('臺北市中正區'), { postalCode: '', address: '臺北市中正區' });
  // 門牌號碼開頭不應被誤判成郵遞區號
  assert.deepEqual(Parser.splitPostalCode('臺北市中正區重慶南路100號'), { postalCode: '', address: '臺北市中正區重慶南路100號' });
});

test('姓名去掉用印標記', () => {
  assert.equal(Parser.cleanName('王小明　（印）'), '王小明');
  assert.equal(Parser.cleanName('王小明 (印)'), '王小明');
  assert.equal(Parser.cleanName('王小明'), '王小明');
});

test('官方樣板文字被辨識為非內容', () => {
  assert.equal(Parser.isBoilerplate('郵局存證信函用紙'), true);
  assert.equal(Parser.isBoilerplate('〈寄件人如為機關、團體、學校、公司、商號請加蓋單位圖章及法定代理人簽名或蓋章〉'), true);
  assert.equal(Parser.isBoilerplate('騎縫郵戳'), true);
  assert.equal(Parser.isBoilerplate('一、台端於一月十日向本人借款。'), false);
});

test('純文字檔可判讀欄位並保留正文', () => {
  const result = Parser.parsePlainText([
    '寄件人姓名：王小明',
    '寄件人地址：100 臺北市中正區重慶南路一段2號',
    '收件人姓名：陳大華',
    '收件人詳細地址：臺中市中區民權路1號',
    '',
    '主旨：催告返還欠款',
    '一、請於七日內清償。'
  ].join('\n'));

  assert.equal(result.fields.senderName, '王小明');
  assert.equal(result.fields.senderPostalCode, '100');
  assert.equal(result.fields.senderAddr, '臺北市中正區重慶南路一段2號');
  assert.equal(result.fields.recvName, '陳大華');
  assert.equal(result.fields.recvAddr, '臺中市中區民權路1號');
  assert.equal(result.content, '主旨：催告返還欠款\n一、請於七日內清償。');
  assert.equal(result.source, 'paragraphs');
});

test('分行書寫的欄位格式也能判讀，且副本收件人不被當成收件人', () => {
  const result = Parser.parsePlainText([
    '一、寄件人', '姓名：甲', '詳細地址：220 新北市板橋區',
    '二、收件人', '姓名：乙', '詳細地址：桃園市桃園區',
    '三、副本收件人', '姓名：丙', '詳細地址：400 臺中市中區',
    '正文開始'
  ].join('\n'));

  assert.equal(result.fields.senderName, '甲');
  assert.equal(result.fields.senderPostalCode, '220');
  assert.equal(result.fields.recvName, '乙');
  assert.equal(result.fields.recvAddr, '桃園市桃園區');
  assert.equal(result.fields.ccName, '丙');
  assert.equal(result.fields.ccPostalCode, '400');
});

test('開頭數字不是合法郵遞區號時整串留在地址，不被切壞', () => {
  const result = Parser.parsePlainText('寄件人姓名：甲\n寄件人地址：1234 臺北市');
  assert.equal(result.fields.senderPostalCode, '');
  assert.equal(result.fields.senderAddr, '1234 臺北市');

  const ok = Parser.parsePlainText('寄件人姓名：甲\n寄件人地址：220 新北市板橋區');
  assert.equal(ok.fields.senderPostalCode, '220');
  assert.equal(ok.fields.senderAddr, '新北市板橋區');
});

test('缺少必填欄位時回報說明，不靜默通過', () => {
  const result = Parser.parsePlainText('只有正文，沒有任何欄位');
  assert.ok(result.notes.some(note => /未能判讀 4 個必填欄位/.test(note)));
  assert.equal(result.found.senderName, false);
});

test('.docx 中的存證信函字格可還原成正文', async () => {
  const rows = ['主旨：測試', '一、第一點'].map(line => {
    const cells = Array.from(line);
    while (cells.length < 20) cells.push('');
    return `<w:tr>${cells.map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
  }).join('');
  const blocks = Ooxml.extractDocxBlocks(DOCX_XML(`<w:tbl>${rows}</w:tbl>`));
  const result = Parser.parseLetter(blocks);
  assert.equal(result.source, 'grid');
  assert.equal(result.gridRows, 2);
  assert.equal(result.content, '主旨：測試\n一、第一點');
});

test('HTML 讀取器把表格列與段落分開，並略過 script 與 style', () => {
  const blocks = Html.readBlocks(
    '<style>.a{color:red}</style><script>var x="甲";</script>'
    + '<div>段落一</div><table><tr><td>甲</td><td>乙</td></tr></table>'
  );
  assert.deepEqual(blocks.filter(b => b.kind === 'paragraph').map(b => b.text), ['段落一']);
  assert.deepEqual(blocks.filter(b => b.kind === 'row')[0].cells, ['甲', '乙']);
});
