// FingerprintJS free tier — generates stable visitor ID
// Works across incognito, different tabs, cleared cookies

let cachedFp = null

export async function getFingerprint() {
  if (cachedFp) return cachedFp

  try {
    // Load FingerprintJS from CDN
    const FingerprintJS = await import('https://openfpcdn.io/fingerprintjs/v4')
    const fp = await FingerprintJS.load()
    const result = await fp.get()
    cachedFp = result.visitorId
    return cachedFp
  } catch (e) {
    // Fallback: generate a hash from browser properties
    const ua  = navigator.userAgent
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone
    const res = `${screen.width}x${screen.height}x${screen.colorDepth}`
    const lang = navigator.language
    const raw = `${ua}|${tz}|${res}|${lang}`
    
    // Simple hash
    let hash = 0
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    cachedFp = Math.abs(hash).toString(36)
    return cachedFp
  }
}

export function getTrialStatus() {
  return localStorage.getItem('kiko_trial_done') === '1'
}

export function setTrialDone() {
  localStorage.setItem('kiko_trial_done', '1')
}
