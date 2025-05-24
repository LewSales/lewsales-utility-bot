// priceTracker.js
import fetch from 'node-fetch';

const WINLEW_MINT_ADDR    = process.env.WINLEW_MINT;
const WINLEW_POOL_ID      = process.env.WINLEW_POOL_ID;
const RAYDIUM_POOL_ID     = process.env.RAYDIUM_POOL_ID;
const PUMPFUN_POOL_ID     = process.env.PUMPFUN_POOL_ID;
const DEXSCREENER_PAIR_ID = process.env.DEXSCREENER_PAIR_ID;
const SOLSCAN_KEY         = process.env.SOLSCAN_API_KEY;

// endpoints
const SOLSCAN_URL      = id => `https://pro-api.solscan.io/v2.0/token/price?address=${id}`;
const RAY_KEY_URL      = `https://api-v3.raydium.io/pools/key/ids?ids=${RAYDIUM_POOL_ID}`;
const RAY_INFO_URL     = `https://api-v3.raydium.io/pools/info/ids?ids=${RAYDIUM_POOL_ID}`;
const PUMPFUN_URL      = `https://api.pump.fun/coin/${PUMPFUN_POOL_ID}`;
const DEXSCREENER_URL  = id => `https://api.dexscreener.io/latest/dex/pairs/solana/${id}`;

export async function fetchSolscanPrice() {
  if (!SOLSCAN_KEY) throw new Error('SOLSCAN_API_KEY not set');
  const res = await fetch(SOLSCAN_URL(WINLEW_MINT_ADDR), {
    headers: {
      accept: 'application/json',
      token: SOLSCAN_KEY
    }
  });
  if (!res.ok) throw new Error(`Solscan HTTP ${res.status}`);
  const json = await res.json();
  if (typeof json.data?.price !== 'number') throw new Error('No price in Solscan result');
  return Number(json.data.price);
}

export async function fetchRaydiumPrice() {
  const keyRes = await fetch(RAY_KEY_URL);
  if (!keyRes.ok) throw new Error(`Ray key HTTP ${keyRes.status}`);
  const { data: [poolKey] } = await keyRes.json();
  if (!poolKey?.id) throw new Error('Raydium pool not found');
  const infoRes = await fetch(RAY_INFO_URL);
  if (!infoRes.ok) throw new Error(`Ray info HTTP ${infoRes.status}`);
  const { data: [info] } = await infoRes.json();
  if (typeof info.price !== 'string') throw new Error('No price in Ray info');
  return Number(info.price);
}

export async function fetchPumpFunPrice() {
  const res = await fetch(PUMPFUN_URL);
  if (!res.ok) throw new Error(`Pump.fun HTTP ${res.status}`);
  const json = await res.json();
  if (typeof json.price?.usd !== 'number') throw new Error('No price in Pump.fun');
  return Number(json.price.usd);
}

export async function fetchDexscreenerPrice() {
  if (!DEXSCREENER_PAIR_ID) throw new Error('DEXSCREENER_PAIR_ID not set');
  const res = await fetch(DEXSCREENER_URL(DEXSCREENER_PAIR_ID));
  if (!res.ok) throw new Error(`Dexscreener HTTP ${res.status}`);
  const json = await res.json();
  if (typeof json.pair?.priceUsd !== 'number') {
    throw new Error('No price in Dexscreener result');
  }
  return Number(json.pair.priceUsd);
}

export async function fetchBestPrice() {
  try {
    const solscan = await fetchSolscanPrice();
    console.log('Solscan price:', solscan);
    return solscan;
  } catch (e) { console.warn('⚠️ Solscan failed, trying Raydium…', e); }
  try {
    const ray = await fetchRaydiumPrice();
    console.log('Raydium price:', ray);
    return ray;
  } catch (e) { console.warn('⚠️ Raydium failed, trying Pump.fun…', e); }
  try {
    const pump = await fetchPumpFunPrice();
    console.log('Pump.fun price:', pump);
    return pump;
  } catch (e) { console.warn('⚠️ Pump.fun failed, trying Dexscreener…', e); }
  try {
    const dexscreener = await fetchDexscreenerPrice();
    console.log('Dexscreener price:', dexscreener);
    return dexscreener;
  } catch (e) {
    console.error('❌ All price sources failed!', e);
    throw new Error('All price sources failed');
  }
}
