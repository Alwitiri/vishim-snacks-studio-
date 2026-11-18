/* Vishim Snack Studio — admin panel */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BUILT_IN_IMAGES = ['momos', 'noodles', 'soup', 'hero-momos', 'storefront', 'coffee-sketch'].map((n) => `/assets/img/${n}.webp`);
  const VIEWS = { dashboard: 'Dashboard', menu: 'Menu', reviews: 'Reviews', categories: 'Highlights', settings: 'Store details', account: 'Account' };

  let db = null;
  let reviewStatus = 'pending';
  let editingItem = null;
  let editingReview = null;
  let catDraft = [];

  /* ---------------------------------------------------------------- api */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/api/auth')) { showAuth(true); throw new Error('Session expired — please log in again'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'err' ? ' err' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  function confirmBox(text, okLabel = 'Delete') {
    const d = $('#confirmDialog');
    $('#confirmText').textContent = text;
    d.querySelector('[value=yes]').textContent = okLabel;
    d.showModal();
    return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
  }

  /* ---------------------------------------------------------------- auth */
  let setupMode = false;
  function showAuth(configured) {
    setupMode = !configured;
    $('#app').hidden = true;
    $('#auth').hidden = false;
    $('#authTitle').textContent = setupMode ? 'Set up admin' : 'Welcome back';
    $('#authHint').textContent = setupMode ? 'Create a password for the admin panel (at least 8 characters). Keep it safe!' : 'Log in to manage your menu, reviews and store details.';
    $('#confirmWrap').hidden = !setupMode;
    $('#authConfirm').required = setupMode;
    $('#authPassword').autocomplete = setupMode ? 'new-password' : 'current-password';
    $('#authBtn').textContent = setupMode ? 'Create password' : 'Log in';
    $('#authErr').textContent = '';
    setTimeout(() => $('#authPassword').focus(), 50);
  }

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#authPassword').value;
    const err = $('#authErr');
    err.textContent = '';
    if (setupMode && pw !== $('#authConfirm').value) { err.textContent = 'Passwords do not match'; return; }
    const btn = $('#authBtn'); btn.disabled = true;
    try {
      await api(setupMode ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: { password: pw } });
      e.target.reset();
      await boot();
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    db = null;
    showAuth(true);
  });

  /* ---------------------------------------------------------------- routing */
  // Mobile tab bar mirrors the sidebar nav
  $('#tabbar').innerHTML = $('#sideNav').innerHTML.replace(/<span>Highlights<\/span>/, '<span>Photos</span>');

  function route() {
    if (!db) return;
    let view = (location.hash || '#dashboard').slice(1);
    if (!VIEWS[view]) view = 'dashboard';
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
    $$('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    $('#viewTitle').textContent = VIEWS[view];
    document.title = `${VIEWS[view]} · Admin · Vishim Snack Studio`;
    render(view);
    scrollTo(0, 0);
  }
  addEventListener('hashchange', route);

  function render(view) {
    ({ dashboard: renderDashboard, menu: renderMenu, reviews: renderReviews, categories: renderCats, settings: renderSettings, account: () => {} })[view]();
    updateBadge();
  }

  function updateBadge() {
    const n = db.reviews.filter((r) => r.status === 'pending').length;
    $$('#pendingBadge, .tabbar .badge').forEach((b) => { b.hidden = !n; b.textContent = n; });
  }

  /* ---------------------------------------------------------------- dashboard */
  function renderDashboard() {
    const available = db.menu.filter((m) => m.available).length;
    const cats = new Set(db.menu.map((m) => m.category)).size;
    const approved = db.reviews.filter((r) => r.status === 'approved');
    const pending = db.reviews.filter((r) => r.status === 'pending');
    const avg = approved.length ? (approved.reduce((s, r) => s + r.rating, 0) / approved.length).toFixed(1) : '–';
    const stats = [
      [db.menu.length, `Menu items · ${available} available`],
      [cats, 'Categories'],
      [avg + (approved.length ? ' ★' : ''), `Avg rating · ${approved.length} reviews`],
      [pending.length, 'Reviews to approve', pending.length ? 'warn' : ''],
    ];
    $('#stats').innerHTML = stats.map(([n, l, c], i) => `<div class="stat ${c || ''}" style="--i:${i}"><span class="num">${esc(n)}</span><span class="lbl">${esc(l)}</span></div>`).join('');

    const closed = !!db.settings.temporarilyClosed;
    $('#quickOpen').checked = !closed;
    $('#statusText').textContent = closed ? 'Temporarily closed' : 'Open';
    $('#statusText').className = closed ? 'closed' : 'open';
    $('#statusHours').textContent = db.settings.hoursText || '';

    $('#dashPending').innerHTML = pending.length
      ? pending.slice(0, 3).map((r) => `
        <div class="row" style="padding:10px;box-shadow:none">
          <div class="row-main"><h3>${esc(r.name)} <span class="stars">${'★'.repeat(r.rating)}</span></h3><p>${esc(r.text)}</p></div>
          <div class="row-actions"><button class="btn sm primary" data-approve="${r.id}">Approve</button></div>
        </div>`).join('')
      : '<p class="muted small">All caught up — no reviews waiting. 🎉</p>';
  }

  $('#quickOpen').addEventListener('change', async (e) => {
    try {
      db.settings = await api('/api/admin/settings', { method: 'PUT', body: { temporarilyClosed: !e.target.checked } });
      toast(e.target.checked ? 'Store marked open' : 'Store marked temporarily closed');
      renderDashboard();
    } catch (ex) { toast(ex.message, 'err'); e.target.checked = !e.target.checked; }
  });

  document.addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-approve]');
    if (ap) await setReviewStatus(ap.dataset.approve, 'approved');
    const act = e.target.closest('[data-action]');
    if (act?.dataset.action === 'add-item') openItem();
    if (act?.dataset.action === 'add-review') openReview();
  });

  /* ---------------------------------------------------------------- menu */
  function menuCategories() { return [...new Set(db.menu.map((m) => m.category))]; }

  function renderMenu() {
    const sel = $('#menuFilter');
    const current = sel.value || 'All';
    sel.innerHTML = ['All', ...menuCategories()].map((c) => `<option ${c === current ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const q = $('#menuSearch').value.trim().toLowerCase();
    const items = db.menu
      .filter((m) => (sel.value === 'All' || m.category === sel.value) && (!q || (m.name + ' ' + m.description).toLowerCase().includes(q)))
      .sort((a, b) => a.order - b.order);
    $('#menuList').innerHTML = items.length ? items.map((m, i) => `
      <div class="row ${m.available ? '' : 'off'}" style="--i:${i}">
        ${m.image ? `<img class="thumb round" src="${esc(m.image)}" alt="">` : '<span class="thumb round"></span>'}
        <div class="row-main">
          <h3><span class="veg ${m.veg ? '' : 'non'}"></span>${esc(m.name)}</h3>
          <div class="row-meta"><span class="price">₹${esc(m.price)}</span><span class="chip">${esc(m.category)}</span>${m.popular ? '<span class="chip gold">Popular</span>' : ''}${m.available ? '' : '<span class="chip red">Sold out</span>'}</div>
        </div>
        <div class="row-actions">
          <label class="switch" title="Available"><input type="checkbox" data-avail="${m.id}" ${m.available ? 'checked' : ''} aria-label="Available"><span></span></label>
          <button class="icon-btn" data-edit="${m.id}" aria-label="Edit ${esc(m.name)}">✎</button>
          <button class="icon-btn danger" data-del="${m.id}" aria-label="Delete ${esc(m.name)}">🗑</button>
        </div>
      </div>`).join('') : '<div class="empty"><b>🥟</b>No dishes found.</div>';
  }
  $('#menuSearch').addEventListener('input', renderMenu);
  $('#menuFilter').addEventListener('change', renderMenu);

  $('#menuList').addEventListener('change', async (e) => {
    const id = e.target.dataset.avail;
    if (!id) return;
    try {
      const updated = await api('/api/admin/menu/' + id, { method: 'PUT', body: { available: e.target.checked } });
      Object.assign(db.menu.find((m) => m.id === id), updated);
      toast(updated.available ? `${updated.name} is available` : `${updated.name} marked sold out`);
      renderMenu();
    } catch (ex) { toast(ex.message, 'err'); }
  });
  $('#menuList').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return openItem(db.menu.find((m) => m.id === ed.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del) {
      const item = db.menu.find((m) => m.id === del.dataset.del);
      if (!(await confirmBox(`Delete “${item.name}” from the menu?`))) return;
      try {
        await api('/api/admin/menu/' + item.id, { method: 'DELETE' });
        db.menu = db.menu.filter((m) => m.id !== item.id);
        toast('Item deleted');
        renderMenu();
      } catch (ex) { toast(ex.message, 'err'); }
    }
  });

  function galleryImages() {
    const used = [...db.menu.map((m) => m.image), ...db.categories.map((c) => c.image)].filter(Boolean);
    return [...new Set([...BUILT_IN_IMAGES, ...used])];
  }
  function setPreview(el, url) {
    el.style.backgroundImage = url ? `url("${url}")` : '';
    el.textContent = url ? '' : 'No photo';
  }

  function openItem(item = null) {
    editingItem = item;
    const f = $('#itemForm');
    f.reset();
    $('#itemTitle').textContent = item ? 'Edit item' : 'Add item';
    const v = item || { name: '', category: $('#menuFilter').value !== 'All' && $('#menuFilter').value ? $('#menuFilter').value : 'Momos', price: '', description: '', veg: true, available: true, popular: false, image: '', order: db.menu.length + 1 };
    f.name.value = v.name; f.category.value = v.category; f.price.value = v.price; f.description.value = v.description;
    f.veg.checked = v.veg; f.available.checked = v.available; f.popular.checked = v.popular; f.order.value = v.order; f.image.value = v.image;
    setPreview($('#itemPreview'), v.image);
    $('#catList').innerHTML = menuCategories().map((c) => `<option value="${esc(c)}">`).join('');
    $('#itemGallery').innerHTML = '<option value="">Or pick an existing photo…</option>' + galleryImages().map((u) => `<option value="${esc(u)}">${esc(u.split('/').pop())}</option>`).join('') + '<option value="__none">No photo</option>';
    $('#itemDialog').showModal();
  }
  $('#itemGallery').addEventListener('change', (e) => {
    const v = e.target.value === '__none' ? '' : e.target.value;
    if (e.target.value) { $('#itemForm').image.value = v; setPreview($('#itemPreview'), v); }
  });
  $('#itemFile').addEventListener('change', async (e) => {
    const url = await uploadFile(e.target.files[0]);
    e.target.value = '';
    if (url) { $('#itemForm').image.value = url; setPreview($('#itemPreview'), url); }
  });

  $('#itemForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    const body = {
      name: f.name.value, category: f.category.value, price: Number(f.price.value), description: f.description.value,
      veg: f.veg.checked, available: f.available.checked, popular: f.popular.checked, order: Number(f.order.value) || 0, image: f.image.value,
    };
    const btn = $('#itemSave'); btn.disabled = true;
    try {
      if (editingItem) {
        const updated = await api('/api/admin/menu/' + editingItem.id, { method: 'PUT', body });
        Object.assign(editingItem, updated);
        toast('Item updated');
      } else {
        db.menu.push(await api('/api/admin/menu', { method: 'POST', body }));
        toast('Item added');
      }
      $('#itemDialog').close();
      render(currentView());
    } catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; }
  });

  /* ---------------------------------------------------------------- reviews */
  function renderReviews() {
    const counts = { pending: 0, approved: 0, hidden: 0 };
    db.reviews.forEach((r) => counts[r.status]++);
    $$('#reviewSeg button').forEach((b) => {
      b.setAttribute('aria-selected', b.dataset.status === reviewStatus);
      b.innerHTML = `${b.dataset.status[0].toUpperCase() + b.dataset.status.slice(1)}<span class="count">${counts[b.dataset.status]}</span>`;
    });
    const list = db.reviews.filter((r) => r.status === reviewStatus).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    $('#reviewList').innerHTML = list.length ? list.map((r, i) => `
      <div class="row" style="--i:${i}">
        ${r.avatar ? `<img class="thumb round" src="${esc(r.avatar)}" alt="">` : `<span class="thumb round initial">${esc((r.name || '?')[0].toUpperCase())}</span>`}
        <div class="row-main">
          <h3>${esc(r.name)} <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span></h3>
          <p>${esc(r.text)}</p>
          <div class="row-meta muted">${r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
        </div>
        <div class="row-actions">
          ${r.status !== 'approved' ? `<button class="btn sm primary" data-rstatus="approved" data-id="${r.id}">Approve</button>` : ''}
          ${r.status !== 'hidden' ? `<button class="btn sm" data-rstatus="hidden" data-id="${r.id}">Hide</button>` : ''}
          <button class="icon-btn" data-redit="${r.id}" aria-label="Edit review">✎</button>
          <button class="icon-btn danger" data-rdel="${r.id}" aria-label="Delete review">🗑</button>
        </div>
      </div>`).join('') : `<div class="empty"><b>${reviewStatus === 'pending' ? '🎉' : '💬'}</b>No ${reviewStatus} reviews.</div>`;
  }
  $('#reviewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { reviewStatus = b.dataset.status; renderReviews(); }
  });
  async function setReviewStatus(id, status) {
    try {
      const updated = await api('/api/admin/reviews/' + id, { method: 'PUT', body: { status } });
      Object.assign(db.reviews.find((r) => r.id === id), updated);
      toast(status === 'approved' ? 'Review is now live on the website' : 'Review hidden');
      render(currentView());
    } catch (ex) { toast(ex.message, 'err'); }
  }
  $('#reviewList').addEventListener('click', async (e) => {
    const s = e.target.closest('[data-rstatus]');
    if (s) return setReviewStatus(s.dataset.id, s.dataset.rstatus);
    const ed = e.target.closest('[data-redit]');
    if (ed) return openReview(db.reviews.find((r) => r.id === ed.dataset.redit));
    const del = e.target.closest('[data-rdel]');
    if (del) {
      if (!(await confirmBox('Delete this review permanently?'))) return;
      try {
        await api('/api/admin/reviews/' + del.dataset.rdel, { method: 'DELETE' });
        db.reviews = db.reviews.filter((r) => r.id !== del.dataset.rdel);
        toast('Review deleted');
        renderReviews(); updateBadge();
      } catch (ex) { toast(ex.message, 'err'); }
    }
  });

  function openReview(r = null) {
    editingReview = r;
    const f = $('#reviewForm');
    f.reset();
    $('#reviewTitle').textContent = r ? 'Edit review' : 'Add review';
    const v = r || { name: '', rating: 5, status: 'approved', text: '', avatar: '' };
    f.name.value = v.name; f.rating.value = v.rating; f.status.value = v.status; f.text.value = v.text; f.avatar.value = v.avatar;
    setPreview($('#reviewPreview'), v.avatar);
    $('#reviewDialog').showModal();
  }
  $('#reviewFile').addEventListener('change', async (e) => {
    const url = await uploadFile(e.target.files[0], 300);
    e.target.value = '';
    if (url) { $('#reviewForm').avatar.value = url; setPreview($('#reviewPreview'), url); }
  });
  $('#reviewNoPhoto').addEventListener('click', () => { $('#reviewForm').avatar.value = ''; setPreview($('#reviewPreview'), ''); });
  $('#reviewForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    const body = { name: f.name.value, rating: Number(f.rating.value), status: f.status.value, text: f.text.value, avatar: f.avatar.value };
    try {
      if (editingReview) {
        Object.assign(editingReview, await api('/api/admin/reviews/' + editingReview.id, { method: 'PUT', body }));
        toast('Review updated');
      } else {
        db.reviews.push(await api('/api/admin/reviews', { method: 'POST', body }));
        toast('Review added');
      }
      reviewStatus = body.status;
      $('#reviewDialog').close();
      render(currentView());
    } catch (ex) { toast(ex.message, 'err'); }
  });

  /* ---------------------------------------------------------------- highlights */
  function renderCats(fromDb = true) {
    if (fromDb) catDraft = db.categories.map((c) => ({ ...c }));
    $('#catEdit').innerHTML = catDraft.map((c, i) => `
      <div class="cat-card" data-i="${i}">
        <div class="img-preview" style="background-image:url('${esc(c.image)}')">${c.image ? '' : 'No photo'}</div>
        <label>Name<input data-field="name" value="${esc(c.name)}" maxlength="40"></label>
        <select data-field="image" aria-label="Photo">
          ${galleryImages().map((u) => `<option value="${esc(u)}" ${u === c.image ? 'selected' : ''}>${esc(u.split('/').pop())}</option>`).join('')}
        </select>
        <div class="cat-actions">
          <label class="btn sm">Upload<input type="file" accept="image/*" data-upload hidden></label>
          <span>
            <button class="icon-btn" data-move="-1" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>←</button>
            <button class="icon-btn" data-move="1" aria-label="Move right" ${i === catDraft.length - 1 ? 'disabled' : ''}>→</button>
            <button class="icon-btn danger" data-remove aria-label="Remove">🗑</button>
          </span>
        </div>
      </div>`).join('') || '<div class="empty">No highlights. Add one!</div>';
    $('#addCat').disabled = catDraft.length >= 6;
  }
  $('#catEdit').addEventListener('input', (e) => {
    const card = e.target.closest('.cat-card');
    const field = e.target.dataset.field;
    if (!card || !field) return;
    catDraft[card.dataset.i][field] = e.target.value;
    if (field === 'image') renderCats(false);
  });
  $('#catEdit').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-upload]')) return;
    const i = e.target.closest('.cat-card').dataset.i;
    const url = await uploadFile(e.target.files[0]);
    if (url) { catDraft[i].image = url; renderCats(false); }
  });
  $('#catEdit').addEventListener('click', (e) => {
    const card = e.target.closest('.cat-card');
    if (!card) return;
    const i = Number(card.dataset.i);
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const j = i + Number(mv.dataset.move);
      [catDraft[i], catDraft[j]] = [catDraft[j], catDraft[i]];
      renderCats(false);
    }
    if (e.target.closest('[data-remove]')) { catDraft.splice(i, 1); renderCats(false); }
  });
  $('#addCat').addEventListener('click', () => {
    catDraft.push({ id: '', name: 'New', image: BUILT_IN_IMAGES[0] });
    renderCats(false);
  });
  $('#saveCats').addEventListener('click', async () => {
    try {
      db.categories = await api('/api/admin/categories', { method: 'PUT', body: { categories: catDraft } });
      toast('Highlights saved');
      renderCats();
    } catch (ex) { toast(ex.message, 'err'); }
  });

  /* ---------------------------------------------------------------- settings */
  function renderSettings() {
    const f = $('#settingsForm');
    for (const el of f.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = !!db.settings[el.name];
      else el.value = db.settings[el.name] ?? '';
    }
  }
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    const body = {};
    for (const el of f.elements) if (el.name) body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    try {
      db.settings = await api('/api/admin/settings', { method: 'PUT', body });
      toast('Store details saved');
    } catch (ex) { toast(ex.message, 'err'); }
  });

  /* ---------------------------------------------------------------- account */
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.confirm.value) return toast('New passwords do not match', 'err');
    try {
      await api('/api/admin/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      toast('Password updated');
    } catch (ex) { toast(ex.message, 'err'); }
  });

  /* ---------------------------------------------------------------- uploads */
  // Resize in the browser so uploads stay small and fast on mobile data
  async function uploadFile(file, max = 900) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file', 'err'); return null; }
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      let dataUrl = c.toDataURL('image/webp', 0.85);
      if (!dataUrl.startsWith('data:image/webp')) dataUrl = c.toDataURL('image/jpeg', 0.85);
      toast('Uploading photo…');
      const { url } = await api('/api/admin/upload', { method: 'POST', body: { dataUrl } });
      return url;
    } catch (ex) { toast(ex.message || 'Upload failed', 'err'); return null; }
  }

  /* ---------------------------------------------------------------- boot */
  const currentView = () => { const v = (location.hash || '#dashboard').slice(1); return VIEWS[v] ? v : 'dashboard'; };

  async function boot() {
    const status = await api('/api/auth/status');
    if (status.setupDisabled) {
      showAuth(true);
      $('#authHint').textContent = 'The admin password is not set yet. Add an ADMIN_PASSWORD environment variable on your hosting dashboard, then reload.';
      $('#authBtn').disabled = true;
      return;
    }
    if (!status.loggedIn) return showAuth(status.configured);
    // When login is turned off on the server, hide the log-out button and password page
    $('#logoutBtn').hidden = status.loginRequired === false;
    $$('[data-view="account"]').forEach((el) => (el.hidden = status.loginRequired === false));
    db = await api('/api/admin/data');
    $('#auth').hidden = true;
    $('#app').hidden = false;
    route();
  }
  boot().catch((e) => toast(e.message, 'err'));
})();
