import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import './Inbox.css'

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

export default function Inbox() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [conversations, setConversations] = useState([])
  const [activeConvo, setActiveConvo]     = useState(null) // {user_id, username, avatar_url}
  const [messages, setMessages]           = useState([])
  const [newMsg, setNewMsg]               = useState('')
  const [sending, setSending]             = useState(false)
  const [unread, setUnread]               = useState(0)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!user) { nav('/login'); return }
    loadConversations()
    // Open specific convo from URL param
    const withUser = searchParams.get('with')
    if (withUser) openConvoById(withUser)
  }, [user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages])

  const loadConversations = async () => {
    const { data } = await supabase.from('direct_messages')
      .select('sender_id,receiver_id,body,created_at,read')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false })

    // Build conversation list
    const convoMap = {}
    data?.forEach(m => {
      const otherId = m.sender_id === user.id ? m.receiver_id : m.sender_id
      if (!convoMap[otherId]) convoMap[otherId] = { otherId, lastMsg: m.body, lastAt: m.created_at, unread: 0 }
      if (!m.read && m.receiver_id === user.id) convoMap[otherId].unread++
    })

    // Load usernames
    const ids = Object.keys(convoMap)
    const convos = []
    for (const id of ids) {
      const { data: rep } = await supabase.from('user_reputation').select('username,email,avatar_url').eq('user_id', id).single()
      convos.push({ ...convoMap[id], username: rep?.username || rep?.email?.split('@')[0] || id.slice(0,8), avatar_url: rep?.avatar_url })
    }
    convos.sort((a,b) => new Date(b.lastAt) - new Date(a.lastAt))
    setConversations(convos)
    setUnread(convos.reduce((sum, c) => sum + c.unread, 0))
  }

  const openConvoById = async (otherId) => {
    const { data: rep } = await supabase.from('user_reputation').select('username,email,avatar_url').eq('user_id', otherId).single()
    const convo = { otherId, username: rep?.username || rep?.email?.split('@')[0], avatar_url: rep?.avatar_url }
    setActiveConvo(convo)
    loadMessages(otherId)
    // Mark as read
    await supabase.from('direct_messages').update({ read: true })
      .eq('receiver_id', user.id).eq('sender_id', otherId)
  }

  const loadMessages = async (otherId) => {
    const { data } = await supabase.from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${user.id})`)
      .order('created_at')
    setMessages(data || [])
  }

  const sendMessage = async () => {
    if (!newMsg.trim() || !activeConvo || sending) return
    setSending(true)
    await supabase.from('direct_messages').insert({
      sender_id: user.id, receiver_id: activeConvo.otherId, body: newMsg.trim()
    })
    setNewMsg('')
    setSending(false)
    loadMessages(activeConvo.otherId)
    loadConversations()
  }

  return (
    <div className="inbox-screen">
      <NavBar active="inbox" />
      <div className={`inbox-body${activeConvo ? ' thread-open' : ''}`}>
        {/* Conversation list */}
        <div className="inbox-sidebar">
          <div className="inbox-sidebar-header">Messages {unread > 0 && <span className="inbox-unread-count">{unread}</span>}</div>
          {conversations.length === 0
            ? <div className="inbox-empty-sidebar">No messages yet.</div>
            : conversations.map(c => (
              <div key={c.otherId}
                className={`inbox-convo ${activeConvo?.otherId === c.otherId ? 'active' : ''}`}
                onClick={() => openConvoById(c.otherId)}>
                <div className="inbox-convo-avatar">
                  {c.avatar_url ? <img src={c.avatar_url} alt="" /> : c.username?.slice(0,2).toUpperCase()}
                </div>
                <div className="inbox-convo-info">
                  <div className="inbox-convo-name">{c.username} {c.unread > 0 && <span className="inbox-badge">{c.unread}</span>}</div>
                  <div className="inbox-convo-preview">{c.lastMsg?.slice(0,40)}{c.lastMsg?.length > 40 ? '...' : ''}</div>
                </div>
                <div className="inbox-convo-time">{timeAgo(c.lastAt)}</div>
              </div>
            ))
          }
        </div>

        {/* Message thread */}
        <div className="inbox-thread">
          {!activeConvo ? (
            <div className="inbox-empty-thread">Select a conversation</div>
          ) : (
            <>
              <div className="inbox-thread-header">
                <button className="inbox-thread-back" onClick={() => setActiveConvo(null)} style={{display:'none'}}>←</button>
                <div className="inbox-thread-avatar">
                  {activeConvo.avatar_url ? <img src={activeConvo.avatar_url} alt="" /> : activeConvo.username?.slice(0,2).toUpperCase()}
                </div>
                <div className="inbox-thread-name" onClick={() => nav(`/profile/${activeConvo.username || activeConvo.otherId}`)}>
                  {activeConvo.username}
                </div>
              </div>

              <div className="inbox-messages">
                {messages.map(m => (
                  <div key={m.id} className={`inbox-msg ${m.sender_id === user.id ? 'inbox-msg-mine' : 'inbox-msg-theirs'}`}>
                    <div className="inbox-msg-body">{m.body}</div>
                    <div className="inbox-msg-time">{timeAgo(m.created_at)}</div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="inbox-compose">
                <input className="inbox-input" placeholder="Message..."
                  value={newMsg} onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()} />
                <button className="inbox-send" onClick={sendMessage} disabled={sending || !newMsg.trim()}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
