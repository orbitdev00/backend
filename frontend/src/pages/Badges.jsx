// Badges.jsx — /badges page
// Shows all badges: owned (lit) vs locked (dimmed), equip controls

import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import BadgeIcon from "../components/BadgeIcon";
import { equipBadge, unequipBadge } from "../hooks/useBadges";
import "./Badges.css";

const BACKEND = import.meta.env.VITE_BACKEND_URL || "https://backend-production-a427a.up.railway.app";

const CATEGORY_LABELS = {
  activity: "Activity",
  trading: "Trading & PnL",
  community: "Community",
  subscription: "Subscription",
  staff: "Staff",
  skill: "Skill",
  fun: "Fun · Rare",
};

export default function Badges() {
  const { user, profile } = useAuth();
  const [allBadges, setAllBadges] = useState([]);
  const [userBadges, setUserBadges] = useState({}); // badge_id -> { equipped, awarded_at }
  const [equipLimit, setEquipLimit] = useState(1);
  const [equippedCount, setEquippedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");

  const tier = profile?.tier || "free";

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [allRes, userRes, limitRes] = await Promise.all([
          fetch(`${BACKEND}/badges/all`).then(r => r.json()),
          user ? fetch(`${BACKEND}/badges/user/${user.id}`).then(r => r.json()) : Promise.resolve({ badges: [] }),
          fetch(`${BACKEND}/badges/equip-limit?tier=${tier}`).then(r => r.json()),
        ]);

        setAllBadges(allRes.badges || []);
        const map = {};
        for (const b of (userRes.badges || [])) {
          map[b.id] = { equipped: b.equipped, awarded_at: b.awarded_at };
        }
        setUserBadges(map);
        setEquipLimit(limitRes.limit || 1);
        setEquippedCount(Object.values(map).filter(v => v.equipped).length);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user, tier]);

  async function handleEquipToggle(badge) {
    const owned = userBadges[badge.id];
    if (!owned) return; // don't own it

    if (owned.equipped) {
      await unequipBadge(user.id, badge.id);
      setUserBadges(prev => ({ ...prev, [badge.id]: { ...prev[badge.id], equipped: false } }));
      setEquippedCount(c => c - 1);
    } else {
      if (equippedCount >= equipLimit) return;
      const res = await equipBadge(user.id, badge.id, tier);
      if (!res.error) {
        setUserBadges(prev => ({ ...prev, [badge.id]: { ...prev[badge.id], equipped: true } }));
        setEquippedCount(c => c + 1);
      }
    }
  }

  const categories = ["all", ...Object.keys(CATEGORY_LABELS)];

  const filtered = activeCategory === "all"
    ? allBadges
    : allBadges.filter(b => b.category === activeCategory);

  // Group by category for display
  const grouped = {};
  for (const badge of filtered) {
    if (!grouped[badge.category]) grouped[badge.category] = [];
    grouped[badge.category].push(badge);
  }

  const ownedCount = Object.keys(userBadges).length;

  if (loading) return <div className="badges-loading">Loading badges...</div>;

  return (
    <div className="badges-screen">
    <NavBar active="badges" />
    <div className="badges-page">
      <div className="badges-header">
        <div className="badges-header__left">
          <h1 className="badges-title">Badges</h1>
          <p className="badges-subtitle">
            {ownedCount} / {allBadges.length} collected
            <span className="badges-equip-info">
              · {equippedCount} / {equipLimit} equipped
              {tier === "free" && <span className="badges-upgrade-hint"> — upgrade to equip more</span>}
            </span>
          </p>
        </div>
      </div>

      {/* Category filter */}
      <div className="badges-filters">
        {categories.map(cat => (
          <button
            key={cat}
            className={`badges-filter-btn ${activeCategory === cat ? "badges-filter-btn--active" : ""}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat === "all" ? "All" : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Badge grid by category */}
      {Object.entries(grouped).map(([cat, badges]) => (
        <div key={cat} className="badges-section">
          <h2 className="badges-section-title">{CATEGORY_LABELS[cat]}</h2>
          <div className="badges-grid">
            {badges.map(badge => {
              const owned = userBadges[badge.id];
              const equipped = owned?.equipped;
              const canEquip = !!owned && (equipped || equippedCount < equipLimit);

              return (
                <div
                  key={badge.id}
                  className={`badge-card ${owned ? "badge-card--owned" : "badge-card--locked"} ${equipped ? "badge-card--equipped" : ""}`}
                  style={{ "--badge-color": badge.color }}
                  onClick={() => owned && handleEquipToggle(badge)}
                  title={owned ? (equipped ? "Click to unequip" : canEquip ? "Click to equip" : "Equip limit reached") : "Not yet earned"}
                >
                  <BadgeIcon badge={badge} size="lg" dimmed={!owned} showTooltip={!owned} />
                  <div className="badge-card__name">{badge.name}</div>
                  {owned && (
                    <div className={`badge-card__status ${equipped ? "badge-card__status--on" : ""}`}>
                      {equipped ? "Equipped" : "Owned"}
                    </div>
                  )}
                  {!owned && <div className="badge-card__locked">Locked</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
    </div>
    </div>
  );
}
