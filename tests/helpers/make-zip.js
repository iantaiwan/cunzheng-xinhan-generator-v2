'use strict';

// 測試用的最小 ZIP 產生器。刻意不使用任何套件，讓測試與正式程式一樣零依賴，
// 也讓我們能精確控制壓縮方式與刻意損毀的欄位。

const { crc32 } = require('../../importers/zip.js');

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function writeUint32(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint16(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

/**
 * @param {Array<{name: string, content: string|Uint8Array, method?: 0|8}>} files
 * @param {{corruptCrcFor?: string, comment?: string}} [options]
 */
async function makeZip(files, options = {}) {
  const encoder = new TextEncoder();
  const prepared = [];

  for (const file of files) {
    const raw = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const method = file.method ?? 8;
    const stored = method === 0 ? raw : await deflateRaw(raw);
    prepared.push({
      name: encoder.encode(file.name),
      method,
      raw,
      stored,
      crc: options.corruptCrcFor === file.name ? (crc32(raw) ^ 0xffffffff) >>> 0 : crc32(raw)
    });
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const item of prepared) {
    const header = new Uint8Array(30 + item.name.length);
    writeUint32(header, 0, 0x04034b50);
    writeUint16(header, 4, 20);
    writeUint16(header, 8, item.method);
    writeUint32(header, 14, item.crc);
    writeUint32(header, 18, item.stored.length);
    writeUint32(header, 22, item.raw.length);
    writeUint16(header, 26, item.name.length);
    header.set(item.name, 30);
    localParts.push(header, item.stored);

    const central = new Uint8Array(46 + item.name.length);
    writeUint32(central, 0, 0x02014b50);
    writeUint16(central, 4, 20);
    writeUint16(central, 6, 20);
    writeUint16(central, 10, item.method);
    writeUint32(central, 16, item.crc);
    writeUint32(central, 20, item.stored.length);
    writeUint32(central, 24, item.raw.length);
    writeUint16(central, 28, item.name.length);
    writeUint32(central, 42, offset);
    central.set(item.name, 46);
    centralParts.push(central);

    offset += header.length + item.stored.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const comment = encoder.encode(options.comment || '');
  const eocd = new Uint8Array(22 + comment.length);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 8, prepared.length);
  writeUint16(eocd, 10, prepared.length);
  writeUint32(eocd, 12, centralSize);
  writeUint32(eocd, 16, offset);
  writeUint16(eocd, 20, comment.length);
  eocd.set(comment, 22);

  const all = [...localParts, ...centralParts, eocd];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const part of all) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

const DOCX_XML = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

const ODT_XML = body => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`;

/** 產生一份結構正確的 .docx，段落以字串陣列給定。 */
function makeDocx(paragraphs, options) {
  const body = paragraphs
    .map(text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('');
  return makeZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types/>' },
    { name: 'word/document.xml', content: DOCX_XML(body) }
  ], options);
}

/** 產生一份結構正確的 .odt，段落以字串陣列給定。 */
function makeOdt(paragraphs, options) {
  const body = paragraphs.map(text => `<text:p>${text}</text:p>`).join('');
  return makeZip([
    { name: 'mimetype', content: 'application/vnd.oasis.opendocument.text', method: 0 },
    { name: 'content.xml', content: ODT_XML(body) }
  ], options);
}

module.exports = { makeZip, makeDocx, makeOdt, DOCX_XML, ODT_XML };
