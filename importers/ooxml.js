(function initCunzhengOoxml(root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { Zip: require('./zip.js'), XmlScan: require('./xml-scan.js') }
    : { Zip: root.CunzhengZip, XmlScan: root.CunzhengXmlScan };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengOoxml = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createOoxml(deps) {
  'use strict';

  const Zip = deps.Zip;
  const XmlScan = deps.XmlScan;

  // 從 .docx（OOXML）與 .odt（ODF）抽出文字。
  //
  // 重點：中華郵政的官方範本把字格做成 20 欄的表格，如果把儲存格文字直接串接，
  // 版面資訊就會遺失。因此抽取結果保留「段落」與「表格列」兩種區塊，
  // 由後續的 letter-parser 判斷哪些列其實是字格。

  const DOCX_ENTRY = 'word/document.xml';
  const ODT_ENTRY = 'content.xml';

  class ExtractError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ExtractError';
    }
  }

  function createCollector() {
    const blocks = [];
    let paragraph = '';
    let row = null;
    let cell = null;

    return {
      blocks,
      append(text) {
        if (cell !== null) cell += text;
        else paragraph += text;
      },
      startRow() {
        this.endParagraph();
        row = [];
      },
      startCell() { cell = ''; },
      endCell() {
        if (cell === null) return;
        if (row) row.push(cell);
        else paragraph += cell;
        cell = null;
      },
      endRow() {
        this.endCell();
        if (row) blocks.push({ kind: 'row', cells: row });
        row = null;
      },
      endParagraph() {
        if (cell !== null) return; // 儲存格內的段落換行由 appendBreak 處理
        if (paragraph.length > 0) {
          blocks.push({ kind: 'paragraph', text: paragraph });
          paragraph = '';
        } else if (blocks.length > 0) {
          blocks.push({ kind: 'paragraph', text: '' });
        }
      },
      finish() {
        this.endRow();
        if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph });
        return blocks;
      }
    };
  }

  function localName(name) {
    const colon = name.indexOf(':');
    return colon === -1 ? name : name.slice(colon + 1);
  }

  function extractDocxBlocks(xml) {
    const collector = createCollector();
    // 追蹤修訂的刪除文字與功能變數指令碼都不是使用者看得到的內容，必須略過。
    const skipStack = [];
    let inText = false;

    XmlScan.scan(xml, {
      onOpen(rawName, attributes, selfClosing) {
        const name = localName(rawName);
        if (name === 'delText' || name === 'instrText') {
          if (!selfClosing) skipStack.push(name);
          return;
        }
        if (skipStack.length > 0) return;

        if (name === 't') inText = true;
        else if (name === 'br' || name === 'cr') collector.append('\n');
        else if (name === 'tab') collector.append('\t');
        else if (name === 'tr') collector.startRow();
        else if (name === 'tc') collector.startCell();
      },
      onClose(rawName) {
        const name = localName(rawName);
        if (skipStack.length > 0 && skipStack[skipStack.length - 1] === name) {
          skipStack.pop();
          return;
        }
        if (skipStack.length > 0) return;

        if (name === 't') inText = false;
        else if (name === 'p') collector.endParagraph();
        else if (name === 'tc') collector.endCell();
        else if (name === 'tr') collector.endRow();
      },
      onText(text) {
        if (inText && skipStack.length === 0) collector.append(text);
      }
    });

    return collector.finish();
  }

  function extractOdtBlocks(xml) {
    const collector = createCollector();
    let depth = 0;
    const textDepths = [];

    XmlScan.scan(xml, {
      onOpen(rawName, attributes, selfClosing) {
        const name = localName(rawName);

        if (name === 'line-break') { collector.append('\n'); return; }
        if (name === 'tab') { collector.append('\t'); return; }
        if (name === 's') {
          const count = Number.parseInt(attributes['text:c'] ?? '1', 10);
          collector.append(' '.repeat(Number.isFinite(count) && count > 0 ? Math.min(count, 200) : 1));
          return;
        }
        if (name === 'table-row') { collector.startRow(); return; }
        if (name === 'table-cell') { collector.startCell(); return; }
        if ((name === 'p' || name === 'h') && !selfClosing) {
          depth += 1;
          textDepths.push(depth);
        }
      },
      onClose(rawName) {
        const name = localName(rawName);
        if (name === 'p' || name === 'h') {
          if (textDepths.length > 0) {
            textDepths.pop();
            depth -= 1;
          }
          collector.endParagraph();
        } else if (name === 'table-cell') {
          collector.endCell();
        } else if (name === 'table-row') {
          collector.endRow();
        }
      },
      onText(text) {
        if (textDepths.length > 0) collector.append(text);
      }
    });

    return collector.finish();
  }

  async function readBlocks(bytes) {
    if (!Zip.isZip(bytes)) {
      throw new ExtractError('這個檔案不是 ZIP 容器，無法當作 .docx 或 .odt 讀取。');
    }
    const archive = Zip.listEntries(bytes);

    if (Zip.findEntry(archive, DOCX_ENTRY)) {
      const xml = new TextDecoder('utf-8').decode(await Zip.readEntry(archive, Zip.findEntry(archive, DOCX_ENTRY)));
      return { format: 'docx', blocks: extractDocxBlocks(xml) };
    }
    if (Zip.findEntry(archive, ODT_ENTRY)) {
      const xml = new TextDecoder('utf-8').decode(await Zip.readEntry(archive, Zip.findEntry(archive, ODT_ENTRY)));
      return { format: 'odt', blocks: extractOdtBlocks(xml) };
    }
    throw new ExtractError(`ZIP 內找不到 ${DOCX_ENTRY} 或 ${ODT_ENTRY}，不是可辨識的 Word 或 ODF 文件。`);
  }

  return Object.freeze({
    DOCX_ENTRY,
    ExtractError,
    ODT_ENTRY,
    extractDocxBlocks,
    extractOdtBlocks,
    readBlocks
  });
}));
