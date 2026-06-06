'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SAVED_DIR = path.join(__dirname, 'saved');
if (!fs.existsSync(SAVED_DIR)) fs.mkdirSync(SAVED_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(SAVED_DIR, 'voicebattle.db');
let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema(_db);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      username   TEXT,
      first_name TEXT,
      balance    INTEGER NOT NULL DEFAULT 0,
      blocked    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   INTEGER NOT NULL REFERENCES users(id),
      channel_id TEXT    NOT NULL,
      title      TEXT,
      added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS battles (
      id             TEXT    PRIMARY KEY,
      owner_id       INTEGER NOT NULL REFERENCES users(id),
      battle_name    TEXT    NOT NULL,
      channel_id     TEXT    NOT NULL,
      target_votes   INTEGER NOT NULL DEFAULT 10,
      winners_count  INTEGER NOT NULL DEFAULT 3,
      min_votes      INTEGER NOT NULL DEFAULT 1,
      end_mode       TEXT    NOT NULL DEFAULT 'votes',
      end_at         TEXT,
      current_votes  INTEGER NOT NULL DEFAULT 0,
      reward         TEXT    NOT NULL,
      image_url      TEXT,
      message_id     INTEGER,
      active         INTEGER NOT NULL DEFAULT 1,
      finish_reason  TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      finished_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id  TEXT    NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      username   TEXT,
      votes      INTEGER NOT NULL DEFAULT 0,
      joined_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(battle_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id      TEXT    NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      voter_id       INTEGER NOT NULL,
      participant_id INTEGER NOT NULL REFERENCES participants(id),
      username       TEXT,
      voted_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(battle_id, voter_id)
    );

    CREATE TABLE IF NOT EXISTS admins (
      user_id INTEGER PRIMARY KEY
    );

    CREATE INDEX IF NOT EXISTS idx_battles_owner   ON battles(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_active  ON battles(active);
    CREATE INDEX IF NOT EXISTS idx_battles_endat   ON battles(end_at);
    CREATE INDEX IF NOT EXISTS idx_channels_owner  ON channels(owner_id);
    CREATE INDEX IF NOT EXISTS idx_part_battle     ON participants(battle_id);
    CREATE INDEX IF NOT EXISTS idx_part_votes      ON participants(battle_id, votes DESC);
    CREATE INDEX IF NOT EXISTS idx_votes_battle    ON votes(battle_id);
    CREATE INDEX IF NOT EXISTS idx_votes_voter     ON votes(battle_id, voter_id);
  `);

  const adminId = parseInt(process.env.ADMIN_ID || '0', 10);
  if (adminId) db.prepare('INSERT OR IGNORE INTO admins(user_id) VALUES(?)').run(adminId);
  console.log('[DB] Ready:', DB_PATH);
}

function upsertUser(id, username, firstName) {
  const db = getDb();
  db.prepare(`
    INSERT INTO users(id, username, first_name) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      username   = excluded.username,
      first_name  = excluded.first_name
  `).run(id, username || null, firstName || null);
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
  if (isAdmin(ownerId)) return true;
  return !!getDb().prepare('SELECT id FROM channels WHERE owner_id=? AND channel_id=?').get(ownerId, channelId);
}

function createBattle({
  id, ownerId, battleName, channelId, targetVotes,
  winnersCount = 3, minVotes = 1, endMode = 'votes', endAt = null,
  reward, imageUrl = null
}) {
  getDb().prepare(`
    INSERT INTO battles(
      id, owner_id, battle_name, channel_id, target_votes,
      winners_count, min_votes, end_mode, end_at,
      reward, image_url
    )
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, ownerId, battleName, channelId, parseInt(targetVotes, 10),
    parseInt(winnersCount, 10) || 3,
    parseInt(minVotes, 10) || 1,
    endMode || 'votes',
    endAt,
    reward,
    imageUrl || null
  );
  return getBattle(id);
}

function getBattle(id) {
  return getDb().prepare('SELECT * FROM battles WHERE id=?').get(id);
}

function updateBattleMessageId(battleId, messageId) {
  getDb().prepare('UPDATE battles SET message_id=? WHERE id=?').run(messageId, battleId);
}

function closeBattle(battleId, reason = 'manual') {
  getDb().prepare(`
    UPDATE battles
    SET active=0,
        finish_reason=?,
        finished_at=datetime('now')
    WHERE id=?
  `).run(reason, battleId);
}

function deleteBattle(battleId) {
  getDb().prepare('DELETE FROM battles WHERE id=?').run(battleId);
}

function getActiveBattles() {
  return getDb().prepare('SELECT * FROM battles WHERE active=1 ORDER BY created_at DESC').all();
}

function getExpiredBattles() {
  return getDb().prepare(`
    SELECT * FROM battles
    WHERE active=1
      AND end_mode='time'
      AND end_at IS NOT NULL
      AND datetime(end_at) <= datetime('now')
    ORDER BY datetime(end_at) ASC
  `).all();
}

function getUserBattles(ownerId) {
  return getDb().prepare('SELECT * FROM battles WHERE owner_id=? ORDER BY created_at DESC').all(ownerId);
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
  getDb().prepare('UPDATE participants SET votes=votes+1 WHERE id=?').run(participantId);
}

function incrementBattleVotes(battleId) {
  getDb().prepare('UPDATE battles SET current_votes=current_votes+1 WHERE id=?').run(battleId);
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
}

module.exports = {
  getDb,
  upsertUser, getUser, getAllUsers, blockUser,
  addChannel, removeChannel, getUserChannels, getAllChannels, isChannelOwner,
  createBattle, getBattle, updateBattleMessageId, closeBattle, deleteBattle,
  getActiveBattles, getExpiredBattles, getUserBattles, getAllBattles,
  joinBattle, isParticipant, getParticipant, getTopParticipants, getAllParticipants,
  incrementParticipantVotes, incrementBattleVotes, addVote, hasVoted,
  getStats, isAdmin, addAdmin,
};
