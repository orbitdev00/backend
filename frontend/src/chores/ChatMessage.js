// One chat message. Plain JS (createElement, no JSX) so `npm test` can render
// it under Node without a build step. The body is passed as a text child,
// which React always escapes: messages can never inject HTML.
import { createElement as h } from 'react'
import { nameProps } from './shop.js'

export function relativeTime(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const hrs = Math.round(m / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export default function ChatMessage({ message, sender, mine, animate, now }) {
  const name = nameProps(sender)
  return h('li', { className: `ch-msg${mine ? ' is-mine' : ''}${animate ? ' is-new' : ''}`, style: { '--who': sender?.color } },
    h('div', { className: 'ch-msg-head' },
      h('span', { className: `ch-msg-name ${name.className}`, style: name.style }, sender?.name || 'Someone'),
      h('time', { dateTime: message.created_at, title: new Date(message.created_at).toLocaleString() },
        relativeTime(message.created_at, now)),
    ),
    h('p', { className: 'ch-msg-body' }, message.body),
  )
}
