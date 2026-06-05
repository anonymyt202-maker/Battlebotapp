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
      id          INTEGER PRIMARY KEY,
      username    TEXT,
      first_name  TEXT,
      balance     INTEGER NOT NULL DEFAULT 0,
      blocked     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      user_id INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS required_channels (
      channel_id TEXT PRIMARY KEY,
      title      TEXT,
      added_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      title      TEXT,
      added_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS battles (
      id             TEXT PRIMARY KEY,
      owner_id       INTEGER NOT NULL,
      battle_name    TEXT NOT NULL,
      channel_id     TEXT NOT NULL,
      target_votes   INTEGER NOT NULL DEFAULT 10,
      min_win_votes  INTEGER NOT NULL DEFAULT 1,
      places_count   INTEGER NOT NULL DEFAULT 3,
      current_votes  INTEGER NOT NULL DEFAULT 0,
      reward         TEXT NOT NULL,
      button_text    TEXT NOT NULL DEFAULT '🔥 Ovoz berish',
      image_url      TEXT,
      message_id     INTEGER,
      active         INTEGER NOT NULL DEFAULT 1,
      finished_at    TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id  TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      username   TEXT,
      votes      INTEGER NOT NULL DEFAULT 0,
      joined_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(battle_id, user_id),
      FOREIGN KEY(battle_id) REFERENCES battles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id       TEXT NOT NULL,
      voter_id        INTEGER NOT NULL,
      participant_id  INTEGER NOT NULL,
      username        TEXT,
      voted_at        TEXT DEFAULT (datetime('now')),
      UNIQUE(battle_id, voter_id),
      FOREIGN KEY(battle_id) REFERENCES battles(id) ON DELETE CASCADE,
      FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_channels_owner   ON channels(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_owner    ON battles(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_active   ON battles(active);
    CREATE INDEX IF NOT EXISTS idx_participants_bat ON participants(battle_id);
    CREATE INDEX IF NOT EXISTS idx_votes_battle     ON votes(battle_id);
  `);

  const adminId = Number(process.env.ADMIN_ID || 0);
  if (adminId) {
    db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(adminId);
  }

  console.log('[DB] Schema initialized at', DB_PATH);
}

function normalizeChannel(channelId) {
  let ch = String(channelId || '').trim();
  if (!ch) return ch;
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
  return ch;
}

/* Users */
function upsertUser(id, username, firstName) {
  const database = getDb();
  database.prepare(`
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

function blockUser(userId, blocked = true) {
  getDb().prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked ? 1 : 0, userId);
}

function getAllUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

/* Admin */
function isAdmin(userId) {
  if (!userId) return false;
  return !!getDb().prepare('SELECT user_id FROM admins WHERE user_id = ?').get(userId);
}

function addAdmin(userId) {
  getDb().prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(userId);
}

/* Required channels */
function addRequiredChannel(channelId, title = null) {
  const ch = normalizeChannel(channelId);
  if (!ch) throw new Error('Kanal bo\'sh');
  getDb().prepare(`
    INSERT OR REPLACE INTO required_channels (channel_id, title)
    VALUES (?, ?)
  `).run(ch, title);
  return getRequiredChannels().find(c => c.channel_id === ch) || { channel_id: ch, title };
}

function removeRequiredChannel(channelId) {
  const ch = normalizeChannel(channelId);
  getDb().prepare('DELETE FROM required_channels WHERE channel_id = ?').run(ch);
}

function getRequiredChannels() {
  return getDb().prepare('SELECT * FROM required_channels ORDER BY added_at DESC').all();
}

/* User-owned channels */
function addChannel(ownerId, channelId, title = null) {
  const ch = normalizeChannel(channelId);
  if (!ch) throw new Error('Kanal bo\'sh');
  const info = getDb().prepare(`
    INSERT OR IGNORE INTO channels (owner_id, channel_id, title)
    VALUES (?, ?, ?)
  `).run(ownerId, ch, title);
  return info.changes > 0;
}

function getUserChannels(ownerId) {
  return getDb().prepare('SELECT * FROM channels WHERE owner_id = ? ORDER BY added_at DESC').all(ownerId);
}

function getAllChannels() {
  return getDb().prepare('SELECT * FROM channels ORDER BY added_at DESC').all();
}

function isChannelOwner(ownerId, channelId) {
  const ch = normalizeChannel(channelId);
  return !!getDb().prepare('SELECT id FROM channels WHERE owner_id = ? AND channel_id = ?').get(ownerId, ch);
}

/* Battles */
function createBattle({
  id,
  ownerId,
  battleName,
  channelId,
  targetVotes,
  minWinVotes = 1,
  placesCount = 3,
  reward,
  buttonText = '🔥 Ovoz berish',
  imageUrl = null,
}) {
  getDb().prepare(`
    INSERT INTO battles (
      id, owner_id, battle_name, channel_id, target_votes, min_win_votes,
      places_count, reward, button_text, image_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ownerId,
    battleName,
    normalizeChannel(channelId),
    Number(targetVotes),
    Number(minWinVotes) || 1,
    Number(placesCount) || 3,
    reward,
    buttonText || '🔥 Ovoz berish',
    imageUrl || null
  );
  return getBattle(id);
}

function getBattle(id) {
  return getDb().prepare('SELECT * FROM battles WHERE id = ?').get(id);
}

function getUserBattles(userId) {
  return getDb().prepare('SELECT * FROM battles WHERE owner_id = ? ORDER BY created_at DESC').all(userId);
}

function getActiveBattles() {
  return getDb().prepare('SELECT * FROM battles WHERE active = 1 ORDER BY created_at DESC').all();
}

function updateBattleMessageId(battleId, messageId) {
  getDb().prepare('UPDATE battles SET message_id = ? WHERE id = ?').run(messageId, battleId);
}

function incrementBattleVotes(battleId) {
  getDb().prepare('UPDATE battles SET current_votes = current_votes + 1 WHERE id = ?').run(battleId);
  return getDb().prepare('SELECT current_votes, target_votes, min_win_votes, places_count FROM battles WHERE id = ?').get(battleId);
}

function closeBattle(battleId) {
  getDb().prepare(`
    UPDATE battles
    SET active = 0,
        finished_at = datetime('now')
    WHERE id = ?
  `).run(battleId);
}

function deleteBattle(battleId) {
  getDb().prepare('DELETE FROM battles WHERE id = ?').run(battleId);
}

/* Participants */
function joinBattle(battleId, userId, username) {
  const battle = getBattle(battleId);
  if (!battle) throw new Error('Battle topilmadi');
  getDb().prepare(`
    INSERT OR IGNORE INTO participants (battle_id, user_id, username)
    VALUES (?, ?, ?)
  `).run(battleId, userId, username || null);

  if (username) {
    getDb().prepare('UPDATE participants SET username = ? WHERE battle_id = ? AND user_id = ?')
      .run(username, battleId, userId);
  }

  return getParticipant(battleId, userId);
}

function isParticipant(battleId, userId) {
  return !!getDb().prepare('SELECT id FROM participants WHERE battle_id = ? AND user_id = ?').get(battleId, userId);
}

function getParticipant(battleId, userId) {
  return getDb().prepare('SELECT * FROM participants WHERE battle_id = ? AND user_id = ?').get(battleId, userId);
}

function getParticipantByUsername(battleId, username) {
  if (!username) return null;
  const clean = String(username).replace('@', '').trim().toLowerCase();
  return getDb().prepare(`
    SELECT * FROM participants
    WHERE battle_id = ? AND lower(username) = ?
  `).get(battleId, clean);
}

function getTopParticipants(battleId, limit = 10) {
  return getDb().prepare(`
    SELECT p.*
    FROM participants p
    WHERE p.battle_id = ?
    ORDER BY p.votes DESC, p.joined_at ASC, p.id ASC
    LIMIT ?
  `).all(battleId, limit);
}

function incrementParticipantVotes(participantId) {
  getDb().prepare('UPDATE participants SET votes = votes + 1 WHERE id = ?').run(participantId);
  return getDb().prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
}

/* Votes */
function addVote(battleId, voterId, participantId, username) {
  try {
    getDb().prepare(`
      INSERT INTO votes (battle_id, voter_id, participant_id, username)
      VALUES (?, ?, ?, ?)
    `).run(battleId, voterId, participantId, username || null);
    return true;
  } catch (e) {
    if (String(e.code).includes('SQLITE_CONSTRAINT')) return false;
    throw e;
  }
}

function hasVoted(battleId, voterId) {
  return !!getDb().prepare('SELECT id FROM votes WHERE battle_id = ? AND voter_id = ?').get(battleId, voterId);
}

function getVoteCount(battleId) {
  return getDb().prepare('SELECT COUNT(*) AS cnt FROM votes WHERE battle_id = ?').get(battleId).cnt;
}

/* Stats */
function getStats() {
  const database = getDb();
  return {
    users: database.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt,
    battles: database.prepare('SELECT COUNT(*) AS cnt FROM battles').get().cnt,
    active: database.prepare('SELECT COUNT(*) AS cnt FROM battles WHERE active = 1').get().cnt,
    finished: database.prepare('SELECT COUNT(*) AS cnt FROM battles WHERE active = 0').get().cnt,
  };
}

module.exports = {
  getDb,
  upsertUser,
  getUser,
  blockUser,
  getAllUsers,
  isAdmin,
  addAdmin,

  addRequiredChannel,
  removeRequiredChannel,
  getRequiredChannels,

  addChannel,
  getUserChannels,
  getAllChannels,
  isChannelOwner,

  createBattle,
  getBattle,
  getUserBattles,
  getActiveBattles,
  updateBattleMessageId,
  incrementBattleVotes,
  closeBattle,
  deleteBattle,

  joinBattle,
  isParticipant,
  getParticipant,
  getParticipantByUsername,
  getTopParticipants,
  incrementParticipantVotes,

  addVote,
  hasVoted,
  getVoteCount,

  getStats,
};
