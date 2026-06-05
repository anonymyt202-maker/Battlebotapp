'use strict';
require('dotenv').config();

const express = require('express');
const path    = require('path');
const bot     = require('./bot');
const db      = require('./database');
const svc     = require('./services/battleService');
const { telegramAuthMiddleware } = require('./middleware/telegramAuth');
const { battleCreateLimit }      = require('./middleware/rateLimit');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Mini App static
app.use('/miniapp', express.static(path.join(__dirname, 'miniapp')));

// ─── Admin middleware ─────────────────────────────────────────
function adminMw(req, res, next) {
  if (!db.isAdmin(req.telegramUser?.id))
    return res.status(403).json({ success: false, error: 'Admin emas' });
  next();
}

// ═══════════════════════════════════════════════════════════
//   PUBLIC
// ═══════════════════════════════════════════════════════════
app.get('/', (_, res) => res.json({ status: 'ok', app: 'Voice Battle', time: new Date().toISOString() }));

app.get('/api/stats', (_, res) => {
  try { res.json({ success: true, ...db.getStats() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
//   PROFILE
// ═══════════════════════════════════════════════════════════
app.get('/api/profile', telegramAuthMiddleware, (req, res) => {
  try {
    const tg      = req.telegramUser;
    const user    = db.upsertUser(tg.id, tg.username, tg.first_name);
    const battles = db.getUserBattles(tg.id);
    const channels = db.getUserChannels(tg.id);

    res.json({
      success: true,
      user: {
        id: user.id, username: user.username,
        first_name: tg.first_name || user.first_name,
        balance: user.balance, created_at: user.created_at,
      },
      stats: {
        total_battles:  battles.length,
        active_battles: battles.filter(b => b.active).length,
        channels:       channels.length,
      },
      channels,
      battles: battles.slice(0, 30).map(b => ({
        id: b.id, battle_name: b.battle_name, channel_id: b.channel_id,
        target_votes: b.target_votes, current_votes: b.current_votes,
        reward: b.reward, active: !!b.active, created_at: b.created_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   KANAL TEKSHIRISH (bot admin?)
// ═══════════════════════════════════════════════════════════
app.post('/api/check-channel', telegramAuthMiddleware, async (req, res) => {
  let ch = (req.body.channel || '').trim();
  if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

  try {
    const me  = await bot.telegram.getMe();
    const mbr = await bot.telegram.getChatMember(ch, me.id);
    const ok  = ['administrator', 'creator'].includes(mbr.status);
    // Kanal foydalanuvchiga tegishli ekanligini tekshir
    const owned = db.isChannelOwner(req.telegramUser.id, ch);
    res.json({
      success: ok && owned,
      bot_admin: ok,
      channel_owned: owned,
      status: mbr.status,
      error: !ok ? 'Bot kanalda admin emas' : (!owned ? 'Bu kanal sizniki emas. /addchannel bilan qo\'shing' : null),
    });
  } catch (e) {
    res.json({ success: false, error: 'Kanal topilmadi: ' + e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   KANAL QO'SHISH (Mini App orqali)
// ═══════════════════════════════════════════════════════════
app.post('/api/add-channel', telegramAuthMiddleware, async (req, res) => {
  try {
    const tg = req.telegramUser;
    let ch   = (req.body.channel || '').trim();
    if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    // Bot admin tekshirish
    let title = ch;
    try {
      const me  = await bot.telegram.getMe();
      const mbr = await bot.telegram.getChatMember(ch, me.id);
      if (!['administrator', 'creator'].includes(mbr.status)) {
        return res.json({ success: false, error: 'Bot kanalda admin emas! Avval botni admin qiling.' });
      }
      const chat = await bot.telegram.getChat(ch);
      title = chat.title || ch;
    } catch (e) {
      return res.json({ success: false, error: 'Kanal topilmadi: ' + e.message });
    }

    db.upsertUser(tg.id, tg.username, tg.first_name);
    const added = db.addChannel(tg.id, ch, title);
    res.json({ success: true, already: !added, channel: { channel_id: ch, title } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   BATTLE YARATISH
// ═══════════════════════════════════════════════════════════
app.post('/api/create-battle', telegramAuthMiddleware, battleCreateLimit, async (req, res) => {
  try {
    const tg = req.telegramUser;
    const { battleName, channelId, targetVotes, reward, imageUrl } = req.body;

    if (!battleName?.trim()) return res.status(400).json({ success: false, error: 'Battle nomi kerak' });
    if (!channelId?.trim())  return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!reward?.trim())     return res.status(400).json({ success: false, error: 'Sovrin kerak' });
    if (!targetVotes || parseInt(targetVotes) < 1)
      return res.status(400).json({ success: false, error: 'Maqsad ovozlar soni kerak' });

    let ch = channelId.trim();
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    // Xavfsizlik: kanal foydalanuvchiga tegishli bo'lishi shart
    if (!db.isChannelOwner(tg.id, ch)) {
      return res.status(403).json({
        success: false,
        error: 'Bu kanal sizniki emas! Avval /addchannel yoki Mini Appdagi "Kanal qo\'shish" orqali qo\'shing.'
      });
    }

    // Bot admin tekshirish
    try {
      const me  = await bot.telegram.getMe();
      const mbr = await bot.telegram.getChatMember(ch, me.id);
      if (!['administrator', 'creator'].includes(mbr.status))
        return res.status(400).json({ success: false, error: 'Bot kanalda admin emas!' });
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Kanal topilmadi: ' + e.message });
    }

    db.upsertUser(tg.id, tg.username, tg.first_name);

    const battle = await svc.createNewBattle(bot, {
      ownerId: tg.id, battleName: battleName.trim(),
      channelId: ch, targetVotes: parseInt(targetVotes),
      reward: reward.trim(), imageUrl: imageUrl?.trim() || null,
    });

    res.json({ success: true, battle });
  } catch (e) {
    console.error('[create-battle]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   BATTLE MA'LUMOTI
// ═══════════════════════════════════════════════════════════
app.get('/api/battle/:id', telegramAuthMiddleware, (req, res) => {
  try {
    const battle = db.getBattle(req.params.id);
    if (!battle) return res.status(404).json({ success: false, error: 'Battle topilmadi' });
    const tg  = req.telegramUser;
    const top = db.getTopParticipants(battle.id, 10);
    const me  = db.getParticipant(battle.id, tg.id);
    res.json({
      success: true,
      battle: {
        id: battle.id, battle_name: battle.battle_name, channel_id: battle.channel_id,
        target_votes: battle.target_votes, current_votes: battle.current_votes,
        reward: battle.reward, active: !!battle.active, created_at: battle.created_at,
      },
      top,
      my_participation: me
        ? { joined: true, votes: me.votes, ref_link: svc.buildRefLink(battle.id, tg.id) }
        : { joined: false },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   FAOL BATTLELAR
// ═══════════════════════════════════════════════════════════
app.get('/api/active-battles', telegramAuthMiddleware, (req, res) => {
  try {
    const battles = db.getActiveBattles().map(b => ({
      id: b.id, battle_name: b.battle_name, channel_id: b.channel_id,
      target_votes: b.target_votes, current_votes: b.current_votes,
      reward: b.reward, created_at: b.created_at,
      top3: db.getTopParticipants(b.id, 3),
    }));
    res.json({ success: true, battles });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   BATTLEGA QO'SHILISH (Mini App)
// ═══════════════════════════════════════════════════════════
app.post('/api/join-battle', telegramAuthMiddleware, async (req, res) => {
  try {
    const tg       = req.telegramUser;
    const battleId = req.body.battleId;
    if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });

    const battle = db.getBattle(battleId);
    if (!battle)        return res.status(404).json({ success: false, error: 'Battle topilmadi' });
    if (!battle.active) return res.status(400).json({ success: false, error: 'Battle tugagan' });

    db.upsertUser(tg.id, tg.username, tg.first_name);

    if (db.isParticipant(battleId, tg.id)) {
      return res.json({ success: true, already: true, ref_link: svc.buildRefLink(battleId, tg.id) });
    }

    db.joinBattle(battleId, tg.id, tg.username || String(tg.id));
    res.json({ success: true, already: false, ref_link: svc.buildRefLink(battleId, tg.id) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
//   ADMIN: users.json (API orqali ham)
// ═══════════════════════════════════════════════════════════
app.get('/api/admin/users-json', telegramAuthMiddleware, adminMw, (req, res) => {
  const users = db.getAllUsers();
  res.setHeader('Content-Disposition', `attachment; filename="users_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(users, null, 2));
});

app.get('/api/admin/stats', telegramAuthMiddleware, adminMw, (_, res) => {
  res.json({ success: true, ...db.getStats() });
});

app.post('/api/admin/close', telegramAuthMiddleware, adminMw, async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });
  await svc.finishBattle(bot, battleId);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//   BOT + SERVER START
// ═══════════════════════════════════════════════════════════
bot.launch({ allowedUpdates: ['message', 'callback_query'] })
  .then(() => console.log(`✅ Bot @${process.env.BOT_USERNAME} ishga tushdi`))
  .catch(e  => console.error('❌ Bot xatosi:', e.message));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`📱 Mini App: ${process.env.MINIAPP_URL}/miniapp`);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
