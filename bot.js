// ─── Environment & Imports ────────────────────────────────────────────────
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import cron from 'node-cron';

import { Client, GatewayIntentBits, Partials, WebhookClient } from 'discord.js';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as splTokenPkg from '@solana/spl-token';
import { TwitterApi } from 'twitter-api-v2';
import { getDomainKey, NameRegistryState } from '@bonfida/spl-name-service';
import { fetchBestPrice } from './priceTracker.js';
import { dripTokens } from './faucet.js';

// ─── Helpers ──────────────────────────────────────────────────────────────
const loadJson = (path) => { try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return {}; } };
const writeJson = (path, data) => { fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8'); };

async function resolveSolanaAddress(address, connection) {
  if (address.endsWith('.sol')) {
    try {
      const { pubkey } = await getDomainKey(address.replace('.sol', ''));
      const registry = await NameRegistryState.retrieve(connection, pubkey);
      return registry.owner;
    } catch { throw new Error('Unable to resolve .sol domain'); }
  }
  return new PublicKey(address);
}

// ─── Config & Validation ─────────────────────────────────────────────────
const {
  DISCORD_BOT_TOKEN,
  TWITTER_BEARER_TOKEN,
  VOICE_WEBHOOK_URL,
  PRICE_WEBHOOK_URL,
  GENERAL_WEBHOOK_URL,
  ANNOUNCEMENT_WEBHOOK_URL,
  VOICE_CHANNEL_ID,
  PRICE_CHANNEL_ID,
  ALERT_CHANNEL_ID,
  RPC_URL,
  WINLEW_MINT,
  BOT_KEYPAIR_PATH,
  COMMAND_PREFIX = '!',
  DRIP_AMOUNT = 1000
} = process.env;

if (!DISCORD_BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN in .env');
if (!VOICE_CHANNEL_ID) throw new Error('Missing VOICE_CHANNEL_ID in .env');
if (!WINLEW_MINT) throw new Error('Missing WINLEW_MINT in .env');
if (!BOT_KEYPAIR_PATH) throw new Error('Missing BOT_KEYPAIR_PATH in .env');
if (!RPC_URL) throw new Error('Missing RPC_URL in .env');

// ─── Solana Connection & Keypair ──────────────────────────────
function loadKeypair(path) {
  const bytes = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
const connection = new Connection(RPC_URL, 'confirmed');
const BOT_KEYPAIR = loadKeypair(BOT_KEYPAIR_PATH);
console.log('WINLEW_MINT from env:', JSON.stringify(WINLEW_MINT));
const TOKEN_MINT = new PublicKey(WINLEW_MINT);

// MOD_IDS from .env as array (comma-separated)
const MOD_IDS = process.env.MOD_IDS
  ? process.env.MOD_IDS.split(',').map(id => id.trim())
  : [];

const checks = [
  ['DISCORD_BOT_TOKEN',      DISCORD_BOT_TOKEN],
  ['TWITTER_BEARER_TOKEN',   TWITTER_BEARER_TOKEN],
  ['VOICE_WEBHOOK_URL',      VOICE_WEBHOOK_URL],
  ['PRICE_WEBHOOK_URL',      PRICE_WEBHOOK_URL],
  ['GENERAL_WEBHOOK_URL',    GENERAL_WEBHOOK_URL],
  ['ANNOUNCEMENT_WEBHOOK_URL', ANNOUNCEMENT_WEBHOOK_URL],
  ['VOICE_CHANNEL_ID',       VOICE_CHANNEL_ID],
  ['PRICE_CHANNEL_ID',       PRICE_CHANNEL_ID],
  ['ALERT_CHANNEL_ID',       ALERT_CHANNEL_ID],
  ['RPC_URL',                RPC_URL],
  ['WINLEW_MINT',            WINLEW_MINT],
  ['BOT_KEYPAIR_PATH',       BOT_KEYPAIR_PATH],
  ['COMMAND_PREFIX',         COMMAND_PREFIX + ' (default)'],
  ['DRIP_AMOUNT',            DRIP_AMOUNT],
  ['MOD_IDS',                MOD_IDS.join(', ')],
];
console.log('→ .env loaded:');
checks.forEach(([name, val]) => {
  const status = val ? '✅ Completed' : '❌ Rejected';
  console.log(` • ${name.padEnd(22)} : ${status}`);
});
const missing = checks.filter(([name, val]) => !val && name !== 'COMMAND_PREFIX').map(([name]) => name);
if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

const PREFIX = COMMAND_PREFIX;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const lastUsed = new Map();

// ─── Webhooks & Clients ──────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

client.on('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

const voiceWebhook = new WebhookClient({ url: VOICE_WEBHOOK_URL });
const priceWebhook = new WebhookClient({ url: PRICE_WEBHOOK_URL });
const generalWebhook = new WebhookClient({ url: GENERAL_WEBHOOK_URL });
const announcementWebhook = ANNOUNCEMENT_WEBHOOK_URL ? new WebhookClient({ url: ANNOUNCEMENT_WEBHOOK_URL }) : null;

const twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN);
const roClient = twitterClient.readOnly;
let twitterUserId;
let lastTweetId;

// ─── Persistent Faucet Claims ────────────────────────────────────────────
const CLAIMS_FILE = './faucet_claims.json';
function getFaucetClaims() { return loadJson(CLAIMS_FILE); }
function setFaucetClaim(address, timestamp) {
  const claims = getFaucetClaims();
  claims[address] = timestamp;
  writeJson(CLAIMS_FILE, claims);
}

// ─── Twitter State ───────────────────────────────────────────────────────
async function loadTwitterUserId() {
  const data = loadJson('./twitterUserId.json');
  if (data?.twitterUserId) twitterUserId = data.twitterUserId;
  else {
    const user = await twitterClient.v2.userByUsername('WinLewToken');
    twitterUserId = user.data.id;
    writeJson('./twitterUserId.json', { twitterUserId });
  }
}
function loadLastTweetId() {
  const data = loadJson('./lastTweet.json');
  lastTweetId = data?.lastTweetId || 1924173606050730291;
}

// ─── Bot Ready & Webhooks ────────────────────────────────────────────────
client.once('ready', async () => {
  console.log('✅ Bot is online');
  // await voiceWebhook.send(' 💰Channel is now live For Hourly Updates');
  // await priceWebhook.send('  💰 Price Should Update');
  await generalWebhook.send('✅ 💰Channel is now live. For assistance, use the !help command');
});

// ─── Command Handlers ────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const [rawCmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const now = Date.now();
  const cooldownKey = `${cmd}:${message.author.id}`;

  try {
    switch (cmd) {
      // ─── Admin Commands ────────────────────────────────
      case 'uptime': {
        const ms = process.uptime() * 1000,
          s = Math.floor(ms / 1000) % 60,
          m = Math.floor(ms / (1000 * 60)) % 60,
          h = Math.floor(ms / (1000 * 60 * 60));
        message.reply(`⏳ Uptime: ${h}h ${m}m ${s}s`);
        break;
      }
      case 'restart': {
        if (!MOD_IDS.includes(message.author.id)) {
          message.reply('❌ You are not authorized to restart the bot.');
          break;
        }
        await message.reply('♻️ Restarting bot...');
        process.exit(0);
        break;
      }
      case 'wallet': {
        message.reply(`🤖 Bot wallet: \`${BOT_KEYPAIR.publicKey.toBase58()}\``);
        break;
      }
      // ─── Main User Commands ────────────────────────────
      case 'balance': {
        const address = args[0];
        if (!address) {
          message.reply('Usage: !balance <Your Solana ADDRESS or .sol>');
          break;
        }
        let owner;
        try { owner = await resolveSolanaAddress(address, connection); }
        catch {
          message.reply('❌ Invalid address or .sol domain');
          break;
        }
        const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint: TOKEN_MINT });
        if (resp.value.length === 0) {
          message.reply('ℹ️ No $WinLEW account found for that address.');
          break;
        }
        const total = resp.value.map(a => a.account.data.parsed.info.tokenAmount.uiAmount || 0).reduce((sum, x) => sum + x, 0);
        message.reply(`🔍 Balance: ${total} WinLEW`);
        break;
      }
      case 'faucet': {
        const address = args[0];
        if (!address) {
          message.reply('Usage: !faucet <Your Solana ADDRESS or .sol>');
          break;
        }
        let recipient;
        try { recipient = await resolveSolanaAddress(address, connection); }
        catch {
          message.reply('❌ Invalid address or .sol domain');
          break;
        }
        const claims = getFaucetClaims();
        const nowSec = Math.floor(Date.now() / 1000);
        const prev = claims[recipient.toBase58()];
        if (prev && nowSec - prev < 86400) {
          message.reply('⏳ This address already claimed the faucet in the past 24h!💥');
          break;
        }
        if (now < (lastUsed.get(cooldownKey) || 0)) {
          const hours = Math.ceil(((lastUsed.get(cooldownKey) || 0) - now) / 3600000);
          message.reply(`⏳ Please wait ~${hours}h to use that command again.`);
          break;
        }
        lastUsed.set(cooldownKey, now + COOLDOWN_MS);
        try {
          const sig = await dripTokens(connection, BOT_KEYPAIR, recipient);
          setFaucetClaim(recipient.toBase58(), nowSec);
          message.reply(`💧 Dripped! Tx: https://solscan.io/tx/${sig}\n_If you don't see the transaction on Solscan right away, please wait a minute and check again!_`);
        } catch (err) {
          if (
            err.message && (
              err.message.includes('could not find an ATA account') ||
              err.message.includes('TokenAccountNotFoundError') ||
              err.message.includes('Failed to send $WinLEW')
            )
          ) {
            message.reply('💥 Error No ATA Account! (Recipient must create their $WinLEW token account first)');
            break;
          }
          console.error(`[${new Date().toISOString()}] Faucet ERROR for ${address}:`, err);
          message.reply(`❌ ${err.message}`);
        }
        break;
      }
      case 'send': {
  if (!MOD_IDS.includes(message.author.id)) {
    message.reply('❌ You are not authorized to use this command.');
    break;
  }
  const address = args[0];
  if (!address) {
    message.reply('Usage: !send <Your Solana ADDRESS or .sol>');
    break;
  }
  let recipient;
  try { recipient = await resolveSolanaAddress(address, connection); }
  catch {
    message.reply('❌ Invalid address or .sol domain');
    break;
  }
  if (recipient.equals(BOT_KEYPAIR.publicKey)) {
    message.reply('❌ Cannot send tokens to the bot\'s own address!');
    break;
  }
  if (now < (lastUsed.get(cooldownKey) || 0)) {
    const hours = Math.ceil(((lastUsed.get(cooldownKey) || 0) - now) / 3600000);
    message.reply(`⏳ Please wait ~${hours}h to use that command again.`);
    break;
  }
  lastUsed.set(cooldownKey, now + COOLDOWN_MS);
  try {
    const fromAta = await splTokenPkg.getOrCreateAssociatedTokenAccount(
      connection, BOT_KEYPAIR, TOKEN_MINT, BOT_KEYPAIR.publicKey
    );
    const toAta = await splTokenPkg.getOrCreateAssociatedTokenAccount(
      connection, BOT_KEYPAIR, TOKEN_MINT, recipient
    );
    const sig = await splTokenPkg.transfer(
      connection, BOT_KEYPAIR, fromAta.address, toAta.address,
      BOT_KEYPAIR.publicKey, Number(DRIP_AMOUNT) * 1e6
    );
    message.reply(
      `✅ Sent ${DRIP_AMOUNT} WinLEW! Tx: https://solscan.io/tx/${sig}\n_If you don't see the transaction on Solscan right away, please wait a minute and check again!_`
    );
  } catch (err) {
    if (
      err.name === 'TransactionExpiredBlockheightExceededError' ||
      (err.message && err.message.includes('block height exceeded'))
    ) {
      message.reply(
        '⏰ Transaction expired (block height exceeded). The Solana network was too slow or the transaction was sent too late. Please try again!'
      );
      break;
    }
    console.error(`[${new Date().toISOString()}] Send ERROR for ${address}:`, err);
    message.reply(`❌ Failed to send: ${err.message || err}`);
  }
  break;
}
      case 'register': {
        const address = args[0];
        if (!address) {
          message.reply('Usage: !register <Your Solana ADDRESS or .sol>');
          break;
        }
        ['registrations.json', 'airdrops.json'].forEach(file => {
          const data = loadJson(file);
          const list = Array.isArray(data) ? data : [];
          list.push(address);
          writeJson(file, list);
        });
        message.reply(`✅ Registered ${address}`);
        break;
      }
      case 'price': {
        try {
          const raw = await fetchBestPrice();
          if (!raw || isNaN(Number(raw))) {
            message.reply('❌ Could not fetch a valid $WinLEW price. Please try again later!');
            break;
          }
          const price = Number(raw).toFixed(6);
          message.reply(`💰 WinLEW Price: $${price}`);
        } catch (err) {
          message.reply('❌ No price source available for $WinLEW right now.');
        }
        break;
      }
      case 'buy': {
        message.reply('🚀 Buy $WinLEW now on Pump.fun:\nhttps://pump.fun/coin/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump');
        break;
      }
      case 'dexscreener': {
        message.reply('📊 Check $WinLEW charts and stats on DexScreener:\nhttps://dexscreener.com/solana/h3hoytv5tg6a2uzqsjhncidgwcwx4h3kdnewfjmlmgfg');
        break;
      }
      case 'rugcheck': {
        message.reply('🔒 Be safe! Verify $WinLEW on RugCheck:\nhttps://rugcheck.xyz/tokens/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump');
        break;
      }
      case 'swap': {
        message.reply('💱 Swap your tokens for $WinLEW using Raydium:\nhttps://raydium.io/swap/?inputMint=sol&outputMint=DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump');
        break;
      }
      case 'geckoterminal': {
        message.reply('🌐 View $WinLEW pool on GeckoTerminal:\nhttps://www.geckoterminal.com/solana/pools/5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx');
        break;
      }
      case 'cmc': {
        message.reply('📈 Track $WinLEW on CoinMarketCap:\nhttps://coinmarketcap.com/dexscan/solana/H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg/');
        break;
      }
      case 'website': {
        message.reply('🖥️ Visit our official site:\nhttp://WinLEW.xyZ');
        break;
      }
      case 'debugprice': {
        if (!MOD_IDS.includes(message.author.id)) {
          message.reply('❌ This command is restricted.');
          break;
        }
        let out = '🛠️ Debugging price sources...\n';
        try { const solscan = await import('./priceTracker.js').then(m => m.fetchSolscanPrice()).catch(e => { out += 'Solscan ❌: ' + e.message + '\n'; throw e; }); out += `Solscan ✅: $${solscan}\n`; } catch (e) {}
        try { const raydium = await import('./priceTracker.js').then(m => m.fetchRaydiumPrice()).catch(e => { out += 'Raydium ❌: ' + e.message + '\n'; throw e; }); out += `Raydium ✅: $${raydium}\n`; } catch (e) {}
        try { const pumpfun = await import('./priceTracker.js').then(m => m.fetchPumpFunPrice()).catch(e => { out += 'Pump.fun ❌: ' + e.message + '\n'; throw e; }); out += `Pump.fun ✅: $${pumpfun}\n`; } catch (e) {}
        try { const dexscreener = await import('./priceTracker.js').then(m => m.fetchDexscreenerPrice()).catch(e => { out += 'Dexscreener ❌: ' + e.message + '\n'; throw e; }); out += `Dexscreener ✅: $${dexscreener}\n`; } catch (e) {}
        message.reply(out.length > 1900 ? out.slice(0, 1900) + '…' : out);
        break;
      }
      case 'supply': {
        const info = await connection.getTokenSupply(TOKEN_MINT);
        message.reply(`🌐 Total supply: ${info.value.uiAmount} WinLEW`);
        break;
      }
      case 'help': {
  message.reply(
    '📖 **Commands:**\n' +
    '• `!balance <Your Solana Address or .sol>` —\n' +
    '  🔍 Check your $WinLEW balance\n' +
    '• `!faucet <Your Solana Address or .sol>` —\n' +
    '  💧 Receive ' + DRIP_AMOUNT + ' $WinLEW\n' +
    '• `!price` — 💰 View current $WinLEW price\n' +
    '• `!register <Your Solana Address or .sol>` —\n' +
    '  📝 Register for airdrops\n' +
    '• `!supply` — 🌐 Total $WinLEW supply\n' +
    '• `!uptime` — ⏱️ Bot uptime\n' +
    '\n' +
    '🔗 **See Quick Links:** Type `!quicklinks` for all WinLEW ecosystem links!\n' +
    '\n' +
    '🛠️ `!debugprice` — (For MOD use ONLY)'
  );
  break;
}
case 'quicklinks': {
  message.reply(
    '🔗 **Quick Links:**\n' +
    '• `!buy` — 🚀 Buy $WinLEW on Pump.fun\n' +
    '• `!dexscreener` — 📊 View charts on DexScreener\n' +
    '• `!rugcheck` — 🔒 Safety check on RugCheck\n' +
    '• `!swap` — 💱 Swap $WinLEW on Raydium\n' +
    '• `!send <Your Solana Address or .sol>` —\n' +
    '  ✉️💧 Receive ' + DRIP_AMOUNT + ' $WinLEW (MOD only)\n' +
    '• `!geckoterminal` — 🌐 Pool info on GeckoTerminal\n' +
    '• `!cmc` — 📈 CoinMarketCap info\n' +
    '• `!website` — 🖥️ Visit our official site: <http://WinLEW.xyZ>'
  );
  break;
}

      case 'modhelp': {
        if (!MOD_IDS.includes(message.author.id)) {
          message.reply('❌ This command is restricted.');
          break;
        }
        message.reply(
          '🛠️ **Moderator/Admin Commands:**\n' +
          '• `!restart` — ♻️ Restart the bot (admin only)\n' +
          '• `!wallet` — 🤖 Show bot\'s public Solana address\n' +
          '• `!debugprice` — 🧩 Show all price source diagnostics\n' +
          '• `!modhelp` — 🛠️ Show this mod/admin help menu\n' +
          '\n' +
          '🔒 *All regular user commands are also available to mods. Use with caution!*'
        );
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`Error in ${cmd}:`, err);
    message.reply(`❌ ${err.message}`);
  }
});

// ─── Scheduled Tasks ──────────────────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const timeline = await roClient.v2.userTimeline(twitterUserId, {
      since_id: lastTweetId, 'tweet.fields': ['created_at', 'text']
    });
    const tweets = timeline.data?.data;
    if (Array.isArray(tweets) && tweets.length > 0) {
      for (const tweet of tweets.reverse()) {
        const url = `https://x.com/${process.env.TWITTER_USERNAME || "WinLewToken"}/status/${tweet.id}`;
        await generalWebhook.send({
          content: `🆕 New Tweet from @${process.env.TWITTER_USERNAME || "WinLewToken"}:\n${tweet.text}\n${url}`
        });
      }
      lastTweetId = tweets[0].id;
      writeJson('./lastTweet.json', { lastTweetId });
    }
  } catch (e) {
    console.error('Twitter poll error:', e);
  }
});

// Voice channel price update
cron.schedule('0 * * * *', async () => {
  try {
    const price = await fetchBestPrice();
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
    if (channel && typeof channel.isVoiceBased === "function" && channel.isVoiceBased()) {
      await channel.setName(`💰 WinLEW: $${Number(price).toFixed(6)}`);
      console.log(`[CRON] Voice channel renamed to: 💰 WinLEW: $${Number(price).toFixed(6)}`);
    } else {
      console.error('[CRON] VOICE_CHANNEL_ID is not a voice channel or not found!');
    }
  } catch (e) {
    console.error('[CRON] Failed to rename channel:', e);
  }
});

// Price channel update
cron.schedule('0 * * * *', async () => {
  try {
    const price = (await fetchBestPrice()).toFixed(6);
    const channel = await client.channels.fetch(PRICE_CHANNEL_ID);
    if (!channel) {
      console.error('PRICE_CHANNEL_ID not found!');
      return;
    }
    await channel.setName(`💰WinLEW:$${price}`);
  } catch (e) {
    console.error('Price rename error:', e);
  }
});

cron.schedule('*/10 * * * *', async () => {
  // Every 10 minutes
  try {
    const price = await fetchBestPrice();
    const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
    if (channel && channel.isVoiceBased?.()) {
      await channel.setName(`💰 WinLEW: $${price.toFixed(6)}`);
      console.log('Voice channel renamed with price');
    }
  } catch (e) {
    console.error('Error in voice channel cron:', e);
  }
});

// ─── Start Bot ───────────────────────────────────────────────
client.login(DISCORD_BOT_TOKEN);
