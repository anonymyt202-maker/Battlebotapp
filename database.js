'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
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
      owner_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS battles (
      id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL,
      battle_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      target_votes INTEGER NOT NULL DEFAULT 10,
      current_votes INTEGER NOT NULL DEFAULT 0,
      reward TEXT NOT NULL,
      image_url TEXT,
      message_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT,
      votes INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(battle_id, user_id),
      FOREIGN KEY(battle_id) REFERENCES battles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      voter_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      username TEXT,
      voted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(battle_id, voter_id),
      FOREIGN KEY(battle_id) REFERENCES battles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admins (
      user_id INTEGER PRIMARY KEY
    );

    CREATE INDEX IF NOT EXISTS idx_channels_owner      ON channels(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_owner       ON battles(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_active      ON battles(active);
    CREATE INDEX IF NOT EXISTS idx_participants_battle ON participants(battle_id);
    CREATE INDEX IF NOT EXISTS idx_votes_battle        ON votes(battle_id);
  `);

  const adminId = Number(process.env.ADMIN_ID || 0);
  if (adminId) db.prepare('INSERT OR IGNORE INTO admins(user_id) VALUES(?)').run(adminId);

  console.log('[DB] Schema initialized at', DB_PATH);
}

function upsertUser(id, username, firstName) {
  const d = getDb();
  d.prepare(`
    INSERT INTO users (id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
  `).run(id, username || null, firstName || null);
  return getUser(id);
}

function getUser(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function blockUser(id, blocked) {
  getDb().prepare('UPDATE users SET blocked=? WHERE id=?').run(blocked ? 1 : 0, id);
}

function addChannel(ownerId, channelId, title) {
  try {
    getDb().prepare('INSERT INTO channels(owner_id, channel_id, title) VALUES(?,?,?)').run(ownerId, channelId, title || null);
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function removeChannel(ownerId, channelId) {
  getDb().prepare('DELETE FROM channels WHERE owner_id=? AND channel_id=?').run(ownerId, channelId);
}

function getUserChannels(ownerId) {
  return getDb().prepare('SELECT * FROM channels WHERE owner_id=? ORDER BY added_at DESC').all(ownerId);
}

function getAllChannels() {
  return getDb().prepare('SELECT * FROM channels ORDER BY added_at DESC').all();
}

function isChannelOwner(ownerId, channelId) {
  return !!getDb().prepare('SELECT id FROM channels WHERE owner_id=? AND channel_id=?').get(ownerId, channelId);
}

function createBattle({ id, ownerId, battleName, channelId, targetVotes, reward, imageUrl }) {
  getDb().prepare(`
    INSERT INTO battles(id, owner_id, battle_name, channel_id, target_votes, reward, image_url)
    VALUES(?,?,?,?,?,?,?)
  `).run(id, ownerId, battleName, channelId, parseInt(targetVotes, 10), reward, imageUrl || null);
  return getBattle(id);
}

function getBattle(id) {
  return getDb().prepare('SELECT * FROM battles WHERE id=?').get(id);
}

function updateBattleMessageId(battleId, messageId) {
  getDb().prepare('UPDATE battles SET message_id=? WHERE id=?').run(messageId, battleId);
}

function closeBattle(battleId) {
  getDb().prepare('UPDATE battles SET active=0 WHERE id=?').run(battleId);
}

function deleteBattle(battleId) {
  const tx = getDb().transaction((id) => {
    getDb().prepare('DELETE FROM votes WHERE battle_id=?').run(id);
    getDb().prepare('DELETE FROM participants WHERE battle_id=?').run(id);
    getDb().prepare('DELETE FROM battles WHERE id=?').run(id);
  });
  tx(battleId);
}

function getActiveBattles() {
  return getDb().prepare('SELECT * FROM battles WHERE active=1 ORDER BY created_at DESC').all();
}

function getUserBattles(userId) {
  return getDb().prepare('SELECT * FROM battles WHERE owner_id=? ORDER BY created_at DESC').all(userId);
}

function getAllBattles() {
  return getDb().prepare('SELECT * FROM battles ORDER BY created_at DESC').all();
}

function joinBattle(battleId, userId, username) {
  try {
    getDb().prepare('INSERT INTO participants(battle_id, user_id, username) VALUES(?,?,?)').run(battleId, userId, username || null);
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function isParticipant(battleId, userId) {
  return !!getDb().prepare('SELECT id FROM participants WHERE battle_id=? AND user_id=?').get(battleId, userId);
}

function getParticipant(battleId, userId) {
  return getDb().prepare('SELECT * FROM participants WHERE battle_id=? AND user_id=?').get(battleId, userId);
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
  return getDb().prepare('SELECT * FROM participants WHERE battle_id=? ORDER BY votes DESC, joined_at ASC').all(battleId);
}

function incrementParticipantVotes(participantId) {
  getDb().prepare('UPDATE participants SET votes = votes + 1 WHERE id=?').run(participantId);
  return getDb().prepare('SELECT * FROM participants WHERE id=?').get(participantId);
}

function incrementBattleVotes(battleId) {
  getDb().prepare('UPDATE battles SET current_votes = current_votes + 1 WHERE id=?').run(battleId);
  return getDb().prepare('SELECT current_votes, target_votes FROM battles WHERE id=?').get(battleId);
}

function addVote(battleId, voterId, participantId, username) {
  try {
    getDb().prepare('INSERT INTO votes(battle_id, voter_id, participant_id, username) VALUES(?,?,?,?)').run(battleId, voterId, participantId, username || null);
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function hasVoted(battleId, voterId) {
  return !!getDb().prepare('SELECT id FROM votes WHERE battle_id=? AND voter_id=?').get(battleId, voterId);
}

function getVoteCount(battleId) {
  return getDb().prepare('SELECT COUNT(*) AS cnt FROM votes WHERE battle_id=?').get(battleId).cnt;
}

function getStats() {
  const d = getDb();
  return {
    users: d.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt,
    battles: d.prepare('SELECT COUNT(*) AS cnt FROM battles').get().cnt,
    active: d.prepare('SELECT COUNT(*) AS cnt FROM battles WHERE active=1').get().cnt,
    finished: d.prepare('SELECT COUNT(*) AS cnt FROM battles WHERE active=0').get().cnt,
    votes: d.prepare('SELECT COUNT(*) AS cnt FROM votes').get().cnt,
    participants: d.prepare('SELECT COUNT(*) AS cnt FROM participants').get().cnt,
    channels: d.prepare('SELECT COUNT(*) AS cnt FROM channels').get().cnt,
  };
}

function isAdmin(userId) {
  return !!getDb().prepare('SELECT user_id FROM admins WHERE user_id=?').get(userId);
}

function addAdmin(userId) {
  getDb().prepare('INSERT OR IGNORE INTO admins(user_id) VALUES(?)').run(userId);
}

module.exports = {
  getDb,
  upsertUser,
  getUser,
  getAllUsers,
  blockUser,
  addChannel,
  removeChannel,
  getUserChannels,
  getAllChannels,
  isChannelOwner,
  createBattle,
  getBattle,
  updateBattleMessageId,
  closeBattle,
  deleteBattle,
  getActiveBattles,
  getUserBattles,
  getAllBattles,
  joinBattle,
  isParticipant,
  getParticipant,
  getTopParticipants,
  getAllParticipants,
  incrementParticipantVotes,
  incrementBattleVotes,
  addVote,
  hasVoted,
  getVoteCount,
  getStats,
  isAdmin,
  addAdmin,
};
