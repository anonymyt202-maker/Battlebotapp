'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
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

function adminMw(req, res, next) {
  if (!db.isAdmin(req.telegramUser?.id)) {
    return res.status(403).json({ success: false, error: 'Admin emas' });
  }
  next();
}

app.get('/', (_, res) => res.json({ status: 'ok', app: 'Voice Battle', time: new Date().toISOString() }));

app.get('/api/stats', (_, res) => {
  try { res.json({ success: true, ...db.getStats() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
      battles: battles.slice(0, 30).map(b => ({
        id: b.id,
        battle_name: b.battle_name,
        channel_id: b.channel_id,
        target_votes: b.target_votes,
        winners_count: b.winners_count,
        min_votes: b.min_votes,
        end_mode: b.end_mode,
        end_at: b.end_at,
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
  let ch = (req.body.channel || '').trim();
  if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
  try {
    const info = await svc.verifyChannelReady(bot, ch, req.telegramUser.id);
    res.json({
      success: info.ok,
      bot_admin: info.botOk,
      channel_owned: info.userOk,
      status: info.userStatus,
      title: info.chat?.title || ch,
      error: !info.botOk ? 'Bot kanalda admin emas' : (!info.userOk ? 'Bu kanal sizniki emas' : null),
    });
  } catch (e) {
    res.json({ success: false, error: 'Kanal topilmadi: ' + e.message });
  }
});

app.post('/api/add-channel', telegramAuthMiddleware, async (req, res) => {
  try {
    const tg = req.telegramUser;
    let ch = (req.body.channel || '').trim();
    if (!ch) return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    const info = await svc.verifyChannelReady(bot, ch, tg.id);
    if (!info.botOk) return res.json({ success: false, error: 'Bot kanalda admin emas! Avval botni admin qiling.' });
    if (!info.userOk) return res.json({ success: false, error: 'Faqat kanal owner/admin qo\'sha oladi.' });

    const title = info.chat?.title || ch;
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
      battleName, channelId, targetVotes, reward, imageUrl,
      winnersCount, minVotes, endMode, endMinutes,
    } = req.body;

    if (!battleName?.trim()) return res.status(400).json({ success: false, error: 'Battle nomi kerak' });
    if (!channelId?.trim()) return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!reward?.trim()) return res.status(400).json({ success: false, error: 'Sovrin kerak' });

    let ch = channelId.trim();
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    if (!db.isChannelOwner(tg.id, ch)) {
      return res.status(403).json({ success: false, error: 'Bu kanal sizniki emas. Avval kanalni qo\'shing.' });
    }

    const info = await svc.verifyChannelReady(bot, ch, tg.id);
    if (!info.botOk) return res.status(400).json({ success: false, error: 'Bot kanalda admin emas!' });

    const mode = endMode === 'time' ? 'time' : 'votes';
    const goal = parseInt(targetVotes, 10) || 10;
    const winners = parseInt(winnersCount, 10) || 3;
    const min = parseInt(minVotes, 10) || 1;
    let endAt = null;
    if (mode === 'time') {
      const mins = Math.max(1, parseInt(endMinutes, 10) || 60);
      endAt = new Date(Date.now() + mins * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    }

    db.upsertUser(tg.id, tg.username, tg.first_name);
    const battle = await svc.createNewBattle(bot, {
      ownerId: tg.id,
      battleName: battleName.trim(),
      channelId: ch,
      targetVotes: goal,
      winnersCount: winners,
      minVotes: min,
      endMode: mode,
      endAt,
      reward: reward.trim(),
      imageUrl: imageUrl?.trim() || null,
    });

    res.json({ success: true, battle });
  } catch (e) {
    console.error('[create-battle]', e);
    res.status(500).json({ success: false, error: e.message });
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
        winners_count: battle.winners_count,
        min_votes: battle.min_votes,
        end_mode: battle.end_mode,
        end_at: battle.end_at,
        current_votes: battle.current_votes,
        reward: battle.reward,
        active: !!battle.active,
        created_at: battle.created_at,
      },
      top,
      my_participation: me ? {
        joined: true,
        votes: me.votes,
        ref_link: svc.buildRefLink(battle.id, tg.id),
        vote_link: svc.buildVoteLink(battle.id, tg.id),
      } : { joined: false },
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
      winners_count: b.winners_count,
      min_votes: b.min_votes,
      end_mode: b.end_mode,
      end_at: b.end_at,
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
      return res.json({ success: true, already: true, ref_link: svc.buildRefLink(battleId, tg.id), vote_link: svc.buildVoteLink(battleId, tg.id) });
    }

    db.joinBattle(battleId, tg.id, tg.username || String(tg.id));
    res.json({ success: true, already: false, ref_link: svc.buildRefLink(battleId, tg.id), vote_link: svc.buildVoteLink(battleId, tg.id) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/users-json', telegramAuthMiddleware, adminMw, (req, res) => {
  const users = db.getAllUsers();
  const savedDir = path.join(__dirname, 'saved');
  fs.mkdirSync(savedDir, { recursive: true });
  const filePath = path.join(savedDir, `users_${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(filePath);
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

bot.launch({ allowedUpdates: ['message', 'callback_query'] })
  .then(() => console.log(`✅ Bot @${process.env.BOT_USERNAME} ishga tushdi`))
  .catch(e => console.error('❌ Bot xatosi:', e.message));

setInterval(() => {
  svc.scanAndFinishExpiredBattles(bot).catch(err => console.log('[scanExpired interval]', err.message));
}, 30 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`📱 Mini App: ${(process.env.MINIAPP_URL || '')}/miniapp`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
