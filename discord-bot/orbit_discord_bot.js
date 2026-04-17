/**
 * Orbit Discord Bot — Rick-style token analysis
 * Commands: !a <CA>, !track <CA> <MC> above|below, !untrack <CA>, !trackers, !orbit
 */
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js')
require('dotenv').config()

const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const ORBIT_BACKEND = process.env.ORBIT_BACKEND || 'http://localhost:8000'
const DEXSCREENER   = 'https://api.dexscreener.com/tokens/v1/solana'
const POLL_MS       = 15_000

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
})

const trackers = new Map()

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtMC  = n => !n ? '$0' : n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${n.toFixed(0)}`
const fmtAge = s => { if (!s) return '?'; if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s/60)}m`; return `${(s/3600).toFixed(1)}h` }
const pct    = n => n != null ? `${Math.round(n)}%` : '?%'
const sign   = n => n > 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`
const short  = s => s ? `${s.slice(0,4)}...${s.slice(-4)}` : '?'

function rugEmoji(p) {
  if (p >= 75) return '🔴'
  if (p >= 40) return '🟡'
  return '🟢'
}

// ── Fetch data ────────────────────────────────────────────────────────────────
async function fetchDex(mint) {
  const res  = await fetch(`${DEXSCREENER}/${mint}`)
  const data = await res.json()
  const pairs = Array.isArray(data) ? data : (data.pairs || [])
  const sol = pairs.filter(p => p.chainId === 'solana')
  sol.sort((a,b) => ((b.liquidity?.usd||0) - (a.liquidity?.usd||0)))
  return sol[0] || null
}

async function fetchSnapshot(mint) {
  try {
    const res = await fetch(`${ORBIT_BACKEND}/snapshot/${mint}`, { signal: AbortSignal.timeout(25000) })
    return res.ok ? res.json() : null
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
  const socials = []
  if (snap?.has_twitter) socials.push('[𝕏](https://twitter.com)')
  if (snap?.has_telegram) socials.push('[✈](https://t.me)')
  if (snap?.has_website) socials.push('[🌐](https://example.com)')
  socials.push(`[DEX](https://dexscreener.com/solana/${mint})`)
  socials.push(`[Pump](https://pump.fun/${mint})`)
  socials.push(`[Birdeye](https://birdeye.so/token/${mint})`)

  const lines = []
  lines.push(`**${name}** \\[${symbol}\\] ${isMig ? '✅ Migrated' : '🔵 Bonding'}`)
  lines.push(`\`${mint}\``)
  lines.push('')
  lines.push(`💰 **FDV:** ${fmtMC(mc)}　💧 **Liq:** ${fmtMC(liq)} [${liqRatio}x]`)
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
    .setFooter({ text: `Orbit v0.0 · ${new Date().toLocaleTimeString()}` })

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
    trackers.set(mint, { mint, targetMC: parseFloat(mcStr) * 1000, direction: dir, channelId: msg.channelId, triggered: false })
    return msg.reply(`✅ Tracking \`${short(mint)}\` — alert when **${dir}** ${fmtMC(parseFloat(mcStr)*1000)}`)
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

  if (cmd === '!orbit' || cmd === '!help') {
    return msg.reply('**Orbit Bot**\n`!a <CA>` — analyze\n`!track <CA> <MC> above|below` — price alert\n`!untrack <CA>` — remove\n`!trackers` — list')
  }
})

// ── 15s tracker poll ──────────────────────────────────────────────────────────
setInterval(async () => {
  for (const [mint, t] of trackers.entries()) {
    if (t.triggered) continue
    try {
      const pair = await fetchDex(mint)
      if (!pair) continue
      const mc = parseFloat(pair.marketCap || pair.fdv || 0)
      const hit = (t.direction === 'above' && mc >= t.targetMC) || (t.direction === 'below' && mc <= t.targetMC)
      if (hit) {
        t.triggered = true
        const ch = await client.channels.fetch(t.channelId)
        const payload = await buildMessage(mint)
        await ch.send({ content: `🔔 **Alert!** \`${short(mint)}\` hit ${fmtMC(mc)} (target: ${t.direction} ${fmtMC(t.targetMC)})`, ...payload })
      }
    } catch {}
  }
}, POLL_MS)

client.once('ready', () => console.log(`[Orbit Bot] ${client.user.tag} online | Backend: ${ORBIT_BACKEND}`))
client.login(DISCORD_TOKEN)
