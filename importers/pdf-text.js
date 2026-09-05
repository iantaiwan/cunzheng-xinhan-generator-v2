(function initCunzhengPdfText(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengPdfText = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPdfText() {
  'use strict';

  // 從「有文字圖層」的 PDF 抽出文字。掃描件不含文字圖層，必須改走 OCR。
  //
  // 涵蓋範圍與限制（請一併參考 README 的「匯入的可靠度」）：
  //   - 支援 FlateDecode 內容串流、Type0/CID 字型與 ToUnicode CMap，
  //     這涵蓋 Chrome、Word 與大多數工具輸出的中文 PDF。
  //   - 不支援加密 PDF、物件串流（/ObjStm）內的頁面，以及沒有 ToUnicode
  //     對照表的子集化字型；遇到這些情形會明確報告，而不是吐出亂碼。

  class PdfError extends Error {
    constructor(message) {
      super(message);
      this.name = 'PdfError';
    }
  }

  // PDF 同時混有結構文字與二進位資料，因此以「位元組值 = 字元碼位」的方式
  // 轉成字串來做結構掃描。
  //
  // 注意：不能用 TextDecoder('latin1')。依規格該標籤其實對應 windows-1252，
  // 會把 0x80–0x9F 映射到不同的 Unicode 碼位（例如 0x9C → U+0153），
  // 寫回位元組時就變成別的值，剛好破壞掉 zlib 標頭 0x78 0x9C。
  const CHUNK_SIZE = 0x8000;

  // 同一列文字的 y 座標容許誤差（PDF 單位約 1/72 吋）。
  const LINE_EPSILON = 1;

  // 字型內部編碼常落在控制字元範圍，是「這段沒有對照表」的可靠訊號。
  const CONTROL_BYTES = /[\x00-\x08\x0e-\x1f]/;

  function toLatin1(bytes) {
    let out = '';
    for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
      out += String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK_SIZE));
    }
    return out;
  }

  function bytesFromLatin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
    return bytes;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new PdfError('此瀏覽器不支援 DecompressionStream，無法讀取壓縮的 PDF。');
    }
    // PDF 的 FlateDecode 是 zlib 包裝，少數檔案為裸 deflate，因此兩種都試。
    for (const format of ['deflate', 'deflate-raw']) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        // 換下一種格式
      }
    }
    throw new PdfError('內容串流解壓縮失敗。');
  }

  // ---- PDF 物件掃描 -------------------------------------------------------

  function scanObjects(source) {
    const objects = new Map();
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let match = pattern.exec(source);

    while (match) {
      const number = Number.parseInt(match[1], 10);
      const bodyStart = match.index + match[0].length;
      const endIndex = source.indexOf('endobj', bodyStart);
      const body = source.slice(bodyStart, endIndex === -1 ? source.length : endIndex);

      const streamMatch = body.match(/stream\r\n|stream\n|stream\r/);
      let dict = body;
      let stream = null;
      if (streamMatch) {
        dict = body.slice(0, streamMatch.index);
        const dataStart = streamMatch.index + streamMatch[0].length;
        // 優先採用 /Length，串流資料與 endstream 之間還有一個換行，
        // 若一律用 lastIndexOf 會多算一個位元組而讓解壓縮失敗。
        const lengthMatch = dict.match(/\/Length\s+(\d+)\b/);
        const declared = lengthMatch ? Number.parseInt(lengthMatch[1], 10) : null;
        const fallbackEnd = body.lastIndexOf('endstream');
        const dataEnd = (declared !== null && dataStart + declared <= body.length)
          ? dataStart + declared
          : (fallbackEnd === -1 ? body.length : fallbackEnd);
        stream = body.slice(dataStart, dataEnd).replace(/\r?\n$/, '');
      }
      objects.set(number, { dict, stream });
      pattern.lastIndex = endIndex === -1 ? source.length : endIndex;
      match = pattern.exec(source);
    }
    return objects;
  }

  function resolveReference(objects, text) {
    const match = String(text ?? '').match(/(\d+)\s+\d+\s+R/);
    if (!match) return null;
    return objects.get(Number.parseInt(match[1], 10)) || null;
  }

  async function decodeStream(objects, entry) {
    if (!entry || entry.stream === null) return '';
    const raw = bytesFromLatin1(entry.stream);
    if (/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(entry.dict)) {
      return toLatin1(await inflate(raw));
    }
    if (/\/Filter/.test(entry.dict)) {
      throw new PdfError('內容串流使用不支援的壓縮方式。');
    }
    return entry.stream;
  }

  // ---- ToUnicode CMap -----------------------------------------------------

  function hexToString(hex) {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    for (let index = 0; index + 3 < clean.length + 1; index += 4) {
      const unit = Number.parseInt(clean.slice(index, index + 4), 16);
      if (Number.isFinite(unit)) out += String.fromCharCode(unit);
    }
    return out;
  }

  function parseCMap(text) {
    const map = new Map();
    let codeBytes = 2;

    const codespace = text.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
    if (codespace) {
      const first = codespace[1].match(/<([0-9a-fA-F]+)>/);
      if (first) codeBytes = Math.max(1, Math.min(4, Math.ceil(first[1].length / 2)));
    }

    const charSections = text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
    for (const section of charSections) {
      const pairs = section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
      for (const pair of pairs) {
        map.set(Number.parseInt(pair[1], 16), hexToString(pair[2]));
      }
    }

    const rangeSections = text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
    for (const section of rangeSections) {
      const body = section[1];
      // 形式一：<起> <迄> <對應起點>
      const simple = body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
      for (const item of simple) {
        const start = Number.parseInt(item[1], 16);
        const end = Number.parseInt(item[2], 16);
        const base = hexToString(item[3]);
        if (!base || end < start || end - start > 0xffff) continue;
        const baseTail = base.charCodeAt(base.length - 1);
        for (let code = start; code <= end; code += 1) {
          map.set(code, base.slice(0, -1) + String.fromCharCode(baseTail + (code - start)));
        }
      }
      // 形式二：<起> <迄> [<值1> <值2> ...]
      const listed = body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g);
      for (const item of listed) {
        const start = Number.parseInt(item[1], 16);
        const values = [...item[3].matchAll(/<([0-9a-fA-F]*)>/g)].map(value => hexToString(value[1]));
        values.forEach((value, offset) => map.set(start + offset, value));
      }
    }

    return { codeBytes, map };
  }

  // ---- 內容串流的文字運算子 -----------------------------------------------

  function parseLiteralString(source, startIndex) {
    let depth = 1;
    let index = startIndex;
    let out = '';
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === '\\') {
        const next = source[index + 1];
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        if (next >= '0' && next <= '7') {
          const octal = source.slice(index + 1).match(/^[0-7]{1,3}/)[0];
          out += String.fromCharCode(Number.parseInt(octal, 8));
          index += 1 + octal.length;
          continue;
        }
        if (next === '\n') { index += 2; continue; }
        out += Object.prototype.hasOwnProperty.call(escapes, next) ? escapes[next] : next;
        index += 2;
        continue;
      }
      if (character === '(') depth += 1;
      else if (character === ')') { depth -= 1; if (depth === 0) { index += 1; break; } }
      out += character;
      index += 1;
    }
    return { value: out, nextIndex: index };
  }

  function decodeWithCMap(raw, cmap) {
    if (!cmap) return raw;
    const { codeBytes, map } = cmap;
    let out = '';
    for (let index = 0; index < raw.length; index += codeBytes) {
      let code = 0;
      for (let offset = 0; offset < codeBytes && index + offset < raw.length; offset += 1) {
        code = (code << 8) | (raw.charCodeAt(index + offset) & 0xff);
      }
      const mapped = map.get(code);
      out += mapped === undefined ? '' : mapped;
    }
    return out;
  }

  /**
   * 走訪內容串流，依文字定位運算子換行。
   * @returns {{lines: string[], unmappedRuns: number}}
   */
  function extractTextFromContent(content, lookupFont) {
    const lines = [];
    let current = '';
    let currentFont = null;
    let unmappedRuns = 0;
    // PDF 沒有「行」的概念，只有每段文字的座標。同一列的字共用相同的 y，
    // 因此以 y 是否改變來判斷換行；產生器常把每段文字包成獨立的 BT…ET，
    // 若改用 ET 當換行依據，同一行會被切成很多段。
    let textY = 0;
    let lastShownY = null;
    let pendingBreak = false;
    const stack = [];

    function flushLine() {
      lines.push(current);
      current = '';
    }

    function show(raw, isHex) {
      const cmap = lookupFont(currentFont);
      let decoded;
      if (cmap) {
        decoded = decodeWithCMap(raw, cmap);
      } else if (CONTROL_BYTES.test(raw)) {
        // 沒有對照表且內容是字型內部編碼：這些位元組不是可讀文字，
        // 直接捨棄並計數，絕不當成內容輸出亂碼。
        unmappedRuns += 1;
        return;
      } else {
        decoded = raw; // 簡易字型的可列印 ASCII 可直接採用
      }

      if (pendingBreak || (lastShownY !== null && Math.abs(textY - lastShownY) > LINE_EPSILON)) {
        flushLine();
      }
      pendingBreak = false;
      lastShownY = textY;
      current += decoded;
    }

    function numbersOnStack() {
      return stack.filter(item => item.type === 'number').map(item => item.value);
    }

    let index = 0;
    while (index < content.length) {
      const character = content[index];

      if (character === '(') {
        const parsed = parseLiteralString(content, index + 1);
        stack.push({ type: 'string', value: parsed.value, hex: false });
        index = parsed.nextIndex;
        continue;
      }
      if (character === '<' && content[index + 1] !== '<') {
        const end = content.indexOf('>', index);
        const hex = content.slice(index + 1, end === -1 ? content.length : end).replace(/\s+/g, '');
        const padded = hex.length % 2 ? `${hex}0` : hex;
        let raw = '';
        for (let offset = 0; offset < padded.length; offset += 2) {
          raw += String.fromCharCode(Number.parseInt(padded.slice(offset, offset + 2), 16));
        }
        stack.push({ type: 'string', value: raw, hex: true });
        index = end === -1 ? content.length : end + 1;
        continue;
      }
      if (character === '[' || character === ']') {
        stack.push({ type: character === '[' ? 'arrayStart' : 'arrayEnd' });
        index += 1;
        continue;
      }
      if (character === '/') {
        const name = content.slice(index + 1).match(/^[^\s/[\]<>(){}]*/)[0];
        stack.push({ type: 'name', value: name });
        index += 1 + name.length;
        continue;
      }
      if (/\s/.test(character)) { index += 1; continue; }

      const token = content.slice(index).match(/^[^\s/[\]<>(){}]+/);
      if (!token) { index += 1; continue; }
      const word = token[0];
      index += word.length;

      if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
        stack.push({ type: 'number', value: Number.parseFloat(word) });
        continue;
      }

      switch (word) {
        case 'Tf': {
          const name = [...stack].reverse().find(item => item.type === 'name');
          currentFont = name ? name.value : null;
          break;
        }
        case 'Tj': case 'TJ': {
          stack.filter(item => item.type === 'string').forEach(item => show(item.value, item.hex));
          break;
        }
        case "'": case '"': {
          pendingBreak = true;
          stack.filter(item => item.type === 'string').forEach(item => show(item.value, item.hex));
          break;
        }
        case 'T*': pendingBreak = true; break;
        case 'Td': case 'TD': {
          const numbers = numbersOnStack();
          if (numbers.length >= 2) textY += numbers[numbers.length - 1];
          break;
        }
        case 'Tm': {
          const numbers = numbersOnStack();
          if (numbers.length >= 6) textY = numbers[numbers.length - 1];
          break;
        }
        default: break;
      }
      stack.length = 0;
    }

    if (current !== '') flushLine();
    return { lines, unmappedRuns };
  }

  // ---- 主流程 -------------------------------------------------------------

  function isPdf(bytes) {
    if (!bytes || bytes.length < 5) return false;
    return toLatin1(bytes.subarray(0, 5)) === '%PDF-';
  }

  async function readBlocks(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isPdf(bytes)) throw new PdfError('這個檔案不是 PDF。');

    const source = toLatin1(bytes);
    if (/\/Encrypt\b/.test(source)) {
      throw new PdfError('這份 PDF 已加密，請先解除保護再匯入。');
    }

    const objects = scanObjects(source);
    if (objects.size === 0) {
      throw new PdfError('讀不到 PDF 物件，檔案可能已損毀或使用交叉參照串流（/ObjStm），目前不支援。');
    }

    // 建立「字型資源名稱 → ToUnicode 對照表」
    const fontCMaps = new Map();
    let fontsWithoutToUnicode = 0;
    const fontObjectCMaps = new Map();

    for (const [number, entry] of objects) {
      if (!/\/Type\s*\/Font\b/.test(entry.dict)) continue;
      const toUnicode = entry.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
      if (!toUnicode) { fontsWithoutToUnicode += 1; continue; }
      const cmapEntry = objects.get(Number.parseInt(toUnicode[1], 10));
      if (!cmapEntry) { fontsWithoutToUnicode += 1; continue; }
      try {
        fontObjectCMaps.set(number, parseCMap(await decodeStream(objects, cmapEntry)));
      } catch {
        fontsWithoutToUnicode += 1;
      }
    }

    // 由 /Resources 的 /Font 字典把資源名稱對到字型物件
    for (const entry of objects.values()) {
      const fontDict = entry.dict.match(/\/Font\s*<<([\s\S]*?)>>/);
      if (!fontDict) continue;
      const pairs = fontDict[1].matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g);
      for (const pair of pairs) {
        const cmap = fontObjectCMaps.get(Number.parseInt(pair[2], 10));
        if (cmap) fontCMaps.set(pair[1], cmap);
      }
    }
    const contents = [];
    for (const entry of objects.values()) {
      if (entry.stream === null) continue;
      if (/\/Type\s*\/(?:Font|XObject|Metadata|ObjStm|XRef)\b/.test(entry.dict)) continue;
      if (/\/Subtype\s*\/(?:Image|Type1C|CIDFontType0C|TrueType)\b/.test(entry.dict)) continue;
      try {
        const text = await decodeStream(objects, entry);
        if (/\b(?:Tj|TJ|T\*)\b/.test(text)) contents.push(text);
      } catch {
        // 個別串流解不開不應中斷整份文件
      }
    }

    if (contents.length === 0) {
      throw new PdfError('這份 PDF 沒有可讀取的文字圖層，可能是掃描件；請改用 OCR 匯入。');
    }

    // 只有一個字型時，即使 Tf 的資源名稱對不上也直接採用它。
    const soleCMap = fontCMaps.size === 0 && fontObjectCMaps.size === 1
      ? [...fontObjectCMaps.values()][0]
      : null;
    const lookupFont = name => (soleCMap || (name ? fontCMaps.get(name) : null) || null);

    const lines = [];
    let unmappedRuns = 0;
    contents.forEach(content => {
      const result = extractTextFromContent(content, lookupFont);
      unmappedRuns += result.unmappedRuns;
      result.lines.forEach(line => lines.push(line));
    });

    const notes = [];
    if (fontsWithoutToUnicode > 0) {
      notes.push(`有 ${fontsWithoutToUnicode} 個字型缺少 ToUnicode 對照表，這些文字可能無法正確還原。`);
    }
    const text = lines.join('\n');
    if (text.trim() === '') {
      throw new PdfError('PDF 有文字圖層但無法對應到可讀字元，可能使用了未內嵌對照表的子集化字型。');
    }
    if (unmappedRuns > 0) notes.push(`有 ${unmappedRuns} 段文字缺少字元對照，已略過。`);

    return {
      blocks: lines.map(line => ({ kind: 'paragraph', text: line })),
      notes
    };
  }

  return Object.freeze({
    PdfError,
    extractTextFromContent,
    isPdf,
    parseCMap,
    parseLiteralString,
    readBlocks,
    scanObjects
  });
}));
