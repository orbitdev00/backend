// Entry point. 'virtual:app-entry' is aliased at build time by VITE_APP_MODE
// (see vite.config.js), so only one app is ever bundled:
//   VITE_APP_MODE=orbit  → full Orbit app (OrbitMain.jsx)
//   VITE_APP_MODE=chores → Household Chore Dashboard only (chores/ChoresMain.jsx) — default
import { mount } from 'virtual:app-entry'

mount(document.getElementById('root'))
