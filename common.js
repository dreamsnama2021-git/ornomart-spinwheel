// Shared helpers. Data lives in Supabase; the server (spin_play function) picks the coupon.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Brand palette (from the logo) - used for new coupons
const BRAND_COLORS = ['#0a3283', '#ffffff', '#0047ab', '#eaf1fc', '#0066cc', '#ffffff', '#0026b5', '#eaf1fc'];

function normalizeMobile(m) {
  return String(m || '').replace(/\D/g, '').slice(-10);
}

// Navy text on light backgrounds, white text on dark ones
function textColorFor(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1b1f4b' : '#ffffff';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
