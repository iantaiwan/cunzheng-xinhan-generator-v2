(function initCunzhengXmlScan(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengXmlScan = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createXmlScan() {
  'use strict';

  // 極小的 XML 掃描器。不建構 DOM，只依序吐出開／關標籤與文字節點，
  // 讓 .docx 與 .odt 的抽取器共用同一套走訪邏輯，且在 Node 與瀏覽器都能執行。

  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
      if (body[0] === '#') {
        const codePoint = body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
    });
  }

  function parseAttributes(source) {
    const attributes = {};
    const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match = pattern.exec(source);
    while (match) {
      attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
      match = pattern.exec(source);
    }
    return attributes;
  }

  /**
   * 走訪 XML，對每個節點呼叫 handlers。
   * @param {string} xml
   * @param {{onOpen?: (name, attributes, selfClosing) => void,
   *          onClose?: (name) => void,
   *          onText?: (text) => void}} handlers
   */
  function scan(xml, handlers) {
    const { onOpen, onClose, onText } = handlers;
    const length = xml.length;
    let cursor = 0;

    while (cursor < length) {
      const next = xml.indexOf('<', cursor);
      if (next === -1) {
        if (onText && cursor < length) onText(decodeEntities(xml.slice(cursor)));
        return;
      }
      if (next > cursor && onText) onText(decodeEntities(xml.slice(cursor, next)));

      if (xml.startsWith('<!--', next)) {
        const end = xml.indexOf('-->', next + 4);
        cursor = end === -1 ? length : end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', next)) {
        const end = xml.indexOf(']]>', next + 9);
        const stop = end === -1 ? length : end;
        if (onText) onText(xml.slice(next + 9, stop)); // CDATA 內容不解實體
        cursor = end === -1 ? length : end + 3;
        continue;
      }
      if (xml.startsWith('<?', next) || xml.startsWith('<!', next)) {
        const end = xml.indexOf('>', next);
        cursor = end === -1 ? length : end + 1;
        continue;
      }

      const end = xml.indexOf('>', next);
      if (end === -1) return;
      const body = xml.slice(next + 1, end);
      cursor = end + 1;

      if (body[0] === '/') {
        if (onClose) onClose(body.slice(1).trim());
        continue;
      }
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const nameMatch = inner.match(/^[\w:.-]+/);
      if (!nameMatch) continue;
      const name = nameMatch[0];
      if (onOpen) onOpen(name, parseAttributes(inner.slice(name.length)), selfClosing);
      if (selfClosing && onClose) onClose(name);
    }
  }

  return Object.freeze({ decodeEntities, parseAttributes, scan });
}));
