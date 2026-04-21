import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import StarField from '../components/StarField'
import { startCheckout, openBillingPortal } from '../lib/stripe'
import './Pricing.css'

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    color: '#888',
    desc: 'Get started with no commitment.',
    features: [
      '3 analyses per day',
      'Full analyzer results',
      'Full forum access · post, reply, vote, DM',
      'Share analysis · public shareable links',
      'Price tracker · up to 3 coins',
      'Leaderboard · connect wallet and compete',
      'Badge system · earn and equip badges',
    ],
  },
  {
    id: 'degen',
    name: 'Degen',
    price: '$14.99',
    period: '/mo',
    color: '#a78bfa',
    desc: 'For active traders who need more.',
    popular: true,
    features: [
      'Unlimited analyses',
      'Unlimited analysis history',
      'Unlimited price tracker with alerts',
      'Post images in forum',
      'Priority analysis queue',
      'Degen badge on profile and leaderboard',
    ],
  },
  {
    id: 'omega',
    name: 'Omega',
    price: '$49.99',
    salePrice: '$24.99',
    period: '/mo',
    color: '#f59e0b',
    desc: 'Maximum edge. For serious traders.',
    sale: true,
    features: [
      'Everything in Degen',
      'Maximum Orbit analysis depth',
      'Omega-only Forum Chat',
      'Omega badge · exclusive profile border',
      'More Profile Wallets · add up to 5 wallets',
      'Early beta access to new features',
      'Direct channel to Orbit Devs',
    ],
  },
]

export default function Pricing({ currentTier = 'free' }) {
  const nav = useNavigate()
  const [loading, setLoading] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => { setTimeout(() => setVisible(true), 50) }, [])

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
    <div className={`pricing-page ${visible ? "pricing-visible" : ""}`}>
      <StarField />
      <NavBar active="" />
      <div className="pricing-body">
        <div className="pricing-header">
          <h1 className="pricing-title">Choose your plan.</h1>
          <p className="pricing-sub">
            Cancel anytime. Billed monthly. Powered by Stripe.
          </p>
          {isPaid && (
            <button className="pricing-manage" onClick={handleManage} disabled={loading === 'portal'}>
              {loading === 'portal' ? 'Loading...' : 'Manage or cancel subscription →'}
            </button>
          )}
        </div>

        <div className="pricing-grid">
          {TIERS.map(t => {
            const isCurrent = currentTier === t.id
            const isUpgrade = (t.id === 'degen' && currentTier === 'free') ||
                              (t.id === 'omega' && currentTier !== 'omega')
            const isDowngrade = (t.id === 'free' && isPaid) ||
                                (t.id === 'degen' && currentTier === 'omega')

            return (
              <div key={t.id} className={`pricing-card ${t.popular ? 'pricing-card-popular' : ''} ${isCurrent ? 'pricing-card-current' : ''}`}
                style={{'--tc': t.color}}>
                {t.sale && <div className="pricing-sale-tag">🔥 7-DAY LAUNCH PRICE</div>}
                {t.popular && !t.sale && <div className="pricing-popular-tag">MOST POPULAR</div>}

                <div className="pricing-card-top">
                  <div className="pricing-tier-name" style={{color: t.color}}>{t.name}</div>
                  <div className="pricing-tier-desc">{t.desc}</div>
                  <div className="pricing-price-row">
                    {t.salePrice ? (
                      <>
                        <span className="pricing-price-old">{t.price}</span>
                        <span className="pricing-price">{t.salePrice}</span>
                        <span className="pricing-period">{t.period}</span>
                      </>
                    ) : (
                      <>
                        <span className="pricing-price">{t.price}</span>
                        <span className="pricing-period">{t.period}</span>
                      </>
                    )}
                  </div>
                </div>

                <ul className="pricing-features">
                  {t.features.map((f, i) => (
                    <li key={i} className="pricing-feature">
                      <span style={{color: t.color}}>✓</span> {f}
                    </li>
                  ))}
                </ul>

                <div className="pricing-card-bottom">
                  {isCurrent ? (
                    <div className="pricing-current-label">Current plan</div>
                  ) : isDowngrade ? (
                    <div className="pricing-downgrade-label">Lower tier</div>
                  ) : (
                    <button
                      className="pricing-cta"
                      style={{background: t.color}}
                      onClick={() => t.id === 'free' ? nav(-1) : handleUpgrade(t.id)}
                      disabled={!!loading}
                    >
                      {loading === t.id ? 'Redirecting to Stripe...' :
                       t.id === 'free' ? 'Stay on Free' :
                       `Upgrade to ${t.name}`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Stripe trust section */}
        <div className="pricing-trust">

          <div className="pricing-trust-cards">
            {[
              { icon: '🔒', title: 'Secured by Stripe', body: 'Your payment info is encrypted and never stored on our servers. Stripe is used by millions of businesses worldwide and is fully PCI compliant.' },
              { icon: '↩', title: 'Cancel anytime', body: 'No contracts, no hidden fees. Cancel from account settings and keep your benefits until the end of your billing period.' },
              { icon: '⚡', title: 'Instant activation', body: 'Your tier upgrades the moment payment clears. No waiting, no manual approval, no delays.' },
            ].map((c, i) => (
              <div key={i} className="pricing-trust-card" style={{animationDelay: `${i * 0.1}s`}}>
                <div className="pricing-trust-card-icon">{c.icon}</div>
                <div className="pricing-trust-card-title">{c.title}</div>
                <div className="pricing-trust-card-body">{c.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
