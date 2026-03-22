// ============================================================
// ⚠️ 請將下方 URL 替換為你部署後的 GAS Web App 網址
// ============================================================
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwkPKMYfY-IPIcOjbWeVvXNtT_1eUU4yU25UMyKuGrhzDgc28K4EQGppZt0Suyug3dqSg/exec';
// ============================================================

let chatHistory = [];
let chatOpen    = false;

// 儀表板載入的原始資料（供 AI 分析使用）
let _dashData = [];

const FEE_RATE = 0.001425;  // 手續費雙邊費率
const TAX_RATE = 0.0015;    // 交易稅（當沖減半）

// ── 取得今日日期字串 yyyy/MM/dd ──
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// 分頁切換
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).style.display = 'block';
  document.getElementById('tabBtn-' + tab).classList.add('active');
}

// ============================================================
// 浮動 AI 對話 — 開關
// ============================================================
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatPanel').classList.toggle('open', chatOpen);
  document.getElementById('chatFab').classList.toggle('active', chatOpen);
  document.getElementById('chatFabIcon').textContent = chatOpen ? '✕' : '💬';
}

// ============================================================
// 儀表板：載入並計算數據
// ============================================================
async function loadDashboard() {
  const startVal = document.getElementById('dashStart').value;   // yyyy-mm-dd
  const endVal   = document.getElementById('dashEnd').value;     // yyyy-mm-dd
  const statusEl = document.getElementById('dashStatus');
  const btn      = document.getElementById('dashLoadBtn');

  if (!startVal || !endVal) {
    statusEl.textContent = '⚠️ 請選擇開始和結束日期';
    statusEl.style.color = 'var(--warn)';
    return;
  }
  if (startVal > endVal) {
    statusEl.textContent = '⚠️ 開始日期不能大於結束日期';
    statusEl.style.color = 'var(--warn)';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 載入中…';
  statusEl.textContent = '⏳ 從試算表讀取資料中…';
  statusEl.style.color = 'var(--muted)';

  // 隱藏舊結果
  document.getElementById('chartCard').style.display    = 'none';
  document.getElementById('aiPickCard').style.display   = 'none';
  document.getElementById('dashReportArea').style.display = 'none';
  document.getElementById('dashErrorBanner').style.display = 'none';

  try {
    const res  = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'get_history' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '讀取失敗');

    const allTrades = data.history || [];

    // 格式：Sheet 存的日期是 yyyy/MM/dd
    const startDate = startVal.replace(/-/g, '/');
    const endDate   = endVal.replace(/-/g, '/');

    const filtered = allTrades.filter(t => {
      const d = String(t['日期'] || '').trim();
      return d >= startDate && d <= endDate;
    });

    _dashData = filtered;

    if (filtered.length === 0) {
      statusEl.textContent = `😕 ${startDate} ～ ${endDate} 無交易紀錄`;
      statusEl.style.color = 'var(--warn)';
      return;
    }

    statusEl.textContent = `✅ 已載入 ${filtered.length} 筆交易（${startDate} ～ ${endDate}）`;
    statusEl.style.color = 'var(--profit)';

    renderDashboardMetrics(filtered);
    renderDailyChart(filtered);
    populateDateSelect(filtered);

    document.getElementById('chartCard').style.display  = 'block';
    document.getElementById('aiPickCard').style.display = 'block';

  } catch (err) {
    statusEl.textContent = '❌ 載入失敗：' + err.message;
    statusEl.style.color = 'var(--loss)';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📊 載入數據';
  }
}

// ── 計算並渲染指標卡片 ──
function renderDashboardMetrics(trades) {
  const totalPnl  = trades.reduce((sum, t) => sum + (Number(t['淨損益']) || 0), 0);
  const wins      = trades.filter(t => Number(t['淨損益']) > 0).length;
  const total     = trades.length;
  const winRate   = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';

  // 總損益
  const pnlEl   = document.getElementById('mPnl');
  const pnlCard = document.getElementById('mPnlCard');
  pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + totalPnl.toLocaleString() + ' 元';
  pnlCard.className = 'metric-card ' + (totalPnl > 0 ? 'profit' : totalPnl < 0 ? 'loss' : '');

  // 勝率
  const winEl   = document.getElementById('mWinRate');
  const winCard = document.getElementById('mWinCard');
  winEl.textContent = winRate + '%';
  winCard.className = 'metric-card ' + (parseFloat(winRate) >= 50 ? 'profit' : 'loss');

  // 月目標達成率
  const targetInput  = Number(document.getElementById('monthlyTarget').value) || 0;
  const targetEl     = document.getElementById('mMonthTarget');
  const targetCard   = document.getElementById('mTargetCard');
  if (targetInput > 0) {
    const achRate = (totalPnl / targetInput * 100).toFixed(1);
    targetEl.textContent = achRate + '%';
    targetCard.className = 'metric-card ' +
      (parseFloat(achRate) >= 100 ? 'profit' : parseFloat(achRate) >= 70 ? 'warn' : 'loss');
  } else {
    targetEl.textContent = '未設定';
    targetCard.className = 'metric-card';
  }

  // 總交易筆數
  document.getElementById('mTrades').textContent = total + ' 筆';
}

// ── 渲染每日損益走勢圖 ──
function renderDailyChart(trades) {
  // 按日期分組
  const dailyMap = {};
  trades.forEach(t => {
    const date = String(t['日期']).trim();
    if (!dailyMap[date]) dailyMap[date] = { date, pnl: 0, count: 0, wins: 0 };
    dailyMap[date].pnl   += Number(t['淨損益']) || 0;
    dailyMap[date].count += 1;
    if (Number(t['淨損益']) > 0) dailyMap[date].wins++;
  });

  const dailyData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  const maxVal    = Math.max(...dailyData.map(d => Math.abs(d.pnl)), 1);

  const chartEl = document.getElementById('dailyChart');
  chartEl.innerHTML = dailyData.map(d => {
    const heightPct = Math.round(Math.abs(d.pnl) / maxVal * 100);
    const isProfit  = d.pnl >= 0;
    // 短日期顯示 MM/dd
    const parts     = d.date.split('/');
    const shortDate = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d.date;
    const pnlK      = (d.pnl / 1000).toFixed(1);
    const pnlStr    = (d.pnl >= 0 ? '+' : '') + pnlK + 'k';
    const winRate   = d.count > 0 ? Math.round(d.wins / d.count * 100) : 0;

    return `
      <div class="chart-col" title="${d.date}&#10;損益：${pnlStr}&#10;勝率：${winRate}%（${d.wins}/${d.count}）">
        <div class="chart-pnl ${isProfit ? 'profit' : 'loss'}">${pnlStr}</div>
        <div class="chart-bar-wrap">
          <div class="chart-bar ${isProfit ? 'profit' : 'loss'}"
               style="height:${Math.max(heightPct, 2)}%"></div>
        </div>
        <div class="chart-date">${shortDate}</div>
      </div>
    `;
  }).join('');
}

// ── 填充日期選擇下拉 ──
function populateDateSelect(trades) {
  const dates  = [...new Set(trades.map(t => String(t['日期']).trim()))].sort().reverse();
  const select = document.getElementById('analysisDaySelect');
  select.innerHTML = '<option value="">── 選擇交易日期 ──</option>';
  dates.forEach(d => {
    const opt   = document.createElement('option');
    opt.value   = d;
    // 計算當日筆數和損益
    const dayTrades = trades.filter(t => String(t['日期']).trim() === d);
    const dayPnl    = dayTrades.reduce((s, t) => s + (Number(t['淨損益']) || 0), 0);
    opt.textContent = `${d}（${dayTrades.length} 筆，${dayPnl >= 0 ? '+' : ''}${dayPnl.toLocaleString()} 元）`;
    select.appendChild(opt);
  });
}

// ── 產出特定日期的 AI 分析報告 ──
async function generateDayAnalysis() {
  const date     = document.getElementById('analysisDaySelect').value;
  const errEl    = document.getElementById('dashErrorBanner');
  const btn      = document.getElementById('dashAnalyzeBtn');

  errEl.style.display = 'none';

  if (!date) {
    errEl.textContent  = '⚠️ 請先選擇日期';
    errEl.style.display = 'block';
    return;
  }

  const dayTrades = _dashData.filter(t => String(t['日期']).trim() === date);
  if (dayTrades.length === 0) {
    errEl.textContent  = '⚠️ 該日無交易資料';
    errEl.style.display = 'block';
    return;
  }

  // 轉換為 analyze 格式
  const trades = dayTrades.map(t => ({
    date:         String(t['日期']).trim(),
    stock:        String(t['股票代號'] || '').trim(),
    direction:    String(t['方向'] || '多').trim(),
    entry_time:   String(t['進場時間'] || '').trim(),
    exit_time:    String(t['出場時間'] || '').trim(),
    entry_price:  Number(t['進場價'])  || 0,
    exit_price:   Number(t['出場價'])  || 0,
    shares:       Number(t['張數'])    || 1,
    gross_pnl:    Number(t['毛損益'])  || 0,
    tax_fee:      Number(t['手費+稅']) || 0,
    net_pnl:      Number(t['淨損益'])  || 0,
    strategy_id:  String(t['策略代號'] || '').trim()
  }));

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI 分析中，請稍候…';

  try {
    const res  = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'analyze_only', trades, notes: '' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'AI 分析失敗');
    renderDashReport(data.report);
  } catch (err) {
    errEl.textContent  = '❌ ' + err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🤖 產出 AI 分析報告';
  }
}

// ── 渲染儀表板的 AI 分析報告 ──
function renderDashReport(r) {
  const area = document.getElementById('dashReportArea');
  area.style.display = 'block';
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('dRTotal').textContent = r.total_trades ?? '—';
  document.getElementById('dRWin').textContent   = r.win_trades   ?? '—';
  document.getElementById('dRLoss').textContent  = r.loss_trades  ?? '—';

  const pnl = r.net_pnl ?? 0;
  document.getElementById('dRPnl').textContent  = (pnl >= 0 ? '+' : '') + pnl.toLocaleString() + ' 元';
  document.getElementById('dRPnlBox').className = 'stat-box pnl ' + (pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : '');

  const eScore = Math.min(100, Math.max(0, r.emotion_score    ?? 50));
  const dScore = Math.min(100, Math.max(0, r.discipline_score ?? 50));
  document.getElementById('dEmotionScore').textContent    = eScore;
  document.getElementById('dDisciplineScore').textContent = dScore;
  setTimeout(() => {
    const eBar = document.getElementById('dEmotionBar');
    const dBar = document.getElementById('dDisciplineBar');
    eBar.style.width      = eScore + '%';
    dBar.style.width      = dScore + '%';
    eBar.style.background = scoreColor(eScore);
    dBar.style.background = scoreColor(dScore);
  }, 80);

  document.getElementById('dREmotion').textContent    = r.emotion_status      || '—';
  document.getElementById('dRDiscipline').textContent = r.strategy_discipline || '—';
  document.getElementById('dRBehavior').textContent   = r.behavior_pattern    || '—';
  document.getElementById('dRImprovement').textContent= r.improvement         || '—';
  document.getElementById('dRFull').textContent       = r.full_report         || '—';
}

// ============================================================
// 交易明細：新增一行
// ============================================================
function addRow(prefill) {
  const tbody = document.getElementById('tradeBody');
  const idx   = tbody.rows.length + 1;
  const p     = prefill || {};
  const row   = document.createElement('tr');
  row.dataset.idx = idx;

  const dirLong  = (p.direction || '多') === '多' ? 'selected' : '';
  const dirShort = (p.direction || '')   === '空' ? 'selected' : '';

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
      <span class="cell-auto neutral" id="fee_${idx}">
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
  const idx   = row.dataset.idx;
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
  if (type === 'fee') { el.textContent = val.toLocaleString(); el.className = 'cell-auto neutral'; }
}

// ============================================================
// 從 Google Sheet 讀取指定日期的交易資料（交易明細分頁用）
// ============================================================
async function loadFromSheet() {
  const dateInput = document.getElementById('loadDate');
  const statusEl  = document.getElementById('loadStatus');
  const rawDate   = dateInput.value;

  if (!rawDate) { showError('請先選擇要載入的交易日期'); return; }

  const formattedDate = rawDate.replace(/-/g, '/');

  const loadBtn = document.getElementById('loadBtn');
  loadBtn.disabled     = true;
  statusEl.textContent = '⏳ 載入中…';
  statusEl.style.color = 'var(--muted)';
  showError('');

  try {
    const res  = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'get_history' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '讀取失敗');

    const allTrades = data.history || [];
    const trades    = allTrades.filter(t => String(t['日期'] || '').trim() === formattedDate);

    if (trades.length === 0) {
      statusEl.textContent = `😕 ${formattedDate} 無交易紀錄`;
      statusEl.style.color = 'var(--warn)';
      return;
    }

    // 清空現有資料並填入
    document.getElementById('tradeBody').innerHTML = '';
    trades.forEach(t => addRow({
      date:         String(t['日期']).trim(),
      stock:        String(t['股票代號'] || '').trim(),
      direction:    String(t['方向'] || '多').trim(),
      entry_time:   String(t['進場時間'] || '').trim(),
      exit_time:    String(t['出場時間'] || '').trim(),
      entry_price:  Number(t['進場價'])  || '',
      exit_price:   Number(t['出場價'])  || '',
      shares:       Number(t['張數'])    || 1,
      gross_pnl:    Number(t['毛損益'])  || '',
      tax_fee:      Number(t['手費+稅']) || '',
      net_pnl:      Number(t['淨損益'])  || '',
      strategy_id:  String(t['策略代號'] || '').trim()
    }));

    statusEl.textContent = `✅ 已載入 ${trades.length} 筆（${formattedDate}）`;
    statusEl.style.color = 'var(--profit)';
    document.getElementById('notes').placeholder = `選填：${formattedDate} 操作心得、情緒狀態…`;

  } catch (err) {
    statusEl.textContent = '';
    showError('載入失敗：' + err.message);
  } finally {
    loadBtn.disabled = false;
  }
}

// ============================================================
// 送出交易取得 AI 報告（交易明細分頁）
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

// ── 渲染交易明細分頁的 AI 報告 ──
function renderReport(r) {
  const area = document.getElementById('reportArea');
  area.style.display = 'block';
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('rTotal').textContent = r.total_trades ?? '—';
  document.getElementById('rWin').textContent   = r.win_trades   ?? '—';
  document.getElementById('rLoss').textContent  = r.loss_trades  ?? '—';

  const pnl = r.net_pnl ?? 0;
  document.getElementById('rPnl').textContent  = (pnl >= 0 ? '+' : '') + pnl.toLocaleString() + ' 元';
  document.getElementById('rPnlBox').className = 'stat-box pnl ' + (pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : '');

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
  el.className   = 'msg ' + role;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

// ============================================================
// 頁面初始化
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  // 交易明細：預設加一行
  addRow();

  // 日期初始化：今天
  const now    = new Date();
  const yyyy   = now.getFullYear();
  const mm     = String(now.getMonth() + 1).padStart(2, '0');
  const dd     = String(now.getDate()).padStart(2, '0');
  const today  = `${yyyy}-${mm}-${dd}`;

  // 交易明細載入日期
  const ld = document.getElementById('loadDate');
  if (ld) ld.value = today;

  // 儀表板：預設當月第一天到今天
  const firstDay = `${yyyy}-${mm}-01`;
  const dashS    = document.getElementById('dashStart');
  const dashE    = document.getElementById('dashEnd');
  if (dashS) dashS.value = firstDay;
  if (dashE) dashE.value = today;

  // chat textarea 自動展高
  const ci = document.getElementById('chatInput');
  if (ci) {
    ci.addEventListener('input', () => {
      ci.style.height = '44px';
      ci.style.height = Math.min(ci.scrollHeight, 120) + 'px';
    });
    ci.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
  }
});
