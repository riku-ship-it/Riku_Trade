// =============================================
// Gemini 翻譯 API - Google Apps Script
// =============================================
// 使用說明：
// 1. 將 GEMINI_API_KEY 換成你的實際 API 金鑰
// 2. 部署為網路應用程式（Web App）：
//    - 執行身分：我（Me）
//    - 存取權限：所有人（Anyone）
// 3. 複製產生的 Web App URL，貼到 Index.html 的 GAS_URL 變數
// =============================================

const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE'; // ← 換成你的 API 金鑰
const MODEL = 'gemini-2.0-flash';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const text = data.text;
    const language = data.language; // 'english' 或 'japanese'

    if (!text || !text.trim()) {
      return respond({ success: false, error: '請輸入要翻譯的文字' });
    }

    const targetLang = language === 'japanese'
      ? '日文（日語），請使用自然的日文表達'
      : '英文（English），請使用自然的英文表達';

    const prompt = `請將以下文字翻譯成${targetLang}。只回傳翻譯後的文字，不需要任何說明、前言或引號：\n\n${text}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());

    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const translation = result.candidates[0].content.parts[0].text.trim();
      return respond({ success: true, translation });
    } else if (result.error) {
      return respond({ success: false, error: 'Gemini API 錯誤：' + result.error.message });
    } else {
      return respond({ success: false, error: '未收到翻譯結果，請稍後再試' });
    }

  } catch (error) {
    return respond({ success: false, error: '伺服器錯誤：' + error.toString() });
  }
}

function doGet(e) {
  return respond({ status: 'ok', message: 'Gemini 翻譯 API 運作中' });
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
