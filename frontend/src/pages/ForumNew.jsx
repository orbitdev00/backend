import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { filterContent } from '../lib/contentFilter'
import NavBar from '../components/NavBar'
import './Forum.css'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'

const THREAD_COOLDOWN = 5 * 60 * 1000 // 5 minutes

async function updateReputation(userId, email, delta) {
  const { data: existing } = await supabase.from('user_reputation').select('score,post_count').eq('user_id', userId).single()
  const newScore = (existing?.score || 0) + delta
  const newPosts = (existing?.post_count || 0) + 1
  await supabase.from('user_reputation').upsert({ user_id: userId, email, score: newScore, post_count: newPosts, updated_at: new Date().toISOString() })
  if (newPosts === 1) {
    const { data: badge } = await supabase.from('forum_badges').select('id').eq('slug', 'newcomer').single()
    if (badge) await supabase.from('user_badges').upsert({ user_id: userId, badge_id: badge.id })
  }
  const BADGES = [{ slug:'trader', threshold:50 }, { slug:'analyst', threshold:200 }, { slug:'whale', threshold:500 }]
  for (const b of BADGES) {
    if (newScore >= b.threshold) {
      const { data: badge } = await supabase.from('forum_badges').select('id').eq('slug', b.slug).single()
      if (badge) await supabase.from('user_badges').upsert({ user_id: userId, badge_id: badge.id })
    }
  }
}

export default function ForumNew() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [catId, setCatId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!user) { nav('/login'); return }
    loadCategories()
    checkCooldown()
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => c <= 1 ? 0 : c - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const checkCooldown = () => {
    const last = localStorage.getItem(`orbit_thread_cd_${user?.id}`)
    if (last) {
      const elapsed = Date.now() - parseInt(last)
      if (elapsed < THREAD_COOLDOWN) {
        setCooldown(Math.ceil((THREAD_COOLDOWN - elapsed) / 1000))
      }
    }
  }

  const loadCategories = async () => {
    const { data } = await supabase.from('forum_categories').select('*').order('sort_order')
      .in('slug', ['announcements', 'calls', 'analysis', 'general', 'education'])
    setCategories(data || [])
    const slug = searchParams.get('cat')
    if (slug && data) {
      const cat = data.find(c => c.slug === slug)
      if (cat) setCatId(String(cat.id))
    }
  }

  const submit = async () => {
    if (!title.trim() || !body.trim() || !catId) { setError('Fill in all fields.'); return }
    if (cooldown > 0) { setError(`Please wait ${cooldown}s before posting again.`); return }

    // Content filter
    const titleCheck = filterContent(title)
    const bodyCheck  = filterContent(body)
    if (titleCheck.blocked) { setError(titleCheck.reason); return }
    if (bodyCheck.blocked)  { setError(bodyCheck.reason);  return }

    // Announcements: only mods, admins, and owners may post
    const selectedCat = categories.find(c => String(c.id) === catId)
    if (selectedCat?.slug === 'announcements') {
      const { data: rep } = await supabase.from('user_reputation').select('role').eq('user_id', user.id).maybeSingle()
      const role = rep?.role || 'member'
      if (!['mod', 'admin', 'owner'].includes(role)) {
        setError('Only moderators and admins can post in Announcements.')
        return
      }
    }

    setSubmitting(true); setError('')

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setError('Session expired. Please log in again.'); setSubmitting(false); return }

    const res = await fetch(`${BACKEND}/forum/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ category_id: parseInt(catId), title: title.trim(), body: body.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed to post thread.'); setSubmitting(false); return }

    localStorage.setItem(`orbit_thread_cd_${user.id}`, String(Date.now()))
    await updateReputation(user.id, user.email, 5)
    nav(`/forum/thread/${data.id}`)
  }

  return (
    <div className="forum-screen">
      <NavBar active="forum" />
      <div className="forum-body">
        <div className="forum-main">
          <div className="forum-breadcrumb">
            <span onClick={() => nav('/forum')}>Forum</span> › <span>New Thread</span>
          </div>
          <h2 className="forum-heading">New Thread</h2>

          <div className="fnew-form">
            <div className="fnew-field">
              <label>Category</label>
              <select value={catId} onChange={e => setCatId(e.target.value)} className="fnew-select">
                <option value="">Select a category...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div className="fnew-field">
              <label>Title</label>
              <input className="fnew-input" placeholder="Thread title..." value={title}
                onChange={e => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="fnew-field">
              <label>Body</label>
              <textarea className="fnew-textarea" placeholder="Write your post..."
                value={body} onChange={e => setBody(e.target.value)} rows={12} />
            </div>
            {error && <div className="fnew-error">{error}</div>}
            <div className="fnew-actions">
              <button className="fnew-cancel" onClick={() => nav('/forum')}>Cancel</button>
              <button className="fnew-submit" onClick={submit}
                disabled={submitting || cooldown > 0}>
                {cooldown > 0 ? `Wait ${cooldown}s` : submitting ? 'Posting...' : 'Post Thread'}
              </button>
            </div>
          </div>
        </div>

        <div className="forum-sidebar">
          <div className="fsidebar-block">
            <div className="fsidebar-title">Posting as</div>
            <div className="fsidebar-desc">{user?.email?.split('@')[0]}</div>
          </div>
          <div className="fsidebar-block">
            <div className="fsidebar-title">Reputation</div>
            <div className="fsidebar-desc">+5 post a thread</div>
            <div className="fsidebar-desc">+2 per reply</div>
            <div className="fsidebar-desc">+10 per upvote received</div>
          </div>
          <div className="fsidebar-block">
            <div className="fsidebar-title">Rules</div>
            <div className="fsidebar-desc">No slurs or hate speech</div>
            <div className="fsidebar-desc">No spam or repeated text</div>
            <div className="fsidebar-desc">No images or image links</div>
            <div className="fsidebar-desc">5 min cooldown between threads</div>
          </div>
        </div>
      </div>
    </div>
  )
}
