'use strict';

require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const db = require('./database');
const svc = require('./services/battleService');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const user = db.getUser(ctx.from.id);
  if (user?.blocked) return;
  return next();
});

function requireAdmin(ctx, next) {
  if (!db.isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Siz admin emassiz.');
  }
  return next();
}

function extractStartPayload(ctx) {
  return String(ctx.startPayload || '').trim();
}

function parseVotePayload(payload) {
  const raw = payload.replace(/^vote_|^ref_/, '');
  const idx = raw.lastIndexOf('-');
  if (idx === -1) return null;
  const battleId = raw.slice(0, idx);
  const participantUserId = raw.slice(idx + 1);
  return { battleId, participantUserId };
}

bot.start(async (ctx) => {
  const payload = extractStartPayload(ctx);

  if (payload.startsWith('join_')) {
    return svc.joinBattle(bot, ctx, payload.slice(5));
  }

  if (payload.startsWith('vote_') || payload.startsWith('ref_')) {
    const parsed = parseVotePayload(payload);
    if (!parsed) return ctx.reply('❌ Noto‘g‘ri havola.');
    return svc.handleVote(bot, ctx, parsed.battleId, parsed.participantUserId);
  }

  const miniUrl = `${process.env.MINIAPP_URL || ''}/miniapp`;
  return ctx.reply(
    `👋 Salom, <b>${ctx.from.first_name || ctx.from.username || 'do‘st'}</b>!\n\n` +
    `🏆 Voice Battle botga xush kelibsiz.\n\n` +
    `Pastdagi tugma orqali mini appni oching.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Mini Appni ochish', web_app: { url: miniUrl } }],
          [{ text: '📢 Kanal qo‘shish', callback_data: 'add_channel_start' }],
        ]
      }
    }
  );
});

bot.command('mychannels', (ctx) => {
  const channels = db.getUserChannels(ctx.from.id);
  if (!channels.length) {
    return ctx.reply('📢 Sizda hali kanal yo‘q.\n\n/addchannel @kanal_username');
  }
  const text = channels.map((c, i) => `${i + 1}. <b>${c.title || c.channel_id}</b> — <code>${c.channel_id}</code>`).join('\n');
  ctx.reply(`📢 <b>Sizning kanallaringiz:</b>\n\n${text}`, { parse_mode: 'HTML' });
});

bot.command('addchannel', async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (!parts[1]) {
    return ctx.reply('Foydalanish: <code>/addchannel @kanal_username</code>\n\nBot kanalga admin qilingan bo‘lishi kerak.', { parse_mode: 'HTML' });
  }
  return svc.addChannelForUser(bot, ctx, parts[1]);
});

bot.command('removechannel', (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (!parts[1]) return ctx.reply('Foydalanish: /removechannel @kanal_username');
  let ch = parts[1].trim();
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
  db.removeChannel(ctx.from.id, ch);
  ctx.reply(`🗑 <code>${ch}</code> kanali o‘chirildi.`, { parse_mode: 'HTML' });
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

  if (data === 'add_channel_start') {
    await ctx.answerCbQuery();
    return ctx.reply(
      `📢 <b>Kanal qo‘shish</b>\n\nBotni kanalingizga admin qiling, keyin:\n<code>/addchannel @kanal_username</code>`,
      { parse_mode: 'HTML' }
    );
  }

  if (data.startsWith('refresh_')) {
    await ctx.answerCbQuery();
    const battleId = data.slice(8);
    const battle = db.getBattle(battleId);
    if (!battle) return ctx.reply('❌ Battle topilmadi.');
    return svc.updateChannelPost(bot, battleId);
  }

  if (data.startsWith('chk_join_')) {
    await ctx.answerCbQuery();
    return svc.joinBattle(bot, ctx, data.slice(9));
  }

  if (data.startsWith('chk_vote_')) {
    await ctx.answerCbQuery();
    const rest = data.slice(9);
    const idx = rest.lastIndexOf('_');
    if (idx === -1) return ctx.reply('❌ Noto‘g‘ri ma’lumot.');
    const battleId = rest.slice(0, idx);
    const participantId = rest.slice(idx + 1);
    return svc.handleVote(bot, ctx, battleId, participantId);
  }

  await ctx.answerCbQuery();
});

bot.command('admin', requireAdmin, (ctx) => {
  ctx.reply(
    `🛡 <b>Admin panel</b>\n\n` +
    `/admin_stats — statistika\n` +
    `/admin_battles — battlelar\n` +
    `/admin_close ID — battle yopish\n` +
    `/admin_delete ID — battle o‘chirish\n` +
    `/admin_rating ID — reyting\n` +
    `/admin_block UID — bloklash\n` +
    `/admin_unblock UID — blokdan chiqarish\n` +
    `/admin_broadcast MATN — hammasiga yuborish\n` +
    `/admin_users — users.json yuborish\n` +
    `/admin_channels — channel ro‘yxati`,
    { parse_mode: 'HTML' }
  );
});

bot.command('admin_stats', requireAdmin, (ctx) => {
  const s = db.getStats();
  ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
    `👤 Users: <b>${s.users}</b>\n` +
    `🏆 Battles: <b>${s.battles}</b>\n` +
    `⚡ Active: <b>${s.active}</b>\n` +
    `✅ Finished: <b>${s.finished}</b>\n` +
    `📦 Votes: <b>${s.votes}</b>\n` +
    `👥 Participants: <b>${s.participants}</b>\n` +
    `📢 Channels: <b>${s.channels}</b>`,
    { parse_mode: 'HTML' }
  );
});

bot.command('admin_users', requireAdmin, async (ctx) => {
  try {
    const file = process.env.DATA_DIR ? `${process.env.DATA_DIR}/users.json` : `${__dirname}/saved/users.json`;
    await ctx.replyWithDocument({ source: file, filename: `users_${Date.now()}.json` }, {
      caption: `👤 <b>Users export</b>\n\nJami: ${db.getAllUsers().length}`,
      parse_mode: 'HTML',
    });
  } catch (e) {
    ctx.reply('❌ Xato: ' + e.message);
  }
});

bot.command('admin_channels', requireAdmin, (ctx) => {
  const channels = db.getAllChannels();
  if (!channels.length) return ctx.reply('Hali kanal yo‘q.');
  const text = channels.map(c => `• <code>${c.channel_id}</code> → <code>${c.owner_id}</code> — ${c.title || '—'}`).join('\n');
  ctx.reply(`📢 <b>Kanallar</b>\n\n${text}`, { parse_mode: 'HTML' });
});

bot.command('admin_battles', requireAdmin, (ctx) => {
  const battles = db.getAllBattles();
  if (!battles.length) return ctx.reply('Battle yo‘q.');
  const text = battles.map(b => `• <code>${b.id}</code> — ${b.battle_name} (${b.current_votes}/${b.target_votes}) — ${b.active ? 'active' : 'closed'}`).join('\n');
  ctx.reply(`🏆 <b>Battles</b>\n\n${text}`, { parse_mode: 'HTML' });
});

bot.command('admin_close', requireAdmin, async (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!id) return ctx.reply('Foydalanish: /admin_close BATTLE_ID');
  await svc.finishBattle(bot, id, 'manual');
  ctx.reply(`✅ Battle <code>${id}</code> yopildi.`, { parse_mode: 'HTML' });
});

bot.command('admin_delete', requireAdmin, async (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!id) return ctx.reply('Foydalanish: /admin_delete BATTLE_ID');
  const battle = db.getBattle(id);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  try {
    if (battle.channel_id && battle.message_id) {
      await bot.telegram.deleteMessage(battle.channel_id, battle.message_id);
    }
  } catch {}
  db.deleteBattle(id);
  ctx.reply(`🗑 Battle <code>${id}</code> o‘chirildi.`, { parse_mode: 'HTML' });
});

bot.command('admin_rating', requireAdmin, (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!id) return ctx.reply('Foydalanish: /admin_rating BATTLE_ID');
  const battle = db.getBattle(id);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  ctx.reply(
    `📈 <b>${battle.battle_name}</b>\n\n${svc.buildRatingLines(id, 20)}`,
    { parse_mode: 'HTML' }
  );
});

bot.command('admin_block', requireAdmin, (ctx) => {
  const uid = Number(ctx.message.text.trim().split(/\s+/)[1]);
  if (!uid) return ctx.reply('Foydalanish: /admin_block USER_ID');
  db.blockUser(uid, true);
  ctx.reply(`🚫 <code>${uid}</code> bloklandi.`, { parse_mode: 'HTML' });
});

bot.command('admin_unblock', requireAdmin, (ctx) => {
  const uid = Number(ctx.message.text.trim().split(/\s+/)[1]);
  if (!uid) return ctx.reply('Foydalanish: /admin_unblock USER_ID');
  db.blockUser(uid, false);
  ctx.reply(`✅ <code>${uid}</code> blokdan chiqarildi.`, { parse_mode: 'HTML' });
});

bot.command('admin_broadcast', requireAdmin, async (ctx) => {
  const text = ctx.message.text.replace('/admin_broadcast', '').trim();
  if (!text) return ctx.reply('Foydalanish: /admin_broadcast MATN');
  const users = db.getAllUsers().filter(u => !u.blocked);
  let ok = 0, fail = 0;
  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.id, text, { parse_mode: 'HTML' });
      ok++;
    } catch {
      fail++;
    }
    await new Promise(r => setTimeout(r, 20));
  }
  ctx.reply(`📤 Broadcast tugadi.\n✅ ${ok}\n❌ ${fail}`);
});

module.exports = bot;
