'use strict';

const db = require('../database');

const BOT = () => (process.env.BOT_USERNAME || 'your_bot').replace(/^@/, '');

function generateBattleId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

function buildRefLink(battleId, userId) {
  return `https://t.me/${BOT()}?start=ref_${battleId}_${userId}`;
}

function buildVoteLink(battleId, participantToken) {
  return `https://t.me/${BOT()}?start=vote-${battleId}-${encodeURIComponent(String(participantToken))}`;
}

function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function _normalizeToken(v) {
  return String(v ?? '').trim().replace(/^@/, '').toLowerCase();
}

function _getParticipantId(p) {
  return p?.id ?? p?.user_id ?? p?.userId ?? null;
}

function _getParticipantUsername(p) {
  return String(p?.username || p?.user_name || p?.nickname || p?.name || '').replace(/^@/, '');
}

function _formatParticipantLabel(p) {
  const username = _getParticipantUsername(p) || 'noname';
  const votes = Number(p?.votes || 0);
  return `@${username} — ${votes} ovoz`;
}

function getTopParticipantsSafe(battleId, limit = 10) {
  const top = db.getTopParticipants(battleId, limit) || [];
  return top;
}

function buildRatingLines(battleId, limit = 10) {
  const top = getTopParticipantsSafe(battleId, limit);
  if (!top.length) return 'Hali ishtirokchilar yo\'q\n';
  return top.map((p, i) => `${medal(i)} ${_formatParticipantLabel(p)}`).join('\n');
}

// ─── Kanal posti (aktiv) ─────────────────────────────────────
function buildPostText(battle) {
  const rating = buildRatingLines(battle.id);
  return (
    `🏆 <b>BATTLE BOSHLANDI</b>\n\n` +
    `❗ <b>Shartlar:</b>\n• Kanalga obuna bo'lish\n• Do'stlarni chaqirish\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}\n\n` +
    `🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz\n\n` +
    `📈 <b>Reyting:</b>\n\n${rating}`
  );
}

// ─── Kanal posti (yakunlangan) ───────────────────────────────
function buildFinishedText(battle) {
  const rating = buildRatingLines(battle.id);
  return (
    `🏆 <b>BATTLE YAKUNLANDI</b>\n\n` +
    `📈 <b>Yakuniy natijalar:</b>\n\n${rating}\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}`
  );
}

function buildActiveKeyboard(battle) {
  const top = getTopParticipantsSafe(battle.id, 10);
  const rows = [];

  for (const p of top) {
    const id = _getParticipantId(p);
    const token = id != null && id !== '' ? String(id) : _getParticipantUsername(p);
    if (!token) continue;
    rows.push([
      {
        text: _formatParticipantLabel(p),
        url: buildVoteLink(battle.id, token),
      }
    ]);
  }

  rows.push([
    { text: '➕ Battlega qo\'shilish', url: `https://t.me/${BOT()}?start=join_${battle.id}` },
  ]);
  rows.push([
    { text: '🔄 Reytingni yangilash', callback_data: `refresh_${battle.id}` },
  ]);

  return { inline_keyboard: rows };
}

async function _editPost(bot, battle, text, keyboard) {
  if (!battle.message_id || !battle.channel_id) return;
  try {
    if (battle.image_url) {
      await bot.telegram.editMessageCaption(
        battle.channel_id, battle.message_id, undefined, text,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } else {
      await bot.telegram.editMessageText(
        battle.channel_id, battle.message_id, undefined, text,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }
  } catch (e) {
    if (!e.message?.includes('not modified')) console.log('[editPost]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
//   BATTLE YARATISH
// ═══════════════════════════════════════════════════════════
async function createNewBattle(bot, { ownerId, battleName, channelId, targetVotes, reward, imageUrl }) {
  if (!db.isChannelOwner(ownerId, channelId)) {
    throw new Error('Siz bu kanalga battle yarata olmaysiz! Avval kanalingizni qo\'shing.');
  }

  const battleId = generateBattleId();
  db.createBattle({ id: battleId, ownerId, battleName, channelId, targetVotes, reward, imageUrl });

  const battle = db.getBattle(battleId);
  const text   = buildPostText(battle);
  const kb     = buildActiveKeyboard(battle);

  let msg;
  try {
    if (imageUrl) {
      msg = await bot.telegram.sendPhoto(channelId, imageUrl, {
        caption: text, parse_mode: 'HTML', reply_markup: kb
      });
    } else {
      msg = await bot.telegram.sendMessage(channelId, text, {
        parse_mode: 'HTML', reply_markup: kb
      });
    }
  } catch (e) {
    db.deleteBattle(battleId);
    throw new Error('Kanalga post yubora olmadim: ' + e.message);
  }

  db.updateBattleMessageId(battleId, msg.message_id);
  return db.getBattle(battleId);
}

// ═══════════════════════════════════════════════════════════
//   KANAL QO'SHISH (bot orqali tekshirib)
// ═══════════════════════════════════════════════════════════
async function addChannelForUser(bot, ctx, channelUsername, opts = {}) {
  const userId = opts.forceOwnerId || ctx.from.id;
  let ch = channelUsername.trim();
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

  let title = ch;
  try {
    const me   = await bot.telegram.getMe();
    const mbr  = await bot.telegram.getChatMember(ch, me.id);
    if (!['administrator', 'creator'].includes(mbr.status)) {
      return ctx.reply(
        `❌ <b>Bot bu kanalda admin emas!</b>\n\n` +
        `Avval botni ${ch} kanaliga admin qiling, keyin qayta urinib ko'ring.`,
        { parse_mode: 'HTML' }
      );
    }
    const chat = await bot.telegram.getChat(ch);
    title = chat.title || ch;
  } catch (e) {
    return ctx.reply(`❌ Kanal topilmadi yoki kirish imkoni yo'q: ${e.message}`);
  }

  const added = db.addChannel(userId, ch, title);
  if (!added) {
    return ctx.reply(`ℹ️ <b>${title}</b> kanali allaqachon ro'yxatda.`, { parse_mode: 'HTML' });
  }

  ctx.reply(
    `✅ <b>${title}</b> kanali muvaffaqiyatli qo'shildi!\n\n` +
    `Endi bu kanalda battle yarata olasiz.`,
    { parse_mode: 'HTML' }
  );
}

function _resolveParticipantToken(battleId, token) {
  const raw = String(token ?? '').trim();
  if (!raw) return null;

  const top = getTopParticipantsSafe(battleId, 1000);
  const normalized = _normalizeToken(raw);

  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) {
    const byId = top.find(p => Number(_getParticipantId(p)) === numeric);
    if (byId) return byId;
    const direct = db.getParticipant(battleId, numeric);
    if (direct) return direct;
  }

  const byUsername = top.find(p => _normalizeToken(_getParticipantUsername(p)) === normalized);
  if (byUsername) return byUsername;

  return null;
}

async function joinBattle(bot, ctx, battleId) {
  const userId   = ctx.from.id;
  const username = ctx.from.username || String(userId);
  db.upsertUser(userId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle)        return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  const already = db.isParticipant(battleId, userId);
  if (already) {
    const link = buildRefLink(battleId, userId);
    return ctx.reply(
      `✅ Siz allaqachon bu battleda ishtirokchisiz!\n\n` +
      `🔗 <b>Sizning referal havolangiz:</b>\n<code>${link}</code>\n\n` +
      `📤 Do'stlaringizga yuboring va ovoz yig'ing!`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }

  const subOk = await _checkChannelSub(bot, battle.channel_id, userId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Battlega qo'shilish uchun avval kanalga obuna bo'ling!\n\n${battle.channel_id}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Obunani tekshirish', callback_data: `chk_join_${battleId}` }],
          ]
        }
      }
    );
  }

  db.joinBattle(battleId, userId, username);
  const link = buildRefLink(battleId, userId);

  await ctx.reply(
    `✅ <b>Siz battlega qo'shildingiz!</b>\n\n` +
    `🎤 <i>${battle.battle_name}</i>\n\n` +
    `🔗 <b>Sizning referal havolangiz:</b>\n<code>${link}</code>\n\n` +
    `📤 Havolani do'stlaringizga yuboring va ovoz yig'ing! 📦`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}

async function handleRefVote(bot, ctx, battleId, participantUserId) {
  const voterId   = ctx.from.id;
  const voterName = ctx.from.username || String(voterId);
  db.upsertUser(voterId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle)        return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  const participant = _resolveParticipantToken(battleId, participantUserId);
  if (!participant) {
    return ctx.reply('❌ Bu ishtirokchi battleda topilmadi.');
  }

  const participantId = Number(_getParticipantId(participant));
  if (Number.isFinite(participantId) && voterId === participantId) {
    return ctx.reply('❌ O\'z havolangizga ovoz bera olmaysiz!');
  }

  if (db.hasVoted(battleId, voterId)) {
    return ctx.reply('❌ Siz bu battleda allaqachon ovoz bergansiz!');
  }

  const subOk = await _checkChannelSub(bot, battle.channel_id, voterId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Ovoz berish uchun avval kanalga obuna bo'ling!\n\n${battle.channel_id}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Tekshirish', callback_data: `chk_vote_${battleId}_${participantUserId}` }],
          ]
        }
      }
    );
  }

  const saved = db.addVote(battleId, voterId, participantId, voterName);
  if (!saved) return ctx.reply('❌ Siz allaqachon ovoz bergansiz!');

  db.incrementParticipantVotes(participantId);
  const counts      = db.incrementBattleVotes(battleId);
  const freshBattle = db.getBattle(battleId);

  await ctx.reply(
    `✅ <b>Ovozingiz qabul qilindi!</b>\n\n` +
    `@${_getParticipantUsername(participant) || 'noname'}ga ovoz berdingiz 📦\n\n` +
    `📊 Battle: ${counts.current_votes} / ${counts.target_votes} ovoz`,
    { parse_mode: 'HTML' }
  );

  await updateChannelPost(bot, freshBattle);

  if (counts.current_votes >= counts.target_votes) {
    await finishBattle(bot, battleId);
  }
}

async function updateChannelPost(bot, battle) {
  const text = buildPostText(battle);
  const kb   = buildActiveKeyboard(battle);
  await _editPost(bot, battle, text, kb);
}

async function finishBattle(bot, battleId) {
  db.closeBattle(battleId);
  const battle = db.getBattle(battleId);
  if (!battle) return;

  const text = buildFinishedText(battle);
  await _editPost(bot, battle, text, { inline_keyboard: [] });

  try {
    await bot.telegram.sendMessage(
      battle.owner_id,
      `🏆 <b>Battleingiz yakunlandi!</b>\n\n` +
      `🎤 ${battle.battle_name}\n` +
      `✅ ${battle.current_votes} ovoz yig'ildi\n\n` +
      `${buildFinishedText(battle)}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.log('[finishBattle notify]', e.message);
  }
  return battle;
}

async function _checkChannelSub(bot, channelId, userId) {
  try {
    const m = await bot.telegram.getChatMember(channelId, userId);
    return !['left', 'kicked'].includes(m.status);
  } catch (e) {
    return true; // kanal private yoki bot admin emas → skip
  }
}

module.exports = {
  generateBattleId,
  buildRefLink,
  buildVoteLink,
  buildPostText,
  buildFinishedText,
  buildActiveKeyboard,
  buildRatingLines,
  createNewBattle,
  addChannelForUser,
  joinBattle,
  handleRefVote,
  updateChannelPost,
  finishBattle,
};
