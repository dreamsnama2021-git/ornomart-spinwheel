const $ = id => document.getElementById(id);

let segments = [];   // [{id, label, color}] - coupon codes stay on the server
let currentUser = null;
let rotation = 0;
let spinning = false;

const ERRORS = {
  already_played: 'This mobile number has already been used to spin',
  invalid_mobile: 'Please enter a valid 10-digit mobile number',
  invalid_name: 'Please enter a valid name',
  no_coupons: 'The wheel is not set up yet. Please contact the store.',
  campaign_ended: 'This offer has ended.'
};
function errorText(err) {
  const key = Object.keys(ERRORS).find(k => String(err?.message || '').includes(k));
  return key ? ERRORS[key] : 'Network error. Please try again.';
}

async function loadWheel() {
  const { data, error } = await sb.rpc('spin_get_wheel');
  if (error) throw error;
  segments = data || [];
}

// ---------- Validity date (set by the admin; checked on the server in India time) ----------
let campaign = { valid_until: null, ended: false };
const campaignReady = sb.rpc('spin_public_info')
  .then(({ data }) => { if (data) campaign = data; applyCampaign(); })
  .catch(() => {});

function formatDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function validText() {
  return campaign.valid_until ? `Valid till ${formatDate(campaign.valid_until)}` : '';
}

function applyCampaign() {
  $('resultValid').textContent = validText();
  $('endedNote').classList.toggle('hidden', !campaign.ended);
  if (campaign.ended) {
    $('endedNote').textContent = `This offer ended on ${formatDate(campaign.valid_until)}. Already played? Enter your details to view your coupon.`;
  }
  if (!$('myCard').classList.contains('hidden') && lastShown) showMyCoupon(lastShown);
}

// ---------- Returning user: "Your Coupon" ----------
let lastShown = null;
// Remember the won coupon in this browser so it shows up right away on the next visit
const MY_KEY = 'ornomart_my_coupon';
function getMine() {
  try { return JSON.parse(localStorage.getItem(MY_KEY)); } catch (e) { return null; }
}
function saveMine(v) {
  try { localStorage.setItem(MY_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ }
}
function clearMine() {
  try { localStorage.removeItem(MY_KEY); } catch (e) { /* ignore */ }
}

function showMyCoupon(mine) {
  lastShown = mine;
  $('formCard').classList.add('hidden');
  $('wheelCard').classList.add('hidden');
  $('myCard').classList.remove('hidden');
  const first = String(mine.name || '').split(' ')[0];
  $('myHello').textContent = first ? `Welcome back, ${first}!` : 'Welcome back!';
  $('myMobile').textContent = `Mobile: ${'XXXXXX' + String(mine.mobile).slice(-4)}`;
  $('myLabel').textContent = mine.details || mine.label;
  $('myCode').textContent = mine.code || '';
  $('myCodeRow').classList.toggle('hidden', !mine.code);
  $('myNoCode').classList.toggle('hidden', !!mine.code);
  $('myStatus').classList.toggle('hidden', !mine.code);
  $('myStatus').classList.toggle('expired', campaign.ended);
  $('myStatus').textContent = campaign.ended ? '✖ Coupon Expired' : '✔ Coupon Active';
  $('myValid').textContent = mine.code ? validText() : '';
  $('myDate').textContent = mine.won_at ? `Won on: ${new Date(mine.won_at).toLocaleString()}` : '';
}

async function fetchMine(mobile) {
  const { data, error } = await sb.rpc('spin_my_coupon', { p_mobile: mobile });
  if (error) throw error;
  return data; // null = no spin for this number
}

// On page load: show the saved coupon instantly, then confirm it with the server
(async function initReturningUser() {
  const saved = getMine();
  if (!saved?.mobile) return;
  showMyCoupon(saved);
  try {
    const fresh = await fetchMine(saved.mobile);
    if (!fresh) {
      // Admin deleted the entry - the user can play again
      clearMine();
      $('myCard').classList.add('hidden');
      $('formCard').classList.remove('hidden');
      return;
    }
    const mine = { ...saved, ...fresh };
    saveMine(mine);
    showMyCoupon(mine);
  } catch (e) { /* offline: keep showing the saved coupon */ }
})();

// Copy buttons
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const code = $(btn.dataset.copy).textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
  } catch (err) {
    const t = document.createElement('textarea');
    t.value = code; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  const old = btn.textContent;
  btn.textContent = 'Copied ✔';
  setTimeout(() => (btn.textContent = old), 1500);
});

// ---------- Step 1: form ----------
$('mobile').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

$('userForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim();
  const mobile = normalizeMobile($('mobile').value);

  if (!name) return showError('Please enter your name');
  if (mobile.length !== 10) return showError(ERRORS.invalid_mobile);

  const btn = e.submitter || $('userForm').querySelector('button');
  btn.disabled = true;
  showError('');
  try {
    const [, canPlay] = await Promise.all([loadWheel(), sb.rpc('spin_can_play', { p_mobile: mobile })]);
    if (canPlay.error) throw canPlay.error;
    if (!canPlay.data) {
      // Already played - show their coupon instead of an error
      const mine = await fetchMine(mobile);
      if (!mine) return showError(ERRORS.already_played);
      const full = { name, mobile, ...mine };
      saveMine(full);
      return showMyCoupon(full);
    }
    await campaignReady;
    if (campaign.ended) return showError(`This offer ended on ${formatDate(campaign.valid_until)}.`);
    if (segments.length < 2) return showError(ERRORS.no_coupons);
  } catch (err) {
    return showError(errorText(err));
  } finally {
    btn.disabled = false;
  }

  currentUser = { name, mobile };
  $('hello').textContent = `Best of luck, ${name.split(' ')[0]}!`;
  $('formCard').classList.add('hidden');
  $('wheelCard').classList.remove('hidden');
  drawWheel();
  // The canvas can only use Cinzel once the font has loaded
  document.fonts.load('700 29px Cinzel').then(drawWheel).catch(() => {});
});

function showError(msg) { $('formError').textContent = msg; }

// ---------- Step 2: wheel ----------
function drawWheel() {
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const r = size / 2;
  const n = segments.length;
  const arc = (2 * Math.PI) / n;

  const ring = 30;            // navy outer ring
  const inner = r - ring;

  ctx.clearRect(0, 0, size, size);

  // Outer ring
  ctx.beginPath();
  ctx.arc(r, r, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#1b1f4b';
  ctx.fill();

  segments.forEach((c, i) => {
    // Segment 0 starts at the top (12 o'clock) and goes clockwise
    const start = -Math.PI / 2 + i * arc;
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, inner, start, start + arc);
    ctx.closePath();
    ctx.fillStyle = c.color || '#0047ab';
    ctx.fill();
    ctx.strokeStyle = '#c9d6ee';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + arc / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColorFor(c.color);
    const maxW = inner * 0.62;
    const x = inner - 22;
    const offer = String(c.label).trim().match(/^(\d+(?:\.\d+)?\s*%\s*OFF)\s*(.*)$/i);
    if (offer) {
      // Highlight "15% OFF" in a big font; the rest ("Category 1") goes smaller underneath,
      // wrapping onto 2 lines when it is long ("Diamond & Making Cat 1")
      const big = offer[1].toUpperCase().replace(/\s+/g, ' ');
      const small = offer[2];
      const bigSize = fitSize(ctx, big, maxW, n > 8 ? 34 : 44, 20, 700);
      const sm = small ? layoutLabel(ctx, small, maxW, n > 8 ? 20 : 24, 15) : { lines: [], size: 0 };
      const smallLineH = sm.size * 1.1;
      const gap = small ? 6 : 0;
      const total = bigSize + gap + sm.lines.length * smallLineH;
      const bigY = -total / 2 + bigSize / 2;
      ctx.font = `700 ${bigSize}px Cinzel, Georgia, serif`;
      ctx.fillText(big, x, bigY);
      ctx.font = `700 ${sm.size}px Cinzel, Georgia, serif`;
      sm.lines.forEach((line, li) => {
        const y = bigY + bigSize / 2 + gap + smallLineH * (li + 0.5);
        ctx.fillText(fitText(ctx, line, maxW), x, y);
      });
    } else {
      // Other labels wrap onto 2 lines and shrink to fit; truncate with "…" as a last resort
      const { lines, size: fs } = layoutLabel(ctx, c.label, maxW, n > 8 ? 24 : 28, 15);
      ctx.font = `700 ${fs}px Cinzel, Georgia, serif`;
      const lineH = fs * 1.15;
      lines.forEach((line, li) => {
        const y = (li - (lines.length - 1) / 2) * lineH;
        ctx.fillText(fitText(ctx, line, maxW), x, y);
      });
    }
    ctx.restore();
  });

  // Small lights on the ring (at segment edges and centers)
  const dots = n * 2;
  for (let k = 0; k < dots; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / dots;
    ctx.beginPath();
    ctx.arc(r + Math.cos(a) * (r - ring / 2), r + Math.sin(a) * (r - ring / 2), 6, 0, 2 * Math.PI);
    ctx.fillStyle = k % 2 ? '#8fb4ea' : '#ffffff';
    ctx.fill();
  }
}

// Largest font size (between max and min) at which text fits maxW
function fitSize(ctx, text, maxW, maxSize, minSize, weight) {
  let size = maxSize;
  for (; size > minSize; size--) {
    ctx.font = `${weight} ${size}px Cinzel, Georgia, serif`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

// Pick 1 or 2 lines (balanced word split) at the largest font size that fits maxW
function layoutLabel(ctx, text, maxW, maxSize, minSize) {
  const words = String(text).trim().split(/\s+/);
  const width = (s, size) => { ctx.font = `700 ${size}px Cinzel, Georgia, serif`; return ctx.measureText(s).width; };
  for (let size = maxSize; size >= minSize; size--) {
    if (width(text, size) <= maxW) return { lines: [text], size };
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      const w = Math.max(width(a, size), width(b, size));
      if (!best || w < best.w) best = { lines: [a, b], w };
    }
    if (best && best.w <= maxW) return { lines: best.lines, size };
  }
  const fallback = words.length > 1
    ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
    : [text];
  return { lines: fallback, size: minSize };
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

$('spinBtn').addEventListener('click', async () => {
  if (spinning || !currentUser) return;
  spinning = true;
  $('spinBtn').disabled = true;
  $('spinError').textContent = '';

  // The server picks the coupon (using the owner's rules) and saves the entry
  const { name, mobile } = currentUser;
  const { data: coupon, error } = await sb.rpc('spin_play', { p_name: name, p_mobile: mobile });
  if (error) {
    spinning = false;
    $('spinBtn').disabled = false;
    $('spinError').textContent = errorText(error);
    return;
  }
  // Save right away so the coupon still shows if the page is closed mid-spin
  saveMine({ name, mobile, label: coupon.label, details: coupon.details, code: coupon.code, won_at: new Date().toISOString() });

  let index = segments.findIndex(c => c.id === coupon.id);
  if (index === -1) {
    // Admin changed the wheel meanwhile - reload and redraw
    await loadWheel().catch(() => {});
    drawWheel();
    index = Math.max(0, segments.findIndex(c => c.id === coupon.id));
  }
  const segDeg = 360 / segments.length;

  // Stop near the segment center with a small random offset so it looks natural
  const offset = (Math.random() - 0.5) * segDeg * 0.7;
  const targetMod = (360 - ((index + 0.5) * segDeg + offset) + 360) % 360;
  const currentMod = ((rotation % 360) + 360) % 360;
  const delta = 360 * (6 + Math.floor(Math.random() * 3)) + ((targetMod - currentMod + 360) % 360);
  rotation += delta;
  $('wheel').style.transform = `rotate(${rotation}deg)`;

  $('wheel').addEventListener('transitionend', () => showResult(coupon), { once: true });
});

function showResult(coupon) {
  spinning = false;
  $('spinBtn').classList.add('hidden');
  $('result').classList.remove('hidden');
  if (coupon.code) {
    $('resultTitle').textContent = 'Congratulations!';
    $('resultText').textContent = `You won: ${coupon.details || coupon.label}`;
    $('resultCode').textContent = coupon.code;
    $('resultCodeRow').classList.remove('hidden');
    $('resultSaved').classList.remove('hidden');
    $('resultValid').classList.remove('hidden');
  } else {
    $('resultTitle').textContent = coupon.label;
    $('resultText').textContent = 'Better luck next time!';
    $('resultCodeRow').classList.add('hidden');
    $('resultSaved').classList.add('hidden');
    $('resultValid').classList.add('hidden');
  }
}

