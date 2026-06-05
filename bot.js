'use strict';

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db = require('./database');
const svc = require('./services/battleService');

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  throw new Error('BOT_TOKEN topilmadi');
}

const bot = new Telegraf(botToken);
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);

function normalizeChannel(raw) {
  let ch = String(raw || '').trim();
  if (!ch) return ch;
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
  return ch;
}

function isAdmin(userId) {
  return db.isAdmin(userId) || (ADMIN_ID && Number(userId) === ADMIN_ID);
}

function mainMenu() {
  return Markup.keyboard([
    ['🎤 Battle yaratish'],
    ['📊 Statistika'],
    ['ℹ️ Yordam'],
  ]).resize();
}

function miniAppLink() {
  const username = String(process.env.BOT_USERNAME || '').replace('@', '');
  if (!username) return 'https://t.me/';
  return `https://t.me/${username}?startapp=app`;
}

function webAppButton() {
  return Markup.inlineKeyboard([
    [Markup.button.url('🎤 Battle yaratish', miniAppLink())],
  ]);
}

bot.start(async (ctx) => {
  const payload = String(ctx.startPayload || '').trim();

  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

  if (payload.startsWith('vote-')) {
    const rest = payload.slice(5);
    const idx = rest.indexOf('-');
    if (idx > 0) {
      const battleId = rest.slice(0, idx);
      const participantIdentifier = rest.slice(idx + 1);
      return svc.handleRefVote(bot, ctx, battleId, participantIdentifier);
    }
  }

  if (payload.startsWith('join_') || payload.startsWith('join-')) {
    const battleId = payload.replace(/^join[_-]/, '');
    return svc.joinBattle(bot, ctx, battleId);
  }

  if (payload.startsWith('refresh_')) {
    const battleId = payload.replace('refresh_', '');
    const battle = db.getBattle(battleId);
    if (battle) await svc.updateChannelPost(bot, battle);
    return ctx.reply('✅ Reyting yangilandi.', mainMenu());
  }

  await ctx.reply(
    `👋 Salom, <b>${ctx.from.first_name || "do'st"}!</b>\n\n` +
      `🏆 <b>Voice Battle Bot</b>ga xush kelibsiz.\n` +
      `Battle yaratish uchun pastdagi tugmadan Mini App ni oching.`,
    { parse_mode: 'HTML', ...webAppButton(), ...mainMenu() }
  );
});

bot.hears('🎤 Battle yaratish', async (ctx) => {
  return ctx.reply(
    'Mini App ni oching:',
    Markup.inlineKeyboard([
      [Markup.button.url('🎤 Battle yaratish', miniAppLink())],
    ])
  );
});

bot.hears('📊 Statistika', async (ctx) => {
  const stats = db.getStats();
  return ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
      `👥 Foydalanuvchilar: ${stats.users}\n` +
      `🏆 Battlelar: ${stats.battles}\n` +
      `🔥 Faol: ${stats.active}\n` +
      `✅ Tugagan: ${stats.finished}`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('ℹ️ Yordam', async (ctx) => {
  return ctx.reply(
    `ℹ️ <b>Yordam</b>\n\n` +
      `• Battle yaratish uchun Mini App ishlating.\n` +
      `• Battle postida ishtirokchi tugmalari bo'ladi.\n` +
      `• Ovoz berish uchun link bosiladi.\n` +
      `• Minimal ovoz va o'rinlar battle yaratayotganda belgilanadi.`,
    { parse_mode: 'HTML' }
  );
});

bot.command('admin_addchannel', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Siz admin emassiz.');
  const parts = ctx.message.text.split(/\s+/);
  const channel = normalizeChannel(parts[1]);
  if (!channel) return ctx.reply('Usage: /admin_addchannel @channelusername');

  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(channel, me.id);
    if (!['administrator', 'creator'].includes(member.status)) {
      return ctx.reply('❌ Bot bu kanalda admin emas.');
    }

    const chat = await bot.telegram.getChat(channel);
    db.addRequiredChannel(channel, chat?.title || channel);

    return ctx.reply(`✅ Majburiy kanal qo'shildi: ${channel}`);
  } catch (e) {
    return ctx.reply(`❌ Xato: ${e.message}`);
  }
});

bot.command('admin_removechannel', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Siz admin emassiz.');
  const parts = ctx.message.text.split(/\s+/);
  const channel = normalizeChannel(parts[1]);
  if (!channel) return ctx.reply('Usage: /admin_removechannel @channelusername');

  db.removeRequiredChannel(channel);
  return ctx.reply(`✅ Majburiy kanal o'chirildi: ${channel}`);
});

bot.command('admin_channels', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Siz admin emassiz.');
  const channels = db.getRequiredChannels();
  if (!channels.length) return ctx.reply('Majburiy kanallar yo‘q.');

  return ctx.reply(
    `📢 <b>Majburiy kanallar</b>\n\n` +
      channels.map((c, i) => `${i + 1}. ${c.channel_id} ${c.title ? `— ${c.title}` : ''}`).join('\n'),
    { parse_mode: 'HTML' }
  );
});

bot.action(/^refresh_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Yangilanmoqda...');
  const battle = db.getBattle(ctx.match[1]);
  if (!battle) return ctx.answerCbQuery('Battle topilmadi', true);
  await svc.updateChannelPost(bot, battle);
  return ctx.answerCbQuery('✅ Yangilandi');
});

bot.catch((err, ctx) => {
  console.error('[BOT ERROR]', err?.message || err);
  try {
    if (ctx?.callbackQuery) ctx.answerCbQuery('❌ Xato yuz berdi').catch(() => {});
  } catch (_) {}
});

module.exports = bot;
