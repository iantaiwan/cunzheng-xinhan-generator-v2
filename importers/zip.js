(function initCunzhengZip(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengZip = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createZip() {
  'use strict';

  // .docx 與 .odt 本質上都是 ZIP 容器。這裡只實作讀取所需的最小子集，
  // 解壓縮交給瀏覽器原生的 DecompressionStream，因此不需要任何第三方套件。

  const SIGNATURE = {
    END_OF_CENTRAL_DIRECTORY: 0x06054b50,
    CENTRAL_FILE_HEADER: 0x02014b50,
    LOCAL_FILE_HEADER: 0x04034b50,
    ZIP64_END_LOCATOR: 0x07064b50
  };

  const METHOD = { STORED: 0, DEFLATE: 8 };
  const MAX_COMMENT_LENGTH = 0xffff;

  class ZipError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ZipError';
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? ((value >>> 1) ^ 0xedb88320) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function toUint8Array(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new ZipError('無法辨識的位元組來源。');
  }

  // 中央目錄在檔案尾端，且尾端可能帶有註解，因此必須由後往前搜尋簽章。
  function findEndOfCentralDirectory(view, length) {
    const earliest = Math.max(0, length - MAX_COMMENT_LENGTH - 22);
    for (let offset = length - 22; offset >= earliest; offset -= 1) {
      if (view.getUint32(offset, true) === SIGNATURE.END_OF_CENTRAL_DIRECTORY) return offset;
    }
    return -1;
  }

  function decodeName(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function listEntries(input) {
    const bytes = toUint8Array(input);
    if (bytes.length < 22) throw new ZipError('檔案太小，不是有效的 ZIP 容器。');

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(view, bytes.length);
    if (eocdOffset < 0) throw new ZipError('找不到 ZIP 中央目錄，檔案可能已損毀或不是 ZIP 格式。');

    const entryCount = view.getUint16(eocdOffset + 10, true);
    let cursor = view.getUint32(eocdOffset + 16, true);

    if (entryCount === 0xffff || cursor === 0xffffffff) {
      throw new ZipError('偵測到 ZIP64 格式，目前不支援；請另存為一般 ZIP 後再試。');
    }

    const entries = [];
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== SIGNATURE.CENTRAL_FILE_HEADER) {
        throw new ZipError(`ZIP 中央目錄在第 ${index + 1} 筆項目處損毀。`);
      }
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);

      entries.push({
        name: decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
        method: view.getUint16(cursor + 10, true),
        crc32: view.getUint32(cursor + 16, true),
        compressedSize: view.getUint32(cursor + 20, true),
        uncompressedSize: view.getUint32(cursor + 24, true),
        localHeaderOffset: view.getUint32(cursor + 42, true)
      });

      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return { bytes, view, entries };
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new ZipError('此瀏覽器不支援 DecompressionStream，無法解壓縮此檔案。');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntry(archive, entry) {
    const { bytes, view } = archive;
    const headerOffset = entry.localHeaderOffset;

    if (headerOffset + 30 > bytes.length || view.getUint32(headerOffset, true) !== SIGNATURE.LOCAL_FILE_HEADER) {
      throw new ZipError(`項目「${entry.name}」的區域檔頭損毀。`);
    }
    // 區域檔頭的名稱與額外欄位長度可能與中央目錄不同，必須以區域檔頭為準。
    const nameLength = view.getUint16(headerOffset + 26, true);
    const extraLength = view.getUint16(headerOffset + 28, true);
    const dataStart = headerOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > bytes.length) throw new ZipError(`項目「${entry.name}」的資料超出檔案範圍。`);
    const raw = bytes.subarray(dataStart, dataEnd);

    let output;
    if (entry.method === METHOD.STORED) {
      output = raw;
    } else if (entry.method === METHOD.DEFLATE) {
      output = await inflateRaw(raw);
    } else {
      throw new ZipError(`項目「${entry.name}」使用不支援的壓縮方式（method ${entry.method}）。`);
    }

    // 解壓後同時驗證長度與 CRC32，避免把損毀的位元組當成正確內容往下傳。
    if (output.length !== entry.uncompressedSize) {
      throw new ZipError(`項目「${entry.name}」解壓後長度不符（預期 ${entry.uncompressedSize}，實際 ${output.length}）。`);
    }
    if (crc32(output) !== entry.crc32) {
      throw new ZipError(`項目「${entry.name}」CRC32 校驗失敗，檔案內容已損毀。`);
    }
    return output;
  }

  function findEntry(archive, name) {
    return archive.entries.find(entry => entry.name === name) || null;
  }

  async function readTextFile(input, name) {
    const archive = listEntries(input);
    const entry = findEntry(archive, name);
    if (!entry) throw new ZipError(`容器內找不到「${name}」。`);
    return new TextDecoder('utf-8').decode(await readEntry(archive, entry));
  }

  function isZip(input) {
    try {
      const bytes = toUint8Array(input);
      if (bytes.length < 4) return false;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return view.getUint32(0, true) === SIGNATURE.LOCAL_FILE_HEADER;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    METHOD,
    ZipError,
    crc32,
    findEntry,
    isZip,
    listEntries,
    readEntry,
    readTextFile
  });
}));
