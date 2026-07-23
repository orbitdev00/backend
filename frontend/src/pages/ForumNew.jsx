import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { filterContent } from '../lib/contentFilter'
import NavBar from '../components/NavBar'
import './Forum.css'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'

const THREAD_COOLDOWN = 5 * 60 * 1000 // 5 minutes

// Reputation score, post_count and badges are now incremented server-side by
// POST /forum/threads (service key). The old client-side updateReputation()
// wrote the protected `score` column and upserted badges — both are now blocked
// by RLS / the protect_reputation_columns trigger, so it was removed.

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

    // Announcements: only admins and owner may post
    const selectedCat = categories.find(c => String(c.id) === catId)
    if (selectedCat?.slug === 'announcements') {
      const { data: rep } = await supabase.from('user_reputation').select('role').eq('user_id', user.id).maybeSingle()
      const role = rep?.role || 'member'
      const isOwner = role === 'owner' || user?.email === 'orbitdev00@gmail.com'
      if (!isOwner && !['admin'].includes(role)) {
        setError('Only admins and the owner can post in Announcements.')
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
