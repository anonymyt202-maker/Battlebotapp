'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'saved');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'voicebattle.db');

let _db = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function getDb() {
  if (_db) return _db;
  ensureDir(DATA_DIR);
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      channel_id TEXT NOT NULL,
      title TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS battles (
      id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      battle_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      target_votes INTEGER NOT NULL DEFAULT 10,
      current_votes INTEGER NOT NULL DEFAULT 0,
      reward TEXT NOT NULL,
      image_url TEXT,
      message_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      winners_count INTEGER NOT NULL DEFAULT 1,
      min_win_votes INTEGER NOT NULL DEFAULT 1,
      end_mode TEXT NOT NULL DEFAULT 'target',
      duration_minutes INTEGER,
      ends_at TEXT,
      ended_at TEXT,
      ended_reason TEXT,
      winners_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      username TEXT,
      votes INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(battle_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      voter_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL REFERENCES participants(id),
      username TEXT,
      voted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(battle_id, voter_id)
    );

    CREATE TABLE IF NOT EXISTS admins (
      user_id INTEGER PRIMARY KEY
    );

    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_owner ON battles(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_active ON battles(active);
    CREATE INDEX IF NOT EXISTS idx_participants_battle ON participants(battle_id);
    CREATE INDEX IF NOT EXISTS idx_votes_battle ON votes(battle_id);
  `);

  const adminId = Number(process.env.ADMIN_ID || 0);
  if (adminId) {
    db.prepare('INSERT OR IGNORE INTO admins(user_id) VALUES(?)').run(adminId);
  }
  persistSnapshots();
}

function persistSnapshots() {
  const db = getDb();
  ensureDir(DATA_DIR);

  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const channels = db.prepare('SELECT * FROM channels ORDER BY added_at DESC').all();
  const battles = db.prepare('SELECT * FROM battles ORDER BY created_at DESC').all();
  const participants = db.prepare('SELECT * FROM participants ORDER BY joined_at DESC').all();
  const votes = db.prepare('SELECT * FROM votes ORDER BY voted_at DESC').all();

  writeJsonAtomic(path.join(DATA_DIR, 'users.json'), users);
  writeJsonAtomic(path.join(DATA_DIR, 'channels.json'), channels);
  writeJsonAtomic(path.join(DATA_DIR, 'battles.json'), battles);
  writeJsonAtomic(path.join(DATA_DIR, 'participants.json'), participants);
  writeJsonAtomic(path.join(DATA_DIR, 'votes.json'), votes);
  writeJsonAtomic(path.join(DATA_DIR, 'stats.json'), getStats());
}

function upsertUser(id, username, firstName) {
  const db = getDb();
  db.prepare(`
    INSERT INTO users(id, username, first_name) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      first_name = COALESCE(excluded.first_name, users.first_name)
  `).run(id, username || null, firstName || null);
  persistSnapshots();
  return getUser(id);
}

function getUser(id) {
  return getDb().prepare('SELECT * FROM users WHERE id=?').get(id);
}

function getAllUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function blockUser(id, blocked) {
  getDb().prepare('UPDATE users SET blocked=? WHERE id=?').run(blocked ? 1 : 0, id);
  persistSnapshots();
}

function addChannel(ownerId, channelId, title) {
  try {
    getDb().prepare(
      'INSERT INTO channels(owner_id, channel_id, title) VALUES(?,?,?)'
    ).run(ownerId, channelId, title || null);
    persistSnapshots();
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function removeChannel(ownerId, channelId) {
  getDb().prepare('DELETE FROM channels WHERE owner_id=? AND channel_id=?').run(ownerId, channelId);
  persistSnapshots();
}

function getUserChannels(ownerId) {
  return getDb().prepare(
    'SELECT * FROM channels WHERE owner_id=? ORDER BY added_at DESC'
  ).all(ownerId);
}

function isChannelOwner(ownerId, channelId) {
  if (isAdmin(ownerId)) return true;
  return !!getDb().prepare(
    'SELECT id FROM channels WHERE owner_id=? AND channel_id=?'
  ).get(ownerId, channelId);
}

function getAllChannels() {
  return getDb().prepare('SELECT * FROM channels ORDER BY added_at DESC').all();
}

function generateBattleRow({ id, ownerId, battleName, channelId, targetVotes, reward, imageUrl, winnersCount, minWinVotes, endMode, durationMinutes, endsAt }) {
  const mode = ['time', 'both'].includes(endMode) ? endMode : 'target';
  const target = Math.max(1, toNum(targetVotes, 10));
  const winners = Math.max(1, toNum(winnersCount, 1));
  const minVotes = Math.max(1, toNum(minWinVotes, 1));
  const duration = durationMinutes === null || durationMinutes === undefined || durationMinutes === ''
    ? null
    : Math.max(1, toNum(durationMinutes, 1));

  let endAt = parseDate(endsAt);
  if (!endAt && mode !== 'target') {
    if (duration) {
      endAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
    }
  }

  return {
    id,
    ownerId,
    battleName,
    channelId,
    targetVotes: target,
    reward,
    imageUrl: imageUrl || null,
    winnersCount: winners,
    minWinVotes: minVotes,
    endMode: mode,
    durationMinutes: duration,
    endsAt: endAt,
  };
}

function createBattle({ id, ownerId, battleName, channelId, targetVotes, reward, imageUrl, winnersCount = 1, minWinVotes = 1, endMode = 'target', durationMinutes = null, endsAt = null }) {
  const row = generateBattleRow({ id, ownerId, battleName, channelId, targetVotes, reward, imageUrl, winnersCount, minWinVotes, endMode, durationMinutes, endsAt });
  getDb().prepare(`
    INSERT INTO battles(
      id, owner_id, battle_name, channel_id, target_votes, reward, image_url,
      winners_count, min_win_votes, end_mode, duration_minutes, ends_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id, row.ownerId, row.battleName, row.channelId, row.targetVotes, row.reward, row.imageUrl,
    row.winnersCount, row.minWinVotes, row.endMode, row.durationMinutes, row.endsAt
  );
  persistSnapshots();
  return getBattle(id);
}

function updateBattleMessageId(battleId, messageId) {
  getDb().prepare('UPDATE battles SET message_id=? WHERE id=?').run(messageId, battleId);
  persistSnapshots();
}

function updateBattleStatus(battleId, { active, endedAt = null, endedReason = null, winnersJson = null }) {
  getDb().prepare(`
    UPDATE battles
    SET active=?, ended_at=?, ended_reason=?, winners_json=?
    WHERE id=?
  `).run(active ? 1 : 0, endedAt, endedReason, winnersJson, battleId);
  persistSnapshots();
}

function setBattleCurrentVotes(battleId, currentVotes) {
  getDb().prepare('UPDATE battles SET current_votes=? WHERE id=?').run(currentVotes, battleId);
  persistSnapshots();
}

function getBattle(id) {
  return getDb().prepare('SELECT * FROM battles WHERE id=?').get(id);
}

function closeBattle(battleId, reason = 'manual') {
  const endedAt = new Date().toISOString();
  getDb().prepare('UPDATE battles SET active=0, ended_at=?, ended_reason=? WHERE id=?').run(endedAt, reason, battleId);
  persistSnapshots();
}

function deleteBattle(battleId) {
  getDb().prepare('DELETE FROM battles WHERE id=?').run(battleId);
  persistSnapshots();
}

function getActiveBattles() {
  return getDb().prepare('SELECT * FROM battles WHERE active=1 ORDER BY created_at DESC').all();
}

function getExpiredBattles(nowIso = new Date().toISOString()) {
  return getDb().prepare(`
    SELECT * FROM battles
    WHERE active=1
      AND end_mode IN ('time', 'both')
      AND ends_at IS NOT NULL
      AND ends_at <= ?
    ORDER BY ends_at ASC
  `).all(nowIso);
}

function getUserBattles(ownerId) {
  return getDb().prepare('SELECT * FROM battles WHERE owner_id=? ORDER BY created_at DESC').all(ownerId);
}

function getAllBattles() {
  return getDb().prepare('SELECT * FROM battles ORDER BY created_at DESC').all();
}

function joinBattle(battleId, userId, username) {
  try {
    getDb().prepare(
      'INSERT INTO participants(battle_id, user_id, username) VALUES(?,?,?)'
    ).run(battleId, userId, username || null);
    persistSnapshots();
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function ensureParticipant(battleId, userId, username) {
  const existing = getParticipant(battleId, userId);
  if (existing) return existing;
  joinBattle(battleId, userId, username);
  return getParticipant(battleId, userId);
}

function isParticipant(battleId, userId) {
  return !!getDb().prepare(
    'SELECT id FROM participants WHERE battle_id=? AND user_id=?'
  ).get(battleId, userId);
}

function getParticipant(battleId, userId) {
  return getDb().prepare(
    'SELECT * FROM participants WHERE battle_id=? AND user_id=?'
  ).get(battleId, userId);
}

function getTopParticipants(battleId, limit = 10) {
  return getDb().prepare(`
    SELECT * FROM participants
    WHERE battle_id=?
    ORDER BY votes DESC, joined_at ASC
    LIMIT ?
  `).all(battleId, limit);
}

function getAllParticipants(battleId) {
  return getDb().prepare(
    'SELECT * FROM participants WHERE battle_id=? ORDER BY votes DESC, joined_at ASC'
  ).all(battleId);
}

function incrementParticipantVotes(participantId) {
  getDb().prepare('UPDATE participants SET votes=votes+1 WHERE id=?').run(participantId);
  persistSnapshots();
}

function addVote(battleId, voterId, participantId, username) {
  try {
    getDb().prepare(
      'INSERT INTO votes(battle_id, voter_id, participant_id, username) VALUES(?,?,?,?)'
    ).run(battleId, voterId, participantId, username || null);
    persistSnapshots();
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function hasVoted(battleId, voterId) {
  return !!getDb().prepare(
    'SELECT id FROM votes WHERE battle_id=? AND voter_id=?'
  ).get(battleId, voterId);
}

function incrementBattleVotes(battleId) {
  getDb().prepare('UPDATE battles SET current_votes=current_votes+1 WHERE id=?').run(battleId);
  const row = getDb().prepare('SELECT current_votes, target_votes FROM battles WHERE id=?').get(battleId);
  persistSnapshots();
  return row;
}

function setBattleWinners(battleId, winners, reason = 'target') {
  const battle = getBattle(battleId);
  if (!battle) return null;
  updateBattleStatus(battleId, {
    active: 0,
    endedAt: new Date().toISOString(),
    endedReason: reason,
    winnersJson: JSON.stringify(winners || []),
  });
  return getBattle(battleId);
}

function getStats() {
  const db = getDb();
  return {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    battles: db.prepare('SELECT COUNT(*) as c FROM battles').get().c,
    active: db.prepare('SELECT COUNT(*) as c FROM battles WHERE active=1').get().c,
    finished: db.prepare('SELECT COUNT(*) as c FROM battles WHERE active=0').get().c,
    votes: db.prepare('SELECT COUNT(*) as c FROM votes').get().c,
    participants: db.prepare('SELECT COUNT(*) as c FROM participants').get().c,
    channels: db.prepare('SELECT COUNT(*) as c FROM channels').get().c,
  };
}

function isAdmin(userId) {
  return !!getDb().prepare('SELECT user_id FROM admins WHERE user_id=?').get(userId);
}

function addAdmin(userId) {
  getDb().prepare('INSERT OR IGNORE INTO admins(user_id) VALUES(?)').run(userId);
  persistSnapshots();
}

module.exports = {
  getDb,
  persistSnapshots,
  upsertUser,
  getUser,
  getAllUsers,
  blockUser,
  addChannel,
  removeChannel,
  getUserChannels,
  isChannelOwner,
  getAllChannels,
  createBattle,
  updateBattleMessageId,
  updateBattleStatus,
  setBattleCurrentVotes,
  getBattle,
  closeBattle,
  deleteBattle,
  getActiveBattles,
  getExpiredBattles,
  getUserBattles,
  getAllBattles,
  joinBattle,
  ensureParticipant,
  isParticipant,
  getParticipant,
  getTopParticipants,
  getAllParticipants,
  incrementParticipantVotes,
  addVote,
  hasVoted,
  incrementBattleVotes,
  setBattleWinners,
  getStats,
  isAdmin,
  addAdmin,
};
