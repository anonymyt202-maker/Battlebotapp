'use strict';

const db = require('../database');

const BOT_USERNAME = () => process.env.BOT_USERNAME || 'your_bot';

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
  return `https://t.me/${BOT_USERNAME()}?start=ref_${battleId}_${userId}`;
}

function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function buildRatingLines(battleId, limit = 10) {
  const top = db.getTopParticipants(battleId, limit);
  if (!top || top.length === 0) return 'Hali ishtirokchilar yo\'q';
  return top.map((p, i) => `${medal(i)} @${p.username || 'noname'} — ${p.votes} 📦`).join('\n');
}

function buildPostText(battle) {
  const rating = buildRatingLines(battle.id, 10);
  return (
    `🏆 <b>BATTLE BOSHLANDI</b>\n\n` +
    `❗ <b>Shartlar:</b>\n` +
    `• Kanalga obuna bo\'lish\n` +
    `• Do\'stlarni chaqirish\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}\n\n` +
    `🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz\n\n` +
    `📈 <b>Reyting:</b>\n\n${rating}`
  );
}

function buildFinishedText(battle) {
  const rating = buildRatingLines(battle.id, 10);
  return (
    `🏆 <b>BATTLE YAKUNLANDI</b>\n\n` +
    `📈 <b>Yakuniy natijalar:</b>\n\n${rating}\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}`
  );
}

function buildActiveKeyboard(battle) {
  return {
    inline_keyboard: [
      [
        {
          text: '➕ Battlega qo\'shilish',
          url: `https://t.me/${BOT_USERNAME()}?start=join_${battle.id}`,
        },
      ],
      [
        {
          text: '🔄 Reytingni yangilash',
          callback_data: `refresh_${battle.id}`,
        },
      ],
    ],
  };
}

async function safeEditPost(bot, battle, text, keyboard) {
  if (!battle || !battle.message_id || !battle.channel_id) return;
  try {
    if (battle.image_url) {
      await bot.telegram.editMessageCaption(battle.channel_id, battle.message_id, undefined, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      await bot.telegram.editMessageText(battle.channel_id, battle.message_id, undefined, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
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

  if (!botOk) throw new Error('Bot kanalda admin emas');
  if (!userOk) throw new Error('Bu kanal sizniki emas. Faqat kanal owneri battle yarata oladi.');

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
    reward,
    imageUrl,
  }
) {
  const ch = normalizeChannel(channelId);
  await assertCanManageChannel(bot, ch, ownerId);

  const battleId = generateBattleId();
  const battleTitle = String(battleName || '').trim();
  const battleReward = String(reward || '').trim();
  const parsedTarget = parseInt(targetVotes, 10);

  if (!battleTitle) throw new Error('Battle nomi bo\'sh');
  if (!battleReward) throw new Error('Mukofot bo\'sh');
  if (!Number.isInteger(parsedTarget) || parsedTarget < 1) throw new Error('Maqsad ovozlar soni noto\'g\'ri');

  try {
    const chat = await bot.telegram.getChat(ch);
    const title = chat?.title || ch;
    db.addChannel(ownerId, ch, title);
  } catch (_) {}

  db.createBattle({
    id: battleId,
    ownerId,
    battleName: battleTitle,
    channelId: ch,
    targetVotes: parsedTarget,
    reward: battleReward,
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

  try {
    await assertCanManageChannel(bot, ch, userId);
    const chat = await bot.telegram.getChat(ch);
    const title = chat?.title || ch;

    const added = db.addChannel(userId, ch, title);
    if (!added) {
      return ctx.reply(`ℹ️ <b>${title}</b> kanali allaqachon qo'shilgan.`, { parse_mode: 'HTML' });
    }

    return ctx.reply(`✅ <b>${title}</b> kanali qo'shildi.\n\nEndi shu kanalda battle yarata olasiz.`, { parse_mode: 'HTML' });
  } catch (e) {
    return ctx.reply(`❌ ${e.message}`, { parse_mode: 'HTML' });
  }
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

  return ctx.reply(
    `✅ <b>Siz battlega qo'shildingiz!</b>\n\n` +
    `🎤 <i>${battle.battle_name}</i>\n\n` +
    `🔗 <b>Sizning referal havolangiz:</b>\n<code>${link}</code>\n\n` +
    `📤 Havolani do'stlaringizga yuboring va ovoz yig'ing! 📦`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}

async function handleRefVote(bot, ctx, battleId, participantUserId) {
  const voterId = ctx.from.id;
  const voterName = ctx.from.username || String(voterId);
  const pid = Number(participantUserId);
  if (!Number.isInteger(pid)) return ctx.reply('❌ Noto‘g‘ri havola.');

  db.upsertUser(voterId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  if (voterId === pid) {
    return ctx.reply('❌ O\'z havolangizga ovoz bera olmaysiz!');
  }

  if (db.hasVoted(battleId, voterId)) {
    return ctx.reply('❌ Siz bu battleda allaqachon ovoz bergansiz!');
  }

  const participant = db.getParticipant(battleId, pid);
  if (!participant) {
    return ctx.reply('❌ Bu ishtirokchi battleda topilmadi.');
  }

  const subOk = await checkChannelSub(bot, battle.channel_id, voterId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Ovoz berish uchun avval kanalga obuna bo'ling!\n\n${battle.channel_id}`,
      {
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
  if (!saved) return ctx.reply('❌ Siz allaqachon ovoz bergansiz!');

  db.incrementParticipantVotes(participant.id);
  const counts = db.incrementBattleVotes(battleId);
  const freshBattle = db.getBattle(battleId);

  await ctx.reply(
    `✅ <b>Ovozingiz qabul qilindi!</b>\n\n` +
    `@${participant.username || 'noname'}ga ovoz berdingiz 📦\n\n` +
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
  const kb = buildActiveKeyboard(battle);
  await safeEditPost(bot, battle, text, kb);
}

async function finishBattle(bot, battleId) {
  db.closeBattle(battleId);
  const battle = db.getBattle(battleId);
  if (!battle) return;

  const text = buildFinishedText(battle);
  await safeEditPost(bot, battle, text, { inline_keyboard: [] });

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

async function checkChannelSub(bot, channelId, userId) {
  try {
    const m = await bot.telegram.getChatMember(channelId, userId);
    return !['left', 'kicked'].includes(m.status);
  } catch (e) {
    return false;
  }
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
};
