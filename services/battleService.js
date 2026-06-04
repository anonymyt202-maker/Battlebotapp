const {
  createBattle,
  getBattle,
  updateBattleMessageId,
  incrementVotes,
  closeBattle,
  addVote,
  hasVoted,
} = require('../database');

const BOT_USERNAME = () => process.env.BOT_USERNAME || 'your_bot';

// Battle ID yaratish
function generateBattleId() {
  return (
    Math.random().toString(36).substring(2, 10) +
    Date.now().toString(36)
  );
}

// Kanal posti
function buildPostText(battle) {
  return `🎤 <b>${battle.battle_name}</b>

🎁 <b>Mukofot:</b>
${battle.reward}

🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz

📊 <b>Hozirgi:</b> ${battle.current_votes} / ${battle.target_votes}

⚡ Battle davom etmoqda!`;
}

// Ovoz berish tugmasi
function buildVoteKeyboard(battle) {
  const button =
    battle.button_text || '🔥 Ovoz berish';

  const url =
    `https://t.me/${BOT_USERNAME()}?start=vote_${battle.id}`;

  return {
    inline_keyboard: [
      [
        {
          text: button,
          url
        }
      ]
    ]
  };
}

// Battle tugagan matn
function buildFinishedText(battle) {
  return `🏆 <b>Battle yakunlandi!</b>

🎤 <b>${battle.battle_name}</b>

✅ Ovozlar: ${battle.current_votes}

🎯 Maqsad: ${battle.target_votes}

🎁 Mukofot:
${battle.reward}`;
}

// Battle yaratish
async function createNewBattle(
  bot,
  {
    ownerId,
    battleName,
    channelId,
    targetVotes,
    reward,
    buttonText,
    imageUrl
  }
) {

  const battleId = generateBattleId();

  createBattle({
    id: battleId,
    ownerId,
    battleName,
    channelId,
    targetVotes,
    reward,
    buttonText,
    imageUrl
  });

  const battle = getBattle(battleId);

  const text = buildPostText(battle);
  const keyboard = buildVoteKeyboard(battle);

  let msg;

  if (imageUrl) {

    msg =
      await bot.telegram.sendPhoto(
        channelId,
        imageUrl,
        {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );

  } else {

    msg =
      await bot.telegram.sendMessage(
        channelId,
        text,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );

  }

  updateBattleMessageId(
    battleId,
    msg.message_id
  );

  return getBattle(battleId);
}

// Ovoz berish
async function handleVote(
  bot,
  battleId,
  userId,
  username
) {

  const battle =
    getBattle(battleId);

  if (!battle) {
    return {
      success: false,
      error: 'Battle topilmadi'
    };
  }

  if (!battle.active) {
    return {
      success: false,
      error: 'Battle tugagan'
    };
  }

  if (
    hasVoted(
      battleId,
      userId
    )
  ) {
    return {
      success: false,
      error:
        'Siz allaqachon ovoz bergansiz'
    };
  }

  const voted =
    addVote(
      battleId,
      userId,
      username
    );

  if (!voted) {
    return {
      success: false,
      error:
        'Ovoz saqlanmadi'
    };
  }

  const updated =
    incrementVotes(
      battleId
    );

  const freshBattle =
    getBattle(
      battleId
    );

  await updateChannelPost(
    bot,
    freshBattle
  );

  if (
    updated.current_votes >=
    updated.target_votes
  ) {

    await finishBattle(
      bot,
      battleId
    );

    return {
      success: true,
      finished: true,
      battle:
        getBattle(
          battleId
        )
    };

  }

  return {
    success: true,
    finished: false,
    battle: freshBattle
  };
}

// Kanal postini yangilash
async function updateChannelPost(
  bot,
  battle
) {

  if (
    !battle ||
    !battle.message_id
  ) {
    return;
  }

  const text =
    buildPostText(
      battle
    );

  const keyboard =
    buildVoteKeyboard(
      battle
    );

  try {

    if (
      battle.image_url
    ) {

      await bot.telegram.editMessageCaption(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        {
          parse_mode:
            'HTML',
          reply_markup:
            keyboard
        }
      );

    } else {

      await bot.telegram.editMessageText(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        {
          parse_mode:
            'HTML',
          reply_markup:
            keyboard
        }
      );

    }

  } catch (err) {
    console.log(
      '[updateChannelPost]',
      err.message
    );
  }

}

// Battle yakunlash
async function finishBattle(
  bot,
  battleId
) {

  closeBattle(
    battleId
  );

  const battle =
    getBattle(
      battleId
    );

  if (!battle)
    return;

  const text =
    buildFinishedText(
      battle
    );

  try {

    if (
      battle.image_url
    ) {

      await bot.telegram.editMessageCaption(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        {
          parse_mode:
            'HTML',
          reply_markup: {
            inline_keyboard: []
          }
        }
      );

    } else {

      await bot.telegram.editMessageText(
        battle.channel_id,
        battle.message_id,
        undefined,
        text,
        {
          parse_mode:
            'HTML',
          reply_markup: {
            inline_keyboard: []
          }
        }
      );

    }

  } catch (err) {
    console.log(
      '[finishBattle]',
      err.message
    );
  }

  try {

    await bot.telegram.sendMessage(
      battle.owner_id,
      `🏆 Battle yakunlandi!

🎤 ${battle.battle_name}

✅ ${battle.current_votes} ovoz yig'ildi.

🎁 Mukofot:
${battle.reward}`
    );

  } catch {}

  return battle;
}

module.exports = {
  createNewBattle,
  handleVote,
  finishBattle,
  buildPostText,
  buildVoteKeyboard,
  buildFinishedText,
  generateBattleId
};
