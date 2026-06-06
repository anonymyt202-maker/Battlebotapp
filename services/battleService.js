'use strict';

const db = require('../database');

const BOT = () => process.env.BOT_USERNAME || 'your_bot';

function generateBattleId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function buildLink(type, battleId, userId) {
  return `https://t.me/${BOT()}?start=${type}_${battleId}_${userId}`;
}

function buildRefLink(battleId, userId) {
  return buildLink('ref', battleId, userId);
}

function buildVoteLink(battleId, userId) {
  return buildLink('vote', battleId, userId);
}

function buildJoinLink(battleId) {
  return `https://t.me/${BOT()}?start=join_${battleId}`;
}

function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function safe(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatParticipants(battleId, limit = 10, withLinks = false) {
  const items = db.getTopParticipants(battleId, limit);
  if (!items.length) return 'Hali qatnashuvchi yo\'q';
  return items.map((p, i) => {
    const name = `@${p.username || p.user_id}`;
    const votes = `${p.votes} ovoz`;
    if (!withLinks) return `${medal(i)} ${name} — ${votes}`;
    const link = buildVoteLink(battleId, p.user_id);
    return `${medal(i)} <a href="${link}">${safe(name)}</a> — ${votes}`;
  }).join('\n');
}

function formatEndInfo(battle) {
  if (battle.end_mode === 'time' && battle.end_at) {
    return `🕒 <b>Tugash vaqti:</b> ${safe(battle.end_at)}`;
  }
  return `🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz`;
}

function buildPostText(battle) {
  const modeText = battle.end_mode === 'time'
    ? `🕒 <b>Auto tugash:</b> vaqt bo'yicha`
    : `🎯 <b>Auto tugash:</b> ${battle.target_votes} ovozga yetganda`;

  return [
    `🏆 <b>${safe(battle.battle_name)}</b>`,
    '',
    `🎁 <b>Sovrin:</b>`,
    safe(battle.reward),
    '',
    `👑 <b>G'oliblar soni:</b> ${battle.winners_count}`,
    `🧮 <b>Minimal yutuq ovozi:</b> ${battle.min_votes}`,
    modeText,
    formatEndInfo(battle),
    '',
    `👥 <b>Qatnashuvchilar:</b>`,
    formatParticipants(battle.id, 5, true),
  ].join('\n');
}

function getWinnersText(battle) {
  const top = db.getTopParticipants(battle.id, battle.winners_count || 3)
    .filter(p => p.votes >= (battle.min_votes || 1));
  if (!top.length) return "G'oliblar uchun yetarli ovoz yo'q.";
  return top.map((p, i) => `${medal(i)} @${p.username || p.user_id} — ${p.votes} ovoz`).join('\n');
}

function buildFinishedText(battle) {
  const winners = getWinnersText(battle);
  return [
    `✅ <b>BATTLE YAKUNLANDI</b>`,
    '',
    `🏆 <b>${safe(battle.battle_name)}</b>`,
    `📦 <b>Yakuniy ovozlar:</b> ${battle.current_votes}`,
    `👑 <b>G'oliblar soni:</b> ${battle.winners_count}`,
    `🧮 <b>Minimal yutuq ovozi:</b> ${battle.min_votes}`,
    '',
    `🥇 <b>Natija:</b>`,
    winners,
    '',
    `🎁 <b>Sovrin:</b>`,
    safe(battle.reward),
  ].join('\n');
}

function buildActiveKeyboard(battle) {
  const rows = [
    [{ text: '➕ Battlega qo\'shilish', url: buildJoinLink(battle.id) }],
    [{ text: '🔄 Reytingni yangilash', callback_data: `refresh_${battle.id}` }],
  ];

  const top = db.getTopParticipants(battle.id, 3);
  if (top.length) {
    rows.push(top.map(p => ({
      text: `@${p.username || p.user_id} (${p.votes})`,
      url: buildVoteLink(battle.id, p.user_id),
    })));
  }
  return { inline_keyboard: rows };
}

async function editPost(bot, battle, text, keyboard) {
  if (!battle.message_id || !battle.channel_id) return;
  try {
    if (battle.image_url) {
      await bot.telegram.editMessageCaption(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } else {
      await bot.telegram.editMessageText(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: true }
      );
    }
  } catch (e) {
    if (!String(e.message || '').includes('not modified')) console.log('[editPost]', e.message);
  }
}

async function verifyChannelReady(bot, channelId, userId) {
  const me = await bot.telegram.getMe();
  const botMember = await bot.telegram.getChatMember(channelId, me.id);
  const userMember = await bot.telegram.getChatMember(channelId, userId);

  const botOk = ['administrator', 'creator'].includes(botMember.status);
  const userOk = ['administrator', 'creator'].includes(userMember.status);

  let chat = null;
  try {
    chat = await bot.telegram.getChat(channelId);
  } catch (_) {}

  return { ok: botOk && userOk, botOk, userOk, chat, botStatus: botMember.status, userStatus: userMember.status };
}

async function createNewBattle(bot, {
  ownerId, battleName, channelId, targetVotes,
  winnersCount = 3, minVotes = 1, endMode = 'votes', endAt = null,
  reward, imageUrl = null,
}) {
  if (!db.isChannelOwner(ownerId, channelId)) {
    throw new Error('Bu kanal sizniki emas. Avval /addchannel bilan qo\'shing.');
  }

  const battleId = generateBattleId();
  db.createBattle({
    id: battleId,
    ownerId,
    battleName,
    channelId,
    targetVotes,
    winnersCount,
    minVotes,
    endMode,
    endAt,
    reward,
    imageUrl,
  });

  const battle = db.getBattle(battleId);
  const text = buildPostText(battle);
  const keyboard = buildActiveKeyboard(battle);

  let msg;
  try {
    if (imageUrl) {
      msg = await bot.telegram.sendPhoto(channelId, imageUrl, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      msg = await bot.telegram.sendMessage(channelId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    db.deleteBattle(battleId);
    throw new Error('Kanalga post yuborib bo\'lmadi: ' + e.message);
  }

  db.updateBattleMessageId(battleId, msg.message_id);
  return db.getBattle(battleId);
}

async function addChannelForUser(bot, ctx, channelUsername) {
  const userId = ctx.from.id;
  let ch = String(channelUsername || '').trim();
  if (!ch) return ctx.reply('❌ Kanal username kerak.');
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

  try {
    const info = await verifyChannelReady(bot, ch, userId);
    if (!info.botOk) {
      return ctx.reply(
        `❌ <b>Bot bu kanalda admin emas!</b>\n\n` +
        `Avval botni ${safe(ch)} kanaliga admin qiling, keyin qayta urinib ko\'ring.`,
        { parse_mode: 'HTML' }
      );
    }
    if (!info.userOk) {
      return ctx.reply(
        `❌ <b>Faqat kanal owner/admin qo\'sha oladi.</b>\n\n` +
        `Siz ${safe(ch)} kanalida creator yoki administrator emassiz.`,
        { parse_mode: 'HTML' }
      );
    }

    const title = info.chat?.title || ch;
    const added = db.addChannel(userId, ch, title);
    if (!added) {
      return ctx.reply(`ℹ️ <b>${safe(title)}</b> allaqachon qo\'shilgan.`, { parse_mode: 'HTML' });
    }

    return ctx.reply(
      `✅ <b>${safe(title)}</b> kanali muvaffaqiyatli qo\'shildi!\n\n` +
      `Endi bu kanal sizning hisobingizga bog\'landi va battle yaratish mumkin.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    return ctx.reply(`❌ Kanal tekshiruv xatosi: ${safe(e.message)}`, { parse_mode: 'HTML' });
  }
}

async function ensureBattleExpired(bot, battle) {
  if (!battle || !battle.active) return false;
  if (battle.end_mode === 'time' && battle.end_at) {
    const end = new Date(String(battle.end_at).replace(' ', 'T'));
    if (Number.isFinite(end.getTime()) && end <= new Date()) {
      await finishBattle(bot, battle.id, 'time');
      return true;
    }
  }
  return false;
}

async function checkSubscription(bot, channelId, userId) {
  try {
    const member = await bot.telegram.getChatMember(channelId, userId);
    return !['left', 'kicked'].includes(member.status);
  } catch (_) {
    return true;
  }
}

async function joinBattle(bot, ctx, battleId) {
  const userId = ctx.from.id;
  const username = ctx.from.username || String(userId);
  db.upsertUser(userId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  if (await ensureBattleExpired(bot, battle)) return ctx.reply('❌ Bu battle tugagan.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  if (db.isParticipant(battleId, userId)) {
    const ref = buildRefLink(battleId, userId);
    const vote = buildVoteLink(battleId, userId);
    return ctx.reply(
      `✅ Siz allaqachon ishtirokchisiz!\n\n` +
      `🔗 <b>Referal:</b>\n<code>${ref}</code>\n\n` +
      `🗳 <b>Ovoz havolasi:</b>\n<code>${vote}</code>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }

  const subOk = await checkSubscription(bot, battle.channel_id, userId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Battlega qo\'shilish uchun avval kanalga obuna bo\'ling!\n\n${safe(battle.channel_id)}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Obunani tekshirish', callback_data: `chk_join_${battleId}` }],
          ],
        },
      }
    );
  }

  db.joinBattle(battleId, userId, username);
  const ref = buildRefLink(battleId, userId);
  const vote = buildVoteLink(battleId, userId);

  return ctx.reply(
    `✅ <b>Siz battlega qo\'shildingiz!</b>\n\n` +
    `🎤 <i>${safe(battle.battle_name)}</i>\n\n` +
    `🔗 <b>Referal:</b>\n<code>${ref}</code>\n\n` +
    `🗳 <b>Ovoz havolasi:</b>\n<code>${vote}</code>\n\n` +
    `📤 Havolani yuboring va ovoz yig\'ing!`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}

async function handleRefVote(bot, ctx, battleId, participantUserId) {
  const voterId = ctx.from.id;
  const voterName = ctx.from.username || String(voterId);
  db.upsertUser(voterId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  if (await ensureBattleExpired(bot, battle)) return ctx.reply('❌ Bu battle tugagan.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  const participantUid = parseInt(participantUserId, 10);
  if (!participantUid) return ctx.reply('❌ Noto\'g\'ri vote havola.');
  if (voterId === participantUid) return ctx.reply('❌ O\'z havolangizga ovoz bera olmaysiz.');
  if (db.hasVoted(battleId, voterId)) return ctx.reply('❌ Siz allaqachon ovoz bergansiz.');

  const participant = db.getParticipant(battleId, participantUid);
  if (!participant) return ctx.reply('❌ Bu ishtirokchi battleda topilmadi.');

  const subOk = await checkSubscription(bot, battle.channel_id, voterId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Ovoz berish uchun avval kanalga obuna bo\'ling!\n\n${safe(battle.channel_id)}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Tekshirish', callback_data: `chk_vote_${battleId}_${participantUserId}` }],
          ],
        },
      }
    );
  }

  const saved = db.addVote(battleId, voterId, participant.id, voterName);
  if (!saved) return ctx.reply('❌ Siz allaqachon ovoz bergansiz.');

  db.incrementParticipantVotes(participant.id);
  const counts = db.incrementBattleVotes(battleId);
  const freshBattle = db.getBattle(battleId);

  await ctx.reply(
    `✅ <b>Ovozingiz qabul qilindi!</b>\n\n` +
    `@${participant.username || participant.user_id}ga ovoz berdingiz.\n\n` +
    `📊 Jami: ${counts.current_votes} / ${counts.target_votes}`,
    { parse_mode: 'HTML' }
  );

  await updateChannelPost(bot, freshBattle);

  if ((freshBattle.end_mode === 'votes' && counts.current_votes >= freshBattle.target_votes) ||
      (freshBattle.end_mode === 'time' && freshBattle.end_at && new Date(String(freshBattle.end_at).replace(' ', 'T')) <= new Date())) {
    await finishBattle(bot, battleId, freshBattle.end_mode === 'time' ? 'time' : 'target');
  }
}

async function updateChannelPost(bot, battle) {
  if (!battle || !battle.active) return;
  await editPost(bot, battle, buildPostText(battle), buildActiveKeyboard(battle));
}

async function finishBattle(bot, battleId, reason = 'manual') {
  const battle = db.getBattle(battleId);
  if (!battle || !battle.active) return battle;

  db.closeBattle(battleId, reason);
  const fresh = db.getBattle(battleId);
  if (!fresh) return battle;

  await editPost(bot, fresh, buildFinishedText(fresh), { inline_keyboard: [] });

  try {
    await bot.telegram.sendMessage(
      fresh.owner_id,
      `🏆 <b>Battle tugadi!</b>\n\n` +
      `🎤 ${safe(fresh.battle_name)}\n` +
      `📦 Ovozlar: ${fresh.current_votes}\n` +
      `📌 Sabab: ${reason === 'time' ? 'vaqt tugadi' : reason === 'target' ? 'maqsadga yetdi' : 'admin yopdi'}\n\n` +
      `${buildFinishedText(fresh)}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.log('[finishBattle notify]', e.message);
  }
  return fresh;
}

async function scanAndFinishExpiredBattles(bot) {
  const expired = db.getExpiredBattles();
  for (const battle of expired) {
    try {
      await finishBattle(bot, battle.id, 'time');
    } catch (e) {
      console.log('[scanExpired]', battle.id, e.message);
    }
  }
}

module.exports = {
  generateBattleId,
  buildRefLink,
  buildVoteLink,
  buildJoinLink,
  buildPostText,
  buildFinishedText,
  buildActiveKeyboard,
  buildParticipants: formatParticipants,
  createNewBattle,
  addChannelForUser,
  joinBattle,
  handleRefVote,
  updateChannelPost,
  finishBattle,
  scanAndFinishExpiredBattles,
  verifyChannelReady,
};
