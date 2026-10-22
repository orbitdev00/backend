// Run with `npm test` (node --test, no extra dependencies).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BRACKET, BYE_SLOTS, allSlots, byeFor, sectionEdges, sourceLabel } from './bracket.js'
import { cleanName, formatEventDate, relativeTime, teamErrors } from './teams.js'
import { layout } from './drawBracket.js'
import WallMessage from './WallMessage.js'

const matches = BRACKET.flatMap(s => s.rounds.flatMap(r => r.matches))
const byId = Object.fromEntries(matches.map(m => [m.id, m]))
const sides = m => [m.a, m.b]

test('round 1 and quarterfinal pairings', () => {
  const [r1, qf, sf] = BRACKET[0].rounds
  assert.deepEqual(r1.matches.map(m => [m.a.slot, m.b.slot]), [[8, 9], [5, 12], [6, 11], [7, 10]])
  // 1 v winner 8/9, 4 v winner 5/12, 3 v winner 6/11, 2 v winner 7/10
  assert.deepEqual(qf.matches.map(m => [m.a.slot, byId[m.b.winner].a.slot, byId[m.b.winner].b.slot]),
    [[1, 8, 9], [4, 5, 12], [3, 6, 11], [2, 7, 10]])
  assert.deepEqual(sf.matches.map(m => [m.a.winner, m.b.winner]), [['W5', 'W6'], ['W7', 'W8']])
  assert.deepEqual([0, 1, 2, 3].map(byeFor), BYE_SLOTS)
  assert.deepEqual(BYE_SLOTS, [1, 4, 3, 2])
})

test('every slot 1–12 appears exactly once', () => {
  assert.deepEqual([...allSlots()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('double elimination: 22 games, every winners-bracket loser drops in once', () => {
  assert.equal(matches.length, 2 * 12 - 2)
  const winnersIds = BRACKET[0].rounds.flatMap(r => r.matches).map(m => m.id).filter(id => id !== 'GF')
  const dropped = matches.flatMap(sides).filter(s => s.loser).map(s => s.loser).sort()
  assert.deepEqual(dropped, [...winnersIds].sort())
  // Every game but the grand final feeds its winner to exactly one later game.
  const fed = matches.flatMap(sides).filter(s => s.winner).map(s => s.winner)
  for (const m of matches) if (m.id !== 'GF') assert.equal(fed.filter(x => x === m.id).length, 1, m.id)
  assert.deepEqual([byId.GF.a.winner, byId.GF.b.winner], ['W11', 'L10'])
})

test('losers bracket crosses over so first-round opponents never meet again early', () => {
  const l1 = BRACKET[1].rounds[0].matches.map(m => [m.a.loser, m.b.loser])
  assert.deepEqual(l1, [['W1', 'W8'], ['W2', 'W7'], ['W3', 'W6'], ['W4', 'W5']])
  for (const [a, b] of l1) {
    const qf = byId[b]
    assert.notEqual(qf.b.winner, a, `${a} and ${b} would be a rematch`)
  }
})

test('connector edges stay inside a section and reach real matches', () => {
  const winners = sectionEdges(BRACKET[0])
  assert.ok(winners.some(e => e.from === 'bye-1' && e.to === 'W5' && e.side === 'a'))
  assert.ok(winners.some(e => e.from === 'W11' && e.to === 'GF'))
  assert.ok(!winners.some(e => e.from.startsWith('L')))
  const losers = sectionEdges(BRACKET[1])
  assert.ok(losers.every(e => e.from.startsWith('L') && e.to.startsWith('L')))
  assert.equal(losers.length, 9)
})

test('TBD captions', () => {
  assert.equal(sourceLabel({ slot: 1 }), 'Slot 1 · bye')
  assert.equal(sourceLabel({ winner: 'W3' }), 'Winner W3')
  assert.equal(sourceLabel({ loser: 'W8' }), 'Loser W8')
  assert.equal(sourceLabel({ winner: 'L10' }), "Losers' champion")
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

test('names: trimmed, 2–30 characters, unique across player and partner, any case', () => {
  const entries = [{ id: 'e1', player_name: 'Alex', partner_name: 'Taylor' }]
  assert.deepEqual(teamErrors({ player_name: 'Sam', partner_name: 'Robin' }, entries), {})
  assert.ok(teamErrors({ player_name: 'alex', partner_name: 'Robin' }, entries).player_name)
  assert.ok(teamErrors({ player_name: 'Sam', partner_name: ' TAYLOR ' }, entries).partner_name)
  assert.ok(teamErrors({ player_name: 'Sam', partner_name: 'sam' }, entries).partner_name)
  assert.ok(teamErrors({ player_name: 'A', partner_name: 'Robin' }, entries).player_name)
  assert.ok(teamErrors({ player_name: 'x'.repeat(31), partner_name: 'Robin' }, entries).player_name)
  // Editing your own team keeps your own names.
  assert.deepEqual(teamErrors({ player_name: 'ALEX', partner_name: 'taylor' }, entries, 'e1'), {})
  assert.equal(cleanName('  Jamie   Lee '), 'Jamie Lee')
})

test('HTML in a wall message renders as text, never markup', () => {
  const body = '<img src=x onerror="alert(1)"><b>hi</b><script>alert(2)</script>'
  const team = { id: 'e1', player_name: '<i>Al</i>', partner_name: 'Bo', color: '#ef4444' }
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
