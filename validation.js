(function initCunzhengValidation(root, factory) {
  const logic = (typeof module === 'object' && module.exports)
    ? require('./logic.js')
    : root.CunzhengLogic;
  const api = factory(logic);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengValidation = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createValidation(Logic) {
  'use strict';

  const MAX_CONTENT_LENGTH = 5000;
  const MAX_TOTAL_SETS = 20;

  // 每個欄位的邊界都集中在此，表單與驗證共用同一份定義。
  const COUNT_FIELDS = Object.freeze([
    { key: 'copyCount', raw: 'copyCountRaw', min: 0, max: 10, label: '副本份數' },
    { key: 'attachCount', raw: 'attachCountRaw', min: 0, max: 100, label: '附件張數' },
    { key: 'extraOriginal', raw: 'extraOriginalRaw', min: 0, max: 20, label: '加具正本份數' },
    { key: 'extraCopy', raw: 'extraCopyRaw', min: 0, max: 20, label: '加具副本份數' }
  ]);

  const FIELD_IDS = Object.freeze([
    'senderName', 'senderPostalCode', 'senderAddr',
    'recvName', 'recvPostalCode', 'recvAddr',
    'ccName', 'ccPostalCode', 'ccAddr',
    'copyCount', 'attachCount', 'extraOriginal', 'extraCopy', 'content'
  ]);

  const TEMPLATES = Object.freeze({
    debt: `主旨：催告返還欠款\n\n一、台端於[借款日期]向本人借款新臺幣[金額]元，雙方約定於[清償日期]前返還，惟迄今尚未清償。\n二、請台端於收受本函後[天數]日內，將前述款項匯至[付款方式或帳戶資訊]。\n三、逾期仍未清償時，本人將依法主張權利，相關費用及責任並由台端負擔。`,
    termination: `主旨：解除契約通知\n\n一、本人與台端於[簽約日期]就[契約名稱或標的]成立契約。\n二、因[具體違約事實]，本人曾於[催告日期]催告台端於期限內履行，惟期限屆滿仍未改善。\n三、本人爰以本函通知解除前述契約，並請於[日期]前返還[款項、物品或文件]。`,
    refund: `主旨：請求退款\n\n一、本人於[交易日期]向台端購買[商品或服務]，已支付新臺幣[金額]元。\n二、因[退款事由及相關事實]，本人已於[聯絡日期]提出退款要求，迄今仍未處理。\n三、請於收受本函後[天數]日內退還新臺幣[金額]元，並以[退款方式]辦理。`,
    lease: `主旨：終止租賃契約通知\n\n一、雙方就坐落於[租賃標的地址]之房屋訂有租賃契約，租期自[起日]至[迄日]。\n二、依契約第[條次]條及[終止事由]，本人以本函通知於[終止日期]終止租賃關係。\n三、請於前述日期前完成點交、返還鑰匙及結清應付款項。`,
    labor: `主旨：勞資爭議事項通知\n\n一、本人自[到職日期]起任職於台端，擔任[職務]。\n二、就[薪資、加班費、資遣費或其他事項]，截至[日期]尚有新臺幣[金額]元未獲給付。\n三、請於收受本函後[天數]日內依法給付並提供相關明細；逾期未處理，本人將循勞資爭議調解或其他法定程序處理。`
  });

  function addRequiredError(errors, data, key, id, label) {
    if (!data[key]) errors.push({ id, message: `請填寫${label}。` });
  }

  function addPostalCodeError(errors, value, id, label) {
    if (!Logic.isOptionalPostalCode(value)) {
      errors.push({ id, message: `${label}郵遞區號須為 3、5 或 6 碼數字。` });
    }
  }

  function validateData(data) {
    const errors = [];
    const warnings = [];

    addRequiredError(errors, data, 'senderName', 'senderName', '寄件人姓名或名稱');
    addRequiredError(errors, data, 'senderAddr', 'senderAddr', '寄件人詳細地址');
    addRequiredError(errors, data, 'recvName', 'recvName', '收件人姓名或名稱');
    addRequiredError(errors, data, 'recvAddr', 'recvAddr', '收件人詳細地址');

    addPostalCodeError(errors, data.senderPostalCode, 'senderPostalCode', '寄件人');
    addPostalCodeError(errors, data.recvPostalCode, 'recvPostalCode', '收件人');

    // 副本收件人整組選填，但只要填了任一格，姓名與地址就必須齊全。
    const hasAnyCc = Boolean(data.ccName || data.ccPostalCode || data.ccAddr);
    if (hasAnyCc) {
      addRequiredError(errors, data, 'ccName', 'ccName', '副本收件人姓名或名稱');
      addRequiredError(errors, data, 'ccAddr', 'ccAddr', '副本收件人詳細地址');
      addPostalCodeError(errors, data.ccPostalCode, 'ccPostalCode', '副本收件人');
    }

    if (!data.content.trim()) {
      errors.push({ id: 'content', message: '請填寫信函正文。' });
    }
    if (data.content.length > MAX_CONTENT_LENGTH) {
      errors.push({ id: 'content', message: '信函正文不得超過 5,000 個字元。' });
    }

    const counts = {};
    COUNT_FIELDS.forEach(field => {
      counts[field.key] = Logic.parseBoundedInteger(data[field.raw], field.min, field.max);
      if (counts[field.key] === null) {
        errors.push({ id: field.key, message: `${field.label}須為 ${field.min} 至 ${field.max} 的整數。` });
      }
    });

    const { copyCount, extraOriginal, extraCopy } = counts;
    if (copyCount !== null && extraOriginal !== null && extraCopy !== null
      && 1 + copyCount + extraOriginal + extraCopy > MAX_TOTAL_SETS) {
      errors.push({ id: 'copyCount', message: '本次列印的正副本合計不得超過 20 份。' });
    }

    if (/\[[^\]]+\]/.test(data.content)) {
      warnings.push('正文仍含有中括號範本欄位，請確認已全部替換。');
    }

    const normalized = { ...data };
    COUNT_FIELDS.forEach(field => {
      normalized[field.key] = counts[field.key] ?? 0;
    });

    return { errors, warnings, normalized };
  }

  function signatureFor(data) {
    return JSON.stringify(data);
  }

  return Object.freeze({
    COUNT_FIELDS,
    FIELD_IDS,
    MAX_CONTENT_LENGTH,
    MAX_TOTAL_SETS,
    TEMPLATES,
    signatureFor,
    validateData
  });
}));
