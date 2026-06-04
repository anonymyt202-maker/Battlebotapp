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
      balance     INTEGER DEFAULT 0,
      blocked     INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS battles (
      id            TEXT PRIMARY KEY,
      owner_id      INTEGER NOT NULL,
      battle_name   TEXT NOT NULL,
      channel_id    TEXT NOT NULL,
      target_votes  INTEGER NOT NULL DEFAULT 10,
      current_votes INTEGER NOT NULL DEFAULT 0,
      reward        TEXT NOT NULL,
      button_text   TEXT NOT NULL DEFAULT '🔥 Ovoz berish',
      image_url     TEXT,
      message_id    INTEGER,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id  TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      username   TEXT,
      voted_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(battle_id, user_id),
      FOREIGN KEY(battle_id) REFERENCES battles(id)
    );

    CREATE TABLE IF NOT EXISTS admins (
      user_id INTEGER PRIMARY KEY
    );

    CREATE INDEX IF NOT EXISTS idx_battles_owner    ON battles(owner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_active   ON battles(active);
    CREATE INDEX IF NOT EXISTS idx_votes_battle     ON votes(battle_id);
  `);

  // Seed ADMIN_ID if set
  const adminId = parseInt(process.env.ADMIN_ID);
  if (adminId) {
    const existing = db.prepare('SELECT user_id FROM admins WHERE user_id = ?').get(adminId);
    if (!existing) {
      db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(adminId);
    }
  }

  console.log('[DB] Schema initialized at', DB_PATH);
}

// ─── User helpers ────────────────────────────────────────────
function upsertUser(id, username, firstName) {
  const db = getDb();
  db.prepare(`
    INSERT INTO users (id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username   = excluded.username,
      first_name = excluded.first_name
  `).run(id, username || null, firstName || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUser(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserBattles(userId) {
  return getDb().prepare('SELECT * FROM battles WHERE owner_id = ? ORDER BY created_at DESC').all(userId);
}

function getUserActiveBattles(userId) {
  return getDb().prepare('SELECT * FROM battles WHERE owner_id = ? AND active = 1').all(userId);
}

// ─── Battle helpers ──────────────────────────────────────────
function createBattle({ id, ownerId, battleName, channelId, targetVotes, reward, buttonText, imageUrl }) {
  getDb().prepare(`
    INSERT INTO battles (id, owner_id, battle_name, channel_id, target_votes, reward, button_text, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, battleName, channelId, targetVotes, reward, buttonText || '🔥 Ovoz berish', imageUrl || null);
  return getBattle(id);
}

function getBattle(id) {
  return getDb().prepare('SELECT * FROM battles WHERE id = ?').get(id);
}

function updateBattleMessageId(battleId, messageId) {
  getDb().prepare('UPDATE battles SET message_id = ? WHERE id = ?').run(messageId, battleId);
}

function incrementVotes(battleId) {
  getDb().prepare('UPDATE battles SET current_votes = current_votes + 1 WHERE id = ?').run(battleId);
  return getDb().prepare('SELECT current_votes, target_votes FROM battles WHERE id = ?').get(battleId);
}

function closeBattle(battleId) {
  getDb().prepare('UPDATE battles SET active = 0 WHERE id = ?').run(battleId);
}

function getActiveBattles() {
  return getDb().prepare('SELECT * FROM battles WHERE active = 1 ORDER BY created_at DESC').all();
}

// ─── Vote helpers ────────────────────────────────────────────
function addVote(battleId, userId, username) {
  try {
    getDb().prepare(`
      INSERT INTO votes (battle_id, user_id, username)
      VALUES (?, ?, ?)
    `).run(battleId, userId, username || null);
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

function hasVoted(battleId, userId) {
  return !!getDb().prepare('SELECT id FROM votes WHERE battle_id = ? AND user_id = ?').get(battleId, userId);
}

function getVoteCount(battleId) {
  return getDb().prepare('SELECT COUNT(*) as cnt FROM votes WHERE battle_id = ?').get(battleId).cnt;
}

// ─── Stats ───────────────────────────────────────────────────
function getStats() {
  const db = getDb();
  return {
    users:    db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt,
    battles:  db.prepare('SELECT COUNT(*) as cnt FROM battles').get().cnt,
    active:   db.prepare('SELECT COUNT(*) as cnt FROM battles WHERE active = 1').get().cnt,
    finished: db.prepare('SELECT COUNT(*) as cnt FROM battles WHERE active = 0').get().cnt,
  };
}

// ─── Admin helpers ───────────────────────────────────────────
function isAdmin(userId) {
  return !!getDb().prepare('SELECT user_id FROM admins WHERE user_id = ?').get(userId);
}

module.exports = {
  getDb,
  upsertUser,
  getUser,
  getUserBattles,
  getUserActiveBattles,
  createBattle,
  getBattle,
  updateBattleMessageId,
  incrementVotes,
  closeBattle,
  getActiveBattles,
  addVote,
  hasVoted,
  getVoteCount,
  getStats,
  isAdmin,
};
