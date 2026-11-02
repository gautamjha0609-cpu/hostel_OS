'use strict';
/* Location helpers shared by the app and the public visitor page (visit.html).
 *
 * "Use my current location" must write something a person can read — "Talwandi, Kota,
 * Rajasthan" — not "25.1442, 75.8468". Reverse geocoding uses two free services that need no
 * key and allow calls straight from a browser: BigDataCloud's client endpoint first, then
 * OpenStreetMap's Nominatim as a fallback. Both are listed in the CSP connect-src. If both
 * fail (offline, blocked) the caller still gets the coordinates and can type the address.
 */
const Geo = {
  // Resolves to { lat, lng } or rejects with a short human message.
  here() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('This phone cannot share its location.'));
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        e => rej(new Error(e && e.code === 1 ? 'Location permission was refused.' : 'Could not find your location.')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  },

  // "Locality, City, State" — duplicates dropped (a small town is often its own city).
  join(parts) {
    const seen = new Set(), out = [];
    for (const p of parts) { const v = String(p || '').trim(); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); } }
    return out.join(', ');
  },

  async place(lat, lng) {
    const tries = [
      async () => {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
        if (!r.ok) throw new Error('geo');
        const d = await r.json();
        const admin = ((d.localityInfo && d.localityInfo.administrative) || []).map(x => x.name);
        const local = d.locality && d.locality !== d.city ? d.locality : admin[admin.length - 1];
        return { locality: local || '', city: d.city || '', state: d.principalSubdivision || '' };
      },
      async () => {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('geo');
        const a = (await r.json()).address || {};
        return { locality: a.suburb || a.neighbourhood || a.village || a.hamlet || a.quarter || '', city: a.city || a.town || a.county || a.state_district || '', state: a.state || '' };
      },
    ];
    for (const fn of tries) {
      try { const p = await fn(); const text = Geo.join([p.locality, p.city, p.state]); if (text) return { ...p, text }; } catch (e) { /* next */ }
    }
    return null;
  },

  // Finds the phone, then names the place. Always resolves with at least the coordinates.
  async locate() {
    const pos = await Geo.here();
    const pl = await Geo.place(pos.lat, pos.lng);
    return { ...pos, text: pl ? pl.text : `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`, named: !!pl };
  },

  // Metres between two points (haversine) — used by the staff punch-in geofence.
  dist(a, b) {
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },
};
