// "Save bracket image": draws both brackets on a <canvas> (no libraries) and
// downloads it as a PNG.
import { BRACKET, MAX_TEAMS, byeFor, bySlot, sectionEdges, sourceLabel, teamName } from './bracket.js'
import { formatEventDate, skillOf } from './teams.js'

const W = 1400, PAD = 48, COL_W = 230, COLS = 5
const GAP = (W - PAD * 2 - COL_W * COLS) / (COLS - 1)
const ROW_H = 40, LABEL_H = 18, MATCH_H = LABEL_H + ROW_H * 2 + 6
const BYE_GROUP_H = ROW_H + 14 + MATCH_H
const SECTION_BODY = { winners: 4 * 176, losers: 4 * 126 }
const HEADER_H = 160, TITLE_H = 44, ROUND_TITLE_H = 30, SECTION_GAP = 36, FOOTER_H = 56

const C = {
  bg: '#0b3a29', bg2: '#0e4732', line: 'rgba(255,255,255,0.10)', text: '#f2fbf4', muted: '#a9c9b6',
  surface: '#135a40', open: 'rgba(255,255,255,0.06)', ball: '#d9f24a', ballInk: '#183018', connector: 'rgba(242,251,244,0.45)',
  skill: { beginner: '#5ee0a0', intermediate: '#7cc4ff', advanced: '#ffb36b' },
}
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif'
const BODY = 'Barlow, system-ui, sans-serif'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

function courtLines(ctx, h) {
  ctx.save()
  ctx.strokeStyle = C.line
  ctx.lineWidth = 3
  const cw = W - 160, ch = h - 200, x = 80, y = 120
  ctx.strokeRect(x, y, cw, ch)
  ctx.beginPath()
  ctx.moveTo(x, y + ch / 2); ctx.lineTo(x + cw, y + ch / 2)               // net
  ctx.moveTo(x, y + ch * 0.35); ctx.lineTo(x + cw, y + ch * 0.35)         // kitchen lines
  ctx.moveTo(x, y + ch * 0.65); ctx.lineTo(x + cw, y + ch * 0.65)
  ctx.moveTo(x + cw / 2, y); ctx.lineTo(x + cw / 2, y + ch * 0.35)        // center lines
  ctx.moveTo(x + cw / 2, y + ch * 0.65); ctx.lineTo(x + cw / 2, y + ch)
  ctx.stroke()
  ctx.restore()
}

/** Positions of every match, side and bye box, in the same arrangement as the page. */
export function layout() {
  const nodes = {}
  const sections = []
  let top = HEADER_H
  for (const section of BRACKET) {
    const bodyTop = top + TITLE_H + ROUND_TITLE_H
    const bodyH = SECTION_BODY[section.id]
    const rounds = section.rounds.map((round, r) => {
      const x = PAD + r * (COL_W + GAP)
      const n = round.matches.length
      round.matches.forEach((match, i) => {
        const center = bodyTop + (bodyH * (i + 0.5)) / n
        const firstRound = section.id === 'winners' && r === 0
        let y = center - MATCH_H / 2
        if (firstRound) {
          const groupTop = center - BYE_GROUP_H / 2
          nodes[`bye-${byeFor(i)}`] = { x, y: groupTop, w: COL_W, h: ROW_H, slot: byeFor(i) }
          y = groupTop + ROW_H + 14
        }
        nodes[match.id] = { x, y, w: COL_W, h: MATCH_H, match, firstRound }
        nodes[`${match.id}:a`] = { x, y: y + LABEL_H, w: COL_W, h: ROW_H }
        nodes[`${match.id}:b`] = { x, y: y + LABEL_H + ROW_H + 6, w: COL_W, h: ROW_H }
      })
      return { title: round.title, x }
    })
    sections.push({ section, top, rounds })
    top = bodyTop + bodyH + SECTION_GAP
  }
  return { nodes, sections, height: top - SECTION_GAP + FOOTER_H }
}

function drawTeam(ctx, x, y, w, h, slot, entry) {
  roundRect(ctx, x, y, w, h, 8)
  ctx.fillStyle = entry ? C.surface : C.open
  ctx.fill()
  if (!entry) {
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore()
  } else {
    ctx.save(); ctx.clip(); ctx.fillStyle = entry.color; ctx.fillRect(x, y, 6, h); ctx.restore()
  }
  // Slot number
  ctx.fillStyle = entry ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.arc(x + 26, y + h / 2, 12, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = C.text
  ctx.font = `700 14px ${DISPLAY}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(String(slot), x + 26, y + h / 2 + 1)
  ctx.textAlign = 'left'

  if (!entry) {
    ctx.fillStyle = C.muted; ctx.font = `500 15px ${BODY}`
    ctx.fillText('Open', x + 46, y + h / 2 + 1)
    return
  }
  const skill = skillOf(entry.skill_level)
  ctx.font = `700 11px ${BODY}`
  const badgeW = ctx.measureText(skill.short).width + 14
  const bx = x + w - badgeW - 8
  roundRect(ctx, bx, y + h / 2 - 9, badgeW, 18, 9)
  ctx.fillStyle = C.skill[skill.id]; ctx.fill()
  ctx.fillStyle = '#0b2418'; ctx.textAlign = 'center'
  ctx.fillText(skill.short, bx + badgeW / 2, y + h / 2 + 1)
  ctx.textAlign = 'left'
  ctx.fillStyle = C.text; ctx.font = `600 15px ${BODY}`
  ctx.fillText(fit(ctx, teamName(entry), bx - (x + 46) - 6), x + 46, y + h / 2 + 1)
}

function drawTbd(ctx, x, y, w, h, side) {
  roundRect(ctx, x, y, w, h, 8)
  ctx.fillStyle = C.open; ctx.fill()
  ctx.fillStyle = C.text; ctx.font = `700 15px ${DISPLAY}`; ctx.textBaseline = 'middle'
  ctx.fillText('TBD', x + 14, y + h / 2 + 1)
  ctx.fillStyle = C.muted; ctx.font = `500 12px ${BODY}`
  ctx.textAlign = 'right'
  ctx.fillText(sourceLabel(side), x + w - 12, y + h / 2 + 1)
  ctx.textAlign = 'left'
}

export async function drawBracketImage({ entries, settings, scale = 2 }) {
  try {
    await Promise.all([document.fonts?.load(`700 40px ${DISPLAY}`), document.fonts?.load(`600 15px ${BODY}`)])
  } catch { /* fall back to system fonts */ }
  const { nodes, sections, height } = layout()
  const slots = bySlot(entries)
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)

  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, C.bg2); grad.addColorStop(1, C.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, height)
  courtLines(ctx, height)

  // Header
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.ball
  ctx.beginPath(); ctx.arc(PAD + 22, 70, 22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = C.ballInk
  for (const [dx, dy] of [[-8, -6], [6, -9], [9, 5], [-5, 8], [0, 0]]) {
    ctx.beginPath(); ctx.arc(PAD + 22 + dx, 70 + dy, 2.6, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = C.text
  ctx.font = `800 52px ${DISPLAY}`
  ctx.fillText(fit(ctx, (settings?.event_name || 'Pickleball Tournament').toUpperCase(), W - PAD * 2 - 260), PAD + 60, 88)
  ctx.font = `500 20px ${BODY}`
  ctx.fillStyle = C.muted
  const sub = [formatEventDate(settings?.event_date), 'Double elimination · Doubles'].filter(Boolean).join('  ·  ')
  ctx.fillText(sub, PAD + 60, 120)
  ctx.textAlign = 'right'
  ctx.fillStyle = C.ball
  ctx.font = `800 34px ${DISPLAY}`
  ctx.fillText(`${(entries || []).length} OF ${MAX_TEAMS}`, W - PAD, 84)
  ctx.font = `600 15px ${BODY}`
  ctx.fillStyle = C.muted
  ctx.fillText('TEAMS', W - PAD, 106)
  ctx.textAlign = 'left'

  for (const { section, top, rounds } of sections) {
    ctx.fillStyle = C.ball
    ctx.font = `800 26px ${DISPLAY}`
    ctx.fillText(section.title.toUpperCase(), PAD, top + 28)
    ctx.fillStyle = C.muted
    ctx.font = `700 14px ${DISPLAY}`
    for (const r of rounds) ctx.fillText(r.title.toUpperCase(), r.x, top + TITLE_H + 16)

    // Connectors
    ctx.strokeStyle = C.connector
    ctx.lineWidth = 2
    for (const edge of sectionEdges(section)) {
      const a = nodes[edge.from], b = nodes[`${edge.to}:${edge.side}`]
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, xm = (x1 + x2) / 2
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xm, y1); ctx.lineTo(xm, y2); ctx.lineTo(x2, y2); ctx.stroke()
    }

    for (const round of section.rounds) {
      for (const match of round.matches) {
        const n = nodes[match.id]
        ctx.fillStyle = C.muted; ctx.font = `700 12px ${DISPLAY}`; ctx.textBaseline = 'alphabetic'
        ctx.fillText(match.id === 'GF' ? 'FINAL' : match.id, n.x + 2, n.y + 12)
        for (const side of ['a', 'b']) {
          const s = nodes[`${match.id}:${side}`]
          if (n.firstRound) drawTeam(ctx, s.x, s.y, s.w, s.h, match[side].slot, slots[match[side].slot])
          else drawTbd(ctx, s.x, s.y, s.w, s.h, match[side])
        }
      }
    }
  }

  // Byes
  for (const [key, n] of Object.entries(nodes)) {
    if (!key.startsWith('bye-')) continue
    drawTeam(ctx, n.x, n.y, n.w - 52, n.h, n.slot, slots[n.slot])
    roundRect(ctx, n.x + n.w - 46, n.y + 8, 46, n.h - 16, 12)
    ctx.fillStyle = C.ball; ctx.fill()
    ctx.fillStyle = C.ballInk; ctx.font = `800 13px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('BYE', n.x + n.w - 23, n.y + n.h / 2 + 1)
    ctx.textAlign = 'left'
  }

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.muted
  ctx.font = `500 14px ${BODY}`
  ctx.fillText('First to 11 · Switch sides at 6 · Slots 1–4 have first-round byes', PAD, height - 24)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(settings?.event_name || 'pickleball-bracket').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'pickleball-bracket'}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
