// Run with `npm test` (node --test, no extra dependencies).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatMessage, { relativeTime } from './ChatMessage.js'
import { pointsFor } from './schedule.js'
import { dress, SHOP_ITEMS } from './shop.js'

const ALEX = { id: 'a', name: 'Alex', color: '#3b82f6' }
const message = body => ({ id: 'm1', member_id: 'a', body, created_at: '2026-10-20T12:00:00Z' })

test('HTML in a message renders as text, never markup', () => {
  const body = '<img src=x onerror="alert(1)"><b>hi</b><script>alert(2)</script>'
  const html = renderToStaticMarkup(h(ChatMessage, { message: message(body), sender: ALEX, mine: false }))
  assert.ok(!html.includes('<img'), html)
  assert.ok(!html.includes('<b>'), html)
  assert.ok(!html.includes('<script'), html)
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;b&gt;hi&lt;/b&gt;'), html)
})

test('sender name shows in their color and own messages are marked', () => {
  const html = renderToStaticMarkup(h(ChatMessage, { message: message('hey'), sender: ALEX, mine: true }))
  assert.match(html, /class="ch-msg is-mine"/)
  assert.match(html, /--name:#3b82f6/)
  assert.match(html, />Alex</)
})

test('relative time', () => {
  const at = Date.parse('2026-10-20T12:00:00Z')
  assert.equal(relativeTime('2026-10-20T12:00:00Z', at + 10_000), 'just now')
  assert.equal(relativeTime('2026-10-20T12:00:00Z', at + 2 * 60_000), '2m ago')
  assert.equal(relativeTime('2026-10-20T12:00:00Z', at + 3 * 3600_000), '3h ago')
  assert.equal(relativeTime('2026-10-20T12:00:00Z', at + 2 * 86400_000), '2d ago')
})

test('points_override wins: evening kitchen is worth exactly 75', () => {
  assert.equal(pointsFor({ minutes: 30, difficulty: 'extreme', points_override: 75 }), 75)
  assert.equal(pointsFor({ minutes: 25, difficulty: 'medium', points_override: null }), 38)
  assert.equal(pointsFor({ minutes: 20, difficulty: 'easy' }), 20)
})

test('dress applies a bought color and avatar', () => {
  const m = dress(ALEX, { color: 'color-gold', avatar: 'avatar-fox' })
  assert.equal(m.color, '#eab308')
  assert.equal(m.baseColor, '#3b82f6')
  assert.equal(m.look.avatar.emoji, '🦊')
  assert.equal(dress(ALEX, null).color, '#3b82f6')
  assert.equal(new Set(SHOP_ITEMS.map(i => i.id)).size, SHOP_ITEMS.length)
})
