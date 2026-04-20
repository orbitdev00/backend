import { useState } from 'react'
import { startCheckout, openBillingPortal } from '../lib/stripe'
import './PricingPanel.css'

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    color: '#666',
    features: [
      '3 analyses per day',
      'Full analyzer results',
      'Full forum access',
      'Share analysis links',
      'Price tracker — up to 3 coins',
      'Leaderboard + wallet connect',
      'Badge system',
    ],
    cta: null,
  },
  {
    id: 'degen',
    name: 'Degen',
    price: '$14.99',
    period: '/mo',
    color: '#a78bfa',
    badge: '🟣',
    features: [
      'Unlimited analyses',
      'Unlimited analysis history',
      'Unlimited price tracker',
      'Post images in forum',
      'Priority analysis queue',
      'Degen badge on profile + leaderboard',
      'Discord: degen-lounge + orbit-calls',
    ],
    cta: 'Upgrade to Degen',
  },
  {
    id: 'omega',
    name: 'Omega',
    price: '$49.99',
    salePrice: '$24.99',
    period: '/mo',
    color: '#f59e0b',
    badge: '⚡',
    sale: true,
    features: [
      'Everything in Degen',
      'Multi-wallet tracking (5 wallets)',
      'Custom alert conditions',
      'Omega-only forum category',
      'Maximum analysis depth',
      'Exclusive profile border',
      'Omega badge — pulses on leaderboard',
      'Early beta access to new features',
      'Direct channel to Orbit devs',
      'Discord: omega-only channel',
    ],
    cta: 'Upgrade to Omega',
  },
]

export default function PricingPanel({ currentTier = 'free', onClose }) {
  const [loading, setLoading] = useState(null)

  const handleUpgrade = async (tierId) => {
    setLoading(tierId)
    await startCheckout(tierId)
    setLoading(null)
  }

  const handleManage = async () => {
    setLoading('portal')
    await openBillingPortal()
    setLoading(null)
  }

  const isPaid = currentTier === 'degen' || currentTier === 'omega'

  return (
    <div className="pp-wrap">
      <div className="pp-header">
        <span className="pp-title">Subscription</span>
        {isPaid && (
          <button className="pp-manage" onClick={handleManage} disabled={loading === 'portal'}>
            {loading === 'portal' ? 'Loading...' : 'Manage billing →'}
          </button>
        )}
      </div>

      {currentTier !== 'free' && (
        <div className="pp-current">
          Current plan: <span style={{color: currentTier === 'omega' ? '#f59e0b' : '#a78bfa', fontWeight:600, textTransform:'capitalize'}}>{currentTier}</span>
        </div>
      )}

      <div className="pp-grid">
        {TIERS.map(t => {
          const isCurrent = currentTier === t.id
          const isLower   = (t.id === 'free' && isPaid) ||
                            (t.id === 'degen' && currentTier === 'omega')
          return (
            <div key={t.id} className={`pp-card ${isCurrent ? 'pp-card-active' : ''}`}
              style={{'--tier-color': t.color}}>
              {t.sale && (
                <div className="pp-sale-badge">7-DAY LAUNCH PRICE</div>
              )}
              <div className="pp-card-header">
                <span className="pp-tier-name">{t.badge} {t.name}</span>
                <div className="pp-price-wrap">
                  {t.salePrice ? (
                    <>
                      <span className="pp-price-old">{t.price}</span>
                      <span className="pp-price">{t.salePrice}</span>
                      <span className="pp-period">{t.period}</span>
                    </>
                  ) : (
                    <>
                      <span className="pp-price">{t.price}</span>
                      <span className="pp-period">{t.period}</span>
                    </>
                  )}
                </div>
              </div>
              <ul className="pp-features">
                {t.features.map((f, i) => (
                  <li key={i} className="pp-feature">
                    <span className="pp-check" style={{color: t.color}}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {t.cta && !isCurrent && !isLower && (
                <button
                  className="pp-cta"
                  style={{background: t.color}}
                  onClick={() => handleUpgrade(t.id)}
                  disabled={!!loading}
                >
                  {loading === t.id ? 'Redirecting...' : t.cta}
                </button>
              )}
              {isCurrent && (
                <div className="pp-current-badge">Current plan</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
