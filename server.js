'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const bot = require('./bot');
const db = require('./database');
const svc = require('./services/battleService');
const { telegramAuthMiddleware } = require('./middleware/telegramAuth');
const { battleCreateLimit, voteLimit } = require('./middleware/rateLimit');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use('/miniapp', express.static(path.join(__dirname, 'miniapp')));

function normalizeChannel(raw) {
  let ch = String(raw || '').trim();
  if (!ch) return ch;
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
  return ch;
}

function adminMw(req, res, next) {
  if (!db.isAdmin(req.telegramUser?.id)) {
    return res.status(403).json({ success: false, error: 'Admin emas' });
  }
  next();
}

app.get('/', (_, res) => {
  res.json({
    status: 'ok',
    app: 'Voice Battle',
    time: new Date().toISOString(),
  });
});

app.get('/api/stats', (_, res) => {
  try {
    res.json({ success: true, ...db.getStats() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/profile', telegramAuthMiddleware, (req, res) => {
  try {
    const tg = req.telegramUser;
    const user = db.upsertUser(tg.id, tg.username, tg.first_name);
    const battles = db.getUserBattles(tg.id);
    const channels = db.getUserChannels(tg.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        first_name: tg.first_name || user.first_name,
        balance: user.balance,
        blocked: user.blocked,
        created_at: user.created_at,
      },
      stats: {
        total_battles: battles.length,
        active_battles: battles.filter(b => b.active === 1).length,
        channels: channels.length,
      },
      channels,
      battles: battles.slice(0, 30).map(b => ({
        id: b.id,
        battle_name: b.battle_name,
        channel_id: b.channel_id,
        target_votes: b.target_votes,
        min_win_votes: b.min_win_votes,
        places_count: b.places_count,
        current_votes: b.current_votes,
        reward: b.reward,
        active: !!b.active,
        created_at: b.created_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/check-channel', telegramAuthMiddleware, async (req, res) => {
  const ch = normalizeChannel(req.body.channel);
  if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });

  try {
    await svc.assertCanManageChannel(bot, ch, req.telegramUser.id);
    res.json({ success: true, bot_admin: true, channel_owned: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/add-channel', telegramAuthMiddleware, async (req, res) => {
  try {
    const tg = req.telegramUser;
    const ch = normalizeChannel(req.body.channel);
    if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });

    await svc.assertCanManageChannel(bot, ch, tg.id);

    const chat = await bot.telegram.getChat(ch);
    const title = chat?.title || ch;

    const added = db.addChannel(tg.id, ch, title);
    db.upsertUser(tg.id, tg.username, tg.first_name);

    res.json({
      success: true,
      already: !added,
      channel: { channel_id: ch, title },
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/create-battle', telegramAuthMiddleware, battleCreateLimit, async (req, res) => {
  try {
    const tg = req.telegramUser;
    const {
      battleName,
      channelId,
      targetVotes,
      minWinVotes,
      placesCount,
      reward,
      buttonText,
      imageUrl,
    } = req.body;

    if (!battleName?.trim()) return res.status(400).json({ success: false, error: 'Battle nomi kerak' });
    if (!channelId?.trim()) return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!reward?.trim()) return res.status(400).json({ success: false, error: 'Sovrin kerak' });
    if (!targetVotes || parseInt(targetVotes, 10) < 1) {
      return res.status(400).json({ success: false, error: 'Maqsad ovozlar soni kerak' });
    }

    const ch = normalizeChannel(channelId);

    // faqat kanal owneri va bot admin bo'lsa battle yaratiladi
    await svc.assertCanManageChannel(bot, ch, tg.id);

    // owner channels ga avtomatik qo'shib qo'yiladi
    try {
      const chat = await bot.telegram.getChat(ch);
      const title = chat?.title || ch;
      db.addChannel(tg.id, ch, title);
    } catch (_) {}

    db.upsertUser(tg.id, tg.username, tg.first_name);

    const battle = await svc.createNewBattle(bot, {
      ownerId: tg.id,
      battleName: battleName.trim(),
      channelId: ch,
      targetVotes: parseInt(targetVotes, 10),
      minWinVotes: parseInt(minWinVotes, 10) || 1,
      placesCount: parseInt(placesCount, 10) || 3,
      reward: reward.trim(),
      buttonText: buttonText?.trim() || '🔥 Ovoz berish',
      imageUrl: imageUrl?.trim() || null,
    });

    res.json({ success: true, battle });
  } catch (e) {
    console.error('[create-battle]', e);
    res.status(403).json({ success: false, error: e.message });
  }
});

app.get('/api/battle/:id', telegramAuthMiddleware, (req, res) => {
  try {
    const battle = db.getBattle(req.params.id);
    if (!battle) return res.status(404).json({ success: false, error: 'Battle topilmadi' });

    const tg = req.telegramUser;
    const top = db.getTopParticipants(battle.id, 10);
    const me = db.getParticipant(battle.id, tg.id);

    res.json({
      success: true,
      battle: {
        id: battle.id,
        battle_name: battle.battle_name,
        channel_id: battle.channel_id,
        target_votes: battle.target_votes,
        min_win_votes: battle.min_win_votes,
        places_count: battle.places_count,
        current_votes: battle.current_votes,
        reward: battle.reward,
        active: !!battle.active,
        created_at: battle.created_at,
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

app.get('/api/active-battles', telegramAuthMiddleware, (req, res) => {
  try {
    const battles = db.getActiveBattles().map(b => ({
      id: b.id,
      battle_name: b.battle_name,
      channel_id: b.channel_id,
      target_votes: b.target_votes,
      min_win_votes: b.min_win_votes,
      places_count: b.places_count,
      current_votes: b.current_votes,
      reward: b.reward,
      created_at: b.created_at,
      top3: db.getTopParticipants(b.id, 3),
    }));
    res.json({ success: true, battles });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/join-battle', telegramAuthMiddleware, async (req, res) => {
  try {
    const tg = req.telegramUser;
    const battleId = req.body.battleId;
    if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });

    const battle = db.getBattle(battleId);
    if (!battle) return res.status(404).json({ success: false, error: 'Battle topilmadi' });
    if (!battle.active) return res.status(400).json({ success: false, error: 'Battle tugagan' });

    db.upsertUser(tg.id, tg.username, tg.first_name);

    if (db.isParticipant(battleId, tg.id)) {
      return res.json({
        success: true,
        already: true,
        ref_link: svc.buildRefLink(battleId, tg.id),
      });
    }

    db.joinBattle(battleId, tg.id, tg.username || String(tg.id));

    await svc.updateChannelPost(bot, db.getBattle(battleId));

    res.json({
      success: true,
      already: false,
      ref_link: svc.buildRefLink(battleId, tg.id),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/vote', telegramAuthMiddleware, voteLimit, async (req, res) => {
  try {
    const tg = req.telegramUser;
    const { battleId, participantId, participantUsername } = req.body;
    const participant = participantId || participantUsername;

    if (!battleId || !participant) {
      return res.status(400).json({ success: false, error: 'battleId va participant kerak' });
    }

    db.upsertUser(tg.id, tg.username, tg.first_name);

    const fakeCtx = { from: tg, reply: () => null };
    const result = await svc.handleRefVote(bot, fakeCtx, battleId, participant);

    res.json(result || { success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/stats', telegramAuthMiddleware, adminMw, (_, res) => {
  res.json({ success: true, ...db.getStats() });
});

app.get('/api/admin/users-json', telegramAuthMiddleware, adminMw, (req, res) => {
  const users = db.getAllUsers();
  res.setHeader('Content-Disposition', `attachment; filename="users_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(users, null, 2));
});

app.get('/api/admin/channels', telegramAuthMiddleware, adminMw, (_, res) => {
  res.json({ success: true, channels: db.getAllChannels() });
});

app.post('/api/admin/close', telegramAuthMiddleware, adminMw, async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });

  try {
    await svc.finishBattle(bot, battleId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/delete', telegramAuthMiddleware, adminMw, async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });

  const battle = db.getBattle(battleId);
  if (!battle) return res.status(404).json({ success: false, error: 'Battle topilmadi' });

  try {
    if (battle.message_id) {
      try {
        await bot.telegram.deleteMessage(battle.channel_id, battle.message_id);
      } catch (_) {}
    }
    db.deleteBattle(battleId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/block', telegramAuthMiddleware, adminMw, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: 'userId kerak' });
  db.blockUser(Number(userId), true);
  res.json({ success: true });
});

app.post('/api/admin/unblock', telegramAuthMiddleware, adminMw, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: 'userId kerak' });
  db.blockUser(Number(userId), false);
  res.json({ success: true });
});

app.post('/api/admin/broadcast', telegramAuthMiddleware, adminMw, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text kerak' });

  const users = db.getAllUsers().filter(u => !u.blocked);
  let ok = 0;
  let fail = 0;

  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.id, text.trim(), { parse_mode: 'HTML' });
      ok++;
    } catch (_) {
      fail++;
    }
    await new Promise(r => setTimeout(r, 35));
  }

  res.json({ success: true, sent: ok, failed: fail });
});

bot.launch({ allowedUpdates: ['message', 'callback_query'] })
  .then(() => console.log(`✅ Bot ishga tushdi! @${process.env.BOT_USERNAME || 'bot'}`))
  .catch(err => console.error('❌ Bot xatosi:', err.message));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server ishga tushdi: http://localhost:${PORT}`);
  console.log(`📱 Mini App: ${(process.env.MINIAPP_URL || '').replace(/\/$/, '')}/miniapp`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;