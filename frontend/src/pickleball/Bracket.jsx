import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BRACKET, byeFor, bySlot, sectionEdges, sourceLabel, teamName } from './bracket.js'
import { skillOf } from './teams.js'
import { reducedMotion } from './motion.js'

const JUMPS = [
  { id: 'winners', label: 'Winners', target: '#pb-section-winners' },
  { id: 'losers', label: 'Losers', target: '#pb-section-losers' },
  { id: 'final', label: 'Grand final', target: '[data-node="GF"]' },
]

function jump(target) {
  const el = document.querySelector(target)
  el?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start', inline: 'center' })
}

/** Display-only double-elimination bracket: both brackets on one board. */
export default function Bracket({ entries, ownedIds, organizer, onEdit, newIds, pulseSlot }) {
  const slots = bySlot(entries)
  const box = { slots, ownedIds, organizer, onEdit, newIds, pulseSlot }
  // Names and badges change box heights, so the lines are re-measured when teams change.
  const version = (entries || []).map(e => `${e.id}:${e.player_name}:${e.partner_name}`).join('|') + organizer
  return (
    <section className="pb-board" aria-labelledby="pb-board-title">
      <div className="pb-board-head">
        <h2 id="pb-board-title" className="pb-card-title">Bracket</h2>
        <div className="pb-jump" role="group" aria-label="Jump to">
          {JUMPS.map(j => (
            <button key={j.id} type="button" className={`pb-jump-btn is-${j.id}`} onClick={() => jump(j.target)}>{j.label}</button>
          ))}
        </div>
      </div>
      <div className="pb-bracket">
        {BRACKET.map((section, i) => (
          <Section key={section.id} section={section} colOffset={i * 2} box={box} version={version} />
        ))}
      </div>
    </section>
  )
}

function Section({ section, colOffset, box, version }) {
  const innerRef = useRef(null)
  const [lines, setLines] = useState([])
  const [drawing, setDrawing] = useState(true)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const edges = sectionEdges(section)
    const measure = () => {
      const base = inner.getBoundingClientRect()
      const segs = []
      for (const edge of edges) {
        const from = inner.querySelector(`[data-node="${edge.from}"]`)
        const to = inner.querySelector(`[data-node="${edge.to}:${edge.side}"]`)
        if (!from || !to) continue
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect()
        const x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top
        const x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top
        const xm = Math.round(x1 + (x2 - x1) / 2)
        const col = Number(to.closest('[data-col]')?.dataset.col || 0)
        const key = `${edge.from}-${edge.to}${edge.side}`
        segs.push({ key: `${key}-1`, kind: 'h', left: x1, top: y1, len: xm - x1, col, step: 0 })
        segs.push({ key: `${key}-2`, kind: 'v', left: xm, top: Math.min(y1, y2), len: Math.abs(y2 - y1), col, step: 1, up: y2 < y1 })
        segs.push({ key: `${key}-3`, kind: 'h', left: xm, top: y2, len: x2 - xm, col, step: 2 })
      }
      setLines(segs)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(inner)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [section, version])

  useEffect(() => {
    const t = setTimeout(() => setDrawing(false), 3200)
    return () => clearTimeout(t)
  }, [])

  return (
    <section className={`pb-section is-${section.id}`} id={`pb-section-${section.id}`} aria-label={section.title}>
      <h2 className="pb-section-title">{section.title}</h2>
      <div className="pb-scroll" tabIndex={0} aria-label={section.title}>
        <div className="pb-section-inner" ref={innerRef}>
          <div className={`pb-lines${drawing ? ' is-drawing' : ''}`} aria-hidden="true">
            {lines.map(s => (
              <span key={s.key} className={`pb-line is-${s.kind}${s.up ? ' is-up' : ''}`}
                style={{
                  left: s.left, top: s.top,
                  [s.kind === 'h' ? 'width' : 'height']: Math.max(0, s.len),
                  '--d': `${0.35 + (colOffset + s.col) * 0.22 + s.step * 0.12}s`,
                }} />
            ))}
          </div>
          {section.rounds.map((round, r) => (
            <div key={round.id} className={`pb-round${round.id === 'gf' ? ' is-final' : ''}`} data-col={r}
              style={{ '--col': colOffset + r }}>
              <h3 className="pb-round-title">{round.title}</h3>
              <div className="pb-round-body">
                {round.matches.map((match, i) => (
                  <div key={match.id} className="pb-cell">
                    {section.id === 'winners' && r === 0 && <ByeBox slot={byeFor(i)} box={box} />}
                    <Match match={match} firstRound={section.id === 'winners' && r === 0} box={box} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ByeBox({ slot, box }) {
  return (
    <div className="pb-bye" data-node={`bye-${slot}`}>
      <TeamBox slot={slot} box={box} />
      <span className="pb-bye-tag">Bye</span>
    </div>
  )
}

function Match({ match, firstRound, box }) {
  return (
    <div className="pb-match" data-node={match.id}>
      <span className="pb-match-id">{match.id === 'GF' ? 'Final' : match.id}</span>
      {['a', 'b'].map(side => (
        <div key={side} className="pb-side" data-node={`${match.id}:${side}`}>
          {firstRound
            ? <TeamBox slot={match[side].slot} box={box} />
            : <div className="pb-tbd"><span>TBD</span><small>{sourceLabel(match[side])}</small></div>}
        </div>
      ))}
    </div>
  )
}

function TeamBox({ slot, box }) {
  const entry = box.slots[slot]
  if (!entry) {
    return (
      <div className="pb-team is-open" data-slot={slot}>
        <span className="pb-team-slot" aria-label={`Slot ${slot}`}>{slot}</span>
        <span className="pb-team-name">Open</span>
      </div>
    )
  }
  const mine = box.ownedIds.has(entry.id)
  const skill = skillOf(entry.skill_level)
  const name = teamName(entry)
  const classes = ['pb-team', 'is-filled', mine && 'is-mine', box.newIds.has(entry.id) && 'is-new',
    box.pulseSlot === slot && 'is-pulse'].filter(Boolean).join(' ')
  return (
    <div className={classes} data-slot={slot} style={{ '--team': entry.color }}>
      <span className="pb-team-slot" aria-label={`Slot ${slot}`}>{slot}</span>
      <span className="pb-team-main">
        <span className="pb-team-name" title={name}>{name}</span>
        <span className="pb-team-meta">
          <span className={`pb-skill is-${skill.id}`} title={skill.label}>{skill.label}</span>
          {mine && <span className="pb-you">You</span>}
        </span>
      </span>
      {(mine || box.organizer) && (
        <button type="button" className="pb-edit" onClick={() => box.onEdit(entry)} aria-label={`Edit ${name}`}>Edit</button>
      )}
    </div>
  )
}
