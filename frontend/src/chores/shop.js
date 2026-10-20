// Shop catalog and cosmetics helpers. Prices here are for display only: the
// backend charges from SHOP_ITEMS in backend/chore_routes.py, and a backend
// test checks that every id and price below matches it.
// Coins: 1 coin for every 10 points earned (chore_wallet view).

export const POINTS_PER_COIN = 10

export const SLOTS = [
  { slot: 'theme', title: 'Themes', blurb: 'Repaint the whole dashboard. Only you see your theme.', defaultName: 'Classic' },
  { slot: 'avatar', title: 'Profile Pictures', blurb: 'Swap your color circle for something cooler.', defaultName: 'Initial' },
  { slot: 'color', title: 'Your Color', blurb: 'Your color on the calendar, leaderboard and chat.', defaultName: 'Original' },
  { slot: 'name_font', title: 'Name Fonts', blurb: 'How your name is written everywhere.', defaultName: 'Standard' },
  { slot: 'name_color', title: 'Name Colors', blurb: 'Make your name stand out.', defaultName: 'Your color' },
  { slot: 'banner', title: 'Animated Banners', blurb: 'Plays behind your name on My Day and the leaderboard.', defaultName: 'None' },
]

export const SHOP_ITEMS = [
  { id: 'theme-bubblegum', slot: 'theme', name: 'Bubblegum', price: 15, swatch: ['#fff0f6', '#ec4899', '#a855f7'] },
  { id: 'theme-rose-noir', slot: 'theme', name: 'Rose Noir', price: 20, swatch: ['#0d0709', '#f472b6', '#be185d'] },
  { id: 'theme-crimson', slot: 'theme', name: 'Crimson Night', price: 20, swatch: ['#070707', '#ef4444', '#7f1d1d'] },
  { id: 'theme-ocean', slot: 'theme', name: 'Ocean Breeze', price: 15, swatch: ['#f0f9ff', '#0284c7', '#06b6d4'] },
  { id: 'theme-midnight', slot: 'theme', name: 'Midnight Blue', price: 20, swatch: ['#050b1f', '#60a5fa', '#1e3a8a'] },
  { id: 'theme-sunset', slot: 'theme', name: 'Sunset', price: 15, swatch: ['#fff7ed', '#f97316', '#8b5cf6'] },
  { id: 'theme-silver-gold', slot: 'theme', name: 'Silver & Gold', price: 25, swatch: ['#eceef1', '#9ca3af', '#d4af37'] },
  { id: 'theme-obsidian', slot: 'theme', name: 'Obsidian Gold', price: 25, swatch: ['#0a0a0a', '#d4af37', '#3a2f0b'] },

  { id: 'avatar-fox', slot: 'avatar', name: 'Fox', price: 30, emoji: '🦊' },
  { id: 'avatar-panda', slot: 'avatar', name: 'Panda', price: 30, emoji: '🐼' },
  { id: 'avatar-unicorn', slot: 'avatar', name: 'Unicorn', price: 45, emoji: '🦄' },
  { id: 'avatar-dragon', slot: 'avatar', name: 'Dragon', price: 60, emoji: '🐉' },
  { id: 'avatar-galaxy', slot: 'avatar', name: 'Galaxy', price: 50, design: 'galaxy' },
  { id: 'avatar-holo', slot: 'avatar', name: 'Holo Ring', price: 75, design: 'holo' },

  { id: 'color-crimson', slot: 'color', name: 'Crimson', price: 40, hex: '#dc2626' },
  { id: 'color-violet', slot: 'color', name: 'Violet', price: 40, hex: '#8b5cf6' },
  { id: 'color-teal', slot: 'color', name: 'Teal', price: 40, hex: '#14b8a6' },
  { id: 'color-gold', slot: 'color', name: 'Gold', price: 40, hex: '#eab308' },
  { id: 'color-hotpink', slot: 'color', name: 'Hot Pink', price: 40, hex: '#f472b6' },
  { id: 'color-sky', slot: 'color', name: 'Sky', price: 40, hex: '#0ea5e9' },

  { id: 'font-playfair', slot: 'name_font', name: 'Elegant', price: 40, family: "'Playfair Display', serif" },
  { id: 'font-pacifico', slot: 'name_font', name: 'Script', price: 50, family: "'Pacifico', cursive" },
  { id: 'font-orbitron', slot: 'name_font', name: 'Sci-Fi', price: 50, family: "'Orbitron', sans-serif" },
  { id: 'font-bungee', slot: 'name_font', name: 'Blocky', price: 50, family: "'Bungee', sans-serif" },
  { id: 'font-pixel', slot: 'name_font', name: 'Pixel', price: 60, family: "'Press Start 2P', monospace" },

  { id: 'nc-royal', slot: 'name_color', name: 'Royal Purple', price: 40 },
  { id: 'nc-neon', slot: 'name_color', name: 'Neon Glow', price: 50 },
  { id: 'nc-fire', slot: 'name_color', name: 'Fire', price: 60 },
  { id: 'nc-ice', slot: 'name_color', name: 'Ice', price: 60 },
  { id: 'nc-gold', slot: 'name_color', name: 'Gold Leaf', price: 60 },
  { id: 'nc-rainbow', slot: 'name_color', name: 'Rainbow', price: 80 },

  { id: 'banner-aurora', slot: 'banner', name: 'Aurora', price: 80 },
  { id: 'banner-waves', slot: 'banner', name: 'Ocean Waves', price: 90 },
  { id: 'banner-stars', slot: 'banner', name: 'Starfield', price: 100 },
  { id: 'banner-lava', slot: 'banner', name: 'Lava', price: 120 },
]

export const ITEM_BY_ID = new Map(SHOP_ITEMS.map(i => [i.id, i]))

/** Item ids are "<kind>-<name>"; the CSS hook is the part after the first dash. */
export const itemKey = id => (id ? id.slice(id.indexOf('-') + 1) : '')

/** A member with their equipped cosmetics applied (color swapped, `look` added). */
export function dress(member, cosmetics) {
  const look = {
    theme: cosmetics?.theme || null,
    avatar: ITEM_BY_ID.get(cosmetics?.avatar) || null,
    font: ITEM_BY_ID.get(cosmetics?.name_font) || null,
    nameColor: cosmetics?.name_color || null,
    banner: cosmetics?.banner || null,
  }
  const color = ITEM_BY_ID.get(cosmetics?.color)?.hex
  return { ...member, baseColor: member.color, color: color || member.color, look }
}

/** className + style for a member's name (font and name color cosmetics). */
export function nameProps(member) {
  const look = member?.look
  return {
    className: `ch-name${look?.nameColor ? ` nc-${itemKey(look.nameColor)}` : ''}`,
    style: { '--name': member?.color || 'inherit', fontFamily: look?.font?.family },
  }
}

export function themeName(themeId) {
  return themeId ? itemKey(themeId) : 'classic'
}

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Bungee&family=Orbitron:wght@700&family=Pacifico' +
  '&family=Playfair+Display:ital,wght@1,700&family=Press+Start+2P&display=swap'

/** Loads the shop's name fonts once (Google Fonts is allowed by the CSP). */
export function ensureShopFonts() {
  if (typeof document === 'undefined' || document.getElementById('ch-shop-fonts')) return
  const link = document.createElement('link')
  link.id = 'ch-shop-fonts'
  link.rel = 'stylesheet'
  link.href = FONT_URL
  document.head.appendChild(link)
}
