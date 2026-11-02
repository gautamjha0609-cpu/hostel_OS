// Sarvlekh runtime config.
//
// CLOUD MODE (what you have now): the app talks to the "hostels" Supabase project. Records
// live in Postgres, so every browser and every phone sees the same thing, and nothing is lost
// when site data is cleared. Log in with a real account — the tap-to-try demo logins are gone.
//
// DEMO MODE: blank the two values below. Everything then runs inside one browser on seeded
// data, which is handy for a quick look but is wiped by anything that clears site storage.
window.HOSTELOS_CONFIG = {
  SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiaW1mcmhuc2lrcGl6dG93bHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MzMzNzMsImV4cCI6MjEwOTAwOTM3M30.uXHoAOykp8tT2at07LJgdxDAReD474odUdCiGcv2luQ',
  AUTH_EMAIL_DOMAIN: 'login.hostelos.app', // must match AUTH_EMAIL_DOMAIN on Vercel (if you set one)
  APP_NAME: 'Sarvlekh',
  // The domain a hostel's public page is advertised on. Set it once the domain points at this
  // deployment, and every owner's link becomes https://sarvlekh.in/h/<their-hostel-name>.
  // Left empty, the page is still reachable by hostel id, so nothing waits on DNS.
  PUBLIC_SITE_BASE: '',
  // With a domain here (no https://, e.g. 'sarvlekh.in') every hostel's page is https://<hostel-name>.sarvlekh.in.
  // Set it with `npm run domain -- sarvlekh.in`, which also adds the matching rewrite to vercel.json.
  PUBLIC_SITE_DOMAIN: 'sarvlekh.in',
};

// The anon key above is public by design — row-level security is what protects the data, and
// this file ships to every browser anyway. The service-role key is a different thing entirely
// and must never appear here; it belongs only in the serverless functions' environment.
//
// Note: /api/admin and /api/public are Vercel functions. A plain static file server cannot run
// them, so on localhost the screens that create clients and logins, the QR self check-in, and the
// public hostel page will not work until this is deployed. Everything else does.
