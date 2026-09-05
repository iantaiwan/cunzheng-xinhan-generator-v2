(function initCunzhengOcr(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengOcr = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createOcr(root) {
  'use strict';

  // OCR 引擎採可插拔設計，預設「不存在」。
  //
  // 為什麼不直接內建：離線中文 OCR 需要 wasm 執行檔與語言模型（合計約 10MB 以上），
  // 內建會讓儲存庫肥大，而從 CDN 載入則違反本工具「零外部依賴、不主動連網」的前提。
  //
  // 因此改成：使用者自行把引擎檔案放進 vendor/，本模組在使用者實際按下
  // 「以 OCR 匯入」時才從「同源」動態載入。這樣 CSP 仍維持 script-src 'self'，
  // 全程不連外網，未安裝時也只是這個功能不可用，不影響其他匯入方式。

  const VENDOR_ENTRY = 'vendor/ocr-engine.js';
  const SETUP_HINT = '尚未安裝 OCR 引擎。請依 vendor/README.md 的說明放入引擎與語言模型後再試；未安裝時仍可使用 .docx、.odt、PDF 與純文字匯入。';

  let engine = null;
  let loadPromise = null;

  /**
   * 註冊 OCR 引擎。vendor/ocr-engine.js 載入後應呼叫此函式。
   * @param {{name: string, recognize: (blob: Blob, options: object) => Promise<string>}} candidate
   */
  function register(candidate) {
    if (!candidate || typeof candidate.recognize !== 'function') {
      throw new TypeError('OCR 引擎必須提供 recognize(blob, options) 函式。');
    }
    engine = candidate;
    return engine;
  }

  function unregister() {
    engine = null;
    loadPromise = null;
  }

  function isRegistered() {
    return engine !== null;
  }

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const element = root.document.createElement('script');
      element.src = source;
      element.async = true;
      element.addEventListener('load', () => resolve(true));
      element.addEventListener('error', () => reject(new Error(SETUP_HINT)));
      root.document.head.appendChild(element);
    });
  }

  /** 首次使用時才載入引擎；同源載入，不觸發任何外部網路請求。 */
  async function ensureEngine() {
    if (engine) return engine;
    if (!root.document) throw new Error(SETUP_HINT);
    if (!loadPromise) loadPromise = loadScript(VENDOR_ENTRY).catch(error => {
      loadPromise = null;
      throw error;
    });
    await loadPromise;
    if (!engine) throw new Error(SETUP_HINT);
    return engine;
  }

  /**
   * 對圖片或掃描件執行 OCR。
   * @param {Blob} blob
   * @param {{lang?: string, onProgress?: (ratio: number) => void}} [options]
   * @returns {Promise<{text: string, engine: string, notes: string[]}>}
   */
  async function recognize(blob, options = {}) {
    const active = await ensureEngine();
    const text = await active.recognize(blob, {
      lang: options.lang || 'chi_tra',
      onProgress: typeof options.onProgress === 'function' ? options.onProgress : () => {}
    });

    const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    const notes = [
      `OCR 結果由「${active.name || '未具名引擎'}」產生，辨識率受掃描品質影響，務必逐字核對後再列印。`
    ];
    if (!clean) notes.push('OCR 沒有辨識出任何文字，請確認圖片清晰度與方向。');

    return { text: clean, engine: active.name || 'unknown', notes };
  }

  return Object.freeze({
    SETUP_HINT,
    VENDOR_ENTRY,
    ensureEngine,
    isRegistered,
    recognize,
    register,
    unregister
  });
}));
