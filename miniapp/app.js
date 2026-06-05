'use strict';

// ─── Telegram WebApp ──────────────────────────────────────────
const tg       = window.Telegram?.WebApp;
const tgUser   = tg?.initDataUnsafe?.user || null;
const initData = tg?.initData || '';

if (tg) { tg.ready(); tg.expand(); tg.enableClosingConfirmation(); }

const API = window.location.origin;

// ─── State ────────────────────────────────────────────────────
let profileData  = null;
let userChannels = [];

// ─── DOM helpers ─────────────────────────────────────────────
const el       = id => document.getElementById(id);
const show     = id => el(id)?.classList.remove('hidden');
const hide     = id => el(id)?.classList.add('hidden');
const setText  = (id, t) => { const e = el(id); if (e) e.textContent = t; };

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function pct(cur, tgt) {
  return tgt ? Math.min(100, Math.round(cur/tgt*100)) : 0;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uz-UZ', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function medal(i) {
  return i===0?'🥇': i===1?'🥈': i===2?'🥉': `${i+1}.`;
}

// ─── API helper ───────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type':'application/json', 'X-Telegram-Init-Data': initData, ...(opts.headers||{}) }
  });
  return r.json();
}

// ═══════════════════════════════════════════════════════════
//   TAB SWITCHING
// ═══════════════════════════════════════════════════════════
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tabId));
  if (tabId === 'channels')  renderChannelsTab();
  if (tabId === 'mybattles') renderMyBattles();
  if (tabId === 'home')      loadActiveBattles();
  if (tabId === 'create')    refreshChannelSelect();
}
window.switchTab = switchTab;
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// ═══════════════════════════════════════════════════════════
//   PROFILE LOAD
// ═══════════════════════════════════════════════════════════
async function loadProfile() {
  try {
    const d = await api('/api/profile');
    if (!d.success) throw new Error(d.error);
    profileData  = d;
    userChannels = d.channels || [];
    renderHeader(d.user, d.stats);
    refreshChannelSelect();
  } catch (e) {
    if (tgUser) renderHeaderFallback(tgUser);
  }
}

function renderHeader(user, stats) {
  const init = (user.first_name || user.username || '?')[0].toUpperCase();
  el('userAvatar').textContent = init;
  setText('headerName', user.first_name || user.username || '—');
  setText('headerSub',  user.username ? '@'+user.username : 'ID:'+user.id);
  el('activeBadge').textContent = `⚡ ${stats.active_battles}`;
}

function renderHeaderFallback(u) {
  el('userAvatar').textContent = (u.first_name||u.username||'?')[0].toUpperCase();
  setText('headerName', u.first_name || u.username || '—');
  setText('headerSub',  u.username ? '@'+u.username : 'ID:'+u.id);
}

// ═══════════════════════════════════════════════════════════
//   GLOBAL STATS
// ═══════════════════════════════════════════════════════════
async function loadStats() {
  try {
    const d = await api('/api/stats');
    if (d.success) {
      setText('statUsers',  d.users  || 0);
      setText('statActive', d.active || 0);
      setText('statVotes',  d.votes  || 0);
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
//   ACTIVE BATTLES
// ═══════════════════════════════════════════════════════════
async function loadActiveBattles() {
  setText('homeSubtitle', 'Yuklanmoqda…');
  try {
    const d = await api('/api/active-battles');
    if (!d.success) throw new Error(d.error);
    const battles = d.battles || [];
    setText('homeSubtitle', `${battles.length} ta faol battle`);
    if (!battles.length) { show('homeEmpty'); hide('homeList'); return; }
    hide('homeEmpty'); show('homeList');
    el('homeList').innerHTML = battles.map(b => battleCard(b)).join('');
    el('homeList').querySelectorAll('.battle-card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
  } catch(e) {
    setText('homeSubtitle', 'Yuklab bo\'lmadi');
  }
}

function battleCard(b) {
  const p = pct(b.current_votes, b.target_votes);
  const top = (b.top3||[]).map((u,i) => `${medal(i)} @${esc(u.username||'noname')} — ${u.votes}`).join(' &nbsp;');
  return `
    <div class="battle-card active-card" data-id="${esc(b.id)}" style="cursor:pointer">
      <div class="battle-card-top">
        <div class="battle-card-name">${esc(b.battle_name)}</div>
        <div class="battle-status active">⚡ Faol</div>
      </div>
      <div class="battle-channel">${esc(b.channel_id)}</div>
      <div class="battle-progress-wrap">
        <div class="battle-progress-bar"><div class="battle-progress-fill" style="width:${p}%"></div></div>
        <div class="battle-progress-text"><span>${b.current_votes} ovoz</span><span>${p}% / ${b.target_votes}</span></div>
      </div>
      ${top ? `<div style="font-size:12px;color:var(--text-sub);margin-top:6px">${top}</div>` : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//   MY BATTLES
// ═══════════════════════════════════════════════════════════
function renderMyBattles() {
  const battles = profileData?.battles || [];
  setText('mySubtitle', `Jami: ${battles.length} ta`);
  if (!battles.length) { show('myEmpty'); hide('myList'); return; }
  hide('myEmpty'); show('myList');
  el('myList').innerHTML = battles.map(b => {
    const p = pct(b.current_votes, b.target_votes);
    return `
      <div class="battle-card ${b.active?'active-card':''}">
        <div class="battle-card-top">
          <div class="battle-card-name">${esc(b.battle_name)}</div>
          <div class="battle-status ${b.active?'active':'done'}">${b.active?'⚡ Faol':'✅ Tugagan'}</div>
        </div>
        <div class="battle-channel">${esc(b.channel_id)}</div>
        <div class="battle-progress-wrap">
          <div class="battle-progress-bar"><div class="battle-progress-fill" style="width:${p}%"></div></div>
          <div class="battle-progress-text"><span>${b.current_votes} ovoz</span><span>${p}% / ${b.target_votes}</span></div>
        </div>
        <div class="battle-reward">🎁 ${esc(b.reward)}</div>
        <div class="battle-date">📅 ${fmtDate(b.created_at)}</div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//   CHANNELS TAB
// ═══════════════════════════════════════════════════════════
function renderChannelsTab() {
  if (!userChannels.length) { show('channelsEmpty'); hide('channelsList'); return; }
  hide('channelsEmpty'); show('channelsList');
  el('channelsList').innerHTML = userChannels.map(c => `
    <div class="channel-card">
      <div class="channel-card-info">
        <div class="channel-card-title">${esc(c.title||c.channel_id)}</div>
        <div class="channel-card-id">${esc(c.channel_id)}</div>
        <div class="channel-card-date">📅 ${fmtDate(c.added_at)}</div>
      </div>
      <span style="font-size:20px">✅</span>
    </div>`).join('');
}

// Kanal qo'shish
el('addChannelBtn').addEventListener('click', async () => {
  const inp    = el('ch-input');
  const hint   = el('chStatus');
  const ch     = inp.value.trim();
  const btn    = el('addChannelBtn');
  if (!ch) { hint.textContent='❌ Kanal kiriting'; hint.className='field-hint err'; return; }

  btn.disabled=true; btn.textContent='…';
  hint.textContent='⏳ Tekshirilmoqda…'; hint.className='field-hint checking';

  try {
    const d = await api('/api/add-channel', { method:'POST', body: JSON.stringify({ channel: ch }) });
    if (d.success) {
      hint.textContent = d.already ? 'ℹ️ Allaqachon qo\'shilgan' : `✅ ${d.channel.title} qo\'shildi!`;
      hint.className   = 'field-hint ok';
      inp.value        = '';
      if (!d.already) {
        userChannels.push(d.channel);
        renderChannelsTab();
        refreshChannelSelect();
      }
    } else {
      hint.textContent = '❌ ' + (d.error || 'Xato');
      hint.className   = 'field-hint err';
    }
  } catch(e) {
    hint.textContent='❌ Tarmoq xatosi'; hint.className='field-hint err';
  } finally {
    btn.disabled=false; btn.textContent='Qo\'shish';
  }
});

// ═══════════════════════════════════════════════════════════
//   CREATE TAB — channel select
// ═══════════════════════════════════════════════════════════
function refreshChannelSelect() {
  const sel  = el('f-channel');
  const hint = el('channelHint');
  sel.innerHTML = '<option value="">— Kanal tanlang —</option>';
  if (!userChannels.length) {
    hint.textContent = '⚠️ Avval "Kanallar" bo\'limida kanal qo\'shing';
    hint.className   = 'field-hint err';
    return;
  }
  userChannels.forEach(c => {
    const opt = document.createElement('option');
    opt.value       = c.channel_id;
    opt.textContent = `${c.title||c.channel_id} (${c.channel_id})`;
    sel.appendChild(opt);
  });
  hint.textContent = `${userChannels.length} ta kanal mavjud`;
  hint.className   = 'field-hint ok';
}

// Image preview
el('f-image').addEventListener('input', () => {
  const url = el('f-image').value.trim();
  if (url) {
    el('previewImg').src    = url;
    el('previewImg').onload = () => show('imagePreview');
    el('previewImg').onerror= () => hide('imagePreview');
  } else {
    hide('imagePreview');
  }
});
el('removeImage').addEventListener('click', () => { el('f-image').value=''; hide('imagePreview'); });

// ─── CREATE SUBMIT ────────────────────────────────────────────
el('createBtn').addEventListener('click', async () => {
  hide('createError');
  const battleName  = el('f-name').value.trim();
  const channelId   = el('f-channel').value;
  const targetVotes = parseInt(el('f-target').value);
  const reward      = el('f-reward').value.trim();
  const imageUrl    = el('f-image').value.trim() || null;

  if (!battleName)   return showErr('Battle nomi kerak!');
  if (!channelId)    return showErr('Kanal tanlang!');
  if (!targetVotes || targetVotes<1) return showErr('Maqsad ovozlar sonini kiriting!');
  if (!reward)       return showErr('Sovrin matnini kiriting!');

  const btn = el('createBtn');
  btn.disabled = true;
  hide('createBtnText'); show('createSpinner');
  tg?.HapticFeedback?.impactOccurred('medium');

  try {
    const d = await api('/api/create-battle', {
      method: 'POST',
      body: JSON.stringify({ battleName, channelId, targetVotes, reward, imageUrl })
    });
    if (!d.success) throw new Error(d.error || 'Yaratishda xato');
    tg?.HapticFeedback?.notificationOccurred('success');
    showSuccess(d.battle);
    // Reset form
    el('f-name').value=''; el('f-channel').value=''; el('f-target').value='';
    el('f-reward').value=''; el('f-image').value=''; hide('imagePreview');
    // Refresh profile
    await loadProfile();
  } catch(e) {
    tg?.HapticFeedback?.notificationOccurred('error');
    showErr(e.message);
  } finally {
    btn.disabled=false; show('createBtnText'); hide('createSpinner');
  }
});

function showErr(msg) {
  const e = el('createError');
  e.textContent = '❌ ' + msg;
  show('createError');
  e.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ═══════════════════════════════════════════════════════════
//   DETAIL MODAL
// ═══════════════════════════════════════════════════════════
async function openDetail(battleId) {
  show('detailModal');
  el('detailContent').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-sub)">⏳ Yuklanmoqda…</div>';

  try {
    const d = await api(`/api/battle/${battleId}`);
    if (!d.success) throw new Error(d.error);
    const b  = d.battle;
    const p  = pct(b.current_votes, b.target_votes);
    const top = (d.top||[]).map((u,i) =>
      `<div class="rating-row"><span>${medal(i)} @${esc(u.username||'noname')}</span><span><b>${u.votes}</b> 📦</span></div>`
    ).join('');

    const me = d.my_participation;
    let joinBlock = '';
    if (!b.active) {
      joinBlock = `<div class="error-msg" style="margin:0">✅ Battle yakunlangan</div>`;
    } else if (me?.joined) {
      joinBlock = `
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:6px">🔗 Sizning referal havolangiz:</div>
        <div class="ref-box">${esc(me.ref_link)}</div>
        <button class="copy-btn" onclick="copyRef('${esc(me.ref_link)}')">📋 Nusxa olish</button>
        <div style="font-size:12px;color:var(--green);text-align:center">✅ Battleda ishtirok etyapsiz — ${me.votes} ovoz</div>`;
    } else {
      joinBlock = `<button class="join-btn" id="joinBtn_${esc(b.id)}" onclick="joinBattle('${esc(b.id)}')">➕ Battlega qo'shilish</button>`;
    }

    el('detailContent').innerHTML = `
      <div class="detail-title">${esc(b.battle_name)}</div>
      <div class="detail-channel">📢 ${esc(b.channel_id)}</div>
      <div class="detail-progress">
        <div class="battle-progress-bar"><div class="battle-progress-fill" style="width:${p}%"></div></div>
        <div class="battle-progress-text" style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-sub);margin-top:5px">
          <span>${b.current_votes} ovoz</span><span>${p}% / ${b.target_votes}</span>
        </div>
      </div>
      <div class="detail-reward">🎁 <b>Sovrin:</b><br>${esc(b.reward)}</div>
      <div class="detail-rating">
        <h4>📈 Reyting (Top 10)</h4>
        ${top || '<div style="font-size:13px;color:var(--text-muted)">Hali ishtirokchi yo\'q</div>'}
      </div>
      ${joinBlock}`;
  } catch(e) {
    el('detailContent').innerHTML = `<div class="error-msg">❌ ${esc(e.message)}</div>`;
  }
}

function closeDetail() { hide('detailModal'); }
window.closeDetail = closeDetail;
window.openDetail  = openDetail;

async function joinBattle(battleId) {
  const btn = el(`joinBtn_${battleId}`);
  if (btn) { btn.disabled=true; btn.textContent='⏳ Qo\'shilmoqda…'; }
  tg?.HapticFeedback?.impactOccurred('light');
  try {
    const d = await api('/api/join-battle', { method:'POST', body: JSON.stringify({ battleId }) });
    if (!d.success) throw new Error(d.error);
    // Refresh detail
    await openDetail(battleId);
  } catch(e) {
    if (btn) { btn.disabled=false; btn.textContent='➕ Battlega qo\'shilish'; }
    alert('❌ ' + e.message);
  }
}
window.joinBattle = joinBattle;

function copyRef(link) {
  navigator.clipboard?.writeText(link).then(() => {
    tg?.HapticFeedback?.notificationOccurred('success');
  }).catch(() => {});
}
window.copyRef = copyRef;

// ═══════════════════════════════════════════════════════════
//   SUCCESS MODAL
// ═══════════════════════════════════════════════════════════
function showSuccess(battle) {
  el('modalDetails').innerHTML = `
    <div><b>🎤 Nomi:</b> ${esc(battle.battle_name)}</div>
    <div><b>📢 Kanal:</b> ${esc(battle.channel_id)}</div>
    <div><b>🎯 Maqsad:</b> ${battle.target_votes} ovoz</div>
    <div><b>🆔 ID:</b> <code>${esc(battle.id)}</code></div>`;
  show('successModal');
}

function closeSuccess() {
  hide('successModal');
  switchTab('mybattles');
}
window.closeSuccess = closeSuccess;

el('successModal').addEventListener('click', e => {
  if (e.target === el('successModal') || e.target.classList.contains('modal-backdrop')) closeSuccess();
});

// ═══════════════════════════════════════════════════════════
//   BOOT
// ═══════════════════════════════════════════════════════════
async function boot() {
  await Promise.all([loadProfile(), loadStats(), loadActiveBattles()]);
  el('loader').style.opacity = '0';
  setTimeout(() => { hide('loader'); show('main'); }, 350);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
