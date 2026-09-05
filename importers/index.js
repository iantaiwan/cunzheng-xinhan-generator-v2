(function initCunzhengImport(root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? {
      Zip: require('./zip.js'),
      Ooxml: require('./ooxml.js'),
      Pdf: require('./pdf-text.js'),
      Html: require('./html-letter.js'),
      Parser: require('./letter-parser.js'),
      Ocr: require('./ocr.js')
    }
    : {
      Zip: root.CunzhengZip,
      Ooxml: root.CunzhengOoxml,
      Pdf: root.CunzhengPdfText,
      Html: root.CunzhengHtmlLetter,
      Parser: root.CunzhengLetterParser,
      Ocr: root.CunzhengOcr
    };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengImport = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createImport(deps) {
  'use strict';

  const Zip = deps.Zip;
  const Ooxml = deps.Ooxml;
  const Pdf = deps.Pdf;
  const Html = deps.Html;
  const Parser = deps.Parser;
  const Ocr = deps.Ocr;

  // 依檔案內容（而非只看副檔名）決定用哪一條匯入路徑。
  // 副檔名可能被改過，magic bytes 才是可靠依據。

  const MAX_BYTES = 20 * 1024 * 1024;

  const KIND = Object.freeze({
    PDF: 'pdf',
    OFFICE: 'office',
    HTML: 'html',
    TEXT: 'text',
    IMAGE: 'image',
    UNKNOWN: 'unknown'
  });

  const KIND_LABEL = Object.freeze({
    pdf: 'PDF',
    office: 'Word／ODF 文件',
    html: 'HTML',
    text: '純文字',
    image: '圖片（需 OCR）',
    unknown: '未知格式'
  });

  const IMAGE_SIGNATURES = [
    { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'PNG' },
    { bytes: [0xff, 0xd8, 0xff], label: 'JPEG' },
    { bytes: [0x42, 0x4d], label: 'BMP' },
    { bytes: [0x49, 0x49, 0x2a, 0x00], label: 'TIFF' },
    { bytes: [0x4d, 0x4d, 0x00, 0x2a], label: 'TIFF' }
  ];

  function startsWith(bytes, signature) {
    if (bytes.length < signature.length) return false;
    return signature.every((value, index) => bytes[index] === value);
  }

  function looksLikeHtml(text) {
    return /<\s*(?:!doctype\s+html|html|body|table|article|div)\b/i.test(text.slice(0, 4000));
  }

  function decodeUtf8(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  function detectKind(bytes, filename) {
    if (Pdf.isPdf(bytes)) return KIND.PDF;
    if (Zip.isZip(bytes)) return KIND.OFFICE;
    if (IMAGE_SIGNATURES.some(item => startsWith(bytes, item.bytes))) return KIND.IMAGE;
    if (/\.gif$|\.webp$|\.heic$/i.test(String(filename ?? ''))) return KIND.IMAGE;

    const text = decodeUtf8(bytes);
    if (text === null) return KIND.UNKNOWN;
    if (looksLikeHtml(text)) return KIND.HTML;
    return KIND.TEXT;
  }

  function validateSize(bytes) {
    if (bytes.length === 0) throw new Error('這個檔案是空的。');
    if (bytes.length > MAX_BYTES) {
      throw new Error(`檔案超過 ${Math.round(MAX_BYTES / 1024 / 1024)} MB 上限，請先裁切或壓縮後再匯入。`);
    }
  }

  /**
   * 匯入檔案位元組，回傳統一格式的判讀結果。
   * OCR 路徑需要 Blob，因此另由 importFile 處理。
   */
  async function importBytes(bytes, filename) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    validateSize(input);

    const kind = detectKind(input, filename);
    const notes = [];
    let blocks;

    if (kind === KIND.PDF) {
      const extracted = await Pdf.readBlocks(input);
      blocks = extracted.blocks;
      extracted.notes.forEach(note => notes.push(note));
    } else if (kind === KIND.OFFICE) {
      const extracted = await Ooxml.readBlocks(input);
      blocks = extracted.blocks;
      notes.push(`已讀取 ${extracted.format === 'docx' ? 'Word (.docx)' : 'ODF (.odt)'} 文件。`);
    } else if (kind === KIND.HTML) {
      blocks = Html.readBlocks(decodeUtf8(input) ?? '');
    } else if (kind === KIND.TEXT) {
      const text = decodeUtf8(input) ?? '';
      const result = Parser.parsePlainText(text);
      return { ...result, kind, kindLabel: KIND_LABEL[kind], notes: [...notes, ...result.notes] };
    } else if (kind === KIND.IMAGE) {
      throw new Error('圖片與掃描件需要 OCR，請改用「以 OCR 匯入」。');
    } else {
      throw new Error('無法辨識這個檔案的格式。支援 .docx、.odt、PDF、HTML 與純文字檔。');
    }

    const result = Parser.parseLetter(blocks);
    return { ...result, kind, kindLabel: KIND_LABEL[kind], notes: [...notes, ...result.notes] };
  }

  /** 對圖片或掃描件執行 OCR，再走純文字判讀。 */
  async function importWithOcr(blob, options = {}) {
    const recognized = await Ocr.recognize(blob, options);
    const result = Parser.parsePlainText(recognized.text);
    return {
      ...result,
      kind: KIND.IMAGE,
      kindLabel: KIND_LABEL[KIND.IMAGE],
      notes: [...recognized.notes, ...result.notes],
      ocrEngine: recognized.engine
    };
  }

  /** 瀏覽器入口：接受 File，依內容自動選擇路徑。 */
  async function importFile(file, options = {}) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateSize(bytes);
    if (detectKind(bytes, file.name) === KIND.IMAGE) {
      return importWithOcr(file, options);
    }
    return importBytes(bytes, file.name);
  }

  /** 把判讀結果轉成可下載、可複製的純文字檔內容。 */
  function toPlainTextFile(result) {
    const fields = result.fields || {};
    const lines = ['# 存證信函（由匯入功能還原，請逐欄核對）', ''];

    const rows = [
      ['寄件人姓名', fields.senderName],
      ['寄件人郵遞區號', fields.senderPostalCode],
      ['寄件人地址', fields.senderAddr],
      ['收件人姓名', fields.recvName],
      ['收件人郵遞區號', fields.recvPostalCode],
      ['收件人地址', fields.recvAddr],
      ['副本收件人姓名', fields.ccName],
      ['副本收件人郵遞區號', fields.ccPostalCode],
      ['副本收件人地址', fields.ccAddr],
      ['副本份數', fields.copyCount],
      ['附件張數', fields.attachCount],
      ['加具正本份數', fields.extraOriginal],
      ['加具副本份數', fields.extraCopy]
    ];
    rows.forEach(([label, value]) => {
      lines.push(`${label}：${value === null || value === undefined || value === '' ? '（未判讀）' : value}`);
    });

    lines.push('', '# 正文', '', result.content || '（未判讀出正文）');

    if (Array.isArray(result.notes) && result.notes.length > 0) {
      lines.push('', '# 判讀說明', ...result.notes.map(note => `- ${note}`));
    }
    return `${lines.join('\n')}\n`;
  }

  return Object.freeze({
    KIND,
    KIND_LABEL,
    MAX_BYTES,
    detectKind,
    importBytes,
    importFile,
    importWithOcr,
    toPlainTextFile
  });
}));
