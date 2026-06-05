'use strict';
require('dotenv').config();

const { Telegraf } = require('telegraf');
const db  = require('./database');
const svc = require('./services/battleService');

const bot = new Telegraf(process.env.BOT_TOKEN);

function getMiniAppUrl() {
  const botUsername = (process.env.BOT_USERNAME || '').replace(/^@/, '');
  if (botUsername) {
    return `https://t.me/${botUsername}?startapp=miniapp`;
  }
  const base = (process.env.MINIAPP_URL || '').replace(/\/$/, '');
  return base ? `${base}/miniapp` : '/miniapp';
}

function parseVotePayload(payload = '') {
  const raw = String(payload || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/^vote[-_]/i, '');
  if (normalized === raw) return null;

  const lastSep = normalized.lastIndexOf('_');
  if (lastSep === -1) return null;

  const battleId = normalized.slice(0, lastSep);
  const participantToken = normalized.slice(lastSep + 1);
  if (!battleId || !participantToken) return null;

  return { battleId, participantToken };
}

// ─── Bloklangan foydalanuvchilar filteri ──────────────────────
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const user = db.getUser(ctx.from.id);
  if (user?.blocked) return;
  return next();
});

// ═══════════════════════════════════════════════════════════
//   /start
// ═══════════════════════════════════════════════════════════
bot.start(async (ctx) => {
  const payload = ctx.startPayload || '';
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

  // ref_BATTLEID_USERID
  if (payload.startsWith('vote-')) {
    const raw   = payload.slice(4);
    const idx   = raw.lastIndexOf('_');
    const battleId      = raw.slice(0, idx);
    const participantId = raw.slice(idx + 1);
    return svc.handleRefVote(bot, ctx, battleId, participantId);
  }

  // join_BATTLEID
  if (payload.startsWith('join_')) {
    return svc.joinBattle(bot, ctx, payload.slice(5));
  }

  // vote-BATTLEID-TOKEN / vote_BATTLEID_TOKEN
  const vote = parseVotePayload(payload);
  if (vote) {
    return svc.handleRefVote(bot, ctx, vote.battleId, vote.participantToken);
  }

  const miniUrl = getMiniAppUrl();
  return ctx.reply(
    `👋 Salom, <b>${ctx.from.first_name}</b>!\n\n` +
    `🏆 <b>Voice Battle Bot</b>ga xush kelibsiz!\n\n` +
    `🎤 Battle yaratish yoki ishtirok etish uchun pastdagi tugmani bosing:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎤 Battle yaratish', url: miniUrl }],
          [{ text: '📢 Kanal qo\'shish', callback_data: 'add_channel_start' }],
        ]
      }
    }
  );
});

// ═══════════════════════════════════════════════════════════
//   /mychannels — Mening kanallarim
// ═══════════════════════════════════════════════════════════
bot.command('mychannels', (ctx) => {
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const channels = db.getUserChannels(ctx.from.id);
  if (!channels.length) {
    return ctx.reply(
      '📢 Sizda hali qo\'shilgan kanal yo\'q.\n\n/addchannel @kanal_username — kanal qo\'shish',
      { parse_mode: 'HTML' }
    );
  }
  const lines = channels.map((c, i) =>
    `${i + 1}. <b>${c.title || c.channel_id}</b> — <code>${c.channel_id}</code>`
  ).join('\n');
  ctx.reply(
    `📢 <b>Sizning kanallaringiz:</b>\n\n${lines}\n\n` +
    `Kanal qo'shish: /addchannel @kanal_username\n` +
    `Kanal o'chirish: /removechannel @kanal_username`,
    { parse_mode: 'HTML' }
  );
});

// ═══════════════════════════════════════════════════════════
//   /addchannel @username
// ═══════════════════════════════════════════════════════════
bot.command('addchannel', async (ctx) => {
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (!parts[1]) {
    return ctx.reply(
      '❌ Foydalanish: <code>/addchannel @kanal_username</code>\n\n' +
      '📌 Bot kanalda admin bo\'lishi kerak!',
      { parse_mode: 'HTML' }
    );
  }
  await svc.addChannelForUser(bot, ctx, parts[1]);
});

// ═══════════════════════════════════════════════════════════
//   /removechannel @username
// ═══════════════════════════════════════════════════════════
bot.command('removechannel', (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (!parts[1]) return ctx.reply('Foydalanish: /removechannel @kanal_username');
  let ch = parts[1].trim();
  if (!ch.startsWith('@')) ch = '@' + ch;
  db.removeChannel(ctx.from.id, ch);
  ctx.reply(`🗑 <code>${ch}</code> kanallar ro'yxatidan olib tashlandi.`, { parse_mode: 'HTML' });
});

// ═══════════════════════════════════════════════════════════
//   callback_query
// ═══════════════════════════════════════════════════════════
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

  // Kanal qo'shish boshlash
  if (data === 'add_channel_start') {
    await ctx.answerCbQuery();
    return ctx.reply(
      `📢 <b>Kanal qo'shish</b>\n\n` +
      `Botni kanalingizga admin qilib qo'shib, keyin:\n\n` +
      `<code>/addchannel @kanal_username</code>\n\n` +
      `ni yuboring.`,
      { parse_mode: 'HTML' }
    );
  }

  // Reyting yangilash
  if (data.startsWith('refresh_')) {
    const battleId = data.slice(8);
    const battle   = db.getBattle(battleId);
    if (!battle)        return ctx.answerCbQuery('❌ Battle topilmadi', { show_alert: true });
    if (!battle.active) return ctx.answerCbQuery('❌ Battle tugagan', { show_alert: true });
    await svc.updateChannelPost(bot, battle);
    return ctx.answerCbQuery('✅ Reyting yangilandi!');
  }

  // Obuna tekshirib join
  if (data.startsWith('chk_join_')) {
    await ctx.answerCbQuery();
    return svc.joinBattle(bot, ctx, data.slice(9));
  }

  // Obuna tekshirib vote
  if (data.startsWith('chk_vote_')) {
    const rest  = data.slice(9);
    const idx   = rest.lastIndexOf('_');
    const battleId      = rest.slice(0, idx);
    const participantId = rest.slice(idx + 1);
    await ctx.answerCbQuery();
    return svc.handleRefVote(bot, ctx, battleId, participantId);
  }

  await ctx.answerCbQuery();
});

// ═══════════════════════════════════════════════════════════
//   ADMIN HELPERS
// ═══════════════════════════════════════════════════════════
function requireAdmin(ctx, next) {
  if (!db.isAdmin(ctx.from.id)) return ctx.reply('❌ Siz admin emassiz.');
  return next();
}

// /admin
bot.command('admin', requireAdmin, (ctx) => {
  ctx.reply(
    `🛡 <b>Admin Panel</b>\n\n` +
    `/admin_stats — Statistika\n` +
    `/admin_battles — Faol battlelar\n` +
    `/admin_close ID — Battle yopish\n` +
    `/admin_delete ID — Battle o'chirish\n` +
    `/admin_rating ID — Reyting\n` +
    `/admin_block UID — Bloklash\n` +
    `/admin_unblock UID — Blokdan chiqarish\n` +
    `/admin_broadcast MATN — Broadcast\n` +
    `/admin_users — Users.json yuklash\n` +
    `/admin_channels — Barcha kanallar\n` +
    `/admin_addchannel @username — Kanal qo'shish`,
    { parse_mode: 'HTML' }
  );
});

// /admin_stats
bot.command('admin_stats', requireAdmin, (ctx) => {
  const s = db.getStats();
  ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
    `👤 Foydalanuvchilar: <b>${s.users}</b>\n` +
    `🏆 Jami battlelar: <b>${s.battles}</b>\n` +
    `⚡ Faol: <b>${s.active}</b>\n` +
    `✅ Yakunlangan: <b>${s.finished}</b>\n` +
    `📦 Ovozlar: <b>${s.votes}</b>\n` +
    `👥 Ishtirokchilar: <b>${s.participants}</b>\n` +
    `📢 Kanallar: <b>${s.channels}</b>`,
    { parse_mode: 'HTML' }
  );
});

// /admin_users — Users.json ni adminга yuborish
bot.command('admin_users', requireAdmin, async (ctx) => {
  try {
    const users = db.getAllUsers();
    const json  = JSON.stringify(users, null, 2);
    const buf   = Buffer.from(json, 'utf8');

    await ctx.replyWithDocument(
      { source: buf, filename: `users_${Date.now()}.json` },
      {
        caption: `👤 <b>Foydalanuvchilar bazasi</b>\n\nJami: ${users.length} ta\nVaqt: ${new Date().toLocaleString('uz')}`,
        parse_mode: 'HTML'
      }
    );
  } catch (e) {
    ctx.reply('❌ Xato: ' + e.message);
  }
});

// /admin_channels
bot.command('admin_channels', requireAdmin, (ctx) => {
  const channels = db.getAllChannels();
  if (!channels.length) return ctx.reply('Hali kanal yo\'q.');
  const lines = channels.map(c =>
    `• <code>${c.channel_id}</code> → user <code>${c.owner_id}</code> — ${c.title || '—'}`
  ).join('\n');
  ctx.reply(`📢 <b>Barcha kanallar:</b>\n\n${lines}`, { parse_mode: 'HTML' });
});

// /admin_addchannel @username
bot.command('admin_addchannel', requireAdmin, async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (!parts[1]) {
    return ctx.reply('Foydalanish: /admin_addchannel @kanal_username');
  }
  await svc.addChannelForUser(bot, ctx, parts[1], { forceOwnerId: ctx.from.id, adminMode: true });
});

// /admin_battles
bot.command('admin_battles', requireAdmin, (ctx) => {
  const battles = db.getActiveBattles();
  if (!battles.length) return ctx.reply('Faol battle yo\'q.');
  const lines = battles.map(b =>
    `• <code>${b.id}</code> — ${b.battle_name} (${b.current_votes}/${b.target_votes})`
  ).join('\n');
  ctx.reply(`⚡ <b>Faol battlelar:</b>\n\n${lines}`, { parse_mode: 'HTML' });
});

// /admin_close ID
bot.command('admin_close', requireAdmin, async (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!id) return ctx.reply('Foydalanish: /admin_close BATTLE_ID');
  if (!db.getBattle(id)) return ctx.reply('❌ Battle topilmadi.');
  await svc.finishBattle(bot, id);
  ctx.reply(`✅ Battle <code>${id}</code> yopildi.`, { parse_mode: 'HTML' });
});

// /admin_delete ID
bot.command('admin_delete', requireAdmin, async (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!id) return ctx.reply('Foydalanish: /admin_delete BATTLE_ID');
  const battle = db.getBattle(id);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  try { await bot.telegram.deleteMessage(battle.channel_id, battle.message_id); } catch (e) {}
  db.deleteBattle(id);
  ctx.reply(`🗑 Battle <code>${id}</code> o'chirildi.`, { parse_mode: 'HTML' });
});

// /admin_rating ID
bot.command('admin_rating', requireAdmin, (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!id) return ctx.reply('Foydalanish: /admin_rating BATTLE_ID');
  const battle = db.getBattle(id);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  ctx.reply(
    `📈 <b>${battle.battle_name} — Reyting</b>\n\n${svc.buildRatingLines(id, 20)}`,
    { parse_mode: 'HTML' }
  );
});

// /admin_block UID
bot.command('admin_block', requireAdmin, (ctx) => {
  const uid = parseInt(ctx.message.text.trim().split(/\s+/)[1]);
  if (!uid) return ctx.reply('Foydalanish: /admin_block USER_ID');
  db.blockUser(uid, true);
  ctx.reply(`🚫 Foydalanuvchi <code>${uid}</code> bloklandi.`, { parse_mode: 'HTML' });
});

// /admin_unblock UID
bot.command('admin_unblock', requireAdmin, (ctx) => {
  const uid = parseInt(ctx.message.text.trim().split(/\s+/)[1]);
  if (!uid) return ctx.reply('Foydalanish: /admin_unblock USER_ID');
  db.blockUser(uid, false);
  ctx.reply(`✅ Foydalanuvchi <code>${uid}</code> blokdan chiqarildi.`, { parse_mode: 'HTML' });
});

// /admin_broadcast MATN
bot.command('admin_broadcast', requireAdmin, async (ctx) => {
  const text = ctx.message.text.replace('/admin_broadcast', '').trim();
  if (!text) return ctx.reply('Foydalanish: /admin_broadcast Matn');
  const users = db.getAllUsers().filter(u => !u.blocked);
  let ok = 0, fail = 0;
  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.id, text, { parse_mode: 'HTML' });
      ok++;
    } catch { fail++; }
    await new Promise(r => setTimeout(r, 35));
  }
  ctx.reply(`📤 Broadcast:\n✅ Yuborildi: ${ok}\n❌ Xato: ${fail}`);
});

module.exports = bot;
