require('dotenv').config();
const express   = require('express');
const path      = require('path');
const { Telegraf } = require('telegraf');

const db          = require('./database');
const { telegramAuthMiddleware } = require('./middleware/telegramAuth');
const { battleCreateLimit, voteLimit } = require('./middleware/rateLimit');
const battleService = require('./services/battleService');

// ─── Bot instance (shared with bot.js logic if needed) ───────
const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── Express app ─────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Mini App static files
app.use('/miniapp', express.static(path.join(__dirname, 'miniapp')));

// ─── CORS for Telegram WebApp ─────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─────────────────────────────────────────────────────────────
//   PUBLIC ENDPOINTS
// ─────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Voice Battle Bot', time: new Date().toISOString() });
});

// Stats (public)
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ success: true, ...stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
//   AUTHENTICATED ENDPOINTS
// ─────────────────────────────────────────────────────────────

// Get own profile
app.get('/api/profile', telegramAuthMiddleware, (req, res) => {
  try {
    const tgUser = req.telegramUser;
    const user = db.upsertUser(tgUser.id, tgUser.username, tgUser.first_name);
    const battles = db.getUserBattles(tgUser.id);
    const activeBattles = battles.filter(b => b.active === 1);

    res.json({
      success: true,
      user: {
        id:            user.id,
        username:      user.username,
        first_name:    tgUser.first_name || user.first_name,
        balance:       user.balance,
        blocked:       user.blocked,
        created_at:    user.created_at,
      },
      stats: {
        total_battles:  battles.length,
        active_battles: activeBattles.length,
      },
      battles: battles.slice(0, 20).map(b => ({
        id:            b.id,
        battle_name:   b.battle_name,
        channel_id:    b.channel_id,
        target_votes:  b.target_votes,
        current_votes: b.current_votes,
        reward:        b.reward,
        active:        b.active === 1,
        created_at:    b.created_at,
      })),
    });
  } catch (e) {
    console.error('[/api/profile]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Check if bot is admin in channel
app.post('/api/check-channel', telegramAuthMiddleware, async (req, res) => {
  const { channel } = req.body;
  if (!channel) return res.status(400).json({ success: false, error: 'Kanal kerak' });

  let ch = channel.trim();
  if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(ch, me.id);
    const ok = ['administrator', 'creator'].includes(member.status);
    res.json({ success: ok, status: member.status, error: ok ? null : 'Bot kanalda admin emas' });
  } catch (e) {
    res.json({ success: false, error: 'Kanal topilmadi yoki bot kirish huquqi yo\'q: ' + e.message });
  }
});

// Create battle
app.post('/api/create-battle', telegramAuthMiddleware, battleCreateLimit, async (req, res) => {
  try {
    const tgUser = req.telegramUser;
    const { battleName, channelId, targetVotes, reward, buttonText, imageUrl } = req.body;

    // Validation
    if (!battleName?.trim())  return res.status(400).json({ success: false, error: 'Battle nomi kerak' });
    if (!channelId?.trim())   return res.status(400).json({ success: false, error: 'Kanal kerak' });
    if (!reward?.trim())      return res.status(400).json({ success: false, error: 'Mukofot kerak' });
    if (!targetVotes || parseInt(targetVotes) < 1) return res.status(400).json({ success: false, error: 'Maqsad ovozlar soni kerak' });

    let ch = channelId.trim();
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;

    // Check bot is admin
    try {
      const me = await bot.telegram.getMe();
      const member = await bot.telegram.getChatMember(ch, me.id);
      if (!['administrator', 'creator'].includes(member.status)) {
        return res.status(400).json({ success: false, error: 'Bot kanalda admin emas! Avval botni admin qiling.' });
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Kanal topilmadi: ' + e.message });
    }

    // Ensure user exists in DB
    db.upsertUser(tgUser.id, tgUser.username, tgUser.first_name);

    const battle = await battleService.createNewBattle(bot, {
      ownerId:    tgUser.id,
      battleName: battleName.trim(),
      channelId:  ch,
      targetVotes: parseInt(targetVotes),
      reward:     reward.trim(),
      buttonText: buttonText?.trim() || '🔥 Ovoz berish',
      imageUrl:   imageUrl?.trim() || null,
    });

    res.json({ success: true, battle });
  } catch (e) {
    console.error('[/api/create-battle]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Vote endpoint (called from bot deeplink, but also available via API)
app.post('/api/vote', telegramAuthMiddleware, voteLimit, async (req, res) => {
  try {
    const tgUser = req.telegramUser;
    const { battleId } = req.body;
    if (!battleId) return res.status(400).json({ success: false, error: 'battleId kerak' });

    db.upsertUser(tgUser.id, tgUser.username, tgUser.first_name);

    const result = await battleService.handleVote(bot, battleId, tgUser.id, tgUser.username);
    res.json(result);
  } catch (e) {
    console.error('[/api/vote]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get single battle info (authenticated)
app.get('/api/battle/:id', telegramAuthMiddleware, (req, res) => {
  try {
    const battle = db.getBattle(req.params.id);
    if (!battle) return res.status(404).json({ success: false, error: 'Battle topilmadi' });
    res.json({ success: true, battle });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
//   ADMIN ENDPOINTS
// ─────────────────────────────────────────────────────────────
function adminMiddleware(req, res, next) {
  const userId = req.telegramUser?.id;
  if (!userId || !db.isAdmin(userId)) {
    return res.status(403).json({ success: false, error: 'Admin emas' });
  }
  next();
}

app.get('/api/admin/stats', telegramAuthMiddleware, adminMiddleware, (req, res) => {
  res.json({ success: true, ...db.getStats() });
});

// ─────────────────────────────────────────────────────────────
//   START BOT + SERVER
// ─────────────────────────────────────────────────────────────

// Start bot in polling mode
bot.launch({ allowedUpdates: ['message', 'callback_query'] })
  .then(() => console.log(`✅ Bot ishga tushdi! @${process.env.BOT_USERNAME}`))
  .catch(err => { console.error('❌ Bot xatosi:', err.message); });

// Handle /start vote_BATTLEID from bot deeplink
bot.start(async (ctx) => {
  const payload = ctx.startPayload || '';

  if (payload.startsWith('vote_')) {
    const battleId = payload.slice(5);
    const battle = db.getBattle(battleId);

    if (!battle) {
      return ctx.reply('❌ Battle topilmadi.');
    }
    if (!battle.active) {
      return ctx.reply('❌ Bu battle tugagan.');
    }

    // Register vote
    db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const result = await battleService.handleVote(bot, battleId, ctx.from.id, ctx.from.username);

    if (!result.success) {
      return ctx.reply(`❌ ${result.error}`);
    }

    if (result.finished) {
      return ctx.reply(`✅ Ovozingiz qabul qilindi!\n\n🏆 Battle yakunlandi! ${battle.battle_name}\n✅ ${battle.target_votes} ta maqsadga yetildi!`);
    }

    const fresh = result.battle;
    return ctx.reply(
      `✅ <b>Ovozingiz qabul qilindi!</b>\n\n🎤 ${fresh.battle_name}\n📊 ${fresh.current_votes} / ${fresh.target_votes} ovoz`,
      { parse_mode: 'HTML' }
    );
  }

  // Default start
  await ctx.reply(
    `👋 Salom, <b>${ctx.from.first_name}</b>!\n\n🎤 <b>Voice Battle Bot</b>ga xush kelibsiz!\n\nBattle yaratish uchun Mini App ni oching:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '🎤 Battle yaratish',
          web_app: { url: process.env.MINIAPP_URL + '/miniapp' }
        }]]
      }
    }
  );
});

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server ishga tushdi: http://localhost:${PORT}`);
  console.log(`📱 Mini App: ${process.env.MINIAPP_URL}/miniapp`);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
