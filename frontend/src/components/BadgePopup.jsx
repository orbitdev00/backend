// BadgePopup.jsx — Animated badge award notification
// Usage: <BadgePopup badge={badge} onClose={() => setNewBadge(null)} />

import { useEffect } from "react";
import "./BadgePopup.css";

export default function BadgePopup({ badge, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!badge) return null;

  return (
    <div className="badge-popup" style={{ "--badge-color": badge.color }}>
      <div className="badge-popup__inner">
        <div className="badge-popup__glow" />
        <div className="badge-popup__emoji-wrap">
          <span className="badge-popup__emoji">{badge.emoji}</span>
        </div>
        <div className="badge-popup__text">
          <div className="badge-popup__label">Badge Unlocked</div>
          <div className="badge-popup__name">{badge.name}</div>
          <div className="badge-popup__desc">{badge.description}</div>
        </div>
        <button className="badge-popup__close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
