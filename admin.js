const $ = id => document.getElementById(id);

// Local state (loaded from Supabase)
let coupons = [];      // [{id, label, code, color, weight, sort}]
let assignments = [];  // [{mobile, coupon_id}]
let settings = { one_spin_per_mobile: true, next_spin_coupon_id: null };
let entries = [];

// ---------- Login ----------
sb.auth.getSession().then(({ data }) => { if (data.session) openDashboard(); });

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: $('loginEmail').value.trim(),
    password: $('pwd').value
  });
  if (error) return ($('loginError').textContent = 'Incorrect email or password');
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
    $('loginError').textContent = 'This account does not have admin access';
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
  renderAll();
}

function renderAll() {
  renderCoupons();
  renderCouponSelects();
  renderAssignments();
  renderEntries();
  $('oneSpin').checked = settings.one_spin_per_mobile;
  $('validUntil').value = settings.valid_until || '';
}

// ---------- Coupons (grouped by category, with Edit / Delete) ----------
let editingId = null; // null = adding a new coupon

const offerText = c => c.details || c.label;
const categoryOf = c => (c.category || '').trim() || 'Uncategorized';

function renderCoupons() {
  const total = coupons.reduce((s, c) => s + Math.max(0, Number(c.weight) || 0), 0) || 1;
  const groups = new Map();
  coupons.forEach(c => {
    const key = categoryOf(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  $('couponList').innerHTML = keys.length ? keys.map(key => `
    <div class="cat-group">
      <div class="cat-title"><span>${escapeHtml(key)}</span><span class="pct">${groups.get(key).length} coupon${groups.get(key).length > 1 ? 's' : ''}</span></div>
      ${groups.get(key).map(c => `
        <div class="coupon-item">
          <span class="swatch" style="background:${escapeHtml(c.color)}"></span>
          <div class="ci-main">
            <div class="ci-offer">${escapeHtml(offerText(c))}</div>
            <div class="ci-meta">
              <span class="tag">Wheel: ${escapeHtml(c.label)}</span>
              <span class="tag">${c.code ? 'Code: ' + escapeHtml(c.code) : 'No code'}</span>
              <span class="tag">Chance: ${Math.round((Math.max(0, Number(c.weight) || 0) / total) * 100)}%</span>
            </div>
          </div>
          <div class="ci-actions">
            <button class="small-btn ghost" data-edit="${c.id}">Edit</button>
            <button class="small-btn danger" data-delete="${c.id}">Delete</button>
          </div>
        </div>`).join('')}
    </div>`).join('') : '<div class="empty">No coupons yet. Click "+ Add Coupon".</div>';

  const cats = [...new Set(coupons.map(c => (c.category || '').trim()).filter(Boolean))];
  $('categoryOptions').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function openCouponDialog(coupon) {
  editingId = coupon ? coupon.id : null;
  $('couponDialogTitle').textContent = coupon ? 'Edit Coupon' : 'Add Coupon';
  $('cfCategory').value = coupon?.category || '';
  $('cfDetails').value = coupon?.details || coupon?.label || '';
  $('cfLabel').value = coupon?.label || '';
  $('cfCode').value = coupon?.code || '';
  $('cfWeight').value = coupon ? Number(coupon.weight) || 0 : 10;
  $('cfColor').value = coupon?.color || BRAND_COLORS[coupons.length % BRAND_COLORS.length];
  $('couponFormError').textContent = '';
  $('couponDialog').showModal();
  $('cfDetails').focus();
}

$('addCoupon').addEventListener('click', () => openCouponDialog(null));
$('cancelCoupon').addEventListener('click', () => $('couponDialog').close());

$('couponList').addEventListener('click', async e => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  if (editId) return openCouponDialog(coupons.find(c => c.id === editId));
  if (!deleteId) return;

  const c = coupons.find(x => x.id === deleteId);
  if (coupons.length <= 2) return alert('The wheel needs at least 2 coupons. Add another coupon before deleting this one.');
  const linked = assignments.filter(a => a.coupon_id === deleteId).length;
  const msg = `Delete "${offerText(c)}"?` + (linked ? `\n\n${linked} user assignment(s) for this coupon will also be removed.` : '');
  if (!confirm(msg)) return;
  const { error } = await sb.from('spin_coupons').delete().eq('id', deleteId);
  if (error) return fail(error);
  await refresh();
  toast('Coupon deleted');
});

$('couponForm').addEventListener('submit', async e => {
  e.preventDefault();
  const row = {
    category: $('cfCategory').value.trim(),
    details: $('cfDetails').value.trim(),
    label: $('cfLabel').value.trim(),
    code: $('cfCode').value.trim(),
    weight: Math.max(0, Math.floor(Number($('cfWeight').value) || 0)),
    color: $('cfColor').value
  };
  if (!row.details) return ($('couponFormError').textContent = 'Please enter the offer');
  if (!row.label) return ($('couponFormError').textContent = 'Please enter a short wheel label');

  $('saveCoupon').disabled = true;
  const query = editingId
    ? sb.from('spin_coupons').update(row).eq('id', editingId)
    : sb.from('spin_coupons').insert({ ...row, sort: Math.max(0, ...coupons.map(c => c.sort || 0)) + 1 });
  const { error } = await query;
  $('saveCoupon').disabled = false;
  if (error) return ($('couponFormError').textContent = 'Error: ' + error.message);

  $('couponDialog').close();
  await refresh();
  toast(editingId ? 'Coupon updated ✔' : 'Coupon added ✔');
});

function renderCouponSelects() {
  const opts = coupons.map(c => `<option value="${c.id}">${escapeHtml(offerText(c))}${c.code ? ' (' + escapeHtml(c.code) + ')' : ''}</option>`).join('');
  $('asgCoupon').innerHTML = opts;
  $('nextSpin').innerHTML = '<option value="">— Off (random by chance) —</option>' + opts;
  $('nextSpin').value = settings.next_spin_coupon_id || '';
}

// ---------- Assignments ----------
$('asgMobile').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });

$('addAssign').addEventListener('click', async () => {
  const m = normalizeMobile($('asgMobile').value);
  if (m.length !== 10) return alert('Please enter a valid 10-digit mobile number');
  if (!$('asgCoupon').value) return alert('Please add a coupon first');
  const { error } = await sb.from('spin_assignments').upsert({ mobile: m, coupon_id: $('asgCoupon').value });
  if (error) return fail(error);
  $('asgMobile').value = '';
  $('addAssign').textContent = 'Assign';
  await refresh();
  toast('Assignment saved ✔');
});

function renderAssignments() {
  const played = new Set(entries.map(en => en.mobile));
  $('assignRows').innerHTML = assignments.length ? assignments.map(a => {
    const c = coupons.find(x => x.id === a.coupon_id);
    return `<tr>
      <td>${escapeHtml(a.mobile)}</td>
      <td>${c ? escapeHtml(offerText(c)) : '<i>deleted</i>'}</td>
      <td><span class="tag">${played.has(a.mobile) ? 'Spun' : 'Pending'}</span></td>
      <td style="white-space:nowrap">
        <button class="small-btn ghost" data-asg-edit="${escapeHtml(a.mobile)}">Edit</button>
        <button class="small-btn danger" data-unassign="${escapeHtml(a.mobile)}">Delete</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="pct">No assignments yet</td></tr>';
}

$('assignRows').addEventListener('click', async e => {
  const editMobile = e.target.dataset.asgEdit;
  if (editMobile) {
    const a = assignments.find(x => x.mobile === editMobile);
    $('asgMobile').value = a.mobile;
    $('asgCoupon').value = a.coupon_id;
    $('addAssign').textContent = 'Update';
    $('asgCoupon').focus();
    return;
  }
  const m = e.target.dataset.unassign;
  if (!m) return;
  if (!confirm(`Delete the assignment for ${m}?`)) return;
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
  toast(id ? 'Next spin set ✔' : 'Off ✔');
});

// ---------- Settings ----------
$('saveSettings').addEventListener('click', async () => {
  const p = $('newPwd').value;
  if (p && p.length < 8) return alert('Password must be at least 8 characters');

  const validUntil = $('validUntil').value || null;
  const { error } = await sb.from('spin_settings').update({ one_spin_per_mobile: $('oneSpin').checked, valid_until: validUntil }).eq('id', 1);
  if (error) return fail(error);
  settings.one_spin_per_mobile = $('oneSpin').checked;
  settings.valid_until = validUntil;

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
      <td>${escapeHtml(en.coupon_details || en.coupon_label)}</td>
      <td>${escapeHtml(en.coupon_code)}</td>
      <td><span class="tag">${escapeHtml(reasonText[en.reason] || en.reason)}</span></td>
    </tr>`).join('') : '<tr><td colspan="6" class="pct">No entries yet</td></tr>';
}

$('exportCsv').addEventListener('click', () => {
  const head = ['Time', 'Name', 'Mobile', 'Coupon', 'Code', 'How'];
  // Prefix values starting with =, +, -, @ with ' to prevent Excel formula injection
  const esc = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [head, ...entries.map(en => [
    new Date(en.created_at).toLocaleString(), en.name, en.mobile,
    en.coupon_details || en.coupon_label, en.coupon_code, reasonText[en.reason] || en.reason
  ])].map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = 'spin-wheel-entries.csv';
  a.click();
});

$('clearEntries').addEventListener('click', async () => {
  if (!confirm('All entries will be permanently deleted. Download the CSV first. Are you sure?')) return;
  const { error } = await sb.from('spin_entries').delete().gt('id', 0);
  if (error) return fail(error);
  await refresh();
  toast('Entries cleared');
});
