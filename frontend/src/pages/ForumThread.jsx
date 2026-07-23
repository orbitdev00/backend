import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { filterContent } from '../lib/contentFilter'
import NavBar from '../components/NavBar'
import { grantBadge, revokeBadge } from '../hooks/useBadges'
import './Forum.css'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'

const REPLY_COOLDOWN = 15 * 1000
const OWNER_EMAIL = 'orbitdev00@gmail.com'

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

// Reputation score/post_count and badges are incremented server-side by
// POST /forum/posts (service key). The old client-side updateReputation()
// wrote the now-protected `score` column, so it was removed.

export default function ForumThread() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const [thread, setThread]       = useState(null)
  const [posts, setPosts]         = useState([])
  const [category, setCategory]   = useState(null)
  const [reply, setReply]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')
  const [votes, setVotes]         = useState({})
  const [userBadges, setUserBadges] = useState({})
  const [userNames, setUserNames] = useState({})
  const [userRole, setUserRole]   = useState('member')
  const [cooldown, setCooldown]   = useState(0)
  const [grantedBadges, setGrantedBadges] = useState({})
  const viewedRef = useRef(false)

  useEffect(() => { loadThread() }, [id])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => c <= 1 ? 0 : c - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const loadThread = async () => {
    const { data: t } = await supabase.from('forum_threads').select('*').eq('id', id).single()
    if (!t) { nav('/forum'); return }
    setThread(t)

    // Increment view count once per mount via backend (bypasses RLS)
    if (!viewedRef.current) {
      viewedRef.current = true
      fetch(`${BACKEND}/forum/view/${id}`, { method: 'POST' })
    }

    const { data: cat } = await supabase.from('forum_categories').select('*').eq('id', t.category_id).single()
    setCategory(cat)

    const { data: p } = await supabase.from('forum_posts').select('*').eq('thread_id', id).order('created_at')
    setPosts(p || [])

    if (user) {
      const { data: rep } = await supabase.from('user_reputation').select('role').eq('user_id', user.id).single()
      setUserRole(rep?.role || 'member')
      const { data: v } = await supabase.from('forum_votes').select('*').eq('user_id', user.id)
      const vmap = {}
      v?.forEach(vote => { vmap[`${vote.target_type}_${vote.target_id}`] = vote.value })
      setVotes(vmap)
      const last = localStorage.getItem(`orbit_reply_cd_${user.id}`)
      if (last) {
        const elapsed = Date.now() - parseInt(last)
        if (elapsed < REPLY_COOLDOWN) setCooldown(Math.ceil((REPLY_COOLDOWN - elapsed) / 1000))
      }
    }

    const userIds = [...new Set([t.user_id, ...(p||[]).map(x => x.user_id)].filter(Boolean))]
    const badgeMap = {}, nameMap = {}
    for (const uid of userIds) {
      const { data: ub } = await supabase.from('user_badges').select('forum_badges(slug,name,icon,color)').eq('user_id', uid)
      badgeMap[uid] = ub?.map(x => x.forum_badges) || []
      const { data: repData } = await supabase.from('user_reputation').select('username,avatar_url,tier,role,email').eq('user_id', uid).single()
      nameMap[uid] = { username: repData?.username, avatar_url: repData?.avatar_url, tier: repData?.tier, role: repData?.role, email: repData?.email }
    }
    setUserBadges(badgeMap)
    setUserNames(nameMap)

    // Seed grantedBadges from already-owned special badges
    const initial = {}
    for (const post of (p || [])) {
      if (badgeMap[post.user_id]?.some(b => b?.slug === 'special')) {
        initial[post.id] = 'exists'
      }
    }
    setGrantedBadges(initial)
  }

  const canModerate = userRole === 'mod' || userRole === 'admin' || userRole === 'owner'

  const deleteThread = async () => {
    if (!confirm('Delete this thread and all replies?')) return
    await supabase.from('forum_posts').delete().eq('thread_id', thread.id)
    await supabase.from('forum_threads').delete().eq('id', thread.id)
    nav(`/forum/category/${category?.slug}`)
  }

  const deletePost = async (postId) => {
    if (!confirm('Delete this reply?')) return
    await supabase.from('forum_posts').delete().eq('id', postId)
    await supabase.from('forum_threads').update({ reply_count: Math.max((thread.reply_count || 1) - 1, 0) }).eq('id', thread.id)
    loadThread()
  }

  const handleVote = async (type, targetId, value) => {
    if (!user) return
    const key = `${type}_${targetId}`
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch(`${BACKEND}/forum/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ target_type: type, target_id: targetId, value }),
    })
    if (!res.ok) return
    const data = await res.json()
    setVotes(prev => {
      const n = { ...prev }
      if (data.user_vote === null) delete n[key]
      else n[key] = data.user_vote
      return n
    })
    if (type === 'thread') {
      setThread(prev => ({ ...prev, vote_score: data.vote_score }))
    } else {
      setPosts(prev => prev.map(p => p.id === targetId ? { ...p, vote_score: data.vote_score } : p))
    }
  }

  const submitReply = async () => {
    if (!reply.trim() || !user || submitting) return
    if (cooldown > 0) { setError(`Please wait ${cooldown}s before replying again.`); return }
    const check = filterContent(reply)
    if (check.blocked) { setError(check.reason); return }
    setSubmitting(true); setError('')

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setError('Session expired. Please log in again.'); setSubmitting(false); return }

    const res = await fetch(`${BACKEND}/forum/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ thread_id: parseInt(id), body: reply.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      localStorage.setItem(`orbit_reply_cd_${user.id}`, String(Date.now()))
      setCooldown(15)
      setReply('')
      loadThread()
    } else {
      setError(data.error || 'Failed to post reply.')
    }
    setSubmitting(false)
  }

  const renderPost = (post, isOP = false) => {
    const voteKey = isOP ? `thread_${thread.id}` : `post_${post.id}`
    const displayName = userNames[post.user_id]?.username || post.author_email?.split('@')[0]
    const avatarUrl = userNames[post.user_id]?.avatar_url
    const postAuthorIsOwner = userNames[post.user_id]?.role === 'owner' || userNames[post.user_id]?.email === OWNER_EMAIL
    const canDelete = (canModerate && !postAuthorIsOwner) || post.user_id === user?.id
    return (
      <div key={isOP ? 'op' : post.id} className={`fpost ${isOP ? 'fpost-op' : ''}`}>
        <div className="fpost-author">
          <div className="fpost-avatar">
            {avatarUrl
              ? <img src={avatarUrl} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} alt="" />
              : displayName?.slice(0,2).toUpperCase()
            }
          </div>
          <div
            className={`fpost-author-name ${userNames[post.user_id]?.tier === 'omega' ? 'fpost-name-omega' : userNames[post.user_id]?.tier === 'degen' ? 'fpost-name-degen' : ''}`}
            style={{cursor:'pointer'}}
            onClick={() => nav(`/profile/${userNames[post.user_id]?.username || post.user_id}`)}
          >
            {displayName}
            {userNames[post.user_id]?.tier === 'degen' && <span className="fpost-tier-badge fpost-tier-degen">DEGEN</span>}
            {userNames[post.user_id]?.tier === 'omega' && <span className="fpost-tier-badge fpost-tier-omega">OMEGA</span>}
          </div>
          {isOP && <span className="fpost-op-tag">OP</span>}
          <div className="fpost-badges">
            {(userBadges[post.user_id] || []).map(b => (
              <span key={b?.slug} className="fpost-badge" style={{color: b?.color}} data-tooltip={b?.name}>{b?.icon}</span>
            ))}
          </div>
        </div>
        <div className="fpost-content">
          <div className="fpost-body">{post.body}</div>
          <div className="fpost-footer">
            <span className="fpost-time">{timeAgo(post.created_at)}</span>
            <div className="fpost-footer-right">
              {!isOP && canDelete && (
                <button className="fpost-delete" onClick={() => deletePost(post.id)}>🗑 Delete</button>
              )}
              {!isOP && canModerate && post.user_id !== user?.id && !postAuthorIsOwner && (
                <button
                  className="fpost-delete"
                  style={{color: grantedBadges[post.id] ? '#4ade80' : '#a78bfa'}}
                  onClick={async () => {
                    if (grantedBadges[post.id]) {
                      const res = await revokeBadge(user.id, post.user_id, 'special', userRole)
                      if (res.revoked) setGrantedBadges(prev => { const n = {...prev}; delete n[post.id]; return n })
                    } else {
                      const res = await grantBadge(user.id, post.user_id, 'special', userRole)
                      setGrantedBadges(prev => ({ ...prev, [post.id]: res.awarded ? 'granted' : 'exists' }))
                    }
                  }}
                  title={grantedBadges[post.id] ? 'Revoke Special badge' : 'Grant Special badge'}
                >
                  {grantedBadges[post.id] ? '⭐ Revoke' : '⭐ Special'}
                </button>
              )}
              <div className="fpost-votes">
                <button className={`fvote-btn ${votes[voteKey] === 1 ? 'voted-up' : ''}`}
                  onClick={() => handleVote(isOP ? 'thread' : 'post', isOP ? thread.id : post.id, 1)}
                  disabled={!user}>▲</button>
                <span>{post.vote_score || 0}</span>
                <button className={`fvote-btn ${votes[voteKey] === -1 ? 'voted-down' : ''}`}
                  onClick={() => handleVote(isOP ? 'thread' : 'post', isOP ? thread.id : post.id, -1)}
                  disabled={!user}>▼</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!thread) return (
    <div className="forum-screen">
      <NavBar active="forum" />
      <div className="forum-loading">Loading...</div>
    </div>
  )

  return (
    <div className="forum-screen">
      <NavBar active="forum" />
      <div className="forum-body">
        <div className="forum-main">
          <div className="forum-breadcrumb">
            <span onClick={() => nav('/forum')}>Forum</span> ›{' '}
            <span onClick={() => nav(`/forum/category/${category?.slug}`)}>{category?.name}</span> ›{' '}
            <span>{thread.title}</span>
          </div>

          <div className="fthread-header">
            <h2>{thread.pinned && '📌 '}{thread.locked && '🔒 '}{thread.title}</h2>
            {(() => {
              const threadAuthorIsOwner = userNames[thread.user_id]?.role === 'owner' || userNames[thread.user_id]?.email === OWNER_EMAIL
              return ((canModerate && !threadAuthorIsOwner) || thread.user_id === user?.id) && (
                <button className="fthread-delete-btn" onClick={deleteThread}>🗑 Delete Thread</button>
              )
            })()}
          </div>

          {renderPost({ id: thread.id, user_id: thread.user_id, author_email: thread.author_email, body: thread.body, created_at: thread.created_at, vote_score: thread.vote_score }, true)}
          {posts.map(p => renderPost(p))}

          {error && <div className="fnew-error" style={{margin:'8px 0'}}>{error}</div>}

          {!thread.locked ? (
            user ? (
              <div className="freply-box">
                <div className="freply-label">Reply</div>
                <textarea className="freply-input" placeholder="Write your reply..."
                  value={reply} onChange={e => setReply(e.target.value)} rows={5} />
                <div className="freply-actions">
                  <button className="freply-submit" onClick={submitReply}
                    disabled={submitting || cooldown > 0 || !reply.trim()}>
                    {cooldown > 0 ? `Wait ${cooldown}s` : submitting ? 'Posting...' : 'Post Reply'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="freply-guest">
                <span>Sign in to reply</span>
                <button onClick={() => nav('/login')}>Sign In</button>
              </div>
            )
          ) : (
            <div className="freply-locked">🔒 This thread is locked.</div>
          )}
        </div>

        <div className="forum-sidebar">
          <div className="fsidebar-block">
            <div className="fsidebar-title">Thread Info</div>
            <div className="fstat-row"><span>Replies</span><span>{thread.reply_count}</span></div>
            <div className="fstat-row"><span>Views</span><span>{thread.view_count}</span></div>
            <div className="fstat-row"><span>Posted</span><span>{timeAgo(thread.created_at)}</span></div>
            <div className="fstat-row"><span>Author</span><span>{thread.author_email?.split('@')[0]}</span></div>
          </div>
          <div className="fsidebar-block">
            <div className="fsidebar-title">Category</div>
            <div className="fsidebar-desc" style={{cursor:'pointer'}} onClick={() => nav(`/forum/category/${category?.slug}`)}>
              {category?.icon} {category?.name}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
