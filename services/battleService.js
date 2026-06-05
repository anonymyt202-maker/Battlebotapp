'use strict';

const db = require('../database');

const BOT = () => process.env.BOT_USERNAME || 'your_bot';

function normalizeChannel(channelId) {
  let ch = String(channelId || '').trim();
  if (!ch) return ch;
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
  return ch;
}

function generateBattleId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

function buildRefLink(battleId, userId) {
  return `https://t.me/${BOT()}?start=vote-${battleId}-${userId}`;
}

function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function getTopParticipants(battleId, limit = 10) {
  return db.getTopParticipants(battleId, limit) || [];
}

function buildRatingLines(battleId, limit = 10) {
  const top = getTopParticipants(battleId, limit);
  if (!top.length) return 'Hali ishtirokchilar yo\'q';
  return top.map((p, i) => `${medal(i)} @${p.username || `user_${p.user_id}`} — ${p.votes} 📦`).join('\n');
}

function buildWinnerLines(battleId, places = 3, minVotes = 1) {
  const top = getTopParticipants(battleId, 20)
    .filter(p => Number(p.votes) >= Number(minVotes))
    .slice(0, Number(places) || 3);

  if (!top.length) return 'G\'olib topilmadi';
  return top.map((p, i) => `${medal(i)} @${p.username || `user_${p.user_id}`} — ${p.votes} 📦`).join('\n');
}

function buildPostText(battle) {
  const rating = buildRatingLines(battle.id, 10);
  return (
    `🏆 <b>BATTLE BOSHLANDI</b>\n\n` +
    `❗ <b>Shartlar:</b>\n` +
    `• Kanalga obuna bo'lish\n` +
    `• Do'stlarni chaqirish\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}\n\n` +
    `🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz\n` +
    `🏅 <b>Minimal yutish:</b> ${battle.min_win_votes} ovoz\n` +
    `🥇 <b>O'rinlar:</b> ${battle.places_count}\n\n` +
    `📈 <b>Reyting:</b>\n\n${rating}`
  );
}

function buildFinishedText(battle) {
  const winners = buildWinnerLines(battle.id, battle.places_count, battle.min_win_votes);
  return (
    `🏆 <b>BATTLE YAKUNLANDI</b>\n\n` +
    `📈 <b>Yakuniy natijalar:</b>\n\n${winners}\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}\n` +
    `🎯 <b>Minimal yutish:</b> ${battle.min_win_votes} ovoz`
  );
}

function buildActiveKeyboard(battle) {
  const top = getTopParticipants(battle.id, Math.max(10, Number(battle.places_count) || 3));

  const rows = top.map(p => {
    const identifier = p.username ? p.username : p.user_id;
    return [
      {
        text: `@${p.username || `user_${p.user_id}`} — ${p.votes} 📦`,
        url: buildRefLink(battle.id, identifier),
      },
    ];
  });

  rows.push([
    {
      text: '➕ Battlega qo\'shilish',
      url: `https://t.me/${BOT()}?start=join_${battle.id}`,
    },
  ]);

  rows.push([
    {
      text: '🔄 Reytingni yangilash',
      callback_data: `refresh_${battle.id}`,
    },
  ]);

  return { inline_keyboard: rows };
}

async function safeEditPost(bot, battle, text, keyboard) {
  if (!battle || !battle.message_id || !battle.channel_id) return;

  try {
    if (battle.image_url) {
      await bot.telegram.editMessageCaption(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }
      );
    } else {
      await bot.telegram.editMessageText(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }
      );
    }
  } catch (e) {
    if (!String(e.message || '').includes('message is not modified')) {
      console.log('[safeEditPost]', e.message);
    }
  }
}

async function assertCanManageChannel(bot, channelId, userId) {
  const ch = normalizeChannel(channelId);
  if (!ch) throw new Error('Kanal bo\'sh');

  const me = await bot.telegram.getMe();

  const [botMember, userMember] = await Promise.all([
    bot.telegram.getChatMember(ch, me.id),
    bot.telegram.getChatMember(ch, userId),
  ]);

  const botOk = ['administrator', 'creator'].includes(botMember.status);
  const userOk = userMember.status === 'creator';

  if (!botOk) {
    throw new Error('Bot kanalda admin emas');
  }

  if (!userOk) {
    throw new Error('Bu kanal sizniki emas. Faqat kanal owneri battle yarata oladi.');
  }

  return {
    channelId: ch,
    botStatus: botMember.status,
    userStatus: userMember.status,
  };
}

async function createNewBattle(
  bot,
  {
    ownerId,
    battleName,
    channelId,
    targetVotes,
    minWinVotes = 1,
    placesCount = 3,
    reward,
    buttonText,
    imageUrl,
  }
) {
  const ch = normalizeChannel(channelId);

  await assertCanManageChannel(bot, ch, ownerId);

  const battleId = generateBattleId();

  db.createBattle({
    id: battleId,
    ownerId,
    battleName: String(battleName || '').trim(),
    channelId: ch,
    targetVotes: parseInt(targetVotes, 10),
    minWinVotes: parseInt(minWinVotes, 10) || 1,
    placesCount: parseInt(placesCount, 10) || 3,
    reward: String(reward || '').trim(),
    buttonText: buttonText || '🔥 Ovoz berish',
    imageUrl: imageUrl ? String(imageUrl).trim() : null,
  });

  const battle = db.getBattle(battleId);
  if (!battle) throw new Error('Battle saqlanmadi');

  const text = buildPostText(battle);
  const keyboard = buildActiveKeyboard(battle);

  let msg;
  try {
    if (battle.image_url) {
      msg = await bot.telegram.sendPhoto(ch, battle.image_url, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      msg = await bot.telegram.sendMessage(ch, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    db.deleteBattle(battleId);
    throw new Error('Kanalga post yubora olmadim: ' + e.message);
  }

  db.updateBattleMessageId(battleId, msg.message_id);
  return db.getBattle(battleId);
}

async function addChannelForUser(bot, ctx, channelUsername) {
  const userId = ctx.from.id;
  const ch = normalizeChannel(channelUsername);

  if (!ch) return ctx.reply('❌ Kanal kiriting.');

  let title = ch;

  try {
    await assertCanManageChannel(bot, ch, userId);
    const chat = await bot.telegram.getChat(ch);
    title = chat.title || ch;
  } catch (e) {
    return ctx.reply(`❌ ${e.message}`, { parse_mode: 'HTML' });
  }

  const added = db.addChannel(userId, ch, title);

  return ctx.reply(
    added
      ? `✅ <b>${title}</b> kanali qo'shildi.\n\nEndi shu kanalda battle yarata olasiz.`
      : `ℹ️ <b>${title}</b> kanali allaqachon qo'shilgan.`,
    { parse_mode: 'HTML' }
  );
}

function resolveParticipant(battleId, participantIdentifier) {
  const raw = String(participantIdentifier || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    return db.getParticipant(battleId, Number(raw));
  }

  return db.getParticipantByUsername(battleId, raw);
}

async function joinBattle(bot, ctx, battleId) {
  const userId = ctx.from.id;
  const username = ctx.from.username || String(userId);

  db.upsertUser(userId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
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

  const subOk = await checkChannelSub(bot, battle.channel_id, userId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Battlega qo'shilish uchun avval kanalga obuna bo'ling!\n\n${battle.channel_id}`,
      {
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

  const link = buildRefLink(battleId, userId);

  await ctx.reply(
    `✅ <b>Siz battlega qo'shildingiz!</b>\n\n` +
    `🎤 <i>${battle.battle_name}</i>\n\n` +
    `🔗 <b>Sizning referal havolangiz:</b>\n<code>${link}</code>\n\n` +
    `📤 Havolani do'stlaringizga yuboring va ovoz yig'ing! 📦`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );

  const freshBattle = db.getBattle(battleId);
  if (freshBattle) await updateChannelPost(bot, freshBattle);
}

async function handleRefVote(bot, ctx, battleId, participantIdentifier) {
  const voterId = ctx.from.id;
  const voterName = ctx.from.username || String(voterId);

  db.upsertUser(voterId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return sendReply(ctx, '❌ Battle topilmadi.');
  if (!battle.active) return sendReply(ctx, '❌ Bu battle tugagan.');

  const participant = resolveParticipant(battleId, participantIdentifier);
  if (!participant) return sendReply(ctx, '❌ Bu ishtirokchi battleda topilmadi.');

  if (voterId === Number(participant.user_id)) {
    return sendReply(ctx, '❌ O\'z havolangizga ovoz bera olmaysiz!');
  }

  if (db.hasVoted(battleId, voterId)) {
    return sendReply(ctx, '❌ Siz bu battleda allaqachon ovoz bergansiz!');
  }

  const subOk = await checkChannelSub(bot, battle.channel_id, voterId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return sendReply(
      ctx,
      `❌ Ovoz berish uchun avval kanalga obuna bo'ling!\n\n${battle.channel_id}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Tekshirish', callback_data: `chk_vote_${battleId}_${participantIdentifier}` }],
          ],
        },
      }
    );
  }

  const saved = db.addVote(battleId, voterId, participant.id, voterName);
  if (!saved) return sendReply(ctx, '❌ Siz allaqachon ovoz bergansiz!');

  db.incrementParticipantVotes(participant.id);
  const counts = db.incrementBattleVotes(battleId);
  const freshBattle = db.getBattle(battleId);

  await sendReply(
    ctx,
    `✅ <b>Ovozingiz qabul qilindi!</b>\n\n` +
    `@${participant.username || `user_${participant.user_id}`}ga ovoz berdingiz 📦\n\n` +
    `📊 Battle: ${counts.current_votes} / ${counts.target_votes} ovoz`,
    { parse_mode: 'HTML' }
  );

  await updateChannelPost(bot, freshBattle);

  if (shouldAutoFinish(freshBattle)) {
    await finishBattle(bot, battleId);
  }

  return { success: true, battle: db.getBattle(battleId) };
}

function shouldAutoFinish(battle) {
  if (!battle) return false;
  const top = db.getTopParticipants(battle.id, 1)[0];
  const topVotes = Number(top?.votes || 0);
  const minVotes = Number(battle.min_win_votes || 1);
  const totalVotes = Number(battle.current_votes || 0);
  const targetVotes = Number(battle.target_votes || 0);

  return topVotes >= minVotes || totalVotes >= targetVotes;
}

async function updateChannelPost(bot, battle) {
  if (!battle) return;
  const text = buildPostText(battle);
  const kb = buildActiveKeyboard(battle);
  await safeEditPost(bot, battle, text, kb);
}

async function finishBattle(bot, battleId) {
  const battle = db.getBattle(battleId);
  if (!battle) return null;

  if (battle.active) {
    db.closeBattle(battleId);
  }

  const fresh = db.getBattle(battleId);
  if (!fresh) return null;

  const finalText = buildFinishedText(fresh);
  await safeEditPost(bot, fresh, finalText, { inline_keyboard: [] });

  const winners = db.getTopParticipants(battleId, Number(fresh.places_count || 3))
    .filter(p => Number(p.votes) >= Number(fresh.min_win_votes || 1));

  const winnersText = winners.length
    ? winners.map((p, i) => `${medal(i)} @${p.username || `user_${p.user_id}`} — ${p.votes} 📦`).join('\n')
    : 'G\'olib topilmadi';

  const ownerMessage =
    `🏆 <b>Battle tugadi!</b>\n\n` +
    `🎤 <b>Kanal:</b> ${fresh.channel_id}\n` +
    `🎁 <b>Sovrin:</b>\n${fresh.reward}\n\n` +
    `🏅 <b>Minimal yutish:</b> ${fresh.min_win_votes} ovoz\n` +
    `🥇 <b>O'rinlar:</b> ${fresh.places_count}\n\n` +
    `👑 <b>G'alaba qozonganlar:</b>\n\n${winnersText}`;

  try {
    await bot.telegram.sendMessage(fresh.owner_id, ownerMessage, { parse_mode: 'HTML' });
  } catch (e) {
    console.log('[finishBattle owner]', e.message);
  }

  for (const winner of winners) {
    try {
      await bot.telegram.sendMessage(
        Number(winner.user_id),
        `🎉 <b>Siz yutdingiz!</b>\n\n` +
        `Siz <b>${fresh.channel_id}</b> kanalida yutdiz.\n` +
        `Iltimos kanal admini bilan bog'laning.\n\n` +
        `🏅 Minimal yutish: ${fresh.min_win_votes} ovoz\n` +
        `📈 Yakuniy natijalar:\n\n${winnersText}`,
        { parse_mode: 'HTML' }
      );
    } catch (_) {}
  }

  return fresh;
}

async function checkChannelSub(bot, channelId, userId) {
  try {
    const m = await bot.telegram.getChatMember(channelId, userId);
    return !['left', 'kicked'].includes(m.status);
  } catch (e) {
    return false;
  }
}

function sendReply(ctx, text, extra = {}) {
  if (ctx && typeof ctx.reply === 'function') {
    return ctx.reply(text, extra);
  }
  return null;
}

module.exports = {
  generateBattleId,
  buildRefLink,
  buildPostText,
  buildFinishedText,
  buildActiveKeyboard,
  buildRatingLines,
  assertCanManageChannel,
  createNewBattle,
  addChannelForUser,
  joinBattle,
  handleRefVote,
  updateChannelPost,
  finishBattle,
  shouldAutoFinish,
  checkChannelSub,
};
