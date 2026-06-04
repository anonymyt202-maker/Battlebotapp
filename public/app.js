/* ══════════════════════════════════════════════════
   app.js  —  Telegram Mini App frontend bridge
══════════════════════════════════════════════════ */

const tg = window.Telegram?.WebApp || null;
const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
let initData = '';
let tgUser = null;

if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation?.();

  initData = tg.initData || '';
  tgUser = tg.initDataUnsafe?.user || null;

  if (tg.themeParams) {
    const root = document.documentElement.style;
    const tp = tg.themeParams;
    root.setProperty('--tg-bg', tp.bg_color || '#1a1a2e');
    root.setProperty('--tg-second', tp.secondary_bg_color || '#16213e');
    root.setProperty('--tg-text', tp.text_color || '#eaeaea');
    root.setProperty('--tg-hint', tp.hint_color || '#8b8fa8');
    root.setProperty('--tg-button', tp.button_color || '#5865f2');
    root.setProperty('--tg-btn-txt', tp.button_text_color || '#ffffff');
  }
} else {
  console.warn('[TG] WebApp topilmadi. Lokal rejimda ishlayapti.');
}

if (!initData && (isLocalDev || new URLSearchParams(location.search).get('dev') === '1')) {
  initData = 'dev_mode';
}

const state = {
  user: null,
  battles: [],
  filteredBattles: [],
  currentFilter: 'all',
  channelValid: false,
  stats: null,
  modalCallback: null,
};

async function api(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'x-init-data': initData || 'dev_mode',
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(path, options);
    return await res.json();
  } catch (err) {
    console.error('[API]', method, path, err);
    return { ok: false, error: err.message };
  }
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showChannelStatus(msg, type) {
  const el = document.getElementById('channelStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `channel-status ${type}`;
  el.classList.remove('hidden');
}

function renderUser(user) {
  const nameEl = document.getElementById('userName');
  const idEl = document.getElementById('userId');
  const avatar = document.getElementById('userAvatar');
  if (!nameEl || !idEl || !avatar) return;

  nameEl.textContent = user.firstName || user.username || 'Foydalanuvchi';
  idEl.textContent = `#${user.id}`;

  const photoUrl = tgUser?.photo_url || user.photoUrl;
  if (photoUrl) {
    avatar.innerHTML = `<img src="${photoUrl}" alt="avatar" onerror="this.parentElement.textContent='${(user.firstName || 'U')[0].toUpperCase()}'">`;
  } else {
    avatar.textContent = (user.firstName || user.username || 'U')[0].toUpperCase();
  }

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('statCreated', user.createdBattles || 0);
  set('statActive', user.activeBattles || 0);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');

  const tab = document.querySelector(`[data-page="${name}"]`);
  if (tab) tab.classList.add('active');

  if (name === 'battles') loadBattles();
  if (name === 'stats') loadStats();
  if (name === 'admin') loadAdminData();

  tg?.HapticFeedback?.selectionChanged?.();
}

async function init() {
  try {
    const res = await api('GET', '/api/user');
    if (res.ok) {
      state.user = res.user;
      renderUser(res.user);
      const adminBtn = document.getElementById('adminBtn');
      if (adminBtn && res.user.isAdmin) adminBtn.classList.remove('hidden');
    } else {
      showToast(`⚠️ ${res.error || 'Ma\'lumotlar yuklanmadi'}`, 'error');
    }

    await loadStats();

    const params = new URLSearchParams(location.search);
    if (params.get('admin') === '1' && state.user?.isAdmin) {
      showPage('admin');
    }
  } catch (err) {
    showToast(`❌ Ulanishda xato: ${err.message}`, 'error');
  } finally {
    setTimeout(() => {
      const ls = document.getElementById('loadingScreen');
      const app = document.getElementById('app');
      if (ls) ls.classList.add('hidden');
      if (app) app.classList.remove('hidden');
    }, 400);
  }
}

async function loadStats() {
  const res = await api('GET', '/api/stats');
  if (!res.ok) return;
  state.stats = res.stats;

  const s = res.stats;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
  };

  set('qTotal', s.totalBattles);
  set('qActive', s.activeBattles);
  set('qUsers', s.totalUsers);
  set('qVotes', s.totalVotes);
  set('statTotal', s.totalBattles);

  const statsContent = document.getElementById('statsContent');
  if (statsContent) {
    statsContent.innerHTML = [
      ['🎤', s.totalBattles, 'Jami Battlelar'],
      ['🟢', s.activeBattles, 'Faol Battlelar'],
      ['✅', s.finishedBattles, 'Yakunlangan'],
      ['👥', s.totalUsers, 'Foydalanuvchilar'],
      ['📦', s.totalVotes, 'Jami Ovozlar'],
      ['🚫', s.bannedUsers, 'Bloklangan'],
    ].map(([icon, num, label]) => `
      <div class="stat-card glass">
        <div class="stat-icon">${icon}</div>
        <div class="stat-body">
          <div class="stat-card-num">${num}</div>
          <div class="stat-card-label">${label}</div>
        </div>
      </div>
    `).join('');
  }
}

async function loadBattles() {
  const list = document.getElementById('battlesList');
  if (!list) return;

  list.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="margin:0 auto"></div></div>`;

  const res = await api('GET', '/api/battles');
  if (!res.ok) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Yuklab bo'lmadi</p>
        <button class="btn btn-ghost mt-1" onclick="loadBattles()">Qayta urinish</button>
      </div>`;
    return;
  }

  state.battles = res.battles || [];
  filterBattles(state.currentFilter);
}

function filterBattles(filter, btnEl) {
  state.currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  else document.querySelector(`[data-filter="${filter}"]`)?.classList.add('active');

  let filtered = [...state.battles];
  if (filter === 'active') filtered = filtered.filter(b => b.active && !b.finished);
  if (filter === 'finished') filtered = filtered.filter(b => b.finished);
  state.filteredBattles = filtered;
  renderBattles(filtered);
}

function renderBattles(battles) {
  const list = document.getElementById('battlesList');
  if (!list) return;

  if (battles.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎤</div>
        <p>${state.battles.length === 0 ? 'Hali battle yo\'q. Birinchisini yarating!' : 'Bu filtrdagi battle yo\'q.'}</p>
        ${state.battles.length === 0 ? '<button class="btn btn-primary mt-1" onclick="showPage(\'create\')">🎤 Yaratish</button>' : ''}
      </div>`;
    return;
  }

  list.innerHTML = battles.map(b => {
    const pct = Math.min(100, Math.floor(((b.voteCount || 0) / (b.target || 1)) * 100));
    const status = b.finished
      ? '<span class="badge badge-done">✅ Yakunlandi</span>'
      : '<span class="badge badge-active">🟢 Aktiv</span>';
    const date = new Date(b.createdAt).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `
      <div class="battle-card glass" onclick="openBattleDetail('${b.battleId}')">
        <div class="battle-card-header">
          <div class="battle-name">${escHtml(b.name)}</div>
          ${status}
        </div>
        <div class="battle-channel">📢 ${escHtml(b.channel)}</div>
        <div class="battle-progress">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="progress-text">
            <span><b>${b.voteCount || 0}</b> / ${b.target} ovoz</span>
            <span>${pct}%</span>
          </div>
        </div>
        <div class="battle-footer">
          <span class="battle-reward">🎁 ${escHtml(String(b.reward || '').slice(0, 40))}</span>
          <span class="battle-date">${date}</span>
        </div>
      </div>`;
  }).join('');
}

function openBattleDetail(battleId) {
  const b = state.battles.find(x => x.battleId === battleId);
  if (!b) return;

  const pct = Math.min(100, Math.floor(((b.voteCount || 0) / (b.target || 1)) * 100));
  const date = new Date(b.createdAt).toLocaleDateString('uz-UZ');

  openModal(
    `🎤 ${escHtml(b.name)}`,
    `
      <div class="detail-row"><span>📢 Kanal</span><b>${escHtml(b.channel)}</b></div>
      <div class="detail-row"><span>🎁 Sovrin</span><b>${escHtml(b.reward)}</b></div>
      <div class="detail-row"><span>📊 Ovozlar</span><b>${b.voteCount || 0} / ${b.target}</b></div>
      <div class="detail-row"><span>📅 Sana</span><b>${date}</b></div>
      <div class="progress-bar mt-1" style="height:10px"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text mt-0-5"><span>Progress</span><span>${pct}%</span></div>
      ${b.active ? `<button class="btn btn-danger btn-full mt-2" onclick="closeBattle('${b.battleId}'); closeModal()">⛔ Battle yopish</button>` : '<p class="text-center text-hint mt-1">Battle yakunlangan</p>'}
    `
  );
}

async function closeBattle(battleId) {
  tg?.HapticFeedback?.impactOccurred?.('medium');
  const res = await api('POST', '/api/admin/close', { battleId });
  if (res.ok) {
    showToast('✅ Battle to\'xtatildi', 'success');
    loadBattles();
    loadStats();
  } else {
    showToast('❌ ' + (res.error || 'Xato'), 'error');
  }
}

async function checkChannel() {
  const ch = document.getElementById('fChannel')?.value.trim();
  const status = document.getElementById('channelStatus');
  const btn = document.getElementById('checkBtn');
  if (!ch) {
    showChannelStatus('⚠️ Kanal username kiriting', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
  }
  if (status) {
    status.className = 'channel-status checking';
    status.textContent = 'Tekshirilmoqda...';
    status.classList.remove('hidden');
  }

  const res = await api('POST', '/api/check-channel', { channel: ch });

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Tekshir';
  }

  if (res.ok && res.isAdmin) {
    state.channelValid = true;
    showChannelStatus(`✅ ${res.channelTitle || ch} — bot admin`, 'success');
    updateCreateBtn();
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } else {
    state.channelValid = false;
    showChannelStatus('❌ ' + (res.error || 'Kanal tekshirishda xato'), 'error');
    updateCreateBtn();
    tg?.HapticFeedback?.notificationOccurred?.('error');
  }
}

function resetChannelStatus() {
  state.channelValid = false;
  document.getElementById('channelStatus')?.classList.add('hidden');
  updateCreateBtn();
}

function updatePreview() {
  const name = document.getElementById('fName')?.value.trim() || '';
  const target = document.getElementById('fTarget')?.value || '';
  const reward = document.getElementById('fReward')?.value.trim() || '';
  const button = document.getElementById('fButton')?.value.trim() || '🗳 Ovoz berish';
  const preview = document.getElementById('previewContent');
  if (!preview) return;

  if (!name && !target && !reward) {
    preview.innerHTML = '<p class="preview-empty">Ma\'lumotlarni kiriting...</p>';
    return;
  }

  preview.innerHTML = `
    <div class="preview-post">
      <div class="preview-title-text">🏆 <b>${escHtml(name) || '...'}</b></div>
      ${reward ? `<div>🎁 <b>Sovrin:</b> ${escHtml(reward)}</div>` : ''}
      ${target ? `<div>🎯 <b>Maqsad:</b> ${escHtml(target)} ta ovoz</div>` : ''}
      <div class="preview-progress">⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%</div>
      <div><b>0</b> / ${escHtml(target || '?')} ovoz</div>
      <div class="preview-btn">${escHtml(button)}</div>
    </div>`;
  updateCreateBtn();
}

function updateCreateBtn() {
  const name = document.getElementById('fName')?.value.trim() || '';
  const target = Number(document.getElementById('fTarget')?.value);
  const reward = document.getElementById('fReward')?.value.trim() || '';
  const btn = document.getElementById('createBtn');
  if (!btn) return;
  const valid = Boolean(name && target >= 1 && target <= 10000 && reward && state.channelValid);
  btn.disabled = !valid;
}

async function createBattle() {
  const name = document.getElementById('fName')?.value.trim();
  const channel = document.getElementById('fChannel')?.value.trim();
  const target = Number(document.getElementById('fTarget')?.value);
  const reward = document.getElementById('fReward')?.value.trim();
  const buttonText = document.getElementById('fButton')?.value.trim() || '🗳 Ovoz berish';
  const imageUrl = document.getElementById('fImage')?.value.trim() || '';

  if (!name || !channel || !target || !reward) {
    showToast('⚠️ Barcha majburiy maydonlarni to\'ldiring', 'error');
    return;
  }
  if (!state.channelValid) {
    showToast('⚠️ Avval kanalni tekshiring', 'error');
    return;
  }

  const btn = document.getElementById('createBtn');
  const status = document.getElementById('createStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Yaratilmoqda...';
  }
  if (status) {
    status.textContent = '';
    status.className = 'create-status';
    status.classList.remove('hidden');
  }

  const res = await api('POST', '/api/create-battle', {
    name, channel, target, reward, buttonText, imageUrl: imageUrl || null,
  });

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🚀 Battle Boshlash';
  }

  if (res.ok) {
    tg?.HapticFeedback?.notificationOccurred?.('success');
    showToast('🎉 Battle muvaffaqiyatli yaratildi!', 'success');
    ['fName', 'fChannel', 'fTarget', 'fReward', 'fImage'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const fButton = document.getElementById('fButton');
    if (fButton) fButton.value = '🗳 Ovoz berish';
    document.getElementById('channelStatus')?.classList.add('hidden');
    const preview = document.getElementById('previewContent');
    if (preview) preview.innerHTML = '<p class="preview-empty">Ma\'lumotlarni kiriting...</p>';
    state.channelValid = false;
    updateCreateBtn();
    setTimeout(() => showPage('battles'), 700);
  } else {
    tg?.HapticFeedback?.notificationOccurred?.('error');
    if (status) {
      status.textContent = '❌ ' + (res.error || 'Xato yuz berdi');
      status.className = 'create-status error';
    }
    showToast('❌ ' + (res.error || 'Battle yaratib bo\'lmadi'), 'error');
  }
}

async function loadAdminData() {
  if (!state.user?.isAdmin) {
    const page = document.getElementById('page-admin');
    if (page) {
      page.querySelector('.page-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🚫</div>
          <p>Admin huquqi yo'q</p>
        </div>`;
    }
    return;
  }

  const res = await api('GET', '/api/admin/stats');
  if (!res.ok) {
    showToast('❌ Admin ma\'lumotlari yuklanmadi', 'error');
    return;
  }

  const s = res.stats;

  const adminStats = document.getElementById('adminStats');
  if (adminStats) {
    adminStats.innerHTML = [
      ['Foydalanuvchilar', s.totalUsers],
      ['Banlangan', s.bannedUsers],
      ['Jami Battlelar', s.totalBattles],
      ['Aktiv', s.activeBattles],
      ['Yakunlangan', s.finishedBattles],
      ['Jami Ovozlar', s.totalVotes],
    ].map(([label, val]) => `
      <div class="admin-stat-item">
        <div class="admin-stat-num">${val}</div>
        <div class="admin-stat-label">${label}</div>
      </div>
    `).join('');
  }

  const adminBattles = document.getElementById('adminBattles');
  if (adminBattles) {
    adminBattles.innerHTML = (res.battles || []).length === 0
      ? '<p class="text-hint">Battle yo\'q</p>'
      : res.battles.slice(0, 20).map(b => `
          <div class="admin-list-item">
            <div class="admin-list-main">
              <span class="admin-list-icon">${b.finished ? '✅' : '🟢'}</span>
              <span class="admin-list-name">${escHtml(String(b.name || '').substring(0, 30))}</span>
            </div>
            <span class="admin-list-val">${b.voteCount || 0}/${b.target}</span>
          </div>
        `).join('');
  }

  const adminUsers = document.getElementById('adminUsers');
  if (adminUsers) {
    adminUsers.innerHTML = (res.users || []).length === 0
      ? '<p class="text-hint">Foydalanuvchi yo\'q</p>'
      : res.users.slice(0, 20).map(u => `
          <div class="admin-list-item">
            <div class="admin-list-main">
              <span class="admin-list-icon">${u.banned ? '🚫' : '👤'}</span>
              <span class="admin-list-name">${escHtml(u.firstName || u.username || String(u.id))}</span>
            </div>
            <button class="btn btn-xs ${u.banned ? 'btn-success' : 'btn-danger'}" onclick="toggleBan(${u.id}, ${!u.banned})">
              ${u.banned ? 'Ochish' : 'Ban'}
            </button>
          </div>
        `).join('');
  }
}

async function sendBroadcast() {
  const text = document.getElementById('broadcastText')?.value.trim() || '';
  const status = document.getElementById('broadcastStatus');
  if (!text) {
    showToast('⚠️ Xabar matni kiriting', 'error');
    return;
  }

  if (status) status.textContent = '⏳ Yuborilmoqda...';

  const res = await api('POST', '/api/admin/broadcast', { text });
  if (res.ok) {
    if (status) status.textContent = `✅ Yuborildi: ${res.sent} | ❌ Xato: ${res.failed}`;
    const ta = document.getElementById('broadcastText');
    if (ta) ta.value = '';
    showToast(`✅ ${res.sent} ta foydalanuvchiga yuborildi`, 'success');
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } else {
    if (status) status.textContent = '❌ ' + (res.error || 'Xato');
    showToast('❌ Broadcast yuborib bo\'lmadi', 'error');
  }
}

async function toggleBan(userId, banned) {
  const res = await api('POST', '/api/admin/ban', { userId, banned });
  if (res.ok) {
    showToast(banned ? '🚫 Foydalanuvchi banlandi' : '✅ Ban olib tashlandi', 'success');
    loadAdminData();
  } else {
    showToast('❌ ' + (res.error || 'Xato'), 'error');
  }
}

function openModal(title, body, callback) {
  const modal = document.getElementById('modal');
  const titleEl = document.getElementById('modalTitle');
  const bodyEl = document.getElementById('modalBody');
  const confirmBtn = document.getElementById('modalConfirm');
  if (!modal || !titleEl || !bodyEl || !confirmBtn) return;

  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  state.modalCallback = callback || null;

  confirmBtn.classList.toggle('hidden', !callback);
  modal.classList.remove('hidden');
  tg?.HapticFeedback?.impactOccurred?.('light');
}

function closeModal() {
  document.getElementById('modal')?.classList.add('hidden');
  state.modalCallback = null;
}

function confirmModal() {
  if (typeof state.modalCallback === 'function') state.modalCallback();
  closeModal();
}

document.addEventListener('DOMContentLoaded', init);
