const {
  createBattle,
  getBattle,
  updateBattleMessageId,
  incrementVotes,
  closeBattle,
  addVote,
  hasVoted,
} = require('../database');

const BOT_USERNAME = () => process.env.BOT_USERNAME;

// ─── Generate unique battle ID ───────────────────────────────
function generateBattleId() {
  return Math.random().toString(36).substr(2, 8) + Date.now().toString(36);
}

// ─── Build channel post text ─────────────────────────────────
function buildPostText(battle) {
  let text = `🎤 <b>${battle.battle_name}</b>\n\n`;
  text += `🎁 <b>Mukofot:</b>\n${battle.reward}\n\n`;
  text += `🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz\n`;
  text += `📊 <b>Hozirgi:</b> ${battle.current_votes} / ${battle.target_votes}\n\n`;
  text += `⚡ Battle davom etmoqda!`;
  return text;
}

// ─── Build vote inline keyboard ──────────────────────────────
function buildVoteKeyboard(battle) {
  const { InlineKeyboard } = require('../node_modules/telegraf/dist/core/helpers/keyboard.js');
  const button = battle.button_text || '🔥 Ovoz berish';
  const url = `https://t.me/${BOT_USERNAME()}?start=vote_${battle.id}`;
  return {
    inline_keyboard: [[{ text: button, url }]]
  };
}

// ─── Build finished post text ─────────────────────────────────
function buildFinishedText(battle) {
  let text = `🏆 <b>Battle yakunlandi</b>\n\n`;
  text += `🎤 <b>Nomi:</b> ${battle.battle_name}\n\n`;
  text += `✅ <b>Ovozlar:</b> ${battle.current_votes} / ${battle.target_votes}\n\n`;
  text += `🎁 <b>Mukofot:</b>\n${battle.reward}`;
  return text;
}

// ─── Create new battle ───────────────────────────────────────
async function createNewBattle(bot, { ownerId, battleName, channelId, targetVotes, reward, buttonText, imageUrl }) {
  const battleId = generateBattleId();

  const battle = createBattle({
    id: battleId,
    ownerId,
    battleName,
    channelId,
    targetVotes: parseInt(targetVotes),
    reward,
    buttonText: buttonText || '🔥 Ovoz berish',
    imageUrl: imageUrl || null,
  });

  // Send post to channel
  const text = buildPostText(battle);
  const keyboard = buildVoteKeyboard(battle);

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
      });
    }
    updateBattleMessageId(battleId, msg.message_id);
  } catch (e) {
    console.error('[battleService] sendMessage error:', e.message);
    throw new Error('Kanalga post yuborib bo\'lmadi: ' + e.message);
  }

  return getBattle(battleId);
}

// ─── Handle a vote ───────────────────────────────────────────
async function handleVote(bot, battleId, userId, username) {
  const battle = getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle topilmadi' };
  if (!battle.active) return { success: false, error: 'Battle tugagan' };
  if (hasVoted(battleId, userId)) return { success: false, error: 'Siz allaqachon ovoz bergansiz' };

  const voted = addVote(battleId, userId, username);
  if (!voted) return { success: false, error: 'Ovoz berishda xato' };

  const updated = incrementVotes(battleId);
  const freshBattle = getBattle(battleId);

  // Update channel post
  await updateChannelPost(bot, freshBattle).catch(() => {});

  // Check if target reached
  if (updated.current_votes >= updated.target_votes) {
    await finishBattle(bot, battleId);
    return { success: true, finished: true, battle: getBattle(battleId) };
  }

  return { success: true, finished: false, battle: freshBattle };
}

// ─── Update channel post ─────────────────────────────────────
async function updateChannelPost(bot, battle) {
  if (!battle.message_id || !battle.channel_id) return;
  try {
    const text = buildPostText(battle);
    const keyboard = buildVoteKeyboard(battle);
    if (battle.image_url) {
      await bot.telegram.editMessageCaption(battle.channel_id, battle.message_id, null, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      await bot.telegram.editMessageText(battle.channel_id, battle.message_id, null, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    console.log('[battleService] updatePost:', e.message);
  }
}

// ─── Finish battle ───────────────────────────────────────────
async function finishBattle(bot, battleId) {
  closeBattle(battleId);
  const battle = getBattle(battleId);
  if (!battle) return;

  // Edit channel post - remove buttons
  if (battle.message_id && battle.channel_id) {
    try {
      const text = buildFinishedText(battle);
      if (battle.image_url) {
        await bot.telegram.editMessageCaption(battle.channel_id, battle.message_id, null, text, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      } else {
        await bot.telegram.editMessageText(battle.channel_id, battle.message_id, null, text, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      }
    } catch (e) {
      console.log('[battleService] finishBattle edit:', e.message);
    }
  }

  // Notify owner
  try {
    await bot.telegram.sendMessage(
      battle.owner_id,
      `🏆 <b>Battleingiz yakunlandi!</b>\n\n🎤 ${battle.battle_name}\n✅ ${battle.current_votes} ovoz to'plandi\n🎁 ${battle.reward}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}

  return battle;
}

module.exports = {
  createNewBattle,
  handleVote,
  finishBattle,
  buildPostText,
  buildVoteKeyboard,
  buildFinishedText,
  generateBattleId,
};
