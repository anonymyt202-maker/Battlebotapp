const crypto = require('crypto');

/**
 * Validates Telegram WebApp initData using HMAC-SHA256
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateTelegramData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    // Sort keys and build data_check_string
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256 with key = HMAC-SHA256("WebAppData", BOT_TOKEN)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (expectedHash !== hash) return null;

    // Parse user data
    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);

    return user;
  } catch (e) {
    console.error('[telegramAuth] Error:', e.message);
    return null;
  }
}

/**
 * Express middleware — attaches req.telegramUser or returns 401
 */
function telegramAuthMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;

  if (!initData) {
    return res.status(401).json({ success: false, error: 'initData topilmadi' });
  }

  // Dev mode bypass (no BOT_TOKEN set or test mode)
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
    req.telegramUser = { id: 1, first_name: 'Dev', username: 'dev_user' };
    return next();
  }

  const user = validateTelegramData(initData);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Telegram autentifikatsiya xatosi' });
  }

  req.telegramUser = user;
  next();
}

module.exports = { validateTelegramData, telegramAuthMiddleware };
