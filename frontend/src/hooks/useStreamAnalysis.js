import { useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getFingerprint } from '../lib/fingerprint'

export function useStreamAnalysis() {
  const [status, setStatus]           = useState('idle')
  const [statusMsg, setStatusMsg]     = useState('Ready')
  const [snapshot, setSnapshot]       = useState(null)
  const [prediction, setPrediction]   = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [preview, setPreview]         = useState(null)
  const [partials, setPartials]       = useState({})
  const wsRef       = useRef(null)
  const baselineRef = useRef(null)

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close() } catch {}
      wsRef.current = null
    }
    // Clear all state so landing screen shows cleanly
    setSnapshot(null)
    setPrediction(null)
    setPreview(null)
    setPartials({})
    setStatus('idle')
    setStatusMsg('Ready')
  }, [])

  const analyze = useCallback(async (mint, keepExisting = false) => {
    if (!mint?.trim()) return null
    disconnect()
    setStatus('loading')
    setStatusMsg('Analyzing...')
    if (!keepExisting) {
      setSnapshot(null)
      setPrediction(null)
      setPreview(null)
      setPartials({})
    }
    baselineRef.current = null

    const { data: { session } } = await supabase.auth.getSession()
    const loggedIn = !!(session?.user?.id)

    const proto  = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl  = `${proto}//${window.location.host}/ws/stream/${mint.trim()}`

    console.log('[ORBIT] Connecting WebSocket:', wsUrl)

    return new Promise((resolve) => {
      let settled = false
      const settle = (val) => {
        if (!settled) { settled = true; resolve(val) }
      }

      // On ngrok skip WS — free tier blocks upgrades, go straight to HTTP
      if (window.location.host.includes('ngrok')) {
        console.log('[ORBIT] Ngrok detected — using HTTP directly')
        httpFallback(mint, loggedIn, settle)
        return
      }

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[ORBIT] WebSocket connected')
        setStatusMsg('Connected — fetching data...')
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'partial') {
            setPartials(prev => ({ ...prev, [msg.source]: msg.data }))
            if (msg.source === 'market') setPreview(msg.data)
          } else if (msg.type === 'status') {
            setStatusMsg(msg.data?.message || 'Loading...')
          } else if (msg.type === 'complete' || msg.type === 'update') {
            const { snapshot: snap, prediction: pred } = msg.data
            setSnapshot(snap)
            setPrediction(pred)
            setLastUpdated(Date.now())
            setStatus('live')
            setStatusMsg('Live')
            if (!baselineRef.current) baselineRef.current = pred
            if (msg.type === 'complete') settle({})
          } else if (msg.type === 'error') {
            setStatus('error')
            setStatusMsg(msg.data?.message || 'Analysis failed')
            settle({ error: msg.data?.message })
          }
        } catch (err) {
          console.warn('[ORBIT] ws parse error:', err)
        }
      }

      ws.onerror = (err) => {
        console.warn('[ORBIT] WebSocket error — falling back to HTTP', err)
        ws.close()
        httpFallback(mint, loggedIn, settle)
      }

      ws.onclose = (e) => {
        console.log('[ORBIT] WebSocket closed', e.code)
        wsRef.current = null
        // If we never got a result, fall back
        if (!settled) {
          httpFallback(mint, loggedIn, settle)
        }
      }

      // Safety timeout — fall back after 15s if nothing arrives
      setTimeout(() => {
        if (!settled) {
          console.warn('[ORBIT] WebSocket timeout — falling back to HTTP')
          ws.close()
          httpFallback(mint, loggedIn, settle)
        }
      }, 15000)
    })

    async function httpFallback(mint, loggedIn, settle) {
      try {
        let q = ''
        if (!loggedIn) {
          const fp = await getFingerprint()
          q = `?fingerprint=${encodeURIComponent(fp)}&is_trial=true`
        }
        setStatusMsg('Analyzing...')
        // Add user_id to request
        const { data: { session: sess2 } } = await supabase.auth.getSession()
        const uid = sess2?.user?.id || ''
        const uidParam = uid ? `${q ? '&' : '?'}user_id=${encodeURIComponent(uid)}` : ''
        const res  = await fetch(`/analyze/${mint.trim()}${q}${uidParam}`, {
          headers: { 'ngrok-skip-browser-warning': '1' }
        })
        const text = await res.text()
        if (!text?.trim()) throw new Error('Empty response from server')
        const data = JSON.parse(text)
        if ((data.error === 'trial_used' || data.error === 'trial_no_fingerprint') && !loggedIn) {
          setStatus('idle'); setStatusMsg('Ready')
          settle({ trialUsed: true }); return
        }
        if (data.error) throw new Error(data.error)
        setSnapshot(data.snapshot)
        setPrediction(data.prediction)
        setLastUpdated(Date.now())
        setStatus('live')
        setStatusMsg('Live')
        if (!baselineRef.current) baselineRef.current = data.prediction
        settle({ trialConsumed: data.trial_consumed })
      } catch (e) {
        setStatus('error')
        setStatusMsg(e.message || 'Analysis failed')
        settle({ error: e.message })
      }
    }
  }, [disconnect])

  const refresh = useCallback(async () => {
    if (snapshot?.mint) return analyze(snapshot.mint)
  }, [analyze, snapshot])

  return {
    status, statusMsg, snapshot, prediction, preview, partials, lastUpdated,
    analyze, refresh, disconnect,
    get baselinePred() { return baselineRef.current }
  }
}
