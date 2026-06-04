// ══════════════════════════════════════════════════
//  bot.js  —  Express + Telegraf | Railway deploy
// ══════════════════════════════════════════════════
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const db = require('./database');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_USERNAME = (process.env.BOT_USERNAME || '').replace(/^@/, '');
const MINIAPP_URL = (process.env.MINIAPP_URL || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'production';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN o\'rnatilmagan!');
  process.exit(1);
}
if (!BOT_USERNAME) {
  console.error('❌ BOT_USERNAME o\'rnatilmagan!');
  process.exit(1);
}
if (!MINIAPP_URL) {
  console.error('❌ MINIAPP_URL o\'rnatilmagan!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeChannel(channel) {
  const text = String(channel || '').trim();
  if (!text) return '';
  return text.startsWith('@') ? text : `@${text}`;
}

function safeParseUser(initData) {
  try {
    const params = new URLSearchParams(initData);
    const raw = params.get('user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function verifyTelegramData(initData) {
  try {
    if (!initData || typeof initData !== 'string') return false;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch (err) {
    console.error('[verifyTelegramData]', err.message);
    return false;
  }
}

function makeDevUser(req) {
  const ip = req.ip || '0.0.0.0';
  return {
    id: 0,
    username: 'dev',
    first_name: 'Dev',
    last_name: '',
    photo_url: '',
    is_dev: true,
    ip,
  };
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-init-data'];

  if (NODE_ENV !== 'production' && (!initData || initData === 'dev_mode')) {
    req.tgUser = makeDevUser(req);
    return next();
  }

  if (!initData) {
    return res.status(401).json({ ok: false, error: 'initData yo\'q' });
  }

  if (!verifyTelegramData(initData)) {
    return res.status(403).json({ ok: false, error: 'initData noto\'g\'ri' });
  }

  const user = safeParseUser(initData);
  if (!user?.id) {
    return res.status(403).json({ ok: false, error: 'User ma\'lumoti topilmadi' });
  }

  req.tgUser = user;
  next();
}

const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const key = String(req.tgUser?.id || req.ip || 'anon');
  const now = Date.now();
  const list = (rateLimitMap.get(key) || []).filter(t => now - t < 10_000);
  if (list.length >= 20) {
    rateLimitMap.set(key, list);
    return res.status(429).json({ ok: false, error: 'Juda ko\'p so\'rov. Biroz kuting.' });
  }
  list.push(now);
  rateLimitMap.set(key, list);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, list] of rateLimitMap.entries()) {
    const fresh = list.filter(t => now - t < 60_000);
    if (fresh.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, fresh);
  }
}, 5 * 60 * 1000);

function mainMenu() {
  return Markup.keyboard([
    [Markup.button.webApp('🎤 Battle yaratish', MINIAPP_URL)],
    ['📋 Battlelarim', '📊 Statistika'],
    ['ℹ️ Yordam'],
  ]).resize();
}

function cancelMenu() {
  return Markup.keyboard([['❌ Bekor qilish']]).resize();
}

function buildProgressBar(current, target) {
  const total = Math.max(1, Number(target) || 1);
  const currentNum = Math.max(0, Number(current) || 0);
  const filled = Math.max(0, Math.min(10, Math.floor((currentNum / total) * 10)));
  return `${'🟦'.repeat(filled)}${'⬜'.repeat(10 - filled)} ${Math.min(100, Math.floor((currentNum / total) * 100))}%`;
}

function buildBattlePost(battle) {
  const status = battle.finished ? '✅ Yakunlandi' : '🟢 Aktiv';
  const bar = buildProgressBar(battle.voteCount, battle.target);

  return (
    `🏆 <b>${escapeHtml(battle.name)}</b>\n\n` +
    `🎁 <b>Sovrin:</b> ${escapeHtml(battle.reward)}\n` +
    `🎯 <b>Maqsad:</b> ${Number(battle.target)} ta ovoz\n` +
    `📌 <b>Holat:</b> ${status}\n\n` +
    `📊 <b>Progress:</b>\n${bar}\n` +
    `<b>${Number(battle.voteCount)}</b> / ${Number(battle.target)} ovoz\n\n` +
    `❗ <b>Shartlar:</b>\n` +
    `• Kanalga obuna bo'ling\n` +
    `• Pastdagi tugmani bosing`
  );
}

function buildBattleKeyboard(battle) {
  const resultUrl = `https://t.me/${BOT_USERNAME}?start=res_${battle.battleId}`;
  if (battle.finished || !battle.active) {
    return Markup.inlineKeyboard([
      [Markup.button.url('📊 Natijalar', resultUrl)],
    ]);
  }

  const voteUrl = `https://t.me/${BOT_USERNAME}?start=vote_${battle.battleId}`;
  return Markup.inlineKeyboard([
    [Markup.button.url(`🗳 ${battle.buttonText || 'Ovoz berish'}`, voteUrl)],
    [Markup.button.url('📊 Natijalar', resultUrl)],
  ]);
}

async function updateChannelPost(battle) {
  if (!battle?.messageId) return;
  try {
    const text = buildBattlePost(battle);
    const keyboard = buildBattleKeyboard(battle);
    if (battle.imageUrl) {
      await bot.telegram.editMessageCaption(
        battle.channel,
        battle.messageId,
        null,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }
      );
    } else {
      await bot.telegram.editMessageText(
        battle.channel,
        battle.messageId,
        null,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }
      );
    }
  } catch (err) {
    console.log('[updateChannelPost]', err.message);
  }
}

async function updateOwnerActiveBattles(ownerId, delta) {
  if (!ownerId) return;
  const owner = db.getUser(ownerId);
  if (!owner) return;
  const next = Math.max(0, Number(owner.activeBattles || 0) + delta);
  db.upsertUser(ownerId, { activeBattles: next });
}

async function finishBattle(battle, lastVoter) {
  const current = db.getBattle(battle.battleId);
  if (!current || current.finished) return current || battle;

  db.updateBattle(battle.battleId, {
    active: false,
    finished: true,
    winner: {
      userId: lastVoter?.id || null,
      username: lastVoter?.username || null,
    },
  });

  await updateOwnerActiveBattles(battle.ownerId, -1);

  const updated = db.getBattle(battle.battleId) || battle;
  try {
    await bot.telegram.sendMessage(
      updated.channel,
      `🏆 <b>BATTLE YAKUNLANDI!</b>\n\n` +
      `📊 Jami ovozlar: <b>${updated.voteCount}</b>\n` +
      `🎁 Sovrin: ${escapeHtml(updated.reward)}\n` +
      `🥇 So'nggi ovoz: @${escapeHtml(lastVoter?.username || String(lastVoter?.id || 'user'))}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.log('[finishBattle channel]', err.message);
  }

  try {
    await bot.telegram.sendMessage(
      updated.ownerId,
      `🏆 <b>Battleingiz yakunlandi!</b>\n\n` +
      `📝 Nomi: ${escapeHtml(updated.name)}\n` +
      `📊 Ovozlar: ${updated.voteCount}/${updated.target}\n` +
      `🎁 Sovrin: ${escapeHtml(updated.reward)}`,
      { parse_mode: 'HTML' }
    );
  } catch {}

  await updateChannelPost(db.getBattle(battle.battleId) || updated);
  return db.getBattle(battle.battleId) || updated;
}

async function closeBattleById(battleId, actorId) {
  const battle = db.getBattle(battleId);
  if (!battle) return { ok: false, error: 'Battle topilmadi' };

  if (!db.isAdmin(actorId) && String(battle.ownerId) !== String(actorId)) {
    return { ok: false, error: 'Ruxsat yo\'q' };
  }

  if (battle.active && !battle.finished) {
    db.updateBattle(battleId, { active: false, finished: true });
    await updateOwnerActiveBattles(battle.ownerId, -1);
  }

  const updated = db.getBattle(battleId);
  if (updated) {
    try {
      await bot.telegram.sendMessage(
        updated.channel,
        `⛔ <b>Battle to'xtatildi</b>\n\n📊 Jami ovozlar: <b>${updated.voteCount}</b>\n🎁 Sovrin: ${escapeHtml(updated.reward)}`,
        { parse_mode: 'HTML' }
      );
    } catch {}
    await updateChannelPost(updated);
  }

  return { ok: true };
}

function ensureUser(reqTgUser) {
  const id = reqTgUser.id;
  const existing = db.getUser(id);
  const payload = {
    id,
    username: reqTgUser.username || existing?.username || null,
    firstName: reqTgUser.first_name || reqTgUser.firstName || existing?.firstName || null,
    photoUrl: reqTgUser.photo_url || existing?.photoUrl || null,
    joinedAt: existing?.joinedAt || Date.now(),
  };
  return db.upsertUser(id, payload);
}

app.get('/api/user', authMiddleware, rateLimit, (req, res) => {
  const user = ensureUser(req.tgUser);
  const battles = db.getUserBattles(req.tgUser.id);
  res.json({
    ok: true,
    user: {
      ...user,
      isAdmin: db.isAdmin(req.tgUser.id),
      createdBattles: battles.length,
      activeBattles: battles.filter(b => b.active && !b.finished).length,
    },
  });
});

app.get('/api/stats', authMiddleware, rateLimit, (req, res) => {
  res.json({ ok: true, stats: db.getStats() });
});

app.get('/api/battles', authMiddleware, rateLimit, (req, res) => {
  const battles = db.getUserBattles(req.tgUser.id);
  res.json({ ok: true, battles });
});

app.post('/api/check-channel', authMiddleware, rateLimit, async (req, res) => {
  let channel = normalizeChannel(req.body?.channel);
  if (!channel) return res.status(400).json({ ok: false, error: 'channel kerak' });

  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(channel, me.id);
    if (!['administrator', 'creator'].includes(member.status)) {
      return res.json({
        ok: false,
        isAdmin: false,
        error: 'Bot kanalda admin emas. Avval botni admin qiling!',
      });
    }

    const info = await bot.telegram.getChat(channel);
    res.json({
      ok: true,
      isAdmin: true,
      channelTitle: info.title || channel,
      channelUsername: channel,
    });
  } catch (err) {
    res.json({
      ok: false,
      isAdmin: false,
      error: 'Kanal topilmadi yoki bot ulanmagan: ' + err.message,
    });
  }
});

app.post('/api/create-battle', authMiddleware, rateLimit, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const channel = normalizeChannel(req.body?.channel);
  const target = Number(req.body?.target);
  const reward = String(req.body?.reward || '').trim();
  const buttonText = String(req.body?.buttonText || '🗳 Ovoz berish').trim() || '🗳 Ovoz berish';
  const imageUrl = String(req.body?.imageUrl || '').trim();

  if (!name || !channel || !target || !reward) {
    return res.status(400).json({ ok: false, error: 'Barcha majburiy maydonlarni to\'ldiring' });
  }

  if (!Number.isInteger(target) || target < 1 || target > 10000) {
    return res.status(400).json({ ok: false, error: 'Maqsad 1 dan 10000 gacha bo\'lishi kerak' });
  }

  const dbUser = ensureUser(req.tgUser);
  if (dbUser?.banned) {
    return res.status(403).json({ ok: false, error: 'Siz ban qilingansiz' });
  }

  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(channel, me.id);
    if (!['administrator', 'creator'].includes(member.status)) {
      return res.json({ ok: false, error: 'Bot kanalda admin emas' });
    }
  } catch (err) {
    return res.json({ ok: false, error: 'Kanal tekshirishda xato: ' + err.message });
  }

  const battle = db.createBattle({
    ownerId: req.tgUser.id,
    ownerUsername: req.tgUser.username || null,
    name: name.slice(0, 100),
    channel,
    target,
    reward: reward.slice(0, 200),
    buttonText: buttonText.slice(0, 50),
    imageUrl: imageUrl || null,
  });

  try {
    const postText = buildBattlePost(battle);
    const keyboard = buildBattleKeyboard(battle);
    const sendOpts = { parse_mode: 'HTML', reply_markup: keyboard.reply_markup };

    const msg = imageUrl
      ? await bot.telegram.sendPhoto(channel, imageUrl, { caption: postText, ...sendOpts })
      : await bot.telegram.sendMessage(channel, postText, sendOpts);

    db.updateBattle(battle.battleId, { messageId: msg.message_id });
    res.json({ ok: true, battle: db.getBattle(battle.battleId) });
  } catch (err) {
    if (battle.active && !battle.finished) {
      await updateOwnerActiveBattles(battle.ownerId, -1);
    }
    db.deleteBattle(battle.battleId);
    res.json({ ok: false, error: 'Kanalga post yubora olmadi: ' + err.message });
  }
});

app.post('/api/vote', authMiddleware, rateLimit, async (req, res) => {
  const battleId = String(req.body?.battleId || '').trim();
  if (!battleId) return res.status(400).json({ ok: false, error: 'battleId kerak' });

  const battle = db.getBattle(battleId);
  if (!battle) return res.json({ ok: false, error: 'Battle topilmadi' });
  if (!battle.active || battle.finished) return res.json({ ok: false, error: 'Battle tugagan' });

  ensureUser(req.tgUser);

  if (db.hasVoted(battleId, req.tgUser.id)) {
    return res.json({ ok: false, error: 'Siz allaqachon ovoz bergansiz' });
  }

  const result = db.castVote(battleId, req.tgUser.id, req.tgUser.username || null);
  if (!result.ok) return res.json({ ok: false, error: 'Ovoz berib bo\'lmadi' });

  const updated = db.getBattle(battleId);
  if (!updated) return res.json({ ok: false, error: 'Battle topilmadi' });

  await updateChannelPost(updated);
  let finished = false;
  if (updated.voteCount >= updated.target) {
    finished = true;
    await finishBattle(updated, req.tgUser);
  }

  res.json({ ok: true, voteCount: updated.voteCount, finished });
});

app.get('/api/battle/:id/check-vote', authMiddleware, rateLimit, (req, res) => {
  res.json({ ok: true, voted: db.hasVoted(req.params.id, req.tgUser.id) });
});

app.delete('/api/battle/:id', authMiddleware, rateLimit, async (req, res) => {
  const battle = db.getBattle(req.params.id);
  if (!battle) return res.json({ ok: false, error: 'Battle topilmadi' });

  if (!db.isAdmin(req.tgUser.id) && String(battle.ownerId) !== String(req.tgUser.id)) {
    return res.status(403).json({ ok: false, error: 'Ruxsat yo\'q' });
  }

  if (battle.active && !battle.finished) {
    await updateOwnerActiveBattles(battle.ownerId, -1);
  }

  const ok = db.deleteBattle(req.params.id);
  res.json({ ok });
});

app.post('/api/admin/close', authMiddleware, rateLimit, async (req, res) => {
  const battleId = String(req.body?.battleId || '').trim();
  const result = await closeBattleById(battleId, req.tgUser.id);
  if (!result.ok) return res.status(403).json(result);
  res.json({ ok: true });
});

app.post('/api/admin/ban', authMiddleware, rateLimit, (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) {
    return res.status(403).json({ ok: false, error: 'Admin emas' });
  }
  const userId = String(req.body?.userId || '').trim();
  const banned = req.body?.banned !== false;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId kerak' });

  db.banUser(userId, banned);
  res.json({ ok: true });
});

app.post('/api/admin/broadcast', authMiddleware, rateLimit, async (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) {
    return res.status(403).json({ ok: false, error: 'Admin emas' });
  }

  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Xabar matni kerak' });

  const users = db.getAllUsers();
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await bot.telegram.sendMessage(user.id, text, { parse_mode: 'HTML' });
      sent += 1;
    } catch {
      failed += 1;
    }
    await new Promise(r => setTimeout(r, 60));
  }

  res.json({ ok: true, sent, failed, total: users.length });
});

app.get('/api/admin/stats', authMiddleware, rateLimit, (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) {
    return res.status(403).json({ ok: false, error: 'Admin emas' });
  }

  res.json({
    ok: true,
    stats: db.getStats(),
    battles: db.getAllBattles().slice(0, 50),
    users: db.getAllUsers().slice(0, 50),
  });
});

const userStates = new Map();
const setState = (id, state) => userStates.set(String(id), state);
const getState = id => userStates.get(String(id)) || null;
const clearState = id => userStates.delete(String(id));

bot.start(async (ctx) => {
  const u = ctx.from;
  ensureUser({
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    photo_url: u.photo_url,
  });

  const user = db.getUser(u.id);
  if (user?.banned) {
    return ctx.reply('🚫 Siz ban qilingansiz. Admin bilan bog\'laning.');
  }

  const payload = ctx.startPayload || '';
  if (payload.startsWith('vote_')) {
    const battleId = payload.slice(5);
    const battle = db.getBattle(battleId);
    if (!battle || !battle.active) {
      return ctx.reply('❌ Battle topilmadi yoki allaqachon tugagan.');
    }

    if (db.hasVoted(battleId, u.id)) {
      return ctx.reply(
        `ℹ️ Siz allaqachon ovoz bergansiz!\n\n📊 Hozirgi ovozlar: <b>${battle.voteCount}</b>/${battle.target}`,
        { parse_mode: 'HTML' }
      );
    }

    const result = db.castVote(battleId, u.id, u.username || null);
    if (!result.ok) {
      return ctx.reply('❌ Ovoz berib bo\'lmadi. Qayta urinib ko\'ring.');
    }

    const updated = db.getBattle(battleId);
    await updateChannelPost(updated);
    if (updated.voteCount >= updated.target) {
      await finishBattle(updated, u);
      return ctx.reply(
        `✅ <b>Ovozingiz qabul qilindi va battle yakunlandi!</b>\n\n` +
        `🏆 Maqsadga yetildi!\n📊 Jami: <b>${updated.voteCount}</b> ovoz\n🎁 Sovrin: ${escapeHtml(updated.reward)}`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
    }

    return ctx.reply(
      `✅ <b>Ovozingiz qabul qilindi!</b>\n\n` +
      `📊 Hozirgi: <b>${updated.voteCount}</b>/${updated.target}\n` +
      `🎁 Sovrin: ${escapeHtml(updated.reward)}`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }

  if (payload.startsWith('res_')) {
    const battleId = payload.slice(4);
    const battle = db.getBattle(battleId);
    if (!battle) return ctx.reply('❌ Battle topilmadi.');

    const bar = buildProgressBar(battle.voteCount, battle.target);
    return ctx.reply(
      `📊 <b>${escapeHtml(battle.name)}</b>\n\n` +
      `${bar}\n<b>${battle.voteCount}</b>/${battle.target} ovoz\n\n` +
      `📌 Holat: ${battle.finished ? '✅ Yakunlandi' : '🟢 Aktiv'}\n` +
      `🎁 Sovrin: ${escapeHtml(battle.reward)}`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }

  return ctx.reply(
    `👋 Salom, <b>${escapeHtml(u.first_name || 'do\'st')}</b>!\n\n` +
    `🎤 <b>Ovoz Battle Bot</b>ga xush kelibsiz!\n\n` +
    `📱 Mini App orqali battle yarating, kanalingizga joylashtiring va ovoz yig'ing!`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

bot.hears('📋 Battlelarim', async (ctx) => {
  const battles = db.getUserBattles(ctx.from.id);
  const active = battles.filter(b => b.active && !b.finished);
  const finished = battles.filter(b => b.finished);

  if (battles.length === 0) {
    return ctx.reply(
      '📋 Sizda hali battle yo\'q.\n\nMini App orqali birinchi battle yarating!',
      mainMenu()
    );
  }

  const rows = [
    ...active.slice(0, 5).map(b => [Markup.button.callback(`🟢 ${b.name.substring(0, 25)} (${b.voteCount}/${b.target})`, `bv_${b.battleId}`)]),
    ...finished.slice(0, 3).map(b => [Markup.button.callback(`✅ ${b.name.substring(0, 25)}`, `bv_${b.battleId}`)]),
  ];

  await ctx.reply(
    `📋 <b>Battlelarim</b>\n\n🟢 Aktiv: <b>${active.length}</b>\n✅ Yakunlangan: <b>${finished.length}</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
  );
});

bot.action(/^bv_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const battle = db.getBattle(ctx.match[1]);
  if (!battle) return ctx.answerCbQuery('Battle topilmadi');

  const bar = buildProgressBar(battle.voteCount, battle.target);
  await ctx.editMessageText(
    `📊 <b>${escapeHtml(battle.name)}</b>\n\n` +
    `${bar}\n<b>${battle.voteCount}</b>/${battle.target} ovoz\n\n` +
    `📢 Kanal: ${escapeHtml(battle.channel)}\n` +
    `🎁 Sovrin: ${escapeHtml(battle.reward)}\n` +
    `📌 Holat: ${battle.finished ? '✅ Yakunlandi' : '🟢 Aktiv'}\n` +
    `📅 Yaratilgan: ${new Date(battle.createdAt).toLocaleDateString('uz-UZ')}`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        battle.active ? [Markup.button.callback('⛔ Battle yopish', `bclose_${battle.battleId}`)] : null,
        [Markup.button.callback('◀️ Orqaga', 'back_battles')],
      ].filter(Boolean)).reply_markup,
    }
  );
});

bot.action(/^bclose_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const battle = db.getBattle(ctx.match[1]);
  if (!battle) return;

  if (!db.isAdmin(ctx.from.id) && String(battle.ownerId) !== String(ctx.from.id)) {
    return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  }

  await closeBattleById(battle.battleId, ctx.from.id);
  await ctx.editMessageText('⛔ Battle muvaffaqiyatli to\'xtatildi.').catch(() => {});
});

bot.action('back_battles', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.deleteMessage().catch(() => {});
});

bot.hears('📊 Statistika', async (ctx) => {
  const stats = db.getStats();
  const battles = db.getUserBattles(ctx.from.id);

  await ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
    `👤 <b>Mening:</b>\n` +
    `🎤 Yaratgan battlelar: <b>${battles.length}</b>\n` +
    `🟢 Aktiv battlelar: <b>${battles.filter(b => !b.finished).length}</b>\n\n` +
    `🌍 <b>Umumiy:</b>\n` +
    `🎤 Jami battlelar: <b>${stats.totalBattles}</b>\n` +
    `🟢 Faol battlelar: <b>${stats.activeBattles}</b>\n` +
    `✅ Tugagan: <b>${stats.finishedBattles}</b>\n` +
    `👥 Foydalanuvchilar: <b>${stats.totalUsers}</b>\n` +
    `📦 Jami ovozlar: <b>${stats.totalVotes}</b>`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('ℹ️ Yordam', async (ctx) => {
  await ctx.reply(
    `ℹ️ <b>Qo'llanma</b>\n\n` +
    `1️⃣ Battle yaratish:\n   Mini App ni oching → formani to'ldiring\n\n` +
    `2️⃣ Shartlar:\n   • Bot kanalingizda admin bo'lishi kerak\n   • Kanal username kiriting\n\n` +
    `3️⃣ Ovoz berish:\n   Kanal postidagi tugmani bosing\n\n` +
    `4️⃣ Battle tugashi:\n   Maqsad ovozga yetganda avto yakunlanadi\n\n` +
    `🤖 Bot: @${escapeHtml(BOT_USERNAME)}`,
    { parse_mode: 'HTML' }
  );
});

bot.command('admin', async (ctx) => {
  if (!db.isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Sizda admin huquqi yo\'q.');
  }

  const stats = db.getStats();

  await ctx.reply(
    `⚙️ <b>Admin Panel</b>\n\n` +
    `👥 Foydalanuvchilar: <b>${stats.totalUsers}</b>\n` +
    `🎤 Jami battlelar: <b>${stats.totalBattles}</b>\n` +
    `🟢 Aktiv: <b>${stats.activeBattles}</b>\n` +
    `📦 Jami ovozlar: <b>${stats.totalVotes}</b>\n` +
    `🚫 Banlangan: <b>${stats.bannedUsers}</b>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('📱 Admin Mini App', `${MINIAPP_URL}?admin=1`)],
        [
          Markup.button.callback('📢 Broadcast', 'adm_bc'),
          Markup.button.callback('📊 Stats', 'adm_stats'),
        ],
        [Markup.button.callback('📋 Battlelar', 'adm_battles')],
      ]),
    }
  );
});

bot.action('adm_bc', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  setState(ctx.from.id, { step: 'broadcast' });
  await ctx.reply('📢 Broadcast xabarini yuboring (HTML qo\'llab-quvvatlanadi):', cancelMenu());
});

bot.action('adm_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = db.getStats();
  await ctx.editMessageText(
    `📊 <b>Bot Statistikasi</b>\n\n` +
    `👥 Foydalanuvchilar: <b>${s.totalUsers}</b>\n` +
    `🚫 Banlangan: <b>${s.bannedUsers}</b>\n` +
    `🎤 Jami battlelar: <b>${s.totalBattles}</b>\n` +
    `🟢 Aktiv: <b>${s.activeBattles}</b>\n` +
    `✅ Tugagan: <b>${s.finishedBattles}</b>\n` +
    `📦 Ovozlar: <b>${s.totalVotes}</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Orqaga', 'adm_back')]]).reply_markup,
    }
  );
});

bot.action('adm_battles', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const battles = db.getAllBattles().slice(0, 20);
  let text = `📋 <b>So\'nggi Battlelar (${battles.length})</b>\n\n`;
  if (battles.length === 0) {
    text += 'Hali battle yo\'q.';
  } else {
    for (const b of battles) {
      text += `${b.finished ? '✅' : '🟢'} ${escapeHtml(b.name).substring(0, 20)} | ${b.voteCount}/${b.target}\n`;
    }
  }
  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Orqaga', 'adm_back')]]).reply_markup,
  });
});

bot.action('adm_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.deleteMessage().catch(() => {});
});

bot.on('text', async (ctx) => {
  const state = getState(ctx.from.id);
  if (!state) return;

  const text = ctx.message.text.trim();

  if (text === '❌ Bekor qilish') {
    clearState(ctx.from.id);
    return ctx.reply('❌ Bekor qilindi.', mainMenu());
  }

  if (state.step === 'broadcast' && db.isAdmin(ctx.from.id)) {
    clearState(ctx.from.id);
    const users = db.getAllUsers();

    await ctx.reply(`📢 ${users.length} ta foydalanuvchiga yuborilmoqda...`);

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.id, text, { parse_mode: 'HTML' });
        sent += 1;
      } catch {
        failed += 1;
      }
      await new Promise(r => setTimeout(r, 60));
    }

    return ctx.reply(
      `✅ <b>Broadcast yakunlandi!</b>\n\n📤 Yuborildi: <b>${sent}</b>\n❌ Xato: <b>${failed}</b>`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }
});


bot.catch((err, ctx) => {
  console.error('[BOT ERROR]', err.message);
  try {
    if (ctx?.callbackQuery) {
      ctx.answerCbQuery('❌ Xato yuz berdi.').catch(() => {});
    }
  } catch {}
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Endpoint topilmadi' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Express server: http://0.0.0.0:${PORT}`);
    console.log(`📁 Static fayllar: ${path.join(__dirname, 'public')}`);
    console.log(`📱 Mini App URL: ${MINIAPP_URL}`);
    console.log(`🌍 Environment: ${NODE_ENV}`);
  });

  await bot.launch({ allowedUpdates: ['message', 'callback_query'] });
  console.log(`✅ Bot @${BOT_USERNAME} ishga tushdi!`);
}

main().catch(err => {
  console.error('❌ Ishga tushirishda xato:', err.message);
  process.exit(1);
});

process.once('SIGINT', () => { bot.stop('SIGINT'); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });
