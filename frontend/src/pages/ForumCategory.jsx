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
  const [userRole, setUserRole] = useState('member')
  const PAGE_SIZE = 30

  useEffect(() => { loadCategory() }, [slug, page])
  useEffect(() => {
    if (!user) return
    supabase.from('user_reputation').select('role').eq('user_id', user.id).single()
      .then(({ data }) => { if (data?.role) setUserRole(data.role) })
  }, [user])

  const loadCategory = async () => {
    setLoading(true)
    const { data: cat } = await supabase.from('forum_categories').select('*').eq('slug', slug).single()
    if (!cat) { nav('/forum'); return }
    setCategory(cat)

    const { data: threadData } = await supabase
      .from('forum_threads')
      .select('id,title,author_email,user_id,reply_count,view_count,vote_score,created_at,last_reply_at,pinned,locked')
      .eq('category_id', cat.id)
      .order('pinned', { ascending: false })
      .order('last_reply_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    // Fetch reputation for all thread authors
    const authorIds = [...new Set((threadData || []).map(t => t.user_id).filter(Boolean))]
    let repMap = {}
    if (authorIds.length > 0) {
      const { data: reps } = await supabase
        .from('user_reputation')
        .select('user_id,username,avatar_url,tier')
        .in('user_id', authorIds)
      ;(reps || []).forEach(r => { repMap[r.user_id] = r })
    }

    setThreads((threadData || []).map(t => ({ ...t, rep: repMap[t.user_id] || null })))
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
            {user && (slug !== 'announcements' || ['admin', 'owner'].includes(userRole) || user?.email === 'orbitdev00@gmail.com') && (
              <button className="forum-new-btn" onClick={() => nav(`/forum/new?cat=${slug}`)}>
                + New Thread
              </button>
            )}
          </div>

          {/* Thread list header */}
          <div className="fthread-list-head">
            <span>Thread</span>
            <span>Replies</span>
            <span>Views</span>
            <span>Last Post</span>
          </div>

          {loading ? <div className="forum-loading">Loading...</div> : (
            <>
              {threads.length === 0 && <div className="forum-empty">No threads yet. Be the first to post!</div>}
              {threads.map(t => (
                <div key={t.id} className={`fthread-row ${t.pinned ? 'pinned' : ''}`} onClick={() => nav(`/forum/thread/${t.id}`)}>
                  {t.rep?.avatar_url
                    ? <img src={t.rep.avatar_url} className="fthread-pfp" alt="" />
                    : <div className="fthread-pfp fthread-pfp-fallback">{(t.rep?.username || t.author_email || '?')[0].toUpperCase()}</div>
                  }
                  <div className="fthread-main">
                    <div className="fthread-title-row">
                      {t.pinned && <span className="fthread-pin">📌</span>}
                      {t.locked && <span className="fthread-lock">🔒</span>}
                      <span className="fthread-title">{t.title}</span>
                    </div>
                    <div className="fthread-author-row">
                      <span className={`fthread-author-name fpost-name-${t.rep?.tier || 'free'}`}>
                        {t.rep?.username || t.author_email?.split('@')[0]}
                      </span>
                      <span className="fthread-author-dot">·</span>
                      <span className="fthread-author-time">{timeAgo(t.created_at)}</span>
                    </div>
                  </div>
                  <div className="fthread-stat">{t.reply_count}</div>
                  <div className="fthread-stat">{t.view_count}</div>
                  <div className="fthread-last">{timeAgo(t.last_reply_at)}</div>
                </div>
              ))}

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
          {user && (slug !== 'announcements' || ['admin', 'owner'].includes(userRole) || user?.email === 'orbitdev00@gmail.com') && (
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
