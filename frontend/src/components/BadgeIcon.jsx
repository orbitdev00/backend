// BadgeIcon.jsx — Single badge display with tooltip
// Used on profiles, forum posts, leaderboard rows

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import "./BadgeIcon.css";

const RARITY_LABELS = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
};

export default function BadgeIcon({ badge, size = "md", showTooltip = true, dimmed = false }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);

  const sizeClass = `badge-icon--${size}`;

  const handleMouseEnter = () => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.top - 8, left: r.left + r.width / 2 });
    }
    setHovered(true);
  };

  return (
    <div
      ref={wrapRef}
      className="badge-icon-wrap"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`badge-icon ${sizeClass} badge-rarity--${badge.rarity} ${dimmed ? "badge-icon--dimmed" : ""} ${badge.glow ? "badge-icon--glow" : ""}`}
        style={{ "--badge-color": badge.color }}
      >
        <span className="badge-icon__emoji">{badge.emoji}</span>
      </div>

      {showTooltip && hovered && createPortal(
        <div
          className="badge-tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%) translateY(-100%)', zIndex: 9999 }}
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}
