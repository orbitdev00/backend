// BadgeIcon.jsx — Single badge display with tooltip
// Used on profiles, forum posts, leaderboard rows

import { useState } from "react";
import "./BadgeIcon.css";

const RARITY_LABELS = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
};

export default function BadgeIcon({ badge, size = "md", showTooltip = true, dimmed = false }) {
  const [hovered, setHovered] = useState(false);

  const sizeClass = `badge-icon--${size}`; // sm | md | lg

  return (
    <div
      className={`badge-icon ${sizeClass} badge-rarity--${badge.rarity} ${dimmed ? "badge-icon--dimmed" : ""} ${badge.glow ? "badge-icon--glow" : ""}`}
      style={{ "--badge-color": badge.color }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="badge-icon__emoji">{badge.emoji}</span>

      {showTooltip && hovered && (
        <div className="badge-tooltip">
          <div className="badge-tooltip__header">
            <span className="badge-tooltip__emoji">{badge.emoji}</span>
            <div>
              <div className="badge-tooltip__name">{badge.name}</div>
              <div className={`badge-tooltip__rarity badge-tooltip__rarity--${badge.rarity}`}>
                {RARITY_LABELS[badge.rarity]}
              </div>
            </div>
          </div>
          <div className="badge-tooltip__desc">{badge.description}</div>
        </div>
      )}
    </div>
  );
}
