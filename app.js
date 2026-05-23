// ─────────────────────────────────────────────
//  การตั้งค่าอัตราแลกเปลี่ยน
//  แก้ตรงนี้เพื่อเปลี่ยนอัตรา donation/coin → เตะ
// ─────────────────────────────────────────────
const RATE = {
  BAHT_PER_KICK: 1,   // 1 บาท = 1 เตะ
  COINS_PER_KICK: 5,  // 5 เหรียญ = 1 เตะ
};

// ─────────────────────────────────────────────
//  Firebase Config
//  แก้ DB_URL ถ้าเปลี่ยน project
// ─────────────────────────────────────────────
const DB_URL = 'https://kick-lucky-block-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_REF = `${DB_URL}/klb.json`;

// สีอวตาร (bg, text)
const AVATAR_COLORS = [
  ['rgba(34,197,94,0.2)',  '#22c55e'],
  ['rgba(59,130,246,0.2)', '#60a5fa'],
  ['rgba(234,179,8,0.2)',  '#eab308'],
  ['rgba(168,85,247,0.2)', '#c084fc'],
  ['rgba(249,115,22,0.2)', '#fb923c'],
  ['rgba(236,72,153,0.2)', '#f472b6'],
];

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
let queue       = [];
let done        = [];
let totalKicks  = 0;
let ws          = null;
let wsConnected = false;
let toastTimer  = null;

// ─────────────────────────────────────────────
//  Firebase sync
// ─────────────────────────────────────────────
async function saveQueue() {
  try {
    await fetch(DB_REF, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue, done, totalKicks }),
    });
  } catch (_) {}
}

async function loadQueue() {
  try {
    const res = await fetch(DB_REF);
    const d   = await res.json();
    if (d) {
      queue      = d.queue      || [];
      done       = d.done       || [];
      totalKicks = d.totalKicks || 0;
    }
  } catch (_) {}
}

// polling ทุก 2 วินาที — render เฉพาะเมื่อข้อมูลเปลี่ยน
let lastSnapshot = '';

setInterval(async () => {
  try {
    const res = await fetch(DB_REF);
    const raw = await res.text();
    if (raw === lastSnapshot) return; // ไม่เปลี่ยน → ไม่ render
    lastSnapshot = raw;
    const d = JSON.parse(raw);
    if (d) {
      queue      = d.queue      || [];
      done       = d.done       || [];
      totalKicks = d.totalKicks || 0;
    }
    render();
  } catch (_) {}
}, 2000);

// ─────────────────────────────────────────────
//  Helper functions
// ─────────────────────────────────────────────
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name) { return name.slice(0, 2).toUpperCase(); }
function bahtToKicks(b) { return Math.floor(b / RATE.BAHT_PER_KICK); }
function coinToKicks(c) { return Math.floor(c / RATE.COINS_PER_KICK); }

// ─────────────────────────────────────────────
//  Queue actions
// ─────────────────────────────────────────────
async function addToQueue(name, kicks, source) {
  if (kicks <= 0) return;
  const ex = queue.find(q => q.name === name);
  if (ex) { ex.kicks += kicks; ex.total += kicks; }
  else     { queue.push({ name, kicks, total: kicks, source }); }
  totalKicks += kicks;
  render();
  await saveQueue();
  showToast(`+${kicks} เตะ → ${name}`, true);
}

async function useKick(idx) {
  if (idx >= queue.length) return;
  queue[idx].kicks--;
  if (queue[idx].kicks <= 0) {
    done.push({ name: queue[idx].name, total: queue[idx].total });
    queue.splice(idx, 1);
  }
  render();
  await saveQueue();
}

async function removeFromQueue(idx) {
  queue.splice(idx, 1);
  render();
  await saveQueue();
}

async function clearDone() {
  done = [];
  render();
  await saveQueue();
}

async function resetAll() {
  if (!confirm('รีเซ็ตคิวและประวัติทั้งหมด?')) return;
  queue = []; done = []; totalKicks = 0;
  render();
  await saveQueue();
}

// ─────────────────────────────────────────────
//  Manual add (จากปุ่ม UI)
// ─────────────────────────────────────────────
function addManual() {
  const name = document.getElementById('add-name').value.trim();
  const amt  = parseInt(document.getElementById('add-amount').value) || 0;
  const type = document.getElementById('add-type').value;

  if (!name)    { showToast('กรุณาใส่ชื่อผู้ชม'); return; }
  if (amt <= 0) { showToast('กรุณาใส่จำนวน'); return; }

  const kicks = type === 'baht' ? bahtToKicks(amt) : coinToKicks(amt);
  if (kicks <= 0) { showToast(`ต้องการอย่างน้อย ${RATE.COINS_PER_KICK} เหรียญ = 1 เตะ`); return; }

  addToQueue(name, kicks, type === 'baht' ? 'donation' : 'gift');
  document.getElementById('add-name').value   = '';
  document.getElementById('add-amount').value = '';
  document.getElementById('add-name').focus();
}

// ─────────────────────────────────────────────
//  Render UI
// ─────────────────────────────────────────────
function render() {
  const totalQ = queue.reduce((a, q) => a + q.kicks, 0);
  document.getElementById('s-queue').textContent    = totalQ;
  document.getElementById('s-total').textContent    = totalKicks;
  document.getElementById('s-members').textContent  = queue.length;
  document.getElementById('queue-count').textContent = queue.length;
  document.getElementById('done-count').textContent  = done.length;
  renderQueue();
  renderDone();
}

function renderQueue() {
  const ql = document.getElementById('queue-list');
  if (queue.length === 0) {
    ql.innerHTML = '<div class="empty">ยังไม่มีคิว — รอ donation หรือเพิ่มเอง</div>';
    return;
  }
  ql.innerHTML = queue.map((q, i) => {
    const [bg, fg] = colorFor(q.name);
    const isFirst  = i === 0;
    const dots     = Math.min(q.kicks, 10);
    const dotsHtml = Array.from({ length: dots }, (_, j) =>
      `<div class="kdot${j === 0 && isFirst ? ' full' : ''}"></div>`
    ).join('');
    const extra   = q.kicks > 10
      ? `<span style="font-size:11px;color:var(--text3);font-family:'IBM Plex Mono',monospace">+${q.kicks - 10}</span>`
      : '';
    const srcIcon = q.source === 'donation' ? '💵' : q.source === 'gift' ? '🪙' : '✏️';
    return `
      <div class="q-item${isFirst ? ' first' : ''}">
        <div class="q-rank${isFirst ? ' first-rank' : ''}">${isFirst ? '▶' : i + 1}</div>
        <div class="avatar" style="background:${bg};color:${fg}">${initials(q.name)}</div>
        <div class="q-name" title="${q.name}">${q.name}</div>
        <div class="q-source">${srcIcon}</div>
        <div class="kick-dots">${dotsHtml}${extra}</div>
        <div class="kick-count">${q.kicks} เตะ</div>
        <div class="q-actions">
          <button class="btn-sm${isFirst ? ' btn-green' : ''}" onclick="useKick(${i})">ใช้ 1 เตะ</button>
          <button class="btn-sm btn-danger" onclick="removeFromQueue(${i})" title="ลบออกจากคิว">✕</button>
        </div>
      </div>`;
  }).join('');
}

function renderDone() {
  const ds = document.getElementById('done-section');
  const dl = document.getElementById('done-list');
  if (done.length === 0) { ds.style.display = 'none'; return; }
  ds.style.display = 'block';
  dl.innerHTML = done.slice().reverse().map(d => {
    const [bg, fg] = colorFor(d.name);
    return `
      <div class="done-item">
        <div class="avatar" style="width:28px;height:28px;font-size:11px;background:${bg};color:${fg}">${initials(d.name)}</div>
        <span class="done-name">${d.name}</span>
        <span class="done-tag">เตะทั้งหมด ${d.total} ครั้ง</span>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  Toast notification
// ─────────────────────────────────────────────
function showToast(msg, isGreen = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isGreen ? ' green-toast' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2500);
}

// ─────────────────────────────────────────────
//  WebSocket (Tikfinity)
// ─────────────────────────────────────────────
function getPort() { return parseInt(document.getElementById('port-input').value) || 8765; }

function toggleWS() {
  if (wsConnected) { disconnectWS(); } else { connectWS(); }
}

function connectWS() {
  const port = getPort();
  document.getElementById('port-disp').textContent = port;
  try {
    ws = new WebSocket(`ws://localhost:${port}`);
    ws.onopen    = () => setConn(true);
    ws.onclose   = () => setConn(false);
    ws.onerror   = () => setConn(false);
    ws.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (_) {} };
  } catch (_) { setConn(false); }
}

function disconnectWS() {
  if (ws) { ws.close(); ws = null; }
  setConn(false);
}

function setConn(on) {
  wsConnected = on;
  document.getElementById('conn-dot').className    = 'status-dot' + (on ? ' on' : '');
  document.getElementById('conn-label').textContent = on ? 'เชื่อมแล้ว ✓' : 'ยังไม่เชื่อม';
  const btn = document.getElementById('ws-btn');
  btn.textContent = on ? 'ตัดการเชื่อม' : 'เชื่อม';
  btn.className   = 'btn-sm ' + (on ? 'btn-disconnect' : 'btn-connect');
}

// ─────────────────────────────────────────────
//  แปลง Tikfinity event → addToQueue
//  แก้ตรงนี้ถ้า field ชื่อต่างออกไป
// ─────────────────────────────────────────────
function handleEvent(d) {
  const type = (d.type || d.event || '').toLowerCase();
  const name = d.nickname || d.username || d.user || d.displayName || d.name || 'ผู้ชม';

  if (type.includes('gift') || type.includes('coin')) {
    const coins = (d.diamondCount || d.coins || d.amount || 0)
                * (d.repeatCount  || d.count  || 1);
    addToQueue(name, coinToKicks(coins), 'gift');
  } else if (type.includes('donation') || type.includes('payment') || type.includes('subscribe')) {
    const baht = d.amount || d.value || 0;
    addToQueue(name, bahtToKicks(baht), 'donation');
  }
}

// ─────────────────────────────────────────────
//  Keyboard shortcuts
// ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter' && queue.length > 0) useKick(0);
});
document.getElementById('add-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-amount').focus();
});
document.getElementById('add-amount').addEventListener('keydown', e => {
  if (e.key === 'Enter') addManual();
});

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────
loadQueue().then(render);
