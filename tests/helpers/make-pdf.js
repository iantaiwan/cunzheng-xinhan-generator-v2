'use strict';

// 測試用的最小 PDF 產生器。手工組出物件、ToUnicode CMap 與內容串流，
// 讓 CMap 解析、文字運算子與換行判斷都能用確定性的輸入驗證。

function bytesFromLatin1(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

async function deflate(text) {
  const stream = new Blob([bytesFromLatin1(text)]).stream()
    .pipeThrough(new CompressionStream('deflate'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  let result = '';
  out.forEach(byte => { result += String.fromCharCode(byte); });
  return result;
}

const hex4 = value => value.toString(16).toUpperCase().padStart(4, '0');

/**
 * 由「字元 → 兩位元組碼」的對照建立 ToUnicode CMap。
 * @param {Map<string, number>} charToCode
 */
function buildToUnicode(charToCode) {
  const entries = [...charToCode.entries()];
  const lines = entries.map(([char, code]) => `<${hex4(code)}> <${hex4(char.charCodeAt(0))}>`);
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${lines.length} beginbfchar
${lines.join('\n')}
endbfchar
endcmap
end
end`;
}

/**
 * @param {Array<{text: string, y: number}>} runs 每段文字與其 y 座標
 * @param {{compress?: boolean, encrypted?: boolean, omitToUnicode?: boolean}} [options]
 */
async function makePdf(runs, options = {}) {
  const charToCode = new Map();
  let nextCode = 0x0100;
  runs.forEach(run => {
    Array.from(run.text).forEach(char => {
      if (!charToCode.has(char)) {
        charToCode.set(char, nextCode);
        nextCode += 1;
      }
    });
  });

  const content = runs.map(run => {
    const hex = Array.from(run.text).map(char => hex4(charToCode.get(char))).join('');
    return `BT /F1 12 Tf 1 0 0 1 72 ${run.y} Tm <${hex}> Tj ET`;
  }).join('\n');

  const toUnicode = buildToUnicode(charToCode);
  const contentData = options.compress ? await deflate(content) : content;
  const cmapData = options.compress ? await deflate(toUnicode) : toUnicode;
  const filter = options.compress ? '/Filter /FlateDecode ' : '';

  const objects = [
    '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type /Pages /Count 1 /Kids [3 0 R]>>\nendobj\n',
    '3 0 obj\n<</Type /Page /Parent 2 0 R /Resources <</Font <</F1 5 0 R>>>> /Contents 4 0 R>>\nendobj\n',
    `4 0 obj\n<<${filter}/Length ${contentData.length}>>\nstream\n${contentData}\nendstream\nendobj\n`,
    options.omitToUnicode
      ? '5 0 obj\n<</Type /Font /Subtype /Type0 /BaseFont /Test>>\nendobj\n'
      : '5 0 obj\n<</Type /Font /Subtype /Type0 /BaseFont /Test /ToUnicode 6 0 R>>\nendobj\n',
    `6 0 obj\n<<${filter}/Length ${cmapData.length}>>\nstream\n${cmapData}\nendstream\nendobj\n`
  ];

  const trailer = options.encrypted
    ? 'trailer\n<</Size 7 /Root 1 0 R /Encrypt 7 0 R>>\n'
    : 'trailer\n<</Size 7 /Root 1 0 R>>\n';

  return bytesFromLatin1(`%PDF-1.7\n${objects.join('')}${trailer}%%EOF\n`);
}

module.exports = { makePdf, buildToUnicode, bytesFromLatin1 };
