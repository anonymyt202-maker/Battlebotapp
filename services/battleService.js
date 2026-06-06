'use strict';

const db = require('../database');

function botName() {
  return process.env.BOT_USERNAME || 'your_bot';
}

function botUrl() {
  return `https://t.me/${botName()}`;
}

function generateBattleId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

function buildVoteLink(battleId, userId) {
  return `${botUrl()}?start=vote_${battleId}-${userId}`;
}

function buildRefLink(battleId, userId) {
  return `${botUrl()}?start=ref_${battleId}-${userId}`;
}

function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' });
}

function modeLabel(mode) {
  if (mode === 'time') return 'vaqt bo‘yicha';
  if (mode === 'both') return 'ovoz yoki vaqt bo‘yicha';
  return 'ovoz yetganda';
}

function buildRatingLines(battleId, limit = 10) {
  const top = db.getTopParticipants(battleId, limit);
  if (!top.length) return 'Hali ishtirokchilar yo‘q';
  return top
    .map((p, i) => `${medal(i)} @${esc(p.username || 'user' + p.user_id)} — <b>${p.votes}</b> ovoz`)
    .join('\n');
}

function buildWinnersText(battle) {
  const winners = parseWinners(battle.winners_json);
  if (!winners.length) return 'G‘olib topilmadi';
  return winners
    .map((w, i) => `${medal(i)} @${esc(w.username || 'user' + w.user_id)} — <b>${w.votes}</b> ovoz`)
    .join('\n');
}

function parseWinners(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function buildPostText(battle) {
  const rating = buildRatingLines(battle.id, 6);
  const lines = [
    `🏆 <b>${esc(battle.battle_name)}</b>`,
    ``,
    `📢 Kanal: <code>${esc(battle.channel_id)}</code>`,
    `🎁 Sovrin: <b>${esc(battle.reward)}</b>`,
    `🎯 Maqsad ovoz: <b>${battle.target_votes}</b>`,
    `🥇 G‘oliblar soni: <b>${battle.winners_count}</b>`,
    `🔒 Minimal yutish ovozi: <b>${battle.min_win_votes}</b>`,
    `⏱ Tugash turi: <b>${modeLabel(battle.end_mode)}</b>`,
  ];
  if (battle.ends_at) lines.push(`🕒 Tugash vaqti: <b>${formatDate(battle.ends_at)}</b>`);
  lines.push(``);
  lines.push(`👥 <b>Qatnashuvchilar:</b>`);
  lines.push(rating);
  return lines.join('\n');
}

function buildFinishedText(battle) {
  const winners = buildWinnersText(battle);
  const reason = battle.ended_reason === 'time' ? 'vaqt tugadi' : battle.ended_reason === 'target' ? 'maqsadga yetildi' : battle.ended_reason || 'yakunlandi';
  return [
    `🏁 <b>BATTLE YAKUNLANDI</b>`,
    ``,
    `🎤 <b>${esc(battle.battle_name)}</b>`,
    `📌 Sabab: <b>${esc(reason)}</b>`,
    `📢 Kanal: <code>${esc(battle.channel_id)}</code>`,
    `🎁 Sovrin: <b>${esc(battle.reward)}</b>`,
    ``,
    `🏆 <b>G‘oliblar:</b>`,
    winners,
  ].join('\n');
}

function buildJoinKeyboard(battle) {
  return {
    inline_keyboard: [
      [{ text: '➕ Battlega qo‘shilish', url: buildRefLink(battle.id, battle.owner_id) }],
    ]
  };
}

function buildActiveKeyboard(battle) {
  const top = db.getTopParticipants(battle.id, 5);
  const rows = [
    [{ text: '➕ Battlega qo‘shilish', url: `${botUrl()}?start=join_${battle.id}` }],
  ];

  for (const p of top) {
    rows.push([
      {
        text: `${p.username ? '@' + p.username : 'user' + p.user_id} — ${p.votes} ovoz`,
        url: buildVoteLink(battle.id, p.user_id),
      }
    ]);
  }

  rows.push([{ text: '🔄 Reytingni yangilash', callback_data: `refresh_${battle.id}` }]);
  return { inline_keyboard: rows };
}

async function _editPost(bot, battle, text, keyboard) {
  if (!battle || !battle.message_id || !battle.channel_id) return;
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
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }
  } catch (e) {
    if (!String(e.message || '').includes('message is not modified')) {
      console.log('[editPost]', e.message);
    }
  }
}

async function createNewBattle(bot, { ownerId, battleName, channelId, targetVotes, reward, imageUrl, winnersCount = 1, minWinVotes = 1, endMode = 'target', durationMinutes = null, endsAt = null }) {
  if (!db.isChannelOwner(ownerId, channelId)) {
    throw new Error('Bu kanal sizniki emas yoki oldin qo‘shilmagan.');
  }

  const battleId = generateBattleId();
  db.createBattle({
    id: battleId,
    ownerId,
    battleName,
    channelId,
    targetVotes,
    reward,
    imageUrl,
    winnersCount,
    minWinVotes,
    endMode,
    durationMinutes,
    endsAt,
  });

  const battle = db.getBattle(battleId);
  const text = buildPostText(battle);
  const kb = buildActiveKeyboard(battle);

  let msg;
  try {
    if (imageUrl) {
      msg = await bot.telegram.sendPhoto(channelId, imageUrl, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    } else {
      msg = await bot.telegram.sendMessage(channelId, text, {
        parse_mode: 'HTML',
        reply_markup: kb,
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    db.deleteBattle(battleId);
    throw new Error('Kanalga post yuborib bo‘lmadi: ' + e.message);
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
    const me = await bot.telegram.getMe();
    const mbr = await bot.telegram.getChatMember(ch, me.id);
    if (!['administrator', 'creator'].includes(mbr.status)) {
      return ctx.reply(
        `❌ <b>Bot bu kanalda admin emas!</b>\n\nAvval botni ${ch} kanaliga admin qiling, keyin qayta urinib ko‘ring.`,
        { parse_mode: 'HTML' }
      );
    }

    const chat = await bot.telegram.getChat(ch);
    const title = chat.title || ch;

    db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
    const added = db.addChannel(userId, ch, title);
    if (!added) {
      return ctx.reply(`ℹ️ <b>${title}</b> kanali allaqachon ro‘yxatda.`, { parse_mode: 'HTML' });
    }

    return ctx.reply(
      `✅ <b>${title}</b> kanali qo‘shildi.\n\nEndi shu kanalga battle yaratishingiz mumkin.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    return ctx.reply(`❌ Kanal topilmadi yoki kirish imkoni yo‘q: ${e.message}`);
  }
}

async function joinBattle(bot, ctx, battleId) {
  const userId = ctx.from.id;
  const username = ctx.from.username || `user${userId}`;
  db.upsertUser(userId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  const already = db.isParticipant(battleId, userId);
  if (already) {
    const link = buildVoteLink(battleId, userId);
    return ctx.reply(
      `✅ Siz allaqachon battleda bor ekansiz.\n\n🔗 Ovoz havolangiz:\n<code>${link}</code>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }

  const subOk = await _checkChannelSub(bot, battle.channel_id, userId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Avval kanalda obuna bo‘ling.\n\n${battle.channel_id}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Tekshirish', callback_data: `chk_join_${battle.id}` }],
          ]
        }
      }
    );
  }

  db.joinBattle(battleId, userId, username);
  db.ensureParticipant(battleId, userId, username);
  await updateChannelPost(bot, battleId);

  const link = buildVoteLink(battleId, userId);
  return ctx.reply(
    `✅ <b>Battlega qo‘shildingiz!</b>\n\n🎤 ${esc(battle.battle_name)}\n\n🔗 Ovoz havolangiz:\n<code>${link}</code>`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}

async function handleVote(bot, ctx, battleId, participantUserIdRaw) {
  const voterId = ctx.from.id;
  const voterName = ctx.from.username || `user${voterId}`;
  const participantUserId = Number(String(participantUserIdRaw).replace(/\D/g, ''));
  if (!participantUserId) return ctx.reply('❌ Noto‘g‘ri participant ID.');

  db.upsertUser(voterId, ctx.from.username, ctx.from.first_name);

  const battle = db.getBattle(battleId);
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  if (voterId === participantUserId) {
    return ctx.reply('❌ O‘zingizga ovoz bera olmaysiz.');
  }

  if (db.hasVoted(battleId, voterId)) {
    return ctx.reply('❌ Siz allaqachon ovoz bergansiz.');
  }

  const participantUser = db.getUser(participantUserId);
  const participantName = participantUser?.username || `user${participantUserId}`;
  const participant = db.ensureParticipant(battleId, participantUserId, participantName);
  if (!participant) return ctx.reply('❌ Ishtirokchi topilmadi.');

  const subOk = await _checkChannelSub(bot, battle.channel_id, voterId);
  if (!subOk) {
    const ch = battle.channel_id.replace('@', '');
    return ctx.reply(
      `❌ Ovoz berish uchun avval kanalga obuna bo‘ling.\n\n${battle.channel_id}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 ${battle.channel_id} ga obuna`, url: `https://t.me/${ch}` }],
            [{ text: '✅ Tekshirish', callback_data: `chk_vote_${battle.id}_${participantUserId}` }],
          ]
        }
      }
    );
  }

  const saved = db.addVote(battleId, voterId, participant.id, voterName);
  if (!saved) return ctx.reply('❌ Siz allaqachon ovoz bergansiz.');

  db.incrementParticipantVotes(participant.id);
  const counts = db.incrementBattleVotes(battleId);
  const freshBattle = db.getBattle(battleId);

  await ctx.reply(
    `✅ Ovoz qabul qilindi.\n\n@${participantName} ga ovoz berdingiz.\n📊 ${counts.current_votes} / ${counts.target_votes}`,
    { parse_mode: 'HTML' }
  );

  await updateChannelPost(bot, battleId);

  const autoFinish = ['target', 'both'].includes(freshBattle.end_mode) && counts.current_votes >= freshBattle.target_votes;
  if (autoFinish) {
    await finishBattle(bot, battleId, 'target');
  }
}

async function updateChannelPost(bot, battleOrId) {
  const battle = typeof battleOrId === 'string' ? db.getBattle(battleOrId) : battleOrId;
  if (!battle) return;
  await _editPost(bot, battle, buildPostText(battle), buildActiveKeyboard(battle));
}

function computeWinners(battle) {
  const participants = db.getAllParticipants(battle.id);
  const eligible = participants.filter(p => p.votes >= battle.min_win_votes);
  const winners = eligible.slice(0, battle.winners_count).map(p => ({
    user_id: p.user_id,
    username: p.username,
    votes: p.votes,
  }));
  return winners;
}

async function finishBattle(bot, battleId, reason = 'manual') {
  const battle = db.getBattle(battleId);
  if (!battle || !battle.active) return battle;

  const winners = computeWinners(battle);
  db.setBattleWinners(battleId, winners, reason);

  const fresh = db.getBattle(battleId);
  await _editPost(bot, fresh, buildFinishedText(fresh), { inline_keyboard: [] });

  try {
    await bot.telegram.sendMessage(
      fresh.owner_id,
      `🏆 <b>Battle yakunlandi</b>\n\n🎤 ${esc(fresh.battle_name)}\n📊 Ovozlar: ${fresh.current_votes}\n\n${buildFinishedText(fresh)}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.log('[finishBattle notify]', e.message);
  }

  return fresh;
}

async function _checkChannelSub(bot, channelId, userId) {
  try {
    const m = await bot.telegram.getChatMember(channelId, userId);
    return !['left', 'kicked'].includes(m.status);
  } catch {
    return true;
  }
}

module.exports = {
  generateBattleId,
  buildVoteLink,
  buildRefLink,
  buildPostText,
  buildFinishedText,
  buildActiveKeyboard,
  buildRatingLines,
  createNewBattle,
  addChannelForUser,
  joinBattle,
  handleVote,
  updateChannelPost,
  finishBattle,
  computeWinners,
};
