const $ = id => document.getElementById(id);

let segments = [];   // [{id, label, color}] - coupon codes server par hi rehte hain
let currentUser = null;
let rotation = 0;
let spinning = false;

const ERRORS = {
  already_played: 'Is mobile number se pehle hi spin ho chuka hai',
  invalid_mobile: '10 digit ka sahi mobile number daalo',
  invalid_name: 'Naam sahi se bharo',
  no_coupons: 'Wheel abhi setup nahi hai (admin se contact karo)'
};
function errorText(err) {
  const key = Object.keys(ERRORS).find(k => String(err?.message || '').includes(k));
  return key ? ERRORS[key] : 'Network problem, dobara try karo';
}

async function loadWheel() {
  const { data, error } = await sb.rpc('spin_get_wheel');
  if (error) throw error;
  segments = data || [];
}

// ---------- Step 1: form ----------
$('mobile').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

$('userForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim();
  const mobile = normalizeMobile($('mobile').value);
  const email = $('email').value.trim();
  const city = $('city').value.trim();

  if (!name) return showError('Naam bharna zaroori hai');
  if (mobile.length !== 10) return showError('10 digit ka sahi mobile number daalo');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return showError('Email sahi nahi hai');

  const btn = e.submitter || $('userForm').querySelector('button');
  btn.disabled = true;
  showError('');
  try {
    const [, canPlay] = await Promise.all([loadWheel(), sb.rpc('spin_can_play', { p_mobile: mobile })]);
    if (canPlay.error) throw canPlay.error;
    if (segments.length < 2) return showError(ERRORS.no_coupons);
    if (!canPlay.data) return showError(ERRORS.already_played);
  } catch (err) {
    return showError(errorText(err));
  } finally {
    btn.disabled = false;
  }

  currentUser = { name, mobile, email, city };
  $('hello').textContent = `Best of luck, ${name.split(' ')[0]}!`;
  $('formCard').classList.add('hidden');
  $('wheelCard').classList.remove('hidden');
  drawWheel();
  // Canvas par Cinzel tabhi dikhega jab font load ho jaye
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
    // Segment 0 top (12 baje) se clockwise shuru hota hai
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
    // Lamba label ho to pehle font chhota karo, phir bhi na aaye to "…"
    const maxW = inner * 0.66;
    let fs = n > 8 ? 24 : 29;
    do { ctx.font = `700 ${fs}px Cinzel, Georgia, serif`; } while (ctx.measureText(c.label).width > maxW && --fs > 18);
    ctx.fillText(fitText(ctx, c.label, maxW), inner - 22, 0);
    ctx.restore();
  });

  // Ring par chhoti white lights (segment boundaries + beech me)
  const dots = n * 2;
  for (let k = 0; k < dots; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / dots;
    ctx.beginPath();
    ctx.arc(r + Math.cos(a) * (r - ring / 2), r + Math.sin(a) * (r - ring / 2), 6, 0, 2 * Math.PI);
    ctx.fillStyle = k % 2 ? '#8fb4ea' : '#ffffff';
    ctx.fill();
  }
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

  // Coupon server decide karta hai (owner ke rules ke hisaab se) aur entry wahi save hoti hai
  const { name, mobile, email, city } = currentUser;
  const { data: coupon, error } = await sb.rpc('spin_play', {
    p_name: name, p_mobile: mobile, p_email: email || null, p_city: city || null
  });
  if (error) {
    spinning = false;
    $('spinBtn').disabled = false;
    $('spinError').textContent = errorText(error);
    return;
  }

  let index = segments.findIndex(c => c.id === coupon.id);
  if (index === -1) {
    // Admin ne beech me wheel badla - latest wheel load karke redraw
    await loadWheel().catch(() => {});
    drawWheel();
    index = Math.max(0, segments.findIndex(c => c.id === coupon.id));
  }
  const segDeg = 360 / segments.length;

  // Segment ke center ke aas-paas (thoda random offset) taaki natural lage
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
  $('newUserBtn').classList.remove('hidden');
  if (coupon.code) {
    $('resultTitle').textContent = 'Congratulations!';
    $('resultText').textContent = `Aapko mila: ${coupon.label}`;
    $('resultCode').textContent = coupon.code;
    $('resultCode').classList.remove('hidden');
  } else {
    $('resultTitle').textContent = coupon.label;
    $('resultText').textContent = 'Agli baar zaroor milega!';
    $('resultCode').classList.add('hidden');
  }
}

$('newUserBtn').addEventListener('click', () => location.reload());
