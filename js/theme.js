// Applies the saved theme before first paint, so dark mode never flashes white.
// Kept as a file rather than an inline <script> so the Content-Security-Policy can refuse
// inline script outright, which is what makes the policy worth having.
// Default is light; "auto" (follow the phone) is a choice the user makes.
try { var th = JSON.parse(localStorage.getItem('hostelos.theme') || '"light"') || 'light'; if (th !== 'auto') document.documentElement.dataset.theme = th; } catch (e) { document.documentElement.dataset.theme = 'light'; }
