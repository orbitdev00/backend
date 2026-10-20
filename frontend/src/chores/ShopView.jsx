import { useEffect, useState } from 'react'
import { SLOTS, SHOP_ITEMS, POINTS_PER_COIN, itemKey, dress, nameProps, ensureShopFonts } from './shop.js'
import { Avatar } from './ChoreModals.jsx'
import { CountUp } from './Fx.jsx'
import { burst, centerOf } from './motion.js'

export function Coin({ size = 18 }) {
  return <span className="ch-coin" style={{ width: size, height: size }} aria-hidden="true" />
}

export default function ShopView({ me, wallet, owned, cosmetics, onShop }) {
  const [slot, setSlot] = useState('theme')
  const [busy, setBusy] = useState('')
  const coins = wallet?.coins ?? 0
  useEffect(ensureShopFonts, [])

  const equipped = cosmetics?.[slot] || null
  const section = SLOTS.find(s => s.slot === slot)
  const items = SHOP_ITEMS.filter(i => i.slot === slot)

  const act = async (e, item) => {
    const el = e.currentTarget
    setBusy(item?.id || 'default')
    const ok = !item || owned.has(item.id)
      ? await onShop({ action: 'equip', item_id: item?.id ?? null, slot }, item ? `Equipped ${item.name}` : 'Back to default')
      : await onShop({ action: 'buy', item_id: item.id }, null)
    if (ok && item && !owned.has(item.id)) {
      const { x, y } = centerOf(el)
      burst(x, y, { colors: ['#facc15', '#f59e0b', '#fde68a', me.color], count: 16, spread: 90 })
      await onShop({ action: 'equip', item_id: item.id, slot }, `Bought and equipped ${item.name}!`)
    }
    setBusy('')
  }

  return (
    <section className="ch-shop" aria-label="Shop">
      <div className="ch-card ch-shop-hero" style={{ '--i': 0 }}>
        <div>
          <h2>Shop</h2>
          <p className="ch-muted">Earn 1 coin for every {POINTS_PER_COIN} points. Harder chores pay more.</p>
        </div>
        <div className="ch-wallet">
          <Coin size={30} />
          <span className="ch-wallet-value"><CountUp value={coins} /></span>
          <span className="ch-wallet-label">coins<br /><small>{wallet?.coins_earned ?? 0} earned · {wallet?.coins_spent ?? 0} spent</small></span>
        </div>
      </div>

      <nav className="ch-tabs ch-shop-tabs" role="tablist" aria-label="Shop sections">
        {SLOTS.map(s => (
          <button key={s.slot} role="tab" aria-selected={slot === s.slot} className={`ch-tab${slot === s.slot ? ' is-active' : ''}`} onClick={() => setSlot(s.slot)}>
            {s.title}
          </button>
        ))}
      </nav>

      <div className="ch-card ch-shop-section" key={slot} style={{ '--i': 1 }}>
        <p className="ch-muted ch-shop-blurb">{section.blurb}</p>
        <div className="ch-shop-grid">
          <ShopCard
            name={section.defaultName}
            preview={<Preview slot={slot} item={null} me={me} />}
            status={equipped ? 'owned' : 'equipped'}
            price={0}
            busy={busy === 'default'}
            onClick={e => act(e, null)}
            i={0}
          />
          {items.map((item, i) => {
            const has = owned.has(item.id)
            return (
              <ShopCard
                key={item.id}
                name={item.name}
                preview={<Preview slot={slot} item={item} me={me} />}
                status={equipped === item.id ? 'equipped' : has ? 'owned' : coins >= item.price ? 'buy' : 'locked'}
                price={item.price}
                short={item.price - coins}
                busy={busy === item.id}
                onClick={e => act(e, item)}
                i={i + 1}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}

function ShopCard({ name, preview, status, price, short, busy, onClick, i }) {
  const label = status === 'equipped' ? 'Equipped'
    : status === 'owned' ? 'Equip'
      : status === 'locked' ? `Need ${short} more`
        : null
  return (
    <div className={`ch-shop-item is-${status}`} style={{ '--i': i }}>
      <div className="ch-shop-preview">{preview}</div>
      <div className="ch-shop-name">{name}</div>
      <button className="ch-btn ch-btn-sm ch-shop-btn" disabled={busy || status === 'equipped' || status === 'locked'} onClick={onClick}>
        {label ?? <><Coin size={14} /> {price}</>}
      </button>
    </div>
  )
}

function Preview({ slot, item, me }) {
  if (slot === 'theme') {
    const [bg, a, b] = item?.swatch || ['#f8fafc', '#6366f1', '#4f46e5']
    return (
      <span className="ch-theme-swatch" style={{ background: bg }}>
        <span style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
        <span style={{ background: a }} />
        <span style={{ background: b }} />
      </span>
    )
  }
  if (slot === 'banner') {
    return <span className={`ch-banner-fx ch-banner-preview${item ? ` bn-${itemKey(item.id)}` : ''}`} />
  }
  // Show the item on the shopper themselves.
  const cos = { avatar: null, color: null, name_font: null, name_color: null }
  const base = { ...me, color: slot === 'color' ? (me.baseColor ?? me.color) : me.color }
  if (item) cos[slot] = item.id
  const look = dress(base, slot === 'avatar' ? cos : { ...cos, avatar: me.look?.avatar?.id })
  if (slot === 'avatar') return <Avatar member={look} size={56} />
  if (slot === 'color') return <span className="ch-color-swatch" style={{ background: look.color }} />
  const name = nameProps(look)
  return <span className={`ch-shop-name-preview ${name.className}`} style={name.style}>{me.name}</span>
}
