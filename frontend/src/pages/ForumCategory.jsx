import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import './Forum.css'

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

export default function ForumCategory() {
  const { slug } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const [category, setCategory] = useState(null)
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 30

  useEffect(() => { loadCategory() }, [slug, page])

  const loadCategory = async () => {
    setLoading(true)
    const { data: cat } = await supabase.from('forum_categories').select('*').eq('slug', slug).single()
    if (!cat) { nav('/forum'); return }
    setCategory(cat)

    const { data: threads } = await supabase
      .from('forum_threads')
      .select('id,title,author_email,user_id,reply_count,view_count,vote_score,created_at,last_reply_at,pinned,locked')
      .eq('category_id', cat.id)
      .order('pinned', { ascending: false })
      .order('last_reply_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    const threadList = threads || []
    // Fetch avatars for thread authors
    const userIds = [...new Set(threadList.map(t => t.user_id).filter(Boolean))]
    const avatarMap = {}
    if (userIds.length) {
      const { data: reps } = await supabase
        .from('user_reputation')
        .select('user_id,username,avatar_url')
        .in('user_id', userIds)
      for (const r of reps || []) avatarMap[r.user_id] = r
    }
    setThreads(threadList.map(t => ({ ...t, _author: avatarMap[t.user_id] })))
    setLoading(false)
  }

  return (
    <div className="forum-screen">
      <NavBar active="forum" />
      <div className="forum-body">
        <div className="forum-main">
          <div className="forum-topbar">
            <div>
              <div className="forum-breadcrumb">
                <span onClick={() => nav('/forum')}>Forum</span>
                <span> › </span>
                <span>{category?.name}</span>
              </div>
              <h2 className="forum-heading">{category?.icon} {category?.name}</h2>
              <p className="forum-subheading">{category?.description}</p>
            </div>
            {user && (
              <button className="forum-new-btn" onClick={() => nav(`/forum/new?cat=${slug}`)}>
                + New Thread
              </button>
            )}
          </div>

          {/* Thread list header */}
          <div className="fthread-list-head fthread-list-head--pfp">
            <span></span>
            <span>Thread</span>
            <span>Replies</span>
            <span>Views</span>
            <span>Last Post</span>
          </div>

          {loading ? <div className="forum-loading">Loading...</div> : (
            <>
              {threads.length === 0 && <div className="forum-empty">No threads yet. Be the first to post!</div>}
              {threads.map(t => {
                const author = t._author
                const displayName = author?.username || t.author_email?.split('@')[0] || '?'
                const initials = displayName.slice(0,2).toUpperCase()
                return (
                  <div key={t.id} className={`fthread-row ${t.pinned ? 'pinned' : ''}`} onClick={() => nav(`/forum/thread/${t.id}`)}>
                    <div className="fthread-avatar">
                      {author?.avatar_url
                        ? <img src={author.avatar_url} alt="" />
                        : <span>{initials}</span>}
                    </div>
                    <div className="fthread-main">
                      <div className="fthread-title">
                        {t.pinned && <span className="fthread-pin">📌</span>}
                        {t.locked && <span className="fthread-lock">🔒</span>}
                        {t.title}
                      </div>
                      <div className="fthread-author">{displayName} · {timeAgo(t.created_at)}</div>
                    </div>
                    <div className="fthread-stat">{t.reply_count}</div>
                    <div className="fthread-stat">{t.view_count}</div>
                    <div className="fthread-last">{timeAgo(t.last_reply_at)}</div>
                  </div>
                )
              })}

              {/* Pagination */}
              <div className="forum-pagination">
                <button disabled={page === 0} onClick={() => setPage(p => p-1)}>← Prev</button>
                <span>Page {page + 1}</span>
                <button disabled={threads.length < PAGE_SIZE} onClick={() => setPage(p => p+1)}>Next →</button>
              </div>
            </>
          )}
        </div>

        <div className="forum-sidebar">
          {user && (
            <button className="forum-new-btn-side" onClick={() => nav(`/forum/new?cat=${slug}`)}>
              + Post Thread
            </button>
          )}
          <div className="fsidebar-block">
            <div className="fsidebar-title">About</div>
            <div className="fsidebar-desc">{category?.description}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
