/* Vishim Snack Studio — public site behaviour */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  $('#year').textContent = new Date().getFullYear();

  /* ---------------- header: scroll state, mobile nav, active link ---------------- */
  const header = $('.site-header');
  const toTop = $('#toTop');
  const onScroll = () => {
    const y = scrollY;
    header.classList.toggle('scrolled', y > 30);
    toTop.classList.toggle('show', y > 700);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  const burger = $('#burger');
  const nav = $('#nav');
  const setNav = (open) => {
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open);
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  burger.addEventListener('click', () => setNav(!nav.classList.contains('open')));
  $$('a', nav).forEach((a) => a.addEventListener('click', () => setNav(false)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setNav(false));
  document.addEventListener('click', (e) => { if (!header.contains(e.target)) setNav(false); });

  const sections = ['menu', 'about', 'reviews', 'find-us'].map((id) => document.getElementById(id));
  const navLinks = $$('a', nav);
  const spy = () => {
    let current = '#top';
    for (const s of sections) if (s && s.getBoundingClientRect().top < innerHeight * 0.4) current = '#' + s.id;
    if (innerHeight + scrollY >= document.body.scrollHeight - 4) current = '#find-us';
    navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === current));
  };
  addEventListener('scroll', spy, { passive: true });

  /* ---------------- reveal on scroll ---------------- */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }) : null;
  const observe = (els) => els.forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
  observe($$('.reveal'));

  /* ---------------- hero parallax (desktop only) ---------------- */
  const heroImg = $('.hero-media');
  if (!reduceMotion && heroImg && matchMedia('(min-width: 901px)').matches) {
    addEventListener('scroll', () => {
      const y = Math.min(scrollY, 600);
      heroImg.style.transform = `translateY(${y * 0.18}px)`;
    }, { passive: true });
  }

  /* ---------------- data ---------------- */
  let data = null;
  let activeCat = 'All';

  const phoneHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');

  function applySettings(s) {
    const set = (cls, val) => val != null && $$('.js-' + cls).forEach((el) => { el.textContent = val; });
    ['heroTitle', 'heroScript', 'heroSubtitle', 'phone', 'addressShort', 'addressLine2', 'addressFull', 'priceRange', 'hoursText', 'aboutText', 'aboutScript', 'footerMotto'].forEach((k) => set(k, s[k]));
    set('name', s.name);
    if (s.phone) $$('.js-phone-link').forEach((a) => (a.href = phoneHref(s.phone)));
    if (s.mapsUrl && /^https:\/\//.test(s.mapsUrl)) $$('.js-maps').forEach((a) => (a.href = s.mapsUrl));
    const notice = $('#notice');
    if (s.temporarilyClosed) {
      notice.hidden = false; notice.classList.add('closed');
      notice.textContent = s.noticeText || 'We are closed right now — see you soon!';
    } else if (s.noticeText) {
      notice.hidden = false; notice.classList.remove('closed'); notice.textContent = s.noticeText;
    } else notice.hidden = true;
  }

  function renderCategories(cats) {
    if (!cats || !cats.length) return;
    const grid = $('#catGrid');
    grid.innerHTML = cats.map((c, i) => `
      <a class="cat reveal" href="#menu" data-cat="${esc(c.name)}" style="--d:${i * 0.12}s">
        <span class="cat-ring"><img src="${esc(c.image || '/assets/img/momos.webp')}" alt="${esc(c.name)}" loading="lazy"></span>
        <span class="brush">${esc(c.name)}</span>
      </a>`).join('');
    grid.style.gridTemplateColumns = `repeat(${Math.min(cats.length, 3)}, minmax(0, 1fr))`;
    observe($$('.reveal', grid));
  }

  function renderTabs() {
    const cats = ['All', ...new Set(data.menu.map((m) => m.category))];
    $('#menuTabs').innerHTML = cats.map((c) =>
      `<button type="button" role="tab" aria-selected="${c === activeCat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  }

  function renderMenu() {
    const items = data.menu.filter((m) => activeCat === 'All' || m.category === activeCat);
    const grid = $('#menuGrid');
    if (!items.length) { grid.innerHTML = '<p class="muted">Nothing here right now — check back soon!</p>'; return; }
    grid.innerHTML = items.map((m, i) => `
      <article class="dish" style="--i:${i}">
        <div class="dish-img">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : ''}</div>
        <div class="dish-body">
          <div class="dish-top">
            <span class="veg-dot ${m.veg ? '' : 'nonveg'}" title="${m.veg ? 'Veg' : 'Non-veg'}"></span>
            <h3>${esc(m.name)}</h3><span class="dots"></span><span class="price">₹${esc(m.price)}</span>
          </div>
          ${m.description ? `<p>${esc(m.description)}</p>` : ''}
          ${m.popular ? '<span class="tag">★ Popular</span>' : ''}
        </div>
      </article>`).join('');
  }

  function selectCat(cat) {
    activeCat = cat;
    $$('#menuTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.cat === cat));
    renderMenu();
  }
  $('#menuTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) selectCat(b.dataset.cat);
  });
  // clicking a category bubble jumps to the menu filtered by it
  $('#catGrid').addEventListener('click', (e) => {
    const a = e.target.closest('.cat');
    if (a && data && data.menu.some((m) => m.category === a.dataset.cat)) selectCat(a.dataset.cat);
  });

  function stars(n) {
    return Array.from({ length: 5 }, (_, i) => `<span style="--s:${i}" class="${i < n ? '' : 'off'}">★</span>`).join('');
  }
  function renderReviews() {
    const track = $('#reviewTrack');
    const list = data.reviews;
    track.innerHTML = list.map((r, i) => `
      <article class="review reveal" style="--d:${(i % 3) * 0.12}s">
        ${r.avatar ? `<img class="avatar" src="${esc(r.avatar)}" alt="" loading="lazy">` : `<span class="avatar initial" aria-hidden="true">${esc((r.name || '?').trim()[0].toUpperCase())}</span>`}
        <div>
          <h3>${esc(r.name)}</h3>
          <div class="stars" aria-label="${r.rating} out of 5 stars">${stars(r.rating)}</div>
          <p>“${esc(r.text)}”</p>
        </div>
      </article>`).join('') || '<p class="muted">Be the first to leave a review!</p>';
    track.classList.add('collapsed');
    const toggle = $('#toggleReviews');
    toggle.hidden = list.length <= 3;
    toggle.innerHTML = 'View All Reviews <span class="arrow">→</span>';
    observe($$('.reveal', track));
    // mobile dots
    const dots = $('#reviewDots');
    dots.innerHTML = list.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('');
  }
  $('#toggleReviews').addEventListener('click', (e) => {
    const track = $('#reviewTrack');
    const collapsed = track.classList.toggle('collapsed');
    e.currentTarget.innerHTML = collapsed ? 'View All Reviews <span class="arrow">→</span>' : 'Show Less <span class="arrow">↑</span>';
    if (!collapsed) observe($$('.review:not(.in)', track));
  });
  $('#reviewTrack').addEventListener('scroll', (e) => {
    const t = e.currentTarget;
    const cards = $$('.review', t);
    if (!cards.length) return;
    const idx = Math.round(t.scrollLeft / (cards[0].offsetWidth + 14));
    $$('#reviewDots span').forEach((d, i) => d.classList.toggle('on', i === idx));
  }, { passive: true });

  /* ---------------- review form ---------------- */
  const form = $('#reviewForm');
  $('#openReviewForm').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) { form.querySelector('input[name=name]').focus({ preventScroll: true }); form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#reviewMsg');
    const btn = form.querySelector('button[type=submit]');
    const body = Object.fromEntries(new FormData(form));
    btn.disabled = true; msg.className = 'form-msg'; msg.textContent = 'Sending…';
    try {
      const res = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not send your review');
      form.reset();
      msg.className = 'form-msg ok';
      msg.textContent = 'Thank you! Your review will appear once it is approved. 🥟';
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = err.message;
    } finally { btn.disabled = false; }
  });

  /* ---------------- load ---------------- */
  fetch('/api/public')
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then((d) => {
      data = d;
      applySettings(d.settings || {});
      renderCategories(d.categories);
      renderTabs();
      renderMenu();
      renderReviews();
    })
    .catch(() => {
      $('#menuGrid').innerHTML = '<p class="muted">The menu could not be loaded. Please call us to order!</p>';
    });
})();
