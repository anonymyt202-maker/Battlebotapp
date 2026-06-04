# 🎤 Ovoz Battle Bot

Telegram Mini App + Bot — Railway deploy uchun to'liq tayyor loyiha.

## 📁 Fayl tuzilmasi

```
battlebot/
├── bot.js           ← Asosiy server (Express + Telegraf)
├── database.js      ← JSON asosidagi ma'lumotlar bazasi
├── package.json     ← Loyiha bog'liqliklari
├── railway.json     ← Railway konfiguratsiyasi
├── .env.example     ← Muhit o'zgaruvchilari namunasi
├── .gitignore
├── data/            ← JSON fayllar (avtomatik yaratiladi)
│   ├── users.json
│   ├── battles.json
│   ├── votes.json
│   └── settings.json
└── public/          ← Static fayllar (Mini App)
    ├── index.html
    ├── app.js
    └── style.css
```

## 🚀 Railway Deploy

### 1. Telegram Bot yaratish
1. [@BotFather](https://t.me/botfather) ga yozing
2. `/newbot` → nom va username bering
3. **BOT_TOKEN** ni nusxa oling
4. `/newapp` → Mini App domenini Railway URL ga o'rnating

### 2. Railway deploy
1. [railway.app](https://railway.app) ga kiring
2. **New Project** → **Deploy from GitHub repo** (yoki **Empty Project**)
3. Agar GitHub: repo ni import qiling
4. Agar Empty: Railway CLI bilan `railway up` qiling

### 3. Environment Variables (Settings → Variables)
```
BOT_TOKEN    = 1234567890:AABBCCxxx
BOT_USERNAME = mybattlebot
MINIAPP_URL  = https://battlebot-production.up.railway.app
ADMIN_ID     = 123456789
NODE_ENV     = production
```

> ⚠️ `MINIAPP_URL` Railway tomonidan berilgan domeningiz bo'lishi kerak!

### 4. BotFather'da Mini App ulash
1. `/mybots` → botingizni tanlang
2. **Bot Settings** → **Menu Button** → **Configure menu button**
3. URL: `https://your-app.up.railway.app`
4. Matn: `🎤 Battle yaratish`

### 5. Kanal uchun bot ni admin qilish
Battle yaratishdan oldin botni kanalingizda admin qiling:
- Kanal sozlamalari → Administratorlar → Bot qo'shing
- Ruxsatlar: xabar yuborish, xabarlarni tahrirlash

## ⚙️ Admin huquqlari
`ADMIN_ID` ni `.env` da o'rnating (Telegram ID).  
ID ni [@userinfobot](https://t.me/userinfobot) dan oling.

## 🤖 Bot buyruqlari
| Buyruq | Tavsif |
|--------|--------|
| `/start` | Botni ishga tushirish |
| `/admin` | Admin panel |
| `📋 Battlelarim` | O'z battlelaringiz |
| `📊 Statistika` | Umumiy statistika |
| `ℹ️ Yordam` | Qo'llanma |

## 📱 Mini App sahifalari
- **🏠 Bosh** — Umumiy statistika va battle yaratish tugmasi
- **➕ Yaratish** — Yangi battle shakli
- **🎤 Battlelar** — O'z battlelaringiz ro'yxati
- **📊 Statistika** — Bot statistikasi
- **⚙️ Admin** — Admin panel (faqat adminlarga)

## 🔧 Local ishga tushirish
```bash
cp .env.example .env
# .env ni to'ldiring

npm install
npm run dev
```

`NODE_ENV=development` bo'lganda initData tekshirilmaydi.

## 📝 API Endpointlar
| Metod | URL | Tavsif |
|-------|-----|--------|
| GET | `/api/user` | Joriy foydalanuvchi |
| GET | `/api/stats` | Umumiy statistika |
| GET | `/api/battles` | Mening battlelarim |
| POST | `/api/check-channel` | Kanal tekshirish |
| POST | `/api/create-battle` | Battle yaratish |
| POST | `/api/vote` | Ovoz berish |
| POST | `/api/admin/broadcast` | Broadcast (admin) |
| POST | `/api/admin/close` | Battle yopish |
| POST | `/api/admin/ban` | Foydalanuvchi ban |
| GET | `/api/admin/stats` | Admin statistika |
