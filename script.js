// ============================================================
// ⚠️ 請將下方 URL 替換為你部署後的 GAS Web App 網址
// ============================================================
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwkPKMYfY-IPIcOjbWeVvXNtT_1eUU4yU25UMyKuGrhzDgc28K4EQGppZt0Suyug3dqSg/exec';
// ============================================================

let chatHistory = [];
const FEE_RATE  = 0.001425;  // 手續費雙邊費率（可依折扣調整）
const TAX_RATE  = 0.0015;    // 交易稅（當沖減半）

// ── 取得今日日期字串 yyyy/MM/dd ──
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// 新增一行（可選擇帶入預填資料 prefill）
// prefill 格式與後端回傳的 trade 物件相同
// ============================================================
function addRow(prefill) {
  const tbody = document.getElementById('tradeBody');
  const idx   = tbody.rows.length + 1;
  const p     = prefill || {};
  const row   = document.createElement('tr');
  row.dataset.idx = idx;

  // 判斷方向預選
  const dirLong  = (p.direction || '多') === '多' ? 'selected' : '';
  const dirShort = (p.direction || '')   === '空' ? 'selected' : '';

  // 預填損益顯示
  function fmtAuto(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    return (n >= 0 ? '+' : '') + n.toLocaleString();
  }
  function autoClass(val) {
    if (val == null || val === '') return 'cell-auto neutral';
    return 'cell-auto ' + (Number(val) > 0 ? 'profit' : Number(val) < 0 ? 'loss' : 'neutral');
  }

  row.innerHTML = `
    <td class="td-idx">${idx}</td>
    <td data-label="日期">
      <input class="cell-input" style="width:90px" type="text" placeholder="yyyy/MM/dd"
        value="${p.date || ''}" oninput="recalc(this)">
    </td>
    <td data-label="股票代號">
      <input class="cell-input" style="width:80px" type="text" placeholder="如 2330"
        value="${p.stock || ''}">
    </td>
    <td data-label="方向">
      <select class="cell-select" onchange="recalc(this)">
        <option value="多" ${dirLong}>多（做多）</option>
        <option value="空" ${dirShort}>空（放空）</option>
      </select>
    </td>
    <td data-label="進場時間">
      <input class="cell-input" style="width:60px" type="text" placeholder="09:05"
        value="${p.entry_time || ''}" oninput="recalc(this)">
    </td>
    <td data-label="出場時間">
      <input class="cell-input" style="width:60px" type="text" placeholder="10:30"
        value="${p.exit_time || ''}" oninput="recalc(this)">
    </td>
    <td data-label="進場價">
      <input class="cell-input" style="width:65px" type="number" step="0.01" placeholder="進場價"
        value="${p.entry_price || ''}" oninput="recalc(this)">
    </td>
    <td data-label="出場價">
      <input class="cell-input" style="width:65px" type="number" step="0.01" placeholder="出場價"
        value="${p.exit_price || ''}" oninput="recalc(this)">
    </td>
    <td data-label="張數">
      <input class="cell-input" style="width:48px" type="number" min="1" placeholder="1"
        value="${p.shares || 1}" oninput="recalc(this)">
    </td>
    <td data-label="毛損益">
      <span class="${autoClass(p.gross_pnl)}" id="gross_${idx}">${fmtAuto(p.gross_pnl)}</span>
    </td>
    <td data-label="手費+稅">
      <span class="${p.tax_fee != null ? 'cell-auto neutral' : 'cell-auto neutral'}" id="fee_${idx}">
        ${p.tax_fee != null && p.tax_fee !== '' ? Number(p.tax_fee).toLocaleString() : '—'}
      </span>
    </td>
    <td data-label="淨損益">
      <span class="${autoClass(p.net_pnl)}" id="net_${idx}">${fmtAuto(p.net_pnl)}</span>
    </td>
    <td data-label="策略代號">
      <input class="cell-input" style="width:60px" type="text" placeholder="S01"
        value="${p.strategy_id || ''}">
    </td>
    <td class="td-del">
      <button class="btn btn-danger btn-sm" onclick="removeRow(this)" title="刪除">✕</button>
    </td>
  `;
  tbody.appendChild(row);
}

// ── 刪除一行並重新編號 ──
function removeRow(btn) {
  btn.closest('tr').remove();
  document.querySelectorAll('#tradeBody tr').forEach((r, i) => {
    r.dataset.idx = i + 1;
    r.cells[0].textContent = i + 1;
  });
}

// ── 清空所有行 ──
function clearAllRows() {
  if (!confirm('確定要清空所有交易紀錄嗎？')) return;
  document.getElementById('tradeBody').innerHTML = '';
}

// ── 填入今日日期到所有空白日期欄 ──
function fillTodayDate() {
  const today = todayStr();
  document.querySelectorAll('#tradeBody tr').forEach(row => {
    const inp = row.cells[1].querySelector('input');
    if (inp && !inp.value) inp.value = today;
  });
}

// ── 自動計算損益 ──
function recalc(el) {
  const row = el.closest('tr');
  if (!row) return;
  const idx  = row.dataset.idx;
  const cells = row.cells;

  const dir    = cells[3].querySelector('select').value;
  const entryP = parseFloat(cells[6].querySelector('input').value) || 0;
  const exitP  = parseFloat(cells[7].querySelector('input').value) || 0;
  const shares = parseInt(cells[8].querySelector('input').value)   || 0;

  if (!entryP || !exitP || !shares) {
    ['gross','fee','net'].forEach(t => setAutoCell(idx, t, null));
    return;
  }

  const units    = shares * 1000;
  const grossRaw = dir === '多' ? (exitP - entryP) * units : (entryP - exitP) * units;
  const fee      = Math.round((entryP + exitP) * units * FEE_RATE);
  const tax      = Math.round(exitP * units * TAX_RATE);
  const netPnl   = Math.round(grossRaw) - fee - tax;

  setAutoCell(idx, 'gross', Math.round(grossRaw));
  setAutoCell(idx, 'fee',   fee + tax);
  setAutoCell(idx, 'net',   netPnl);
}

function setAutoCell(idx, type, val) {
  const id = { gross: `gross_${idx}`, fee: `fee_${idx}`, net: `net_${idx}` }[type];
  const el = document.getElementById(id);
  if (!el) return;
  if (val === null) {
    el.textContent = '—'; el.className = 'cell-auto neutral'; return;
  }
  el.textContent = (val >= 0 ? '+' : '') + val.toLocaleString();
  el.className   = 'cell-auto ' + (val > 0 ? 'profit' : val < 0 ? 'loss' : 'neutral');
  // 手費固定顯示絕對值
  if (type === 'fee') { el.textContent = val.toLocaleString(); }
}

// ── 頁面初始化 ──
window.addEventListener('DOMContentLoaded', () => {
  addRow();
  // 日期預設今天
  const ld = document.getElementById('loadDate');
  const now = new Date();
  ld.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // chat textarea 自動展高
  const ci = document.getElementById('chatInput');
  ci.addEventListener('input', () => {
    ci.style.height = '44px';
    ci.style.height = Math.min(ci.scrollHeight, 120) + 'px';
  });
  ci.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
});

// ============================================================
// 從 Google Sheet 讀取指定日期的交易資料
// ============================================================
async function loadFromSheet() {
  const dateInput  = document.getElementById('loadDate');
  const statusEl   = document.getElementById('loadStatus');
  const rawDate    = dateInput.value;  // yyyy-mm-dd

  if (!rawDate) { showError('請先選擇要載入的交易日期'); return; }
  if (GAS_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
    showError('請先在 Index.html 設定 GAS_URL');
    return;
  }

  // 轉為 yyyy/MM/dd 格式（符合 Sheet 儲存格式）
  const formattedDate = rawDate.replace(/-/g, '/');

  const loadBtn = document.getElementById('loadBtn');
  loadBtn.disabled  = true;
  statusEl.textContent = '⏳ 載入中…';
  statusEl.style.color = 'var(--muted)';
  showError('');

  try {
    const res  = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'loadFromSheet', date: formattedDate })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || '讀取失敗');

    const trades = data.trades || [];
    if (trades.length === 0) {
      statusEl.textContent = `😕 ${formattedDate} 無交易紀錄`;
      statusEl.style.color = 'var(--warn)';
      return;
    }

    // 清空現有資料並填入
    document.getElementById('tradeBody').innerHTML = '';
    trades.forEach(t => addRow(t));

    statusEl.textContent = `✅ 已載入 ${trades.length} 筆（${formattedDate}）`;
    statusEl.style.color = 'var(--profit)';

    // 把日期也填進備註提示
    document.getElementById('notes').placeholder = `選填：${formattedDate} 操作心得、情緒狀態…`;

  } catch (err) {
    statusEl.textContent = '';
    showError('載入失敗：' + err.message);
  } finally {
    loadBtn.disabled = false;
  }
}

// ============================================================
// 送出交易取得 AI 報告
// ============================================================
async function submitTrades() {
  showError('');
  const rows   = document.querySelectorAll('#tradeBody tr');
  const trades = [];

  for (let i = 0; i < rows.length; i++) {
    const cells  = rows[i].cells;
    const date   = cells[1].querySelector('input').value.trim();
    const stock  = cells[2].querySelector('input').value.trim();
    const dir    = cells[3].querySelector('select').value;
    const entryT = cells[4].querySelector('input').value.trim();
    const exitT  = cells[5].querySelector('input').value.trim();
    const entryP = parseFloat(cells[6].querySelector('input').value);
    const exitP  = parseFloat(cells[7].querySelector('input').value);
    const shares = parseInt(cells[8].querySelector('input').value);
    const strat  = cells[12].querySelector('input').value.trim();

    if (!date || !stock || !entryP || !exitP || !shares) {
      showError(`第 ${i+1} 筆不完整，請確認日期、股票代號、進出場價、張數均已填寫`);
      return;
    }

    const units    = shares * 1000;
    const grossRaw = dir === '多' ? (exitP - entryP) * units : (entryP - exitP) * units;
    const fee      = Math.round((entryP + exitP) * units * FEE_RATE);
    const tax      = Math.round(exitP * units * TAX_RATE);
    const netPnl   = Math.round(grossRaw) - fee - tax;

    trades.push({
      date, stock, direction: dir,
      entry_time: entryT, exit_time: exitT,
      entry_price: entryP, exit_price: exitP,
      shares,
      gross_pnl:   Math.round(grossRaw),
      tax_fee:     fee + tax,
      net_pnl:     netPnl,
      strategy_id: strat || ''
    });
  }

  if (trades.length === 0) { showError('請至少新增一筆交易再送出'); return; }
  if (GAS_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
    showError('請先設定 GAS_URL');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI 分析中，請稍候…';

  try {
    const res  = await fetch(GAS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'analyze', trades, notes: document.getElementById('notes').value.trim() })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '後端回傳失敗');
    renderReport(data.report);
  } catch (err) {
    showError('送出失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🤖 送出並取得 AI 分析報告';
  }
}

// ── 渲染報告 ──
function renderReport(r) {
  const area = document.getElementById('reportArea');
  area.style.display = 'block';
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('rTotal').textContent = r.total_trades ?? '—';
  document.getElementById('rWin').textContent   = r.win_trades   ?? '—';
  document.getElementById('rLoss').textContent  = r.loss_trades  ?? '—';

  const pnl = r.net_pnl ?? 0;
  document.getElementById('rPnl').textContent   = (pnl >= 0 ? '+' : '') + pnl.toLocaleString() + ' 元';
  document.getElementById('rPnlBox').className  = 'stat-box pnl ' + (pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : '');

  const eScore = Math.min(100, Math.max(0, r.emotion_score    ?? 50));
  const dScore = Math.min(100, Math.max(0, r.discipline_score ?? 50));
  document.getElementById('emotionScore').textContent    = eScore;
  document.getElementById('disciplineScore').textContent = dScore;
  setTimeout(() => {
    document.getElementById('emotionBar').style.width      = eScore + '%';
    document.getElementById('disciplineBar').style.width   = dScore + '%';
    document.getElementById('emotionBar').style.background    = scoreColor(eScore);
    document.getElementById('disciplineBar').style.background = scoreColor(dScore);
  }, 80);

  document.getElementById('rEmotion').textContent     = r.emotion_status      || '—';
  document.getElementById('rDiscipline').textContent  = r.strategy_discipline || '—';
  document.getElementById('rBehavior').textContent    = r.behavior_pattern    || '—';
  document.getElementById('rImprovement').textContent = r.improvement         || '—';
  document.getElementById('rFull').textContent        = r.full_report         || '—';
}

function scoreColor(s) {
  return s >= 70 ? 'var(--profit)' : s >= 40 ? 'var(--warn)' : 'var(--loss)';
}

function showError(msg) {
  const el = document.getElementById('errorBanner');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = '⚠️ ' + msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
// AI 對話
// ============================================================
function sendHint(btn) {
  document.getElementById('chatInput').value = btn.textContent.replace(/^[^\w\u4e00-\u9fff]+/, '').trim();
  document.getElementById('chatHints').style.display = 'none';
  sendChat();
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;

  if (GAS_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
    appendMsg('system', '⚠️ 請先設定 GAS_URL');
    return;
  }

  appendMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });
  input.value = '';
  input.style.height = '44px';
  document.getElementById('chatHints').style.display = 'none';

  const loadingEl = appendMsg('ai', '…');
  const sendBtn   = document.getElementById('chatSendBtn');
  sendBtn.disabled = true;

  try {
    const res  = await fetch(GAS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'chat', message: msg, history: chatHistory.slice(-12) })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '對話失敗');
    loadingEl.textContent = data.reply;
    chatHistory.push({ role: 'ai', content: data.reply });
  } catch (err) {
    loadingEl.textContent = '❌ ' + err.message;
  } finally {
    sendBtn.disabled = false;
  }
}

function appendMsg(role, text) {
  const box = document.getElementById('chatMessages');
  const el  = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}
