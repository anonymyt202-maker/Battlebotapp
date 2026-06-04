// ══════════════════════════════════════════════════
//  database.js  —  JSON fayllarga asoslangan DB
// ══════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');

// Railway'da /data papkasi yozilishi mumkin bo'lishi uchun
// loyiha papkasiga nisbatan yo'l beramiz
const DATA_DIR = path.join(__dirname, 'data');

const FILES = {
  users:    path.join(DATA_DIR, 'users.json'),
  battles:  path.join(DATA_DIR, 'battles.json'),
  votes:    path.join(DATA_DIR, 'votes.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
};

const DEFAULTS = {
  users:    {},
  battles:  {},
  votes:    {},
  settings: { requiredChannels: [], adminIds: [] },
};

// ── Papka va fayllarni yaratish ────────────────────
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
Object.entries(FILES).forEach(([key, filePath]) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULTS[key], null, 2), 'utf8');
  }
});

// ── O'qish / Yozish ────────────────────────────────
function read(key) {
  try {
    return JSON.parse(fs.readFileSync(FILES[key], 'utf8'));
  } catch (e) {
    console.error(`[DB] read ${key}:`, e.message);
    return DEFAULTS[key];
  }
}

function write(key, data) {
  try {
    fs.writeFileSync(FILES[key], JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[DB] write ${key}:`, e.message);
    return false;
  }
}

// ── ID generatsiya ──────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

// ══════════════════════════════════════════════════
//                     USERS
// ══════════════════════════════════════════════════
function getUser(id) {
  const users = read('users');
  return users[String(id)] || null;
}

function upsertUser(id, data) {
  const users = read('users');
  const uid   = String(id);
  users[uid] = {
    ...(users[uid] || {
      id,
      createdBattles:     0,
      activeBattles:      0,
      totalVotesReceived: 0,
      wins:               0,
      banned:             false,
      joinedAt:           Date.now(),
    }),
    ...data,
  };
  write('users', users);
  return users[uid];
}

function banUser(id, banned = true) {
  return upsertUser(id, { banned });
}

function getAllUsers() {
  return Object.values(read('users'));
}

// ══════════════════════════════════════════════════
//                    BATTLES
// ══════════════════════════════════════════════════
function createBattle(data) {
  const battles  = read('battles');
  const battleId = genId();

  battles[battleId] = {
    battleId,
    ownerId:       data.ownerId,
    ownerUsername: data.ownerUsername || null,
    name:          data.name,
    channel:       data.channel,
    target:        data.target,
    reward:        data.reward,
    buttonText:    data.buttonText || 'Ovoz berish',
    imageUrl:      data.imageUrl   || null,
    active:        true,
    finished:      false,
    winner:        null,
    messageId:     null,
    participants:  [],
    voteCount:     0,
    createdAt:     Date.now(),
  };
  write('battles', battles);

  // Foydalanuvchi statistikasini yangilash
  const users = read('users');
  const uid   = String(data.ownerId);
  if (users[uid]) {
    users[uid].createdBattles = (users[uid].createdBattles || 0) + 1;
    users[uid].activeBattles  = (users[uid].activeBattles  || 0) + 1;
    write('users', users);
  }

  return battles[battleId];
}

function getBattle(battleId) {
  return read('battles')[battleId] || null;
}

function updateBattle(battleId, data) {
  const battles = read('battles');
  if (!battles[battleId]) return null;
  battles[battleId] = { ...battles[battleId], ...data };
  write('battles', battles);
  return battles[battleId];
}

function deleteBattle(battleId) {
  const battles = read('battles');
  if (!battles[battleId]) return false;
  delete battles[battleId];
  write('battles', battles);
  return true;
}

function getAllBattles() {
  return Object.values(read('battles')).sort((a, b) => b.createdAt - a.createdAt);
}

function getActiveBattles() {
  return getAllBattles().filter(b => b.active && !b.finished);
}

function getUserBattles(userId) {
  return getAllBattles().filter(b => String(b.ownerId) === String(userId));
}

// ══════════════════════════════════════════════════
//                      VOTES
// ══════════════════════════════════════════════════
function castVote(battleId, userId, username) {
  const votes = read('votes');
  const key   = `${battleId}:${userId}`;

  if (votes[key]) return { ok: false, reason: 'already_voted' };

  votes[key] = { battleId, userId, username, time: Date.now() };
  write('votes', votes);

  // Battle voteCount yangilash
  const battles = read('battles');
  if (battles[battleId]) {
    battles[battleId].voteCount = (battles[battleId].voteCount || 0) + 1;
    if (!battles[battleId].participants) battles[battleId].participants = [];
    if (!battles[battleId].participants.find(p => String(p.userId) === String(userId))) {
      battles[battleId].participants.push({ userId, username, votedAt: Date.now() });
    }
    write('battles', battles);
  }

  return { ok: true };
}

function hasVoted(battleId, userId) {
  const votes = read('votes');
  return !!votes[`${battleId}:${userId}`];
}

function getBattleVotes(battleId) {
  return Object.values(read('votes')).filter(v => v.battleId === battleId);
}

// ══════════════════════════════════════════════════
//                    SETTINGS
// ══════════════════════════════════════════════════
function getSettings() { return read('settings'); }

function updateSettings(data) {
  const s = { ...read('settings'), ...data };
  write('settings', s);
  return s;
}

function isAdmin(id) {
  const s        = getSettings();
  const adminIds = s.adminIds || [];
  const envAdmin = process.env.ADMIN_ID ? [String(process.env.ADMIN_ID)] : [];
  return [...adminIds, ...envAdmin].includes(String(id));
}

// ══════════════════════════════════════════════════
//                   STATISTICS
// ══════════════════════════════════════════════════
function getStats() {
  const battles = getAllBattles();
  const users   = getAllUsers();
  const votes   = Object.values(read('votes'));
  return {
    totalBattles:    battles.length,
    activeBattles:   battles.filter(b => b.active && !b.finished).length,
    finishedBattles: battles.filter(b => b.finished).length,
    totalUsers:      users.length,
    totalVotes:      votes.length,
    bannedUsers:     users.filter(u => u.banned).length,
  };
}

module.exports = {
  // Users
  getUser, upsertUser, banUser, getAllUsers,
  // Battles
  createBattle, getBattle, updateBattle, deleteBattle,
  getAllBattles, getActiveBattles, getUserBattles,
  // Votes
  castVote, hasVoted, getBattleVotes,
  // Settings
  getSettings, updateSettings, isAdmin,
  // Stats
  getStats, genId,
};
