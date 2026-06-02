/**
 * Orbit Discord Bot — Rick-style token analysis
 * Commands: !a <CA>, !track <CA> <MC> above|below, !untrack <CA>, !trackers, !orbit
 */
const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js')
require('dotenv').config()

const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const ORBIT_BACKEND = process.env.ORBIT_BACKEND || 'https://backend-production-a427a.up.railway.app'
const DEXSCREENER_BASE  = 'https://api.dexscreener.com/latest/dex'
const DEXSCREENER_V1    = 'https://api.dexscreener.com/tokens/v1'
const PUMPFUN_API       = 'https://frontend-api.pump.fun/coins'
const POLL_MS           = 5_000

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
})

const trackers = new Map()

function isPaidUser(member) {
  if (!member?.roles?.cache) return false
  return member.roles.cache.some(r => ['degen', 'omega'].includes(r.name.toLowerCase()))
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtMC    = n => !n ? '$0' : n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${n.toFixed(0)}`
const fmtPrice = n => {
  if (!n || n === 0) return '$0'
  if (n >= 1)        return `$${n.toFixed(4)}`
  if (n >= 0.001)    return `$${n.toFixed(6)}`
  if (n >= 0.00001)  return `$${n.toFixed(8)}`
  return `$${n.toExponential(3)}`
}
const fmtAge = s => { if (!s) return '?'; if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s/60)}m`; return `${(s/3600).toFixed(1)}h` }
const pct    = n => n != null ? `${Math.round(n)}%` : '?%'
const sign   = n => n > 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`
const short  = s => s ? `${s.slice(0,4)}...${s.slice(-4)}` : '?'

function rugEmoji(p) {
  if (p >= 75) return '🔴'
  if (p >= 40) return '🟡'
  return '🟢'
}

// ── Chain detection ───────────────────────────────────────────────────────────
function detectChain(mint) {
  // ETH addresses: 0x + 40 hex chars
  if (/^0x[0-9a-fA-F]{40}$/.test(mint)) return 'ethereum'
  // Solana: base58, 32-44 chars
  return 'solana'
}

// ── Fetch data ────────────────────────────────────────────────────────────────
async function fetchDex(mint) {
  const chain = detectChain(mint)

  // Use v1 endpoint for Solana (returns array directly, chain-scoped).
  // Fall back to the legacy cross-chain endpoint for EVM addresses.
  const url = chain === 'solana'
    ? `${DEXSCREENER_V1}/solana/${mint}`
    : `${DEXSCREENER_BASE}/tokens/${mint}`

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) {
    console.error(`[DexScreener] HTTP ${res.status} for ${mint} (${url})`)
    return null
  }
  const data = await res.json()

  // v1 returns an array; legacy returns { pairs: [...] }
  let pairs = Array.isArray(data) ? data : (data.pairs || [])
  if (!Array.isArray(data)) {
    // Legacy endpoint: filter to matching chain, fall back to all if none match
    const filtered = pairs.filter(p => p.chainId === chain)
    pairs = filtered.length ? filtered : pairs
  }
  if (!pairs.length) return null

  const isBonding = p => {
    const dex = (p.dexId || '').toLowerCase()
    return dex === 'pumpfun' || dex === 'pump.fun' || (p.labels && p.labels.includes('v1'))
  }
  // Prefer migrated pairs over bonding curve, then sort by liquidity desc
  pairs.sort((a, b) => {
    const diff = (isBonding(a) ? 0 : 1) - (isBonding(b) ? 0 : 1)
    if (diff !== 0) return -diff
    return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
  })

  // Walk pairs to find one with a non-zero market cap / FDV
  for (const p of pairs) {
    if (parseFloat(p.marketCap || p.fdv || 0) > 0) return p
  }
  return pairs[0]
}

async function fetchPumpMC(mint) {
  try {
    const res = await fetch(`${PUMPFUN_API}/${mint}`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data = await res.json()
    const mc = data.usd_market_cap
    return (typeof mc === 'number' && mc > 0) ? mc : null
  } catch { return null }
}

// For the tracker: use pump.fun for SOL (much fresher data), DexScreener for ETH
async function fetchTrackerMC(mint) {
  if (detectChain(mint) === 'solana') {
    const mc = await fetchPumpMC(mint)
    if (mc !== null) return mc
  }
  const pair = await fetchDex(mint)
  if (!pair) return null
  return parseFloat(pair.marketCap || pair.fdv || 0) || null
}

async function fetchSnapshot(mint) {
  try {
    const chain = detectChain(mint)
    const url = chain === 'ethereum'
      ? `${ORBIT_BACKEND}/debug/eth/${mint}`
      : `${ORBIT_BACKEND}/debug/${mint}`
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
    if (!res.ok) return null
    const d = await res.json()
    return d.snapshot || d
  } catch { return null }
}

// ── Build Rick-style message ──────────────────────────────────────────────────
async function buildMessage(mint) {
  const [pair, snap] = await Promise.all([
    fetchDex(mint).catch(() => null),
    fetchSnapshot(mint).catch(() => null),
  ])

  if (!pair) return { content: `❌ Token not found: \`${short(mint)}\`` }

  const name     = pair.baseToken?.name    || '?'
  const symbol   = pair.baseToken?.symbol  || '?'
  const mc       = parseFloat(pair.marketCap || pair.fdv || 0)
  const liq      = parseFloat(pair.liquidity?.usd || 0)
  const liqRatio = liq > 0 ? Math.round(mc / liq) : 0
  const vol1h    = parseFloat(pair.volume?.h1 || 0)
  const vol24    = parseFloat(pair.volume?.h24 || 0)
  const price    = parseFloat(pair.priceUsd || 0)
  const ch1h     = parseFloat(pair.priceChange?.h1 || 0)
  const ch24     = parseFloat(pair.priceChange?.h24 || 0)
  const buys5m   = pair.txns?.m5?.buys   || 0
  const sells5m  = pair.txns?.m5?.sells  || 0
  const buys1h   = pair.txns?.h1?.buys   || 0
  const sells1h  = pair.txns?.h1?.sells  || 0
  const created  = pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 1000) : null

  // Snapshot signals
  const rugPct   = snap?.rug_probability ?? 50
  const top5     = snap?.top5_concentration_pct
  const devHold  = snap?.dev_holding_pct
  const fresh1d  = snap?.fresh_wallet_pct
  const bundle   = snap?.bundle_detected
  const holders  = snap?.total_holders
  const topH     = snap?.top_holders?.slice(0,3).map(h => h.pct?.toFixed(1) + '%').join('·') || '?'
  const isMig    = snap?.is_migrated || mc > 34000
  const flags    = snap?.flags || []
  const bullish  = snap?.bullish_flags || []

  // Social links
  const chain = detectChain(mint)
  const chainBadge = chain === 'ethereum' ? '⟠ ETH' : '◎ SOL'
  const socials = []
  if (snap?.has_twitter) socials.push('[𝕏](https://twitter.com)')
  if (snap?.has_telegram) socials.push('[✈](https://t.me)')
  if (snap?.has_website) socials.push('[🌐](https://example.com)')
  socials.push(`[DEX](https://dexscreener.com/${chain}/${mint})`)
  if (chain === 'solana') {
    socials.push(`[Pump](https://pump.fun/${mint})`)
    socials.push(`[Birdeye](https://birdeye.so/token/${mint})`)
  } else {
    socials.push(`[Etherscan](https://etherscan.io/token/${mint})`)
    socials.push(`[Uniswap](https://app.uniswap.org/explore/tokens/ethereum/${mint})`)
  }

  const lines = []
  lines.push(`**${name}** \\[${symbol}\\] ${isMig ? '✅ Migrated' : '🔵 Bonding'}`)
  lines.push(`\`${mint}\``)
  lines.push('')
  lines.push(`💲 **Price:** ${fmtPrice(price)}　💰 **FDV:** ${fmtMC(mc)}　💧 **Liq:** ${fmtMC(liq)} [${liqRatio}x]`)
  lines.push(`📊 **Vol:** 1h ${fmtMC(vol1h)} · 24h ${fmtMC(vol24)}　⏱ **Age:** ${fmtAge(created)}`)
  lines.push(`📈 **1H:** ${sign(ch1h)} · **24H:** ${sign(ch24)}　🔵 ${buys1h} 🔴 ${sells1h}`)
  lines.push('')
  if (topH !== '?') lines.push(`🏆 **Top 3:** ${topH}　💼 **Dev:** ${pct(devHold)}`)
  if (fresh1d != null) lines.push(`🆕 **Fresh 1D:** ${pct(fresh1d)}　${bundle ? '📦 **Bundle detected**' : '✅ No bundle'}`)
  lines.push('')
  lines.push(`🔗 ${socials.join(' · ')}`)

  if (flags.length > 0) {
    lines.push('')
    lines.push(`⚠️ ${flags.slice(0,3).map(f => `\`${f}\``).join(' · ')}`)
  }
  if (bullish.length > 0) {
    lines.push(`✅ ${bullish.slice(0,2).map(f => `\`${f}\``).join(' · ')}`)
  }

  const color = rugPct >= 70 ? 0xFF4444 : rugPct >= 40 ? 0xFFAA00 : 0x22C55E

  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Orbit v0.8 · ${chainBadge} · ${new Date().toLocaleTimeString()}` })

  return { embeds: [embed] }
}

// ── Commands ──────────────────────────────────────────────────────────────────
client.on('messageCreate', async msg => {
  if (msg.author.bot) return
  const args = msg.content.trim().split(/\s+/)
  const cmd  = args[0]?.toLowerCase()

  if (cmd === '!a' || cmd === '!analyze') {
    const mint = args[1]
    if (!mint || mint.length < 20) return msg.reply('Usage: `!a <token CA>`')
    const pending = await msg.reply('⬡ Analyzing...')
    try {
      const payload = await buildMessage(mint)
      await pending.edit({ content: '', ...payload })
    } catch (e) {
      await pending.edit(`❌ ${e.message}`)
    }
    return
  }

  if (cmd === '!track' || cmd === '!t') {
    const [, mint, mcStr, dir = 'above'] = args
    if (!mint || !mcStr) return msg.reply('Usage: `!track <CA> <MC in K> above|below`')
    if (!isPaidUser(msg.member)) {
      const userCount = [...trackers.values()].filter(t => t.userId === msg.author.id).length
      if (userCount >= 1) return msg.reply('❌ Free accounts can only track 1 coin at a time. Upgrade to **Degen** or **Omega** for unlimited trackers.')
    }
    const targetMC = parseFloat(mcStr) * 1000
    trackers.set(mint, { mint, targetMC, direction: dir, channelId: msg.channelId, lastAbove: null, userId: msg.author.id })
    const watchBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('watching').setLabel('● Watching').setStyle(ButtonStyle.Success)
    )
    return msg.reply({ content: `Tracking \`${short(mint)}\` — alert when **${dir}** ${fmtMC(targetMC)}\n-# Data may lag slightly. Free accounts can only track 1 coin — upgrade to Degen or Omega for unlimited trackers.`, components: [watchBtn] })
  }

  if (cmd === '!untrack') {
    trackers.delete(args[1])
    return msg.reply('✅ Removed.')
  }

  if (cmd === '!trackers') {
    if (!trackers.size) return msg.reply('No active trackers.')
    const list = [...trackers.values()].map(t => `• \`${short(t.mint)}\` ${t.direction} ${fmtMC(t.targetMC)}`).join('\n')
    return msg.reply(`**Active:**\n${list}`)
  }


  if (cmd === '!pnl') {
    const wallet = args[1]
    if (!wallet || wallet.length < 20) return msg.reply('Usage: `!pnl <wallet>`')
    const pending = await msg.reply('⬡ Fetching PnL...')
    try {
      const res = await fetch(`${ORBIT_BACKEND}/pnl/${wallet}`, { signal: AbortSignal.timeout(30000) })
      const data = await res.json()
      if (data.error) { await pending.edit(`❌ ${data.error}`); return }
      const net = data.total_pnl_pct ?? data.net_sol
      const sign = net >= 0 ? '+' : ''
      await pending.edit(`💰 **PnL for** \`${wallet.slice(0,8)}...\`\n**Net SOL:** ${sign}${net?.toFixed(4)} SOL\n**Trades:** ${data.trade_count || 0} · **Tokens:** ${data.tokens_traded || 0}`)
    } catch (e) {
      await pending.edit(`❌ ${e.message}`)
    }
    return
  }

  if (cmd === '!orbit' || cmd === '!help') {
    return msg.reply('**Orbit Bot**\n`!a <CA>` — analyze (SOL or ETH)\n`!pnl <wallet>` — monthly PnL\n`!track <CA> <MC> above|below` — price alert\n`!untrack <CA>` — remove\n`!trackers` — list\norbit-app.xyz')
  }
})

// ── Button interactions ───────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return
  if (interaction.customId === 'watching') {
    await interaction.reply({ content: '🟢 Tracker is active and watching for your target.', ephemeral: true })
  }
})

// ── 5s tracker poll (parallel, edge-crossing) ────────────────────────────────
setInterval(() => {
  Promise.allSettled([...trackers.entries()].map(async ([mint, t]) => {
    try {
      const mc = await fetchTrackerMC(mint)
      if (!mc) return  // skip 0 and null — bad reads must not affect state

      const isAbove = mc >= t.targetMC

      if (t.lastAbove === null) {
        // First valid reading — establish baseline, don't alert
        t.lastAbove = isAbove
        return
      }

      // Detect a threshold crossing since the last valid reading
      const crossed = t.direction === 'above'
        ? (!t.lastAbove && isAbove)   // was below, now crossed above
        : (t.lastAbove && !isAbove)   // was above, now crossed below

      t.lastAbove = isAbove

      if (crossed) {
        const ch = await client.channels.fetch(t.channelId)
        const payload = await buildMessage(mint)
        await ch.send({ content: `🔔 **Alert!** \`${short(mint)}\` hit ${fmtMC(mc)} (target: ${t.direction} ${fmtMC(t.targetMC)})`, ...payload })
      }
    } catch (e) { console.error(`[Tracker] ${mint}:`, e.message) }
  }))
}, POLL_MS)

process.on('unhandledRejection', err => console.error('[Bot] Unhandled rejection:', err))
process.on('uncaughtException', err => console.error('[Bot] Uncaught exception:', err))

console.log('[Bot] Starting... TOKEN exists:', !!DISCORD_TOKEN, 'BACKEND:', ORBIT_BACKEND)

client.once('ready', () => console.log(`[Orbit Bot] ${client.user.tag} online | Backend: ${ORBIT_BACKEND}`))
client.on('error', err => console.error('[Bot] Client error:', err))
client.login(DISCORD_TOKEN).catch(err => console.error('[Bot] Login failed:', err))
