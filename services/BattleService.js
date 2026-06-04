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

// Generate unique battle ID
function generateBattleId() {
return (
Math.random().toString(36).substring(2, 10) +
Date.now().toString(36)
);
}

// Build active battle post text
function buildPostText(battle) {
return `🎤 <b>${battle.battle_name}</b>

🎁 <b>Mukofot:</b>
${battle.reward}

🎯 <b>Maqsad:</b> ${battle.target_votes} ta ovoz

📊 <b>Hozirgi:</b> ${battle.current_votes} / ${battle.target_votes}

⚡ Battle davom etmoqda!`;
}

// Build vote button
function buildVoteKeyboard(battle) {
const button =
battle.button_text || '🔥 Ovoz berish';

const url =
"https://t.me/${BOT_USERNAME()}?start=vote_${battle.id}";

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

// Build finished text
function buildFinishedText(battle) {
return `🏆 <b>Battle yakunlandi</b>

🎤 <b>Nomi:</b>
${battle.battle_name}

✅ <b>Ovozlar:</b>
${battle.current_votes} / ${battle.target_votes}

🎁 <b>Mukofot:</b>
${battle.reward}`;
}

// Create battle
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

const battleId =
generateBattleId();

createBattle({
id: battleId,
ownerId,
battleName,
channelId,
targetVotes:
parseInt(targetVotes),
reward,
buttonText:
buttonText ||
'🔥 Ovoz berish',
imageUrl:
imageUrl || null
});

const battle =
getBattle(battleId);

const text =
buildPostText(battle);

const keyboard =
buildVoteKeyboard(battle);

let msg;

try {

if (
  imageUrl &&
  imageUrl.trim() !== ''
) {

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

} catch (err) {

console.error(
  '[createBattle]',
  err
);

throw new Error(
  'Kanalga post yuborilmadi'
);

}

return getBattle(battleId);
}

// Vote
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
  error:
    'Battle topilmadi'
};

}

if (!battle.active) {

return {
  success: false,
  error:
    'Battle tugagan'
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

const ok =
addVote(
battleId,
userId,
username
);

if (!ok) {

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

const fresh =
getBattle(
battleId
);

await updateChannelPost(
bot,
fresh
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
battle: fresh
};
}

// Update channel post
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

try {

const text =
  buildPostText(
    battle
  );

const keyboard =
  buildVoteKeyboard(
    battle
  );

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
  '[updatePost]',
  err.message
);

}

}

// Finish battle
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
      reply_markup:
        {
          inline_keyboard:
            []
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
      reply_markup:
        {
          inline_keyboard:
            []
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

✅ ${battle.current_votes} ovoz

🎁 ${battle.reward}`
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
