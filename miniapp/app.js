'use strict';

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const initData = tg?.initData || '';
const apiBase = window.location.origin;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let state = { profile: null, channels: [], battles: [], stats: null };

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData,
  };
}

async function api(path, options = {}) {
  const r = await fetch(apiBase + path, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  return r.json();
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'channels') renderChannels();
  if (name === 'create') fillChannels();
  if (name === 'battles') renderMyBattles();
}
window.switchTab = showTab;

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

async function loadAll() {
  try {
    const [profile, stats, active] = await Promise.all([
      api('/api/profile'),
      api('/api/stats'),
      api('/api/active-battles'),
    ]);

    state.profile = profile;
    state.stats = stats;
    state.battles = active.battles || [];
    state.channels = profile.channels || [];

    $('sub').textContent = profile.user ? (profile.user.username ? '@' + profile.user.username : 'ID: ' + profile.user.id) : '—';
    $('statUsers').textContent = stats.users ?? 0;
    $('statActive').textContent = stats.active ?? 0;
    $('statVotes').textContent = stats.votes ?? 0;

    renderActiveBattles();
    renderChannels();
    renderMyBattles();
    fillChannels();
    renderProfile();
  } catch (e) {
    $('sub').textContent = 'Yuklashda xato';
  }
}

function renderActiveBattles() {
  const root = $('activeBattles');
  if (!state.battles.length) {
    root.innerHTML = `<div class="card"><b>Hozircha faol battle yo‘q</b></div>`;
    return;
  }
  root.innerHTML = state.battles.map(b => `
    <div class="card battle">
      <div class="row between">
        <b>${esc(b.battle_name)}</b>
        <span>${b.current_votes}/${b.target_votes}</span>
      </div>
      <div class="muted">${esc(b.channel_id)}</div>
      <div class="mini-list">
        ${(b.top3 || []).map((p, i) => `<div>${i + 1}. @${esc(p.username || 'user' + p.user_id)} — ${p.votes}</div>`).join('')}
      </div>
    </div>
  `).join('');
}

function renderChannels() {
  const root = $('channelsList');
  if (!state.channels.length) {
    root.innerHTML = `<div class="card"><b>Kanal yo‘q</b></div>`;
    return;
  }
  root.innerHTML = state.channels.map(c => `
    <div class="card">
      <div class="row between">
        <b>${esc(c.title || c.channel_id)}</b>
        <span class="muted">${esc(c.channel_id)}</span>
      </div>
    </div>
  `).join('');
}

function fillChannels() {
  const select = $('channelSelect');
  select.innerHTML = '';
  if (!state.channels.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Avval kanal qo‘shing';
    select.appendChild(opt);
    return;
  }
  for (const c of state.channels) {
    const opt = document.createElement('option');
    opt.value = c.channel_id;
    opt.textContent = c.title || c.channel_id;
    select.appendChild(opt);
  }
}

function renderMyBattles() {
  const root = $('myBattles');
  const battles = state.profile?.battles || [];
  if (!battles.length) {
    root.innerHTML = `<div class="card"><b>Sizda battle yo‘q</b></div>`;
    return;
  }
  root.innerHTML = battles.map(b => `
    <div class="card battle">
      <div class="row between">
        <b>${esc(b.battle_name)}</b>
        <span>${b.active ? 'active' : 'closed'}</span>
      </div>
      <div class="muted">${esc(b.channel_id)}</div>
      <div class="muted">${b.current_votes}/${b.target_votes} • g‘oliblar ${b.winners_count} • min ${b.min_win_votes}</div>
      <div class="muted">Turi: ${esc(b.end_mode)}${b.ends_at ? ' • ' + esc(b.ends_at) : ''}</div>
    </div>
  `).join('');
}

function renderProfile() {
  const p = state.profile?.user;
  $('profileBox').innerHTML = p
    ? `ID: ${p.id}<br>Username: ${p.username ? '@' + esc(p.username) : '—'}<br>Kanallar: ${state.channels.length}`
    : '—';
}

async function addChannel() {
  const channel = $('channelInput').value.trim();
  $('channelMsg').textContent = 'Tekshirilmoqda...';
  const d = await api('/api/add-channel', {
    method: 'POST',
    body: JSON.stringify({ channel }),
  });
  $('channelMsg').textContent = d.success ? 'Kanal qo‘shildi' : (d.error || 'Xato');
  if (d.success) {
    $('channelInput').value = '';
    await loadAll();
  }
}

async function createBattle() {
  const body = {
    battleName: $('battleName').value.trim(),
    channelId: $('channelSelect').value,
    targetVotes: $('targetVotes').value,
    winnersCount: $('winnersCount').value,
    minWinVotes: $('minWinVotes').value,
    endMode: $('endMode').value,
    durationMinutes: $('durationMinutes').value,
    reward: $('reward').value.trim(),
    imageUrl: $('imageUrl').value.trim(),
  };
  $('createMsg').textContent = 'Yaratilmoqda...';
  const d = await api('/api/create-battle', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  $('createMsg').textContent = d.success ? 'Battle yaratildi' : (d.error || 'Xato');
  if (d.success) {
    $('battleName').value = '';
    $('targetVotes').value = '';
    $('winnersCount').value = '';
    $('minWinVotes').value = '';
    $('durationMinutes').value = '';
    $('reward').value = '';
    $('imageUrl').value = '';
    await loadAll();
    showTab('battles');
  }
}

window.addChannel = addChannel;
window.createBattle = createBattle;

loadAll();
