/* ═══════════════════════════════════════════════════════════
   VOICE BATTLE MINI APP — app.js
   Telegram WebApp SDK + Vanilla JS
════════════════════════════════════════════════════════════ */

'use strict';

// ─── Telegram WebApp init ────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();
}

const tgUser    = tg?.initDataUnsafe?.user || null;
const initData  = tg?.initData || '';

// ─── Base API URL (same origin as the page) ──────────────────
const API_BASE = window.location.origin;

// ─── State ───────────────────────────────────────────────────
let profileData = null;
let channelChecked = false;

// ─── Helpers ─────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function setHTML(id, html) {
  const e = el(id);
  if (e) e.innerHTML = html;
}

function setText(id, text) {
  const e = el(id);
  if (e) e.textContent = text;
}

function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

function getInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function pct(cur, target) {
  if (!target) return 0;
  return Math.min(100, Math.round((cur / target) * 100));
}

// ─── API fetch wrapper ────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData,
    ...(options.headers || {}),
  };
  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json();
  return data;
}

// ─── Tab switching ────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(s => {
    s.classList.toggle('active', s.id === 'tab-' + tabId);
  });

  if (tabId === 'battles' && profileData) renderBattles(profileData.battles);
}

window.switchTab = switchTab;

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ─── Load profile ────────────────────────────────────────────
async function loadProfile() {
  try {
    const data = await apiFetch('/api/profile');

    if (!data.success) throw new Error(data.error || 'Xato');

    profileData = data;
    renderProfile(data);
    renderBattles(data.battles);
  } catch (e) {
    console.error('[loadProfile]', e);
    // fallback to tgUser
    if (tgUser) renderProfileFallback(tgUser);
  }
}

function renderProfile(data) {
  const { user, stats, battles } = data;
  const initial = getInitial(user.first_name || user.username);

  // Header
  el('userAvatar').textContent  = initial;
  setText('headerName', user.first_name || user.username || '—');
  setText('headerSub',  user.username ? '@' + user.username : 'ID: ' + user.id);
  setText('balanceVal', user.balance || 0);

  // Profile tab
  el('profileAvatar').textContent = initial;
  setText('profileName',   user.first_name || user.username || '—');
  setText('profileHandle', user.username ? '@' + user.username : 'ID: ' + user.id);

  setText('infoId',      user.id);
  setText('infoBalance', (user.balance || 0) + ' 💎');
  setText('infoTotal',   stats.total_battles);
  setText('infoActive',  stats.active_battles);

  // Load global stats
  loadGlobalStats();
}

function renderProfileFallback(u) {
  const initial = getInitial(u.first_name || u.username);
  el('userAvatar').textContent  = initial;
  setText('headerName', u.first_name || u.username || '—');
  setText('headerSub',  u.username ? '@' + u.username : 'ID: ' + u.id);
  el('profileAvatar').textContent = initial;
  setText('profileName',   u.first_name || u.username || '—');
  setText('profileHandle', u.username ? '@' + u.username : 'ID: ' + u.id);
  setText('infoId',      u.id);
  setText('infoBalance', '0 💎');
  setText('infoTotal',   '0');
  setText('infoActive',  '0');
  loadGlobalStats();
}

async function loadGlobalStats() {
  try {
    const d = await apiFetch('/api/stats');
    if (d.success) {
      setText('statUsers',   d.users   || 0);
      setText('statBattles', d.battles || 0);
      setText('statActive',  d.active  || 0);
    }
  } catch (e) {}
}

// ─── Render battles list ─────────────────────────────────────
function renderBattles(battles) {
  const list  = el('battlesList');
  const empty = el('battlesEmpty');
  const sub   = el('battlesSubtitle');

  if (!battles || battles.length === 0) {
    hide('battlesList');
    show('battlesEmpty');
    setText('battlesSubtitle', 'Hali battle yo\'q');
    return;
  }

  hide('battlesEmpty');
  show('battlesList');
  setText('battlesSubtitle', `Jami: ${battles.length} ta`);

  list.innerHTML = battles.map(b => {
    const progress = pct(b.current_votes, b.target_votes);
    const isActive = b.active;
    return `
      <div class="battle-card ${isActive ? 'active-card' : ''}">
        <div class="battle-card-top">
          <div class="battle-card-name">${escapeHtml(b.battle_name)}</div>
          <div class="battle-status ${isActive ? 'active' : 'done'}">
            ${isActive ? '⚡ Faol' : '✅ Tugagan'}
          </div>
        </div>
        <div class="battle-channel">${escapeHtml(b.channel_id)}</div>
        <div class="battle-progress-wrap">
          <div class="battle-progress-bar">
            <div class="battle-progress-fill" style="width:${progress}%"></div>
          </div>
          <div class="battle-progress-text">
            <span>${b.current_votes} ovoz</span>
            <span>${progress}% / ${b.target_votes} maqsad</span>
          </div>
        </div>
        <div class="battle-reward">🎁 ${escapeHtml(b.reward)}</div>
        <div class="battle-date">📅 ${formatDate(b.created_at)}</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Channel check ────────────────────────────────────────────
el('checkChannelBtn').addEventListener('click', async () => {
  const channel = el('f-channel').value.trim();
  const hint    = el('channelStatus');
  const btn     = el('checkChannelBtn');

  if (!channel) {
    hint.textContent = '❌ Kanal username kiriting';
    hint.className   = 'field-hint err';
    return;
  }

  btn.disabled     = true;
  btn.textContent  = '…';
  hint.textContent = '⏳ Tekshirilmoqda…';
  hint.className   = 'field-hint checking';
  channelChecked   = false;

  try {
    const data = await apiFetch('/api/check-channel', {
      method: 'POST',
      body:   JSON.stringify({ channel }),
    });

    if (data.success) {
      hint.textContent = '✅ Bot kanalda admin!';
      hint.className   = 'field-hint ok';
      channelChecked   = true;
    } else {
      hint.textContent = '❌ ' + (data.error || 'Bot admin emas');
      hint.className   = 'field-hint err';
    }
  } catch (e) {
    hint.textContent = '❌ Tarmoq xatosi';
    hint.className   = 'field-hint err';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Tekshir';
  }
});

// Auto-check when channel input changes
el('f-channel').addEventListener('input', () => {
  channelChecked = false;
  el('channelStatus').textContent = '';
  el('channelStatus').className   = 'field-hint';
});

// ─── Image URL preview ────────────────────────────────────────
el('f-image').addEventListener('input', () => {
  const url = el('f-image').value.trim();
  if (url) {
    el('previewImg').src  = url;
    el('previewImg').onload = () => show('imagePreview');
    el('previewImg').onerror = () => hide('imagePreview');
  } else {
    hide('imagePreview');
  }
});

el('removeImage').addEventListener('click', () => {
  el('f-image').value = '';
  hide('imagePreview');
});

// ─── Create battle form ───────────────────────────────────────
el('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hide('createError');

  const battleName = el('f-name').value.trim();
  const channelId  = el('f-channel').value.trim();
  const targetVotes = parseInt(el('f-target').value);
  const reward     = el('f-reward').value.trim();
  const buttonText = el('f-button').value.trim() || '🔥 Ovoz berish';
  const imageUrl   = el('f-image').value.trim() || null;

  // Client-side validation
  if (!battleName) return showFormError('Battle nomi kerak!');
  if (!channelId)  return showFormError('Kanal username kerak!');
  if (!targetVotes || targetVotes < 1) return showFormError('Maqsad ovozlar sonini kiriting!');
  if (!reward)     return showFormError('Mukofot matnini kiriting!');

  if (!channelChecked) {
    return showFormError('Iltimos, avval kanal tekshirilsin ✓ tugmasini bosing!');
  }

  // UI loading state
  const btn      = el('createBtn');
  const btnText  = el('createBtnText');
  const spinner  = el('createSpinner');
  btn.disabled   = true;
  hide('createBtnText');
  show('createSpinner');

  // Haptic feedback
  tg?.HapticFeedback?.impactOccurred('medium');

  try {
    const data = await apiFetch('/api/create-battle', {
      method: 'POST',
      body: JSON.stringify({ battleName, channelId, targetVotes, reward, buttonText, imageUrl }),
    });

    if (!data.success) throw new Error(data.error || 'Yaratishda xato');

    // Success!
    tg?.HapticFeedback?.notificationOccurred('success');
    showSuccessModal(data.battle);
    el('createForm').reset();
    hide('imagePreview');
    channelChecked = false;
    el('channelStatus').textContent = '';
    el('channelStatus').className   = 'field-hint';

    // Reload profile data
    await loadProfile();

  } catch (err) {
    tg?.HapticFeedback?.notificationOccurred('error');
    showFormError(err.message);
  } finally {
    btn.disabled = false;
    show('createBtnText');
    hide('createSpinner');
  }
});

function showFormError(msg) {
  const e = el('createError');
  e.textContent = '❌ ' + msg;
  show('createError');
  e.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Success modal ────────────────────────────────────────────
function showSuccessModal(battle) {
  setText('modalText', 'Kanalga post muvaffaqiyatli yuborildi!');
  el('modalDetails').innerHTML = `
    <div><strong>🎤 Nomi:</strong> ${escapeHtml(battle.battle_name)}</div>
    <div><strong>📢 Kanal:</strong> ${escapeHtml(battle.channel_id)}</div>
    <div><strong>🎯 Maqsad:</strong> ${battle.target_votes} ovoz</div>
    <div><strong>🎁 Mukofot:</strong> ${escapeHtml(battle.reward)}</div>
    <div><strong>🆔 Battle ID:</strong> <code>${battle.id}</code></div>
  `;
  show('successModal');
}

function closeModal() {
  hide('successModal');
  switchTab('battles');
}
window.closeModal = closeModal;

// Close modal on backdrop click
el('successModal').addEventListener('click', (e) => {
  if (e.target === el('successModal') || e.target.classList.contains('modal-backdrop')) {
    closeModal();
  }
});

// ─── Boot ─────────────────────────────────────────────────────
async function boot() {
  // Hide loader, show main after init
  await loadProfile();

  // Animate transition
  el('loader').style.opacity = '0';
  setTimeout(() => {
    hide('loader');
    show('main');
  }, 400);

  // Apply Telegram theme color if available
  if (tg?.themeParams?.bg_color) {
    document.documentElement.style.setProperty(
      '--tg-theme-bg-color', tg.themeParams.bg_color
    );
  }
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
