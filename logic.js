(function initCunzhengLogic(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengLogic = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLogic() {
  'use strict';

  const ROWS_PER_PAGE = 10;
  const COLS_PER_ROW = 20;

  function splitGraphemes(value) {
    const text = String(value ?? '');
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), item => item.segment);
    }
    return Array.from(text);
  }

  function makeBlankRow() {
    return new Array(COLS_PER_ROW).fill('');
  }

  function paginateContent(value) {
    const text = String(value ?? '');
    const paragraphs = text.split(/\r\n?|\n/);
    const rows = [];

    paragraphs.forEach(paragraph => {
      const characters = splitGraphemes(paragraph);
      if (characters.length === 0) {
        rows.push(makeBlankRow());
        return;
      }

      for (let index = 0; index < characters.length; index += COLS_PER_ROW) {
        const row = characters.slice(index, index + COLS_PER_ROW);
        while (row.length < COLS_PER_ROW) row.push('');
        rows.push(row);
      }
    });

    if (rows.length === 0) rows.push(makeBlankRow());

    const pages = [];
    for (let index = 0; index < rows.length; index += ROWS_PER_PAGE) {
      const pageRows = rows.slice(index, index + ROWS_PER_PAGE);
      while (pageRows.length < ROWS_PER_PAGE) pageRows.push(makeBlankRow());
      pages.push(pageRows);
    }
    return pages;
  }

  function countCharacters(value) {
    return splitGraphemes(String(value ?? '').replace(/\r\n?|\n/g, '')).length;
  }

  function countPages(value) {
    return paginateContent(value).length;
  }

  function isPostalCode(value) {
    return /^\d{3}(?:\d{2,3})?$/.test(String(value ?? '').trim());
  }

  function isOptionalPostalCode(value) {
    const postalCode = String(value ?? '').trim();
    return postalCode === '' || isPostalCode(postalCode);
  }

  function parseBoundedInteger(value, minimum, maximum) {
    const raw = String(value ?? '').trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;
    return parsed;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return Object.freeze({
    ROWS_PER_PAGE,
    COLS_PER_ROW,
    countCharacters,
    countPages,
    escapeHtml,
    isOptionalPostalCode,
    isPostalCode,
    paginateContent,
    parseBoundedInteger,
    splitGraphemes
  });
}));
