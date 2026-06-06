
'use strict';

const db = require('../database');

const BOT = () => process.env.BOT_USERNAME || 'your_bot';

function generateBattleId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// ref link: t.me/BOT?start=ref_BATTLEID_USERID
function buildRefLink(battleId, userId) {
  return `https://t.me/${BOT()}?start=ref_${battleId}_${userId}`;
}

function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

// Aktiv battle uchun reyting (oddiy, belgilarsiz)
function buildRatingLines(battleId, limit = 10) {
  const top = db.getTopParticipants(battleId, limit);
  if (!top.length) return 'Hali ishtirokchilar yo\'q\n';
  return top.map((p, i) =>
    `${medal(i)} @${p.username || 'noname'} — ${p.votes} 📦`
  ).join('\n');
}

// Yakunlangan battle uchun reyting (g'olib/yutqazgan belgilar bilan)
function buildFinishedRatingLines(battle) {
  const all = db.getAllParticipants(battle.id);
  if (!all.length) return 'Ishtirokchi yo\'q\n';

  const winnerCount = battle.winner_count || 3;
  const minVotes    = battle.min_votes    || 0;

  const lines = all.map((p, i) => {
    const inTop  = i < winnerCount;
    const enough = p.votes >= minVotes;
    const isWin  = inTop && (minVotes === 0 || enough);
    let mark = '';
    if (inTop) {
      mark = isWin ? ' ✅' : ` ❌ (${minVotes} kerak)`;
    }
    return `${medal(i)} @${p.username || 'noname'} — ${p.votes} 📦${mark}`;
  });

  return lines.join('\n');
}

// ─── Aktiv post matni ─────────────────────────────────────────
function buildPostText(battle) {
  const rating   = buildRatingLines(battle.id);
  const wc       = battle.winner_count || 3;
  const mv       = battle.min_votes    || 0;
  const endLine  = battle.end_time
    ? `\n⏰ <b>Tugash vaqti:</b> ${_fmtTime(battle.end_time)}`
    : '';

  return (
    `🏆 <b>BATTLE BOSHLANDI</b>\n\n` +
    `❗ <b>Shartlar:</b>\n• Kanalga obuna bo'lish\n• Do'stlarni chaqirish\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}\n\n` +
    `🏅 <b>G'oliblar:</b> Top ${wc} ta` +
    (mv > 0 ? ` (minimal ${mv} ovoz)` : '') + '\n' +
    `🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz` +
    endLine + '\n\n' +
    `📈 <b>Reyting:</b>\n\n${rating}`
  );
}

// ─── Yakunlangan post matni ───────────────────────────────────
function buildFinishedText(battle) {
  const rating = buildFinishedRatingLines(battle);
  return (
    `🏆 <b>BATTLE YAKUNLANDI</b>\n\n` +
    `📈 <b>Yakuniy natijalar:</b>\n\n${rating}\n\n` +
    `🎁 <b>Sovrin:</b>\n${battle.reward}`
  );
}

function buildActiveKeyboard(battle) {
  return {
    inline_keyboard: [
      [{ text: '➕ Battlega qo\'shilish', url: `https://t.me/${BOT()}?start=join_${battle.id}` }],
      [{ text: '🔄 Reytingni yangilash', callback_data: `refresh_${battle.id}` }],
    ]
  };
}

function _fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString('uz-UZ', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent'
    });
  } catch (e) { return iso; }
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
async function createNewBattle(bot, { ownerId, battleName, channelId, targetVotes, winnerCount, minVotes, endTime, reward, imageUrl }) {
  if (!db.isChannelOwner(ownerId, channelId)) {
    throw new Error('Siz bu kanalga battle yarata olmaysiz! Bot kanalingizga admin qilinganidan keyin kanal avtomatik qo\'shiladi.');
  }

  const battleId = generateBattleId();
  db.createBattle({ id: battleId, ownerId, battleName, channelId, targetVotes, winnerCount, minVotes, endTime, reward, imageUrl });

  const battle = db.getBattle(battleId);
  const text   = buildPostText(battle);
  const kb     = buildActiveKeyboard(battle);

  let msg;
  try {
    if (imageUrl) {
      msg = await bot.telegram.sendPhoto(channelId, imageUrl, { caption: text, parse_mode: 'HTML', reply_markup: kb });
    } else {
      msg = await bot.telegram.sendMessage(channelId, text, { parse_mode: 'HTML', reply_markup: kb });
    }
  } catch (e) {
    db.deleteBattle(battleId);
    throw new Error('Kanalga post yubora olmadim: ' + e.message);
  }

  db.updateBattleMessageId(battleId, msg.message_id);
  return db.getBattle(battleId);
}

// ═══════════════════════════════════════════════════════════
//   BATTLEGA QO'SHILISH
// ═══════════════════════════════════════════════════════════
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
      `📤 Quyidagi tugmani do'stlaringizga yuboring:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🗳 Menga ovoz ber', url: link }]]
        }
      }
    );
  }

  // Kanal obunasini tekshirish
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

  return ctx.reply(
    `✅ <b>Siz battlega qo'shildingiz!</b>\n\n` +
    `🎤 <i>${battle.battle_name}</i>\n\n` +
    `📤 Quyidagi tugmani do'stlaringizga yuboring, ular ovoz bersin:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🗳 Menga ovoz ber', url: link }]]
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════
//   REFERAL ORQALI OVOZ BERISH
// ═══════════════════════════════════════════════════════════
async function handleRefVote(bot, ctx, battleId, participantUserId) {
  const voterId   = ctx.from.id;
  const voterName = ctx.from.username || String(voterId);
  db.upsertUser(voterId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle)        return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  if (voterId === parseInt(participantUserId)) {
    return ctx.reply('❌ O\'z havolangizga ovoz bera olmaysiz!');
  }
  if (db.hasVoted(battleId, voterId)) {
    return ctx.reply('❌ Siz bu battleda allaqachon ovoz bergansiz!');
  }

  const participant = db.getParticipant(battleId, parseInt(participantUserId));
  if (!participant) return ctx.reply('❌ Bu ishtirokchi topilmadi.');

  // Kanal obunasini tekshirish
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

  const saved = db.addVote(battleId, voterId, participant.id, voterName);
  if (!saved) return ctx.reply('❌ Siz allaqachon ovoz bergansiz!');

  db.incrementParticipantVotes(participant.id);
  const counts      = db.incrementBattleVotes(battleId);
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
  await _editPost(bot, battle, buildPostText(battle), buildActiveKeyboard(battle));
}

// ═══════════════════════════════════════════════════════════
//   BATTLE YAKUNLASH + G'OLIB/YUTQAZGAN XABARLARI
// ═══════════════════════════════════════════════════════════
async function finishBattle(bot, battleId) {
  db.closeBattle(battleId);
  const battle = db.getBattle(battleId);
  if (!battle) return;

  // Kanal postini yangilash
  await _editPost(bot, battle, buildFinishedText(battle), { inline_keyboard: [] });

  const allPart    = db.getAllParticipants(battle.id);
  const winnerCount = battle.winner_count || 3;
  const minVotes    = battle.min_votes    || 0;

  // Egasiga xabar
  try {
    await bot.telegram.sendMessage(
      battle.owner_id,
      `🏆 <b>Battleingiz yakunlandi!</b>\n\n` +
      `🎤 ${battle.battle_name}\n` +
      `👥 ${allPart.length} ta ishtirokchi\n` +
      `✅ ${battle.current_votes} ta umumiy ovoz\n\n` +
      `${buildFinishedText(battle)}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { console.log('[finishBattle] owner notify:', e.message); }

  // Ishtirokchilarga xabar
  for (let i = 0; i < allPart.length; i++) {
    const p      = allPart[i];
    const inTop  = i < winnerCount;
    const enough = minVotes === 0 || p.votes >= minVotes;
    const isWin  = inTop && enough;

    try {
      if (isWin) {
        // G'OLIB xabari
        await bot.telegram.sendMessage(
          p.user_id,
          `🎉 <b>Tabriklaymiz! Siz g'oldingiz!</b>\n\n` +
          `🏆 <b>${battle.battle_name}</b>\n\n` +
          `${medal(i)} Siz ${i + 1}-o'rinda\n` +
          `📦 ${p.votes} ta ovoz yig'ingiz\n\n` +
          `🎁 <b>Sovrin:</b>\n${battle.reward}\n\n` +
          `Battle egasi siz bilan bog'lanadi! 🤝`,
          { parse_mode: 'HTML' }
        );
      } else if (inTop && !enough) {
        // Top o'rinda, lekin minimal ovozga yetmagan
        await bot.telegram.sendMessage(
          p.user_id,
          `😔 <b>Battle yakunlandi.</b>\n\n` +
          `🏆 <b>${battle.battle_name}</b>\n\n` +
          `${medal(i)} ${i + 1}-o'rinda edingiz\n` +
          `📦 ${p.votes} ta ovoz yig'ingiz\n` +
          `❌ G'alaba uchun ${minVotes} ta ovoz kerak edi\n\n` +
          `💪 Keyingi battleda omad!`,
          { parse_mode: 'HTML' }
        );
      } else {
        // Oddiy ishtirokchi
        await bot.telegram.sendMessage(
          p.user_id,
          `🏁 <b>Battle yakunlandi.</b>\n\n` +
          `🏆 <b>${battle.battle_name}</b>\n` +
          `📦 Siz ${p.votes} ta ovoz yig'ingiz\n\n` +
          `💪 Keyingi battleda omad!`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) { /* user botti bloklagan */ }

    // Flood limit
    if (i > 0 && i % 25 === 0) await new Promise(r => setTimeout(r, 1000));
  }

  return battle;
}

// ═══════════════════════════════════════════════════════════
//   AUTO-STOP SCHEDULER (har 60 soniyada tekshiradi)
// ═══════════════════════════════════════════════════════════
function startAutoStopScheduler(bot) {
  setInterval(async () => {
    try {
      const expired = db.getExpiredBattles();
      for (const battle of expired) {
        console.log(`[scheduler] Auto-stopping battle: ${battle.id} — ${battle.battle_name}`);
        await finishBattle(bot, battle.id);
      }
    } catch (e) {
      console.error('[scheduler] Error:', e.message);
    }
  }, 60 * 1000);

  console.log('[scheduler] Auto-stop scheduler started');
}

async function _checkChannelSub(bot, channelId, userId) {
  try {
    const m = await bot.telegram.getChatMember(channelId, userId);
    return !['left', 'kicked'].includes(m.status);
  } catch (e) {
    return true;
  }
}

module.exports = {
  generateBattleId,
  buildRefLink,
  buildPostText,
  buildFinishedText,
  buildActiveKeyboard,
  buildRatingLines,
  buildFinishedRatingLines,
  createNewBattle,
  joinBattle,
  handleRefVote,
  updateChannelPost,
  finishBattle,
  startAutoStopScheduler,
};