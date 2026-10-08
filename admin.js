const $ = id => document.getElementById(id);

// Local state (Supabase se load)
let coupons = [];      // [{id, label, code, color, weight, sort}]
let assignments = [];  // [{mobile, coupon_id}]
let settings = { one_spin_per_mobile: true, next_spin_coupon_id: null };
let entries = [];
let deletedCouponIds = [];

// ---------- Login ----------
sb.auth.getSession().then(({ data }) => { if (data.session) openDashboard(); });

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: $('loginEmail').value.trim(),
    password: $('pwd').value
  });
  if (error) return ($('loginError').textContent = 'Email ya password galat hai');
  $('pwd').value = '';
  openDashboard();
});

$('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function openDashboard() {
  const { data: isAdmin } = await sb.rpc('spin_is_admin');
  if (!isAdmin) {
    await sb.auth.signOut();
    $('loginError').textContent = 'Is account ko admin access nahi hai';
    return;
  }
  $('loginCard').classList.add('hidden');
  $('adminCard').classList.remove('hidden');
  await refresh();
}

$('refreshBtn').addEventListener('click', () => refresh().then(() => toast('Refreshed ✔')));

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (isError) t.style.background = 'var(--danger)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isError ? 3500 : 1800);
}

function fail(error) {
  console.error(error);
  toast('Error: ' + (error.message || error), true);
}

async function refresh() {
  const [c, a, s, en] = await Promise.all([
    sb.from('spin_coupons').select('*').order('sort').order('created_at'),
    sb.from('spin_assignments').select('*').order('created_at', { ascending: false }),
    sb.from('spin_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('spin_entries').select('*').order('created_at', { ascending: false }).limit(5000)
  ]);
  const err = c.error || a.error || s.error || en.error;
  if (err) return fail(err);
  coupons = c.data;
  assignments = a.data;
  settings = s.data || settings;
  entries = en.data;
  deletedCouponIds = [];
  renderAll();
}

function renderAll() {
  renderCoupons();
  renderCouponSelects();
  renderAssignments();
  renderEntries();
  $('oneSpin').checked = settings.one_spin_per_mobile;
}

// ---------- Coupons ----------
function renderCoupons() {
  const total = coupons.reduce((s, c) => s + Math.max(0, Number(c.weight) || 0), 0) || 1;
  $('couponRows').innerHTML = coupons.map((c, i) => `
    <tr data-i="${i}">
      <td><input type="color" data-f="color" value="${escapeHtml(c.color)}" /></td>
      <td><input data-f="label" value="${escapeHtml(c.label)}" /></td>
      <td><input data-f="code" value="${escapeHtml(c.code)}" placeholder="(no coupon)" /></td>
      <td><input type="number" min="0" data-f="weight" value="${Number(c.weight) || 0}" />
          <span class="pct">${Math.round((Math.max(0, Number(c.weight) || 0) / total) * 100)}%</span></td>
      <td><button class="small-btn danger" data-del="${i}">✕</button></td>
    </tr>`).join('');
}

function readCouponRows() {
  document.querySelectorAll('#couponRows tr').forEach(tr => {
    const c = coupons[tr.dataset.i];
    tr.querySelectorAll('[data-f]').forEach(inp => {
      c[inp.dataset.f] = inp.dataset.f === 'weight' ? Math.max(0, Math.floor(Number(inp.value) || 0)) : inp.value.trim();
    });
  });
}

$('couponRows').addEventListener('click', e => {
  const i = e.target.dataset.del;
  if (i === undefined) return;
  readCouponRows();
  const removed = coupons.splice(Number(i), 1)[0];
  if (!removed._new) deletedCouponIds.push(removed.id);
  renderCoupons();
});

$('addCoupon').addEventListener('click', () => {
  readCouponRows();
  coupons.push({
    id: crypto.randomUUID(),
    _new: true,
    label: 'New Coupon',
    code: '',
    color: BRAND_COLORS[coupons.length % BRAND_COLORS.length],
    weight: 10
  });
  renderCoupons();
});

$('saveCoupons').addEventListener('click', async () => {
  readCouponRows();
  if (coupons.length < 2) return alert('Kam se kam 2 coupons chahiye');
  if (coupons.some(c => !c.label)) return alert('Har coupon ka label bharo');
  if (deletedCouponIds.length && !confirm(`${deletedCouponIds.length} coupon delete honge (unke assignments bhi hat jayenge). Continue?`)) return;

  const btn = $('saveCoupons');
  btn.disabled = true;
  try {
    if (deletedCouponIds.length) {
      const { error } = await sb.from('spin_coupons').delete().in('id', deletedCouponIds);
      if (error) throw error;
    }
    const rows = coupons.map((c, i) => ({
      id: c.id, label: c.label, code: c.code, color: c.color, weight: c.weight, sort: i + 1
    }));
    const { error } = await sb.from('spin_coupons').upsert(rows);
    if (error) throw error;
    await refresh();
    toast('Coupons saved ✔');
  } catch (err) {
    fail(err);
  } finally {
    btn.disabled = false;
  }
});

function renderCouponSelects() {
  const saved = coupons.filter(c => !c._new);
  const opts = saved.map(c => `<option value="${c.id}">${escapeHtml(c.label)}${c.code ? ' (' + escapeHtml(c.code) + ')' : ''}</option>`).join('');
  $('asgCoupon').innerHTML = opts;
  $('nextSpin').innerHTML = '<option value="">— Off (random by chance) —</option>' + opts;
  $('nextSpin').value = settings.next_spin_coupon_id || '';
}

// ---------- Assignments ----------
$('asgMobile').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });

$('addAssign').addEventListener('click', async () => {
  const m = normalizeMobile($('asgMobile').value);
  if (m.length !== 10) return alert('10 digit mobile number daalo');
  if (!$('asgCoupon').value) return alert('Pehle coupons save karo');
  const { error } = await sb.from('spin_assignments').upsert({ mobile: m, coupon_id: $('asgCoupon').value });
  if (error) return fail(error);
  $('asgMobile').value = '';
  await refresh();
  toast('Assigned ✔');
});

function renderAssignments() {
  const played = new Set(entries.map(en => en.mobile));
  $('assignRows').innerHTML = assignments.length ? assignments.map(a => {
    const c = coupons.find(x => x.id === a.coupon_id);
    return `<tr>
      <td>${escapeHtml(a.mobile)}</td>
      <td>${c ? escapeHtml(c.label) : '<i>deleted</i>'}</td>
      <td><span class="tag">${played.has(a.mobile) ? 'Spin ho gaya' : 'Pending'}</span></td>
      <td><button class="small-btn danger" data-unassign="${escapeHtml(a.mobile)}">Remove</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="pct">Koi assignment nahi</td></tr>';
}

$('assignRows').addEventListener('click', async e => {
  const m = e.target.dataset.unassign;
  if (!m) return;
  const { error } = await sb.from('spin_assignments').delete().eq('mobile', m);
  if (error) return fail(error);
  await refresh();
});

// ---------- Next spin ----------
$('saveNext').addEventListener('click', async () => {
  const id = $('nextSpin').value || null;
  const { error } = await sb.from('spin_settings').update({ next_spin_coupon_id: id }).eq('id', 1);
  if (error) return fail(error);
  settings.next_spin_coupon_id = id;
  toast(id ? 'Agla spin set ✔' : 'Off ✔');
});

// ---------- Settings ----------
$('saveSettings').addEventListener('click', async () => {
  const p = $('newPwd').value;
  if (p && p.length < 8) return alert('Password kam se kam 8 characters ka rakho');

  const { error } = await sb.from('spin_settings').update({ one_spin_per_mobile: $('oneSpin').checked }).eq('id', 1);
  if (error) return fail(error);
  settings.one_spin_per_mobile = $('oneSpin').checked;

  if (p) {
    const { error: pErr } = await sb.auth.updateUser({ password: p });
    if (pErr) return fail(pErr);
    $('newPwd').value = '';
  }
  toast('Settings saved ✔');
});

// ---------- Entries ----------
const reasonText = { assigned: 'Assigned', 'next-spin': 'Next-spin', weighted: 'Random' };

function renderEntries() {
  $('entryCount').textContent = entries.length;
  $('entryRows').innerHTML = entries.length ? entries.map(en => `
    <tr>
      <td>${new Date(en.created_at).toLocaleString()}</td>
      <td>${escapeHtml(en.name)}</td>
      <td>${escapeHtml(en.mobile)}</td>
      <td>${escapeHtml(en.email)}</td>
      <td>${escapeHtml(en.city)}</td>
      <td>${escapeHtml(en.coupon_label)}</td>
      <td>${escapeHtml(en.coupon_code)}</td>
      <td><span class="tag">${escapeHtml(reasonText[en.reason] || en.reason)}</span></td>
    </tr>`).join('') : '<tr><td colspan="8" class="pct">Abhi koi entry nahi</td></tr>';
}

$('exportCsv').addEventListener('click', () => {
  const head = ['Time', 'Name', 'Mobile', 'Email', 'City', 'Coupon', 'Code', 'How'];
  // Excel formula injection se bachne ke liye =,+,-,@ se shuru hone wali values ke aage '
  const esc = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [head, ...entries.map(en => [
    new Date(en.created_at).toLocaleString(), en.name, en.mobile, en.email, en.city,
    en.coupon_label, en.coupon_code, reasonText[en.reason] || en.reason
  ])].map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = 'spin-wheel-entries.csv';
  a.click();
});

$('clearEntries').addEventListener('click', async () => {
  if (!confirm('Saari entries hamesha ke liye delete ho jayengi. Pehle CSV download kar lo. Pakka delete karna hai?')) return;
  const { error } = await sb.from('spin_entries').delete().gt('id', 0);
  if (error) return fail(error);
  await refresh();
  toast('Entries cleared');
});
