// =============================================
// 當沖交易日誌 AI 分析系統 - Google Apps Script
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

    if (data.action === 'analyze')     return handleAnalyze(data);
    if (data.action === 'chat')        return handleChat(data);
    if (data.action === 'get_history') return handleGetHistory();

    // 相容舊版翻譯功能
    if (data.text) return handleTranslation(data);

    return respond({ success: false, error: '未知的 action' });
  } catch (error) {
    return respond({ success: false, error: '伺服器錯誤：' + error.toString() });
  }
}

function doGet(e) {
  return respond({ status: 'ok', message: '當沖交易日誌 AI 系統運作中' });
}

// ============================================================
// action: analyze — AI 分析今日交易並存入試算表
// ============================================================
function handleAnalyze(data) {
  const trades = data.trades || [];
  const notes  = data.notes  || '';

  if (trades.length === 0) {
    return respond({ success: false, error: '沒有交易資料' });
  }

  // 計算統計
  const totalTrades = trades.length;
  const winTrades   = trades.filter(t => t.net_pnl > 0).length;
  const lossTrades  = trades.filter(t => t.net_pnl < 0).length;
  const netPnl      = trades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);

  // 存入試算表
  saveToSheet(trades);

  // 組 Gemini prompt
  const prompt = buildAnalysisPrompt(trades, notes, { totalTrades, winTrades, lossTrades, netPnl });

  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (!result.candidates || !result.candidates[0]) {
    return respond({ success: false, error: 'Gemini API 未回傳結果' });
  }

  const rawText = result.candidates[0].content.parts[0].text.trim();

  let aiReport;
  try {
    // 嘗試去除 markdown 包裝再 parse
    const jsonStr = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    aiReport = JSON.parse(jsonStr);
  } catch (e) {
    aiReport = { full_report: rawText };
  }

  const report = {
    total_trades:        totalTrades,
    win_trades:          winTrades,
    loss_trades:         lossTrades,
    net_pnl:             netPnl,
    emotion_score:       Number(aiReport.emotion_score)    || 50,
    discipline_score:    Number(aiReport.discipline_score) || 50,
    emotion_status:      aiReport.emotion_status      || '',
    strategy_discipline: aiReport.strategy_discipline || '',
    behavior_pattern:    aiReport.behavior_pattern    || '',
    improvement:         aiReport.improvement         || '',
    full_report:         aiReport.full_report         || rawText
  };

  return respond({ success: true, report });
}

// ============================================================
// action: chat — AI 顧問對話（帶入歷史交易資料）
// ============================================================
function handleChat(data) {
  const message      = data.message      || '';
  const history      = data.history      || [];
  const historyData  = data.history_data || null;

  // 將歷史交易資料整理成文字供 AI 參考
  let historyContext = '';
  if (historyData && historyData.length > 0) {
    const rows = historyData.slice(0, 200); // 最多帶 200 筆，避免 token 爆量
    historyContext = '\n\n【使用者歷史交易紀錄（共 ' + historyData.length + ' 筆，以下列出最近 ' + rows.length + ' 筆）】\n' +
      rows.map((row, i) => {
        const pairs = Object.entries(row).map(([k, v]) => `${k}:${v}`).join('｜');
        return `第${i + 1}筆：${pairs}`;
      }).join('\n');
  }

  const systemText = '你是一位專業的台股當沖交易顧問，熟悉台灣股市規則、當沖策略、技術分析、資金管理與交易心理。' +
    '請用繁體中文回答，語氣專業但親切，提供具體可行的建議。' +
    (historyContext ? historyContext + '\n\n請根據以上歷史紀錄回答使用者的問題。' : '');

  // 組多輪對話 contents
  const contents = [];
  history.forEach(h => {
    if (h.role === 'user') {
      contents.push({ role: 'user',  parts: [{ text: h.content }] });
    } else if (h.role === 'ai' || h.role === 'model') {
      contents.push({ role: 'model', parts: [{ text: h.content }] });
    }
  });
  // 確保最後加入本次使用者訊息
  if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: message }] });
  }

  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: { temperature: 0.8 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (!result.candidates || !result.candidates[0]) {
    return respond({ success: false, error: 'AI 無回應，請稍後再試' });
  }

  const reply = result.candidates[0].content.parts[0].text.trim();
  return respond({ success: true, reply });
}

// ============================================================
// action: get_history — 讀取「交易紀錄」分頁所有資料
// ============================================================
function handleGetHistory() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('交易紀錄');

    if (!sheet) return respond({ success: true, history: [] });

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return respond({ success: true, history: [] });

    const headers = values[0];
    const rows    = values.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    return respond({ success: true, history: rows });
  } catch (e) {
    return respond({ success: false, error: e.toString() });
  }
}

// ============================================================
// 存入試算表
// ============================================================
function saveToSheet(trades) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('交易紀錄');

    if (!sheet) {
      sheet = ss.insertSheet('交易紀錄');
      sheet.appendRow(['日期', '股票代號', '方向', '進場時間', '出場時間',
                       '進場價', '出場價', '張數', '毛損益', '手費+稅', '淨損益', '策略代號']);
    }

    trades.forEach(t => {
      sheet.appendRow([
        t.date, t.stock, t.direction,
        t.entry_time, t.exit_time,
        t.entry_price, t.exit_price, t.shares,
        t.gross_pnl, t.tax_fee, t.net_pnl,
        t.strategy_id || ''
      ]);
    });
  } catch (e) {
    Logger.log('saveToSheet error: ' + e.toString());
  }
}

// ============================================================
// AI 分析 Prompt
// ============================================================
function buildAnalysisPrompt(trades, notes, stats) {
  const tradesText = trades.map((t, i) =>
    `第${i + 1}筆：${t.date} ${t.stock} ${t.direction} ` +
    `進場${t.entry_price}→出場${t.exit_price} ${t.shares}張 ` +
    `淨損益${t.net_pnl}元 策略${t.strategy_id || '無'}`
  ).join('\n');

  return `你是台股當沖交易心理與策略分析師。請分析以下交易數據，並以 JSON 格式回傳。

今日交易摘要：
- 總筆數：${stats.totalTrades}
- 獲利：${stats.winTrades} 筆，虧損：${stats.lossTrades} 筆
- 當日淨損益：${stats.netPnl} 元

交易明細：
${tradesText}

備註：${notes || '（無）'}

請回傳以下 JSON 格式（只回傳 JSON，不要加任何說明或 markdown）：
{
  "emotion_score": 整數0到100（情緒穩定度），
  "discipline_score": 整數0到100（策略紀律），
  "emotion_status": "情緒狀態分析",
  "strategy_discipline": "策略執行紀律分析",
  "behavior_pattern": "行為模式觀察",
  "improvement": "改善建議",
  "full_report": "完整分析報告"
}`;
}

// ============================================================
// 相容舊版翻譯功能
// ============================================================
function handleTranslation(data) {
  const text     = data.text;
  const language = data.language;

  if (!text || !text.trim()) {
    return respond({ success: false, error: '請輸入要翻譯的文字' });
  }

  const targetLang = language === 'japanese'
    ? '日文（日語），請使用自然的日文表達'
    : '英文（English），請使用自然的英文表達';

  const prompt = `請將以下文字翻譯成${targetLang}。只回傳翻譯後的文字，不需要任何說明、前言或引號：\n\n${text}`;

  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
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
}

// ============================================================
// 通用回應包裝
// ============================================================
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
