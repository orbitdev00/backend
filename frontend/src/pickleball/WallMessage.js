import { createElement as h } from 'react'
import { relativeTime } from './teams.js'
import { teamName } from './bracket.js'

// Plain .js (no JSX) so `node --test` can render it. Text always goes in as a
// React child, so HTML in a message shows as text and is never markup.
export default function WallMessage({ message, team, now, isNew, onDelete, confirming }) {
  return h('li', { className: `pb-msg${isNew ? ' is-new' : ''}`, style: team ? { '--team': team.color } : undefined },
    h('div', { className: 'pb-msg-head' },
      h('span', { className: 'pb-msg-team' }, team ? teamName(team) : 'Former team'),
      h('time', { className: 'pb-msg-time', dateTime: message.created_at }, relativeTime(message.created_at, now)),
      onDelete && h('button', {
        type: 'button', className: `pb-msg-delete${confirming ? ' is-confirming' : ''}`, onClick: onDelete,
        'aria-label': confirming ? 'Tap again to delete this message' : 'Delete message',
      }, confirming ? 'Delete?' : '✕')),
    h('p', { className: 'pb-msg-body' }, message.body))
}
