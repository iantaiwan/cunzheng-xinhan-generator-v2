(function initCunzhengHtmlLetter(root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { XmlScan: require('./xml-scan.js') }
    : { XmlScan: root.CunzhengXmlScan };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengHtmlLetter = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createHtmlLetter(deps) {
  'use strict';

  const XmlScan = deps.XmlScan;

  // 讀取 HTML 形式的存證信函，包含本工具自己列印出來的版面（完整往返）。

  const BLOCK_TAGS = new Set([
    'div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'article', 'section', 'header', 'footer', 'blockquote', 'pre', 'figcaption'
  ]);
  const IGNORED_TAGS = new Set(['script', 'style', 'head', 'noscript', 'template', 'svg']);
  const CELL_TAGS = new Set(['td', 'th']);
  const PAGE_MARKER = 'print-page';

  function extractBlocks(html) {
    const blocks = [];
    const pageStarts = [];
    let paragraph = '';
    let row = null;
    let cell = null;
    let ignoreDepth = 0;

    function flushParagraph() {
      if (paragraph.trim() !== '') blocks.push({ kind: 'paragraph', text: paragraph.trim() });
      paragraph = '';
    }

    XmlScan.scan(html, {
      onOpen(rawName, attributes, selfClosing) {
        const name = rawName.toLowerCase();
        if (IGNORED_TAGS.has(name)) { if (!selfClosing) ignoreDepth += 1; return; }
        if (ignoreDepth > 0) return;

        if (name === 'br') { if (cell !== null) cell += '\n'; else paragraph += '\n'; return; }

        if (String(attributes.class ?? '').split(/\s+/).includes(PAGE_MARKER)) {
          flushParagraph();
          pageStarts.push(blocks.length);
        }
        if (name === 'tr') { flushParagraph(); row = []; return; }
        if (CELL_TAGS.has(name)) { cell = ''; return; }
        if (BLOCK_TAGS.has(name)) flushParagraph();
      },
      onClose(rawName) {
        const name = rawName.toLowerCase();
        if (IGNORED_TAGS.has(name)) { ignoreDepth = Math.max(0, ignoreDepth - 1); return; }
        if (ignoreDepth > 0) return;

        if (CELL_TAGS.has(name)) {
          if (cell !== null) {
            if (row) row.push(cell);
            else paragraph += cell;
            cell = null;
          }
          return;
        }
        if (name === 'tr') {
          if (row) blocks.push({ kind: 'row', cells: row });
          row = null;
          return;
        }
        if (BLOCK_TAGS.has(name)) flushParagraph();
      },
      onText(text) {
        if (ignoreDepth > 0) return;
        if (cell !== null) cell += text;
        else paragraph += text;
      }
    });

    flushParagraph();
    if (row) blocks.push({ kind: 'row', cells: row });
    return { blocks, pageStarts };
  }

  /**
   * 本工具會把同一份內容重複列印成正本與多份副本。
   * 費用欄的「本存證信函共 N 頁」已載明每份的頁數，
   * 據此只保留第一份，避免正文被重複串接 N 次。
   */
  function keepFirstCopy(blocks, pageStarts) {
    if (pageStarts.length <= 1) return blocks;

    const text = blocks
      .filter(block => block.kind === 'paragraph')
      .map(block => block.text)
      .join('\n');
    const match = text.match(/本存證信函共\s*(\d+)\s*頁/);
    if (!match) return blocks;

    const pagesPerCopy = Number.parseInt(match[1], 10);
    if (!Number.isFinite(pagesPerCopy) || pagesPerCopy < 1 || pagesPerCopy >= pageStarts.length) return blocks;
    if (pageStarts.length % pagesPerCopy !== 0) return blocks;

    return blocks.slice(0, pageStarts[pagesPerCopy]);
  }

  /** @returns {Array<{kind: string, text?: string, cells?: string[]}>} */
  function readBlocks(html) {
    const { blocks, pageStarts } = extractBlocks(String(html ?? ''));
    return keepFirstCopy(blocks, pageStarts);
  }

  return Object.freeze({ extractBlocks, keepFirstCopy, readBlocks });
}));
