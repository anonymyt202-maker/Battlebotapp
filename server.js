'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const bot = require('./bot');
const db = require('./database');
const svc = require('./services/battleService');
const { telegramAuthMiddleware } = require('./middleware/telegramAuth');
const { battleCreateLimit } = require('./middleware/rateLimit');

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
app.use('/saved', express.static(path.join(__dirname, 'saved')));

function adminMw(req, res, next) {
  if (!db.isAdmin(req.telegramUser?.id)) {
    return res.status(403).json({ success: false, error: 'Admin emas' });
  }
  next();
}

app.get('/', (_, res) => {
  res.json({ status: 'ok', app: 'Voice Battle', time: new Date().toISOString() });
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
        created_at: user.created_at,
      },
      stats: {
        total_battles: battles.length,
        active_battles: battles.filter(b => b.active).length,
        channels: channels.length,
      },
      channels,
      battles: battles.slice(0, 30),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/check-channel', telegramAuthMiddleware, async (req, res) => {
  let ch = String(req.body.channel || '').trim();
  if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

  try {
    const me = await bot.telegram.getMe();
    const mbr = await bot.telegram.getChatMember(ch, me.id);
    const botAdmin = ['administrator', 'creator'].includes(mbr.status);
    const chat = await bot.telegram.getChat(ch);
    const title = chat.title || ch;
    res.json({
      success: botAdmin,
      bot_admin: botAdmin,
      title,
      status: mbr.status,
      error: botAdmin ? null : 'Bot kanalda admin emas',
    });
  } catch (e) {
    res.json({ success: false, error: 'Kanal topilmadi: ' + e.message });
  }
});

app.post('/api/add-channel', telegramAuthMiddleware, async (req, res) => {
  try {
    const tg = req.telegramUser;
    let ch = String(req.body.channel || '').trim();
    if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    let title = ch;
    try {
      const me = await bot.telegram.getMe();
      const mbr = await bot.telegram.getChatMember(ch, me.id);
      if (!['administrator', 'creator'].includes(mbr.status)) {
        return res.json({ success: false, error: 'Bot kanalda admin emas. Avval botni admin qiling.' });
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

app.post('/api/create-battle', telegramAuthMiddleware, battleCreateLimit, async (req, res) => {
  try {
    const tg = req.telegramUser;
    const {
      battleName,
      channelId,
      targetVotes,
      reward,
      imageUrl,
      winnersCount,
      minWinVotes,
      endMode,
      durationMinutes,
      endsAt,
    } = req.body;

    if (!battleName?.trim()) return res.status(400).json({ success: false, error: 'Battle nomi kerak' });
    if (!channelId?.trim()) return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!reward?.trim()) return res.status(400).json({ success: false, error: 'Sovrin kerak' });
    if (!targetVotes || Number(targetVotes) < 1) return res.status(400).json({ success: false, error: 'Maqsad ovoz kerak' });

    const normalizedMode = String(endMode || 'target');
    if (['time', 'both'].includes(normalizedMode) && (!durationMinutes || Number(durationMinutes) < 1) && !endsAt) {
      return res.status(400).json({ success: false, error: 'Vaqtli battle uchun durationMinutes yoki endsAt kerak' });
    }

    let ch = channelId.trim();
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    if (!db.isChannelOwner(tg.id, ch)) {
      return res.status(403).json({ success: false, error: 'Bu kanal sizniki emas yoki qo‘shilmagan.' });
    }

    const battle = await svc.createNewBattle(bot, {
      ownerId: tg.id,
      battleName: battleName.trim(),
      channelId: ch,
      targetVotes: Number(targetVotes),
      reward: reward.trim(),
      imageUrl: imageUrl?.trim() || null,
      winnersCount: Number(winnersCount) || 1,
      minWinVotes: Number(minWinVotes) || 1,
      endMode: String(endMode || 'target'),
      durationMinutes: durationMinutes ? Number(durationMinutes) : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    });

    res.json({ success: true, battle });
  } catch (e) {
    console.error('[create-battle]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/active-battles', telegramAuthMiddleware, (req, res) => {
  try {
    const battles = db.getActiveBattles().map(b => ({
      ...b,
      top3: db.getTopParticipants(b.id, 3),
    }));
    res.json({ success: true, battles });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/battle/:id', telegramAuthMiddleware, (req, res) => {
  try {
    const battle = db.getBattle(req.params.id);
    if (!battle) return res.status(404).json({ success: false, error: 'Battle topilmadi' });
    const tg = req.telegramUser;
    res.json({
      success: true,
      battle,
      top: db.getTopParticipants(battle.id, 10),
      participants: db.getAllParticipants(battle.id),
      my_participation: db.getParticipant(battle.id, tg.id)
        ? { joined: true, ref_link: svc.buildVoteLink(battle.id, tg.id) }
        : { joined: false },
    });
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
      return res.json({ success: true, already: true, ref_link: svc.buildVoteLink(battleId, tg.id) });
    }

    db.joinBattle(battleId, tg.id, tg.username || `user${tg.id}`);
    await svc.updateChannelPost(bot, battleId);
    res.json({ success: true, already: false, ref_link: svc.buildVoteLink(battleId, tg.id) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/users-json', telegramAuthMiddleware, adminMw, (_, res) => {
  const file = path.join(__dirname, 'saved', 'users.json');
  res.setHeader('Content-Disposition', `attachment; filename="users_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(file);
});

app.get('/api/admin/channels-json', telegramAuthMiddleware, adminMw, (_, res) => {
  const file = path.join(__dirname, 'saved', 'channels.json');
  res.setHeader('Content-Disposition', `attachment; filename="channels_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(file);
});

app.get('/api/admin/battles-json', telegramAuthMiddleware, adminMw, (_, res) => {
  const file = path.join(__dirname, 'saved', 'battles.json');
  res.setHeader('Content-Disposition', `attachment; filename="battles_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(file);
});

app.get('/api/admin/stats', telegramAuthMiddleware, adminMw, (_, res) => {
  res.json({ success: true, ...db.getStats() });
});

app.post('/api/admin/close', telegramAuthMiddleware, adminMw, async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });
  await svc.finishBattle(bot, battleId, 'manual');
  res.json({ success: true });
});

function autoFinishExpiredBattles() {
  const expired = db.getExpiredBattles();
  if (!expired.length) return;
  for (const battle of expired) {
    svc.finishBattle(bot, battle.id, 'time').catch(e => console.log('[autoFinish]', e.message));
  }
}

bot.launch({ allowedUpdates: ['message', 'callback_query'] })
  .then(() => console.log(`✅ Bot @${process.env.BOT_USERNAME || 'bot'} ishga tushdi`))
  .catch(e => console.error('❌ Bot xatosi:', e.message));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`📱 Mini App: ${(process.env.MINIAPP_URL || '')}/miniapp`);
});

setInterval(autoFinishExpiredBattles, 30 * 1000);
setInterval(() => db.persistSnapshots(), 5 * 60 * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
