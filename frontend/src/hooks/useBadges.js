// useBadges.js — Badge state + popup queue management
// Import this in App.jsx or any page that awards badges

import { useState, useCallback, useRef } from "react";

const BACKEND = import.meta.env.VITE_BACKEND_URL || "https://backend-production-a427a.up.railway.app";

export function useBadges(userId) {
  const [ownedBadges, setOwnedBadges] = useState([]);
  const [popupQueue, setPopupQueue] = useState([]); // badges waiting to pop
  const [activePopup, setActivePopup] = useState(null);
  const processingRef = useRef(false);

  const fetchBadges = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${BACKEND}/badges/user/${userId}`);
      const data = await res.json();
      setOwnedBadges(data.badges || []);
    } catch (e) {
      console.error("useBadges: fetch failed", e);
    }
  }, [userId]);

  // Call this after any action that might award a badge
  // Pass the badge objects returned from the backend (newly awarded only)
  const pushNewBadges = useCallback((newBadges) => {
    if (!newBadges?.length) return;
    setPopupQueue(prev => [...prev, ...newBadges]);
    setOwnedBadges(prev => {
      const existingIds = new Set(prev.map(b => b.id));
      const fresh = newBadges.filter(b => !existingIds.has(b.id));
      return [...prev, ...fresh];
    });
  }, []);

  // Advance popup queue
  const dismissPopup = useCallback(() => {
    setActivePopup(null);
    setPopupQueue(prev => {
      const [, ...rest] = prev;
      if (rest.length > 0) {
        setTimeout(() => setActivePopup(rest[0]), 300);
        return rest;
      }
      return [];
    });
  }, []);

  // Kick off queue when new items arrive
  const startQueue = useCallback(() => {
    setPopupQueue(prev => {
      if (prev.length > 0 && !activePopup) {
        setActivePopup(prev[0]);
      }
      return prev;
    });
  }, [activePopup]);

  return {
    ownedBadges,
    activePopup,
    fetchBadges,
    pushNewBadges,
    dismissPopup,
    startQueue,
  };
}


// Equip / unequip helpers
export async function equipBadge(userId, badgeId, tier) {
  const res = await fetch(`${BACKEND}/badges/equip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, badge_id: badgeId, tier }),
  });
  return res.json();
}

export async function unequipBadge(userId, badgeId) {
  const res = await fetch(`${BACKEND}/badges/unequip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, badge_id: badgeId }),
  });
  return res.json();
}

export async function fetchEquippedBadges(userId) {
  const res = await fetch(`${BACKEND}/badges/user/${userId}/equipped`);
  const data = await res.json();
  return data.equipped || [];
}

export async function grantBadge(granterId, targetUserId, badgeId, granterRole) {
  const res = await fetch(`${BACKEND}/badges/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      granter_id: granterId,
      target_user_id: targetUserId,
      badge_id: badgeId,
      granter_role: granterRole,
    }),
  });
  return res.json();
}
