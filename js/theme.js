// Applies the saved theme before first paint, so dark mode never flashes white.
// Kept as a file rather than an inline <script> so the Content-Security-Policy can refuse
// inline script outright, which is what makes the policy worth having.
// Default is light; "auto" (follow the phone) is a choice the user makes.
try { var th = JSON.parse(localStorage.getItem('hostelos.theme') || '"light"') || 'light'; if (th !== 'auto') document.documentElement.dataset.theme = th; } catch (e) { document.documentElement.dataset.theme = 'light'; }

// Purge any stale service worker & CacheStorage during development / on localhost or a LAN address (a phone testing the dev server)
try {
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/.test(location.hostname)) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(rs) {
        for (var i = 0; i < rs.length; i++) rs[i].unregister();
      });
    }
    if ('caches' in window) {
      caches.keys().then(function(ks) {
        for (var i = 0; i < ks.length; i++) caches.delete(ks[i]);
      });
    }
  }
} catch (e) {}
