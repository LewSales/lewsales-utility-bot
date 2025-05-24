# 🤖 WinLEW Utility Bot

A full-featured Discord bot for \$WinLEW token holders, with a built-in Solana faucet, price tracking, and ecosystem tools.
*Built and refined by **LewSales** 🦾*

---

## ✨ Features

* 💧 **Faucet**: Secure daily token drops (with cooldowns)
* 💰 **Price Tracking**: Live updates from Solscan, Raydium, Pump.fun, Dexscreener
* 🔗 **Quick Links**: One-click resources for \$WinLEW holders
* 📢 **Webhooks**: Broadcast new tweets, price changes, and announcements
* 🗝️ **Admin Commands**: Wallet, airdrop register, restart, and more
* 🔒 **Security**: Rate-limited faucet, mod-only commands, and safe token handling

---

## 🚀 Getting Started

### 1. **Clone or Download the Bot**

```bash
git clone https://github.com/your-repo/winlew-utility-bot.git
cd winlew-utility-bot
```

*Or just unzip the folder provided.*

---

### 2. **Install Dependencies**

```bash
yarn install
```

or

```bash
npm install
```

---

### 3. **Set Up Your `.env` File**

* Copy `.env.example` to `.env`
  *(Or create your own `.env` using the sample below)*
* **Fill in your own credentials and IDs**

<details>
<summary>Example <code>.env</code> (replace values!)</summary>

```
RPC_URL=https://api.mainnet-beta.solana.com
WINLEW_MINT=YourTokenMintAddressHere
BOT_KEYPAIR_PATH=./bot-keypair.json
DISCORD_BOT_TOKEN=your-discord-token
TWITTER_BEARER_TOKEN=your-twitter-token
VOICE_WEBHOOK_URL=your-webhook-url
VOICE_CHANNEL_ID=1234567890
ALERT_CHANNEL_ID=1234567890
PRICE_WEBHOOK_URL=your-price-webhook-url
PRICE_CHANNEL_ID=1234567890
GENERAL_WEBHOOK_URL=your-general-webhook-url
GENERAL_CHANNEL_ID=1234567890
ANNOUNCEMENT_WEBHOOK_URL=your-announcement-webhook-url
ANNOUNCEMENTS_CHANNEL_ID=1234567890
MOD_IDS=your-discord-id
DRIP_AMOUNT=1000
# Add any other required fields
```

</details>

---

### 4. **Generate or Add Your Solana Keypair**

* Save your Solana keypair as `bot-keypair.json` in the project directory.
* Example:

  ```bash
  solana-keygen new --outfile bot-keypair.json
  ```

---

### 5. **Run the Bot**

```bash
yarn start
```

or

```bash
node bot.js
```

---

## ⚠️ **Security Reminders**

* **Never share your `.env` file or keypair with anyone!**
* Make sure the bot wallet is funded with \$WinLEW tokens to use the faucet/send features.
* Use mod-only commands responsibly (set your Discord user ID in `MOD_IDS`).

---

## 📝 **Bot Commands**

* `!balance <address or .sol>` — Check \$WinLEW balance
* `!faucet <address or .sol>` — Request faucet drop (1 per 24h)
* `!price` — View live \$WinLEW price
* `!register <address or .sol>` — Register for airdrops
* `!supply` — Total \$WinLEW supply
* `!uptime` — Bot uptime
* `!quicklinks` — List ecosystem links
* `!modhelp` — Mod/admin help menu (mods only)
* ...and more!

---

## ✨ **Credits**

Coded & crafted with passion by [LewSales](https://twitter.com/LewSales) 🦾

---

**Questions?**
Open an issue, reach out on Discord, or ping [LewSales](https://twitter.com/LewSales) for custom work or support!

---
