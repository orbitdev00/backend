import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import StarField from '../components/StarField'
import './Forum.css'

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

function fmtNum(n) {
  if (!n) return '0'
  if (n >= 1000) return `${(n/1000).toFixed(1)}K`
  return String(n)
}

const INFO_CATS = ['announcements']
const MAIN_CATS = ['general', 'calls', 'analysis', 'education']

export default function Forum() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [categories, setCategories]       = useState([])
  const [recentThreads, setRecentThreads] = useState([])
  const [search, setSearch]               = useState('')
  const [threadResults, setThreadResults] = useState([])
  const [userResults, setUserResults]     = useState([])
  const [searchDone, setSearchDone]       = useState(false)
  const [searching, setSearching]         = useState(false)
  const [suggestions, setSuggestions]     = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loading, setLoading]             = useState(true)
  const [followingFeed, setFollowingFeed] = useState([])

  useEffect(() => { loadForum() }, [])
  useEffect(() => { if (user) { loadFollowingFeed() } }, [user])

  const loadForum = async () => {
    const { data: cats } = await supabase
      .from('forum_categories').select('*').order('sort_order')
      .in('slug', [...INFO_CATS, ...MAIN_CATS])

    const catMap = {}
    if (cats) {
      for (const cat of cats) {
        const { data: latest } = await supabase.from('forum_threads')
          .select('id,title,author_email,user_id,last_reply_at')
          .eq('category_id', cat.id)
          .order('last_reply_at', { ascending: false })
          .limit(1).maybeSingle()
        const { count: tc } = await supabase.from('forum_threads')
          .select('id', { count: 'exact', head: true }).eq('category_id', cat.id)
        let latestAuthor = null
        if (latest?.user_id) {
          const { data: rep } = await supabase.from('user_reputation')
            .select('avatar_url,username').eq('user_id', latest.user_id).maybeSingle()
          latestAuthor = { avatar_url: rep?.avatar_url, username: rep?.username }
        }
        catMap[cat.id] = { ...cat, latest, latestAuthor, threadCount: tc || 0 }
      }
    }

    const { data: threads } = await supabase.from('forum_threads')
      .select('id,title,author_email,category_id,reply_count,last_reply_at,pinned')
      .order('last_reply_at', { ascending: false }).limit(8)

    setCategories(Object.values(catMap).sort((a,b) => a.sort_order - b.sort_order))
    setRecentThreads(threads || [])
    setLoading(false)
  }

  const loadFollowingFeed = async () => {
    if (!user) return
    // Get list of users this user follows
    const { data: follows } = await supabase.from('user_follows')
      .select('following_id').eq('follower_id', user.id)
    if (!follows?.length) return
    const ids = follows.map(f => f.following_id)
    // Get recent threads from followed users
    const { data: threads } = await supabase.from('forum_threads')
      .select('id,title,user_id,last_reply_at,reply_count')
      .in('user_id', ids)
      .order('last_reply_at', { ascending: false })
      .limit(8)
    if (!threads?.length) return
    // Get usernames
    const { data: reps } = await supabase.from('user_reputation')
      .select('user_id,username,avatar_url').in('user_id', ids)
    const repMap = {}
    reps?.forEach(r => { repMap[r.user_id] = r })
    setFollowingFeed((threads || []).map(t => ({
      ...t,
      username: repMap[t.user_id]?.username || t.user_id?.slice(0,8),
      avatar_url: repMap[t.user_id]?.avatar_url,
    })))
  }

  const fetchSuggestions = async (q) => {
    if (!q.trim() || q.length < 2) { setSuggestions([]); setShowSuggestions(false); return }
    const { data } = await supabase.from('user_reputation')
      .select('user_id,username,avatar_url')
      .ilike('username', `%${q}%`)
      .limit(5)
    setSuggestions(data || [])
    setShowSuggestions((data || []).length > 0)
  }

  const handleSearch = async () => {
    if (!search.trim()) { setSearchDone(false); setThreadResults([]); setUserResults([]); return }
    setSearching(true)
    const q = search.trim()
    const [{ data: threads }, { data: users }] = await Promise.all([
      supabase.from('forum_threads')
        .select('id,title,author_email,reply_count,last_reply_at,category_id')
        .or(`title.ilike.%${q}%,body.ilike.%${q}%`)
        .order('last_reply_at', { ascending: false })
        .limit(20),
      supabase.from('user_reputation')
        .select('user_id,username,email,avatar_url,score')
        .ilike('username', `%${q}%`)
        .limit(5),
    ])
    setThreadResults(threads || [])
    setUserResults(users || [])
    setSearchDone(true)
    setSearching(false)
  }

  const clearSearch = () => {
    setSearch('')
    setSearchDone(false)
    setThreadResults([])
    setUserResults([])
  }

  const catById = {}
  categories.forEach(c => { catById[c.id] = c })

  const infoCats = categories.filter(c => INFO_CATS.includes(c.slug))
  const mainCats = categories.filter(c => MAIN_CATS.includes(c.slug))

  const renderCat = (cat) => (
    <div key={cat.id} className="forum-category-block">
      <div className="fcat-header" onClick={() => nav(`/forum/category/${cat.slug}`)}>
        <span className="fcat-icon">{cat.icon}</span>
        <div className="fcat-info">
          <div className="fcat-name">{cat.name}</div>
          <div className="fcat-desc">{cat.description}</div>
        </div>
        <div className="fcat-stats">
          <span>{fmtNum(cat.threadCount)}</span>
          <span>Threads</span>
        </div>
        <div className="fcat-latest">
          {cat.latest ? (
            <div className="fcat-latest-inner">
              <div className="fcat-latest-pfp">
                {cat.latestAuthor?.avatar_url
                  ? <img src={cat.latestAuthor.avatar_url} alt="" />
                  : (cat.latestAuthor?.username || cat.latest.author_email?.split('@')[0])?.slice(0,2).toUpperCase()
                }
              </div>
              <div className="fcat-latest-text">
                <div className="fcat-latest-title" onClick={e => { e.stopPropagation(); nav(`/forum/thread/${cat.latest.id}`) }}>
                  {cat.latest.title}
                </div>
                <div className="fcat-latest-meta">
                  {cat.latestAuthor?.username || cat.latest.author_email?.split('@')[0]} · {timeAgo(cat.latest.last_reply_at)}
                </div>
              </div>
            </div>
          ) : <span className="fcat-empty">No threads yet</span>}
        </div>
      </div>
    </div>
  )

  return (
    <div className="forum-screen">
      <StarField />
      <NavBar active="forum" />
      <div className="forum-body">
        <div className="forum-main">

          {/* Topbar */}
          <div className="forum-topbar">
            <h2 className="forum-heading">Community</h2>
            <div className="forum-topbar-right">
              <div className="forum-search-wrap" style={{position:"relative"}}>
                <input
                  className="forum-search-input"
                  placeholder="Search threads & users..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); fetchSuggestions(e.target.value) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
                {showSuggestions && (
                  <div className="forum-suggest-list">
                    {suggestions.map(u => (
                      <div key={u.user_id} className="forum-suggest-item"
                        onMouseDown={() => {
                          nav(`/profile/${u.username || u.user_id}`)
                          setShowSuggestions(false)
                          setSearch('')
                        }}>
                        <div className="forum-suggest-avatar">
                          {u.avatar_url ? <img src={u.avatar_url} alt="" /> : u.username?.slice(0,2).toUpperCase()}
                        </div>
                        <span>{u.username}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button className="forum-search-btn" onClick={handleSearch}>
                  {searching ? '...' : '⌕'}
                </button>
              </div>
              {user && (
                <button className="forum-new-btn" onClick={() => nav('/forum/new')}>
                  + Post Thread
                </button>
              )}
            </div>
          </div>

          {/* Search results */}
          {searchDone && (
            <div className="forum-search-results">
              <div className="fsr-header">
                <span>Results for "{search}"</span>
                <button onClick={clearSearch}>✕</button>
              </div>

              {userResults.length > 0 && (
                <div className="fsr-users">
                  <div className="fsr-section-label">Users</div>
                  {userResults.map(u => (
                    <div key={u.user_id} className="fsr-user-row"
                      onClick={() => { nav(`/profile/${u.username || u.user_id}`); clearSearch() }}>
                      <div className="fsr-user-avatar">
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt="" />
                          : (u.username || u.email?.split('@')[0])?.slice(0,2).toUpperCase()}
                      </div>
                      <div className="fsr-user-name">{u.username || u.email?.split('@')[0]}</div>
                      <div className="fsr-user-score">{u.score} rep</div>
                    </div>
                  ))}
                </div>
              )}

              {threadResults.length > 0 && (
                <>
                  <div className="fsr-section-label" style={{padding:'6px 14px'}}>Threads</div>
                  {threadResults.map(t => (
                    <div key={t.id} className="fthread-row" onClick={() => nav(`/forum/thread/${t.id}`)}>
                      <div className="fthread-main">
                        <div className="fthread-title">{t.title}</div>
                        <div className="fthread-author">
                          {catById[t.category_id]?.name} · {t.author_email?.split('@')[0]} · {timeAgo(t.last_reply_at)}
                        </div>
                      </div>
                      <div className="fthread-stat">{t.reply_count}</div>
                      <div className="fthread-stat">—</div>
                      <div className="fthread-last">{timeAgo(t.last_reply_at)}</div>
                    </div>
                  ))}
                </>
              )}

              {threadResults.length === 0 && userResults.length === 0 && (
                <div className="forum-empty">No results found.</div>
              )}
            </div>
          )}

          {/* Categories */}
          {loading ? <div className="forum-loading">Loading...</div> : (
            <>
              {infoCats.length > 0 && (
                <div className="forum-section">
                  <div className="forum-section-header">Information</div>
                  {infoCats.map(renderCat)}
                </div>
              )}
              {mainCats.length > 0 && (
                <div className="forum-section">
                  <div className="forum-section-header">Solana & Memecoins</div>
                  {mainCats.map(renderCat)}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="forum-sidebar">
          <div className="fsidebar-block">
            <div className="fsidebar-title">Recent Threads</div>
            {recentThreads.map(t => (
              <div key={t.id} className="fsidebar-thread" onClick={() => nav(`/forum/thread/${t.id}`)}>
                <div className="fsidebar-thread-title">{t.title}</div>
                <div className="fsidebar-thread-meta">{catById[t.category_id]?.name} · {timeAgo(t.last_reply_at)}</div>
              </div>
            ))}
          </div>

          {user && (
            <div className="fsidebar-block">
              <div className="fsidebar-title">Following</div>
              {followingFeed.length === 0
                ? <div className="fsidebar-empty">Follow users to see their posts here.</div>
                : followingFeed.map(t => (
                  <div key={t.id} className="fsidebar-thread" onClick={() => nav(`/forum/thread/${t.id}`)}>
                    <div className="fsidebar-feed-user">
                      <div className="fsidebar-feed-avatar">
                        {t.avatar_url
                          ? <img src={t.avatar_url} alt="" />
                          : t.username?.slice(0,2).toUpperCase()}
                      </div>
                      <span>{t.username}</span>
                    </div>
                    <div className="fsidebar-thread-title">{t.title}</div>
                    <div className="fsidebar-thread-meta">{timeAgo(t.last_reply_at)}</div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
