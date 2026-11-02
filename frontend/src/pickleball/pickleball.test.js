// Run with `npm test` (node --test, no extra dependencies).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BRACKET, allSlots, sectionEdges, sourceLabel } from './bracket.js'
import { PROFESSIONAL, SKILLS, cleanName, formatEventDate, relativeTime, skillOf, teamErrors } from './teams.js'
import { layout } from './drawBracket.js'
import WallMessage from './WallMessage.js'
import { addItems, bracketEvents, mentions, messageEvents, snapshotEntries, unreadCount } from './notify.js'

const matches = BRACKET.flatMap(s => s.rounds.flatMap(r => r.matches))
const byId = Object.fromEntries(matches.map(m => [m.id, m]))
const sides = m => [m.a, m.b]

test('round 1 and quarterfinal pairings', () => {
  const [r1, qf, sf] = BRACKET[0].rounds
  assert.deepEqual(r1.matches.map(m => [m.a.slot, m.b.slot]),
    [[1, 16], [8, 9], [4, 13], [5, 12], [3, 14], [6, 11], [2, 15], [7, 10]])
  // Slots 1–4 (the old byes) meet the old round-1 winners in the quarterfinals, as before.
  const slotsOf = id => [byId[id].a.slot, byId[id].b.slot]
  assert.deepEqual(qf.matches.map(m => [...slotsOf(m.a.winner), ...slotsOf(m.b.winner)]),
    [[1, 16, 8, 9], [4, 13, 5, 12], [3, 14, 6, 11], [2, 15, 7, 10]])
  assert.deepEqual(sf.matches.map(m => [m.a.winner, m.b.winner]), [['W9', 'W10'], ['W11', 'W12']])
})

test('every slot 1–16 appears exactly once', () => {
  assert.deepEqual([...allSlots()].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1))
})

test('double elimination: 30 games, every winners-bracket loser drops in once', () => {
  assert.equal(matches.length, 2 * 16 - 2)
  const winnersIds = BRACKET[0].rounds.flatMap(r => r.matches).map(m => m.id).filter(id => id !== 'GF')
  const dropped = matches.flatMap(sides).filter(s => s.loser).map(s => s.loser).sort()
  assert.deepEqual(dropped, [...winnersIds].sort())
  // Every game but the grand final feeds its winner to exactly one later game.
  const fed = matches.flatMap(sides).filter(s => s.winner).map(s => s.winner)
  for (const m of matches) if (m.id !== 'GF') assert.equal(fed.filter(x => x === m.id).length, 1, m.id)
  assert.deepEqual([byId.GF.a.winner, byId.GF.b.winner], ['W15', 'L14'])
})

test('losers bracket crosses over so first-round opponents never meet again early', () => {
  // Quarterfinal losers drop in against the opposite half's round-1 losers.
  const l2 = BRACKET[1].rounds[1].matches.map(m => [byId[m.a.winner].a.loser, byId[m.a.winner].b.loser, m.b.loser])
  assert.deepEqual(l2, [['W1', 'W2', 'W12'], ['W3', 'W4', 'W11'], ['W5', 'W6', 'W10'], ['W7', 'W8', 'W9']])
  for (const [a, b, qf] of l2) {
    const fed = [byId[qf].a.winner, byId[qf].b.winner]
    assert.ok(!fed.includes(a) && !fed.includes(b), `${qf} loser would get a rematch`)
  }
})

test('connector edges stay inside a section and reach real matches', () => {
  const winners = sectionEdges(BRACKET[0])
  assert.ok(winners.some(e => e.from === 'W1' && e.to === 'W9' && e.side === 'a'))
  assert.ok(winners.some(e => e.from === 'W15' && e.to === 'GF'))
  assert.ok(!winners.some(e => e.from.startsWith('L')))
  const losers = sectionEdges(BRACKET[1])
  assert.ok(losers.every(e => e.from.startsWith('L') && e.to.startsWith('L')))
  assert.equal(losers.length, 13)
})

test('TBD captions', () => {
  assert.equal(sourceLabel({ winner: 'W3' }), 'Winner W3')
  assert.equal(sourceLabel({ loser: 'W8' }), 'Loser W8')
  assert.equal(sourceLabel({ winner: 'L14' }), "Losers' champion")
  assert.equal(sourceLabel({ winner: 'W15' }), "Winners' champion")
})

test('image layout: no boxes overlap', () => {
  const { nodes, height } = layout()
  const boxes = Object.entries(nodes).filter(([k]) => !k.includes(':')).map(([, n]) => n)
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    assert.ok(a.y >= 0 && a.y + a.h <= height)
    for (const b of boxes.slice(i + 1)) {
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      assert.ok(!overlap, `${a.match?.id || a.slot} overlaps ${b.match?.id || b.slot}`)
    }
  }
})

test('names: trimmed, 2–30 characters, unique in any case', () => {
  const entries = [{ id: 'e1', player_name: 'Alex' }]
  assert.deepEqual(teamErrors({ player_name: 'Sam' }, entries), {})
  assert.ok(teamErrors({ player_name: 'alex' }, entries).player_name)
  assert.ok(teamErrors({ player_name: ' ALEX ' }, entries).player_name)
  assert.ok(teamErrors({ player_name: 'A' }, entries).player_name)
  assert.ok(teamErrors({ player_name: 'x'.repeat(31) }, entries).player_name)
  // Editing your own entry keeps your own name.
  assert.deepEqual(teamErrors({ player_name: 'ALEX' }, entries, 'e1'), {})
  assert.equal(cleanName('  Jamie   Lee '), 'Jamie Lee')
})

test('HTML in a wall message renders as text, never markup', () => {
  const body = '<img src=x onerror="alert(1)"><b>hi</b><script>alert(2)</script>'
  const team = { id: 'e1', player_name: '<i>Al</i>', color: '#ef4444' }
  const html = renderToStaticMarkup(h(WallMessage, {
    message: { id: 'm1', entry_id: 'e1', body, created_at: '2026-10-22T12:00:00Z' }, team, now: Date.parse('2026-10-22T12:05:00Z'),
  }))
  assert.ok(!html.includes('<img') && !html.includes('<b>') && !html.includes('<script') && !html.includes('<i>'), html)
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;b&gt;hi&lt;/b&gt;'), html)
  assert.match(html, /--team:#ef4444/)
  assert.match(html, />5m ago</)
})

test('relative time and event date', () => {
  const at = Date.parse('2026-10-22T12:00:00Z')
  assert.equal(relativeTime('2026-10-22T11:59:40Z', at), 'just now')
  assert.equal(relativeTime('2026-10-22T09:00:00Z', at), '3h ago')
  assert.match(formatEventDate('2026-11-14'), /14/)
  assert.equal(formatEventDate(null), '')
})

test('the pickleball page never touches chore code, tables or endpoints', () => {
  const dir = new URL('.', import.meta.url)
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.test.js')) continue
    const src = readFileSync(new URL(file, dir), 'utf8')
    assert.ok(!/chore|chat_messages/i.test(src), `${file} mentions chores`)
    assert.ok(!/from '\.\.\//.test(src), `${file} imports from outside src/pickleball`)
  }
})

// ── Notifications ────────────────────────────────────────────────────────────

const team = (id, slot, player, extra = {}) =>
  ({ id, slot, player_name: player, skill_level: 'beginner', color: '#ef4444', ...extra })

test('bracket notifications: joins, leaves, organizer edits and removals of your team', () => {
  const a = team('a', 1, 'Alex'), b = team('b', 2, 'Sam'), c = team('c', 3, 'Kim')
  const prev = { entries: snapshotEntries([a, b]), settings: { event_name: 'Cup', event_date: null } }
  const next = {
    entries: snapshotEntries([{ ...a, color: '#3b82f6' }, c]),
    settings: { event_name: 'Cup', event_date: '2026-11-14' },
  }
  const events = bracketEvents(prev, next, { tokens: { a: 't' } })
  const kinds = events.map(e => e.kind).sort()
  assert.deepEqual(kinds, ['edited', 'event', 'joined', 'left'])
  assert.ok(events.find(e => e.kind === 'edited').personal)
  assert.match(events.find(e => e.kind === 'joined').text, /Kim joined · Slot 3/)

  // Your own change doesn't notify you, and your team disappearing is a removal.
  assert.deepEqual(bracketEvents(prev, next, { tokens: { a: 't' }, ignore: new Set(['a', 'c', 'b']) }).map(e => e.kind), ['event'])
  const removed = bracketEvents(prev, { ...prev, entries: snapshotEntries([b]) }, { tokens: { a: 't' } })
  assert.deepEqual(removed.map(e => [e.kind, e.personal]), [['removed', true]])
  // No snapshot yet (first visit): nothing.
  assert.deepEqual(bracketEvents(null, next), [])
})

test('many joins collapse, and a full bracket is announced', () => {
  const sixteen = Array.from({ length: 16 }, (_, i) => team(`t${i}`, i + 1, `Player ${i}`))
  const events = bracketEvents({ entries: snapshotEntries(sixteen.slice(0, 5)), settings: null },
    { entries: snapshotEntries(sixteen), settings: null })
  assert.deepEqual(events.map(e => e.kind), ['joined', 'full'])
  assert.match(events[0].text, /11 new players joined/)
})

test('chat notifications: mentions are personal, your own messages are skipped', () => {
  const mine = team('a', 1, 'Alex'), other = team('b', 2, 'Sam')
  const rows = [
    { id: 'm0', entry_id: 'b', body: 'old', created_at: '2026-10-22T11:00:00Z' },
    { id: 'm1', entry_id: 'b', body: 'good luck @alex!', created_at: '2026-10-22T12:01:00Z' },
    { id: 'm2', entry_id: 'b', body: 'Alexander is not Alex', created_at: '2026-10-22T12:02:00Z' },
    { id: 'm3', entry_id: 'a', body: 'Sam who?', created_at: '2026-10-22T12:03:00Z' },
    { id: 'm4', entry_id: 'b', body: 'hello', created_at: '2026-10-22T12:04:00Z' },
  ]
  const opts = { owned: [mine], byId: { a: mine, b: other } }
  const events = messageEvents('2026-10-22T12:00:00Z', rows, opts)
  assert.deepEqual(events.map(e => [e.kind, e.messageId]), [['mention', 'm1'], ['mention', 'm2'], ['message', 'm4']])
  assert.ok(events[0].personal && /Sam mentioned you/.test(events[0].text))
  // Chat open: only mentions.
  assert.deepEqual(messageEvents('2026-10-22T12:00:00Z', rows, { ...opts, skipPlain: true }).map(e => e.kind), ['mention', 'mention'])
  assert.deepEqual(messageEvents(null, rows, opts), [])
})

test('mentions match whole names only, any case', () => {
  const t = team('a', 1, 'Jo Ann')
  assert.ok(mentions('go JO ANN go', t))
  assert.ok(mentions('@jo ann nice', t))
  assert.ok(!mentions('Alan and Joanna', t))
  assert.ok(!mentions('<script>', team('x', 1, 'a.b+c')))
})

test('notification list is newest first, capped, with an unread count', () => {
  const ev = i => ({ id: `e${i}`, kind: 'joined', text: `${i}`, at: new Date(Date.UTC(2026, 9, 22, 12, i)).toISOString() })
  let items = []
  for (let i = 0; i < 50; i++) items = addItems(items, [ev(i)])
  assert.equal(items.length, 40)
  assert.equal(items[0].id, 'e49')
  assert.equal(unreadCount(items, new Date(Date.UTC(2026, 9, 22, 12, 45)).toISOString()), 4)
  assert.equal(unreadCount(items, null), 40)
})

test('Professional is a reserved skill: shown as a badge, never offered as a choice', () => {
  assert.ok(!SKILLS.some(s => s.id === 'professional'))
  assert.deepEqual(skillOf('professional'), PROFESSIONAL)
  assert.equal(PROFESSIONAL.label, 'Professional')
  assert.equal(skillOf('advanced').id, 'advanced')
})
