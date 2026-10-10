// Pawsessed Lagoon party site: live status, route map, promo viewer, flyers, song requests, raffle, DJ portal.
const CFG = window.PAWSESSED || {};
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const makeStore = (area) => ({
  get(k, d = null) { try { const v = area.getItem('pl:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { area.setItem('pl:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { area.removeItem('pl:' + k); } catch { /* private mode */ } },
});
const store = makeStore(window.localStorage);
const session = makeStore(window.sessionStorage);

// tests point the page at a local mock backend with ?api=http://localhost:PORT/exec, or switch it off with
// ?api=off so they never touch the real sheet; nothing else may override it
function resolveApi() {
  const q = new URLSearchParams(location.search).get('api');
  if (q === 'off') return '';
  if (q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(q)) return q;
  return CFG.apiUrl || '';
}
const API = resolveApi();

const clientId = (() => {
  let id = store.get('client');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    store.set('client', id);
  }
  return id;
})();

// ------------------------------------------------------------------ small helpers
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter((k) => k != null));
  return e;
}

function setMsg(node, text, kind = '') {
  node.textContent = text;
  node.className = 'form-msg' + (kind ? ' ' + kind : '');
}

// ------------------------------------------------------------------ confetti (tiny, no library)
function confetti(n = 90) {
  if (reducedMotion) return;
  const cv = $('#confetti');
  const g = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const colors = ['#ff7ad9', '#ffe014', '#7fe3ff', '#3ee68c', '#ffffff', '#ff3fa4'];
  const parts = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.55,
    vx: (Math.random() - 0.5) * 12, vy: -8 - Math.random() * 10, r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3, s: 5 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const tick = (t) => {
    const age = (t - t0) / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = Math.max(0, 1 - age / 2.2);
      g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
    }
    if (age < 2.2) requestAnimationFrame(tick); else g.clearRect(0, 0, cv.width, cv.height);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ live status ("party's on" / countdown)
const NIGHTS = (CFG.nights || []).map((d) => {
  const start = new Date(`${d}T${CFG.startTime || '20:00'}:00${CFG.utcOffset || '-05:00'}`).getTime();
  return { start, end: start + (CFG.hours || 6) * 3600e3 };
});
const localDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const weekday = (t) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(t);
function duration(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
export function partyStatus(now = Date.now()) {
  for (let i = 0; i < NIGHTS.length; i++) {
    const n = NIGHTS[i];
    if (now >= n.start && now < n.end) {
      const left = n.end - now;
      return { state: 'live', text: `Party's on now! Night ${i + 1} of ${NIGHTS.length} · until 2AM` + (left < 3600e3 ? ` (${duration(left)} left)` : '') };
    }
  }
  const next = NIGHTS.find((n) => now < n.start);
  if (next) {
    const today = localDay(now), day = localDay(next.start);
    const tomorrow = localDay(now + 86400e3);
    const when = day === today ? 'tonight' : day === tomorrow ? 'tomorrow' : weekday(next.start);
    return { state: 'soon', text: `Starts ${when} at 8PM · in ${duration(next.start - now)}` };
  }
  if (!NIGHTS.length) return { state: 'soon', text: 'Fri · Sat · Sun · 8PM–2AM' };
  return { state: 'over', text: "That's a wrap! Thanks for partying with us 💖" };
}
function initStatus() {
  const box = $('#status'), text = $('#status-text');
  const tick = () => {
    const s = partyStatus();
    box.dataset.state = s.state;
    text.textContent = s.text;
  };
  tick();
  setInterval(tick, 30000);
}

// ------------------------------------------------------------------ scroll effects
function initReveal() {
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window) || reducedMotion) { items.forEach((i) => i.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((i) => io.observe(i));
}

function initRoomBar() {
  const bar = $('#roombar'), card = $('.room-card');
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(([e]) => {
    bar.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0);
  }).observe(card);
}

// ------------------------------------------------------------------ map: the walk draws itself, paws pop in behind it
const MAP_DRAW_S = 2.4;
function initMap() {
  const svg = $('#map'), route = $('#route'), paws = $('#paws');
  if (!svg || !route || !route.getTotalLength) return;
  const ns = 'http://www.w3.org/2000/svg';
  const len = route.getTotalLength();
  const step = 34;
  let i = 0;
  for (let d = 28; d < len - 26; d += step, i++) {
    const p = route.getPointAtLength(d);
    const q = route.getPointAtLength(Math.min(len, d + 1));
    const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI + 90;
    const side = i % 2 ? 8 : -8;
    const nx = -(q.y - p.y), ny = q.x - p.x, nl = Math.hypot(nx, ny) || 1;
    // the outer group places the print; the inner one pops in (a CSS transform would replace the placement)
    const at = document.createElementNS(ns, 'g');
    at.setAttribute('transform', `translate(${(p.x + (nx / nl) * side).toFixed(1)} ${(p.y + (ny / nl) * side).toFixed(1)}) rotate(${ang.toFixed(1)}) scale(.8)`);
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'paw');
    g.setAttribute('style', `--d:${((d / len) * MAP_DRAW_S).toFixed(2)}s`);
    g.innerHTML = '<ellipse cx="0" cy="3" rx="7" ry="6"/><circle cx="-7" cy="-5" r="2.8"/><circle cx="-2.5" cy="-8.5" r="2.8"/><circle cx="2.5" cy="-8.5" r="2.8"/><circle cx="7" cy="-5" r="2.8"/>';
    at.append(g);
    paws.append(at);
  }
  const startWisp = (root) => $$('animateMotion', root).forEach((m) => { try { m.beginElement(); } catch { /* no SMIL */ } });

  // tap the map to open a big, pannable copy (labels are small on a phone)
  const card = $('#map-card'), zoom = $('#map-zoom'), scroll = $('#map-zoom-scroll');
  const openZoom = () => {
    const copy = svg.cloneNode(true);
    copy.removeAttribute('id');
    $$('[mask]', copy).forEach((e) => e.removeAttribute('mask'));
    copy.classList.remove('will-draw');
    copy.classList.add('drawn');
    scroll.replaceChildren(copy);
    zoom.hidden = false;
    document.body.style.overflow = 'hidden';
    if (!reducedMotion) startWisp(copy);
    // start on the walk from the hotel to villa D
    requestAnimationFrame(() => {
      // centre on the middle of the walk (map units ~700, 480 in the 280..1000 x 20..1020 window)
      scroll.scrollLeft = scroll.scrollWidth * ((700 - 280) / 720) - scroll.clientWidth / 2;
      scroll.scrollTop = scroll.scrollHeight * ((480 - 20) / 1000) - scroll.clientHeight / 2;
    });
    $('#map-zoom-close').focus();
  };
  const closeZoom = () => { zoom.hidden = true; document.body.style.overflow = ''; card.focus(); };
  card.addEventListener('click', openZoom);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openZoom(); } });
  $('#map-zoom-close').addEventListener('click', closeZoom);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zoom.hidden) closeZoom(); });

  const reveal = () => {
    svg.classList.add('drawn');
    if (!reducedMotion) setTimeout(() => startWisp(svg), MAP_DRAW_S * 1000);
  };
  if (!('IntersectionObserver' in window) || reducedMotion) return reveal();
  svg.classList.add('will-draw');
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { reveal(); io.disconnect(); } }, { threshold: 0.35 });
  io.observe(svg);
}

// ------------------------------------------------------------------ full-screen promo viewer
function initViewer() {
  const viewer = $('#viewer'), video = $('#viewer-video'), close = $('#viewer-close');
  let wake = null, idle = null, opener = null;
  const poke = () => {
    viewer.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => viewer.classList.add('idle'), 2500);
  };
  async function open(e) {
    opener = e && e.currentTarget;
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    video.preload = 'auto';
    video.play().catch(() => {});
    try {
      if (viewer.requestFullscreen) await viewer.requestFullscreen({ navigationUI: 'hide' });
      else if (viewer.webkitRequestFullscreen) viewer.webkitRequestFullscreen();
    } catch { /* overlay already covers the screen */ }
    try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch { /* fine */ }
    close.focus();
    poke();
  }
  function shut() {
    if (viewer.hidden) return;
    viewer.hidden = true;
    document.body.style.overflow = '';
    video.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (wake) { wake.release().catch(() => {}); wake = null; }
    if (opener) opener.focus();
  }
  $('#peek').addEventListener('click', open);
  $$('[data-open-viewer]').forEach((b) => b.addEventListener('click', open));
  close.addEventListener('click', shut);
  viewer.addEventListener('pointerdown', poke);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !viewer.hidden) shut(); });
  window.__viewer = { open, shut };
}

// ------------------------------------------------------------------ share section
function initShare() {
  const video = $('#share-video');
  let shareFile = null;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        video.preload = 'auto';
        if (!reducedMotion) video.play().catch(() => {});
        // grab the clip once so the share sheet can attach it right away (needs a quick tap-to-share)
        if (!shareFile && navigator.canShare) {
          fetch('media/pawsessed-lagoon.mp4').then((r) => r.blob()).then((b) => {
            const f = new File([b], 'pawsessed-lagoon.mp4', { type: 'video/mp4' });
            if (navigator.canShare({ files: [f] })) shareFile = f;
          }).catch(() => {});
        }
      } else {
        video.pause();
      }
    }, { threshold: 0.25 }).observe(video);
  }
  $('#share-btn').addEventListener('click', async () => {
    const url = location.origin + location.pathname;
    const text = "Vortex's AquatiFur party · Room 7416 · Golf Villas D, 4th floor · Fri–Sun 8PM–2AM";
    try {
      if (shareFile) return await navigator.share({ files: [shareFile], title: 'Pawsessed Lagoon', text: `${text}\n${url}` });
      if (navigator.share) return await navigator.share({ title: 'Pawsessed Lagoon · Room 7416', text, url });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    await copyText(url);
    toast('Link copied! Paste it anywhere 💖');
  });
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    await copyText(b.dataset.copy);
    toast('Copied! 📋');
  }));
}

// ------------------------------------------------------------------ flyers + lightbox
function initFlyers() {
  const items = $$('.flyer');
  const box = $('#lightbox'), img = $('#lightbox-img'), cap = $('#lightbox-cap');
  let i = 0, opener = null;
  const show = (n) => {
    i = (n + items.length) % items.length;
    const src = items[i].querySelector('img');
    img.src = src.currentSrc || src.src;
    img.alt = src.alt;
    cap.innerHTML = items[i].querySelector('span').innerHTML;
  };
  const open = (n, from) => { opener = from; show(n); box.hidden = false; document.body.style.overflow = 'hidden'; $('.lb-close', box).focus(); };
  const shut = () => { box.hidden = true; document.body.style.overflow = ''; if (opener) opener.focus(); };
  items.forEach((b, n) => b.addEventListener('click', () => open(n, b)));
  $('.lb-prev', box).addEventListener('click', () => show(i - 1));
  $('.lb-next', box).addEventListener('click', () => show(i + 1));
  $('.lb-close', box).addEventListener('click', shut);
  box.addEventListener('click', (e) => { if (e.target === box) shut(); });
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') shut();
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  });
  let x0 = null;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
}

function initYouTube() {
  const b = $('#yt');
  b.addEventListener('click', () => {
    const f = el('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${b.dataset.id}?autoplay=1&rel=0`,
      title: 'Project Unknown', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: '',
    });
    b.replaceWith(f);
  });
}

// ------------------------------------------------------------------ backend (Google Apps Script web app)
async function call(method, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    // a plain-text POST avoids a CORS preflight, which Apps Script cannot answer
    const res = method === 'GET'
      ? await fetch(`${API}${API.includes('?') ? '&' : '?'}action=state&_=${Date.now()}`, { signal: ctl.signal, cache: 'no-store' })
      : await fetch(API, { method: 'POST', body: JSON.stringify({ client: clientId, ...body }), signal: ctl.signal });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'That took too long. Check your signal and try again.' : "Couldn't reach the request box. Try again in a moment.", network: true };
  } finally {
    clearTimeout(timer);
  }
}

let state = null;
let pollTimer = null, failures = 0;
const djPassword = () => session.get('djpw');

function applyState(s) {
  if (!s || !s.ok) return;
  state = s;
  renderQueue();
  renderSettings();
  renderRaffleState();
}

async function refresh() {
  if (!API) return;
  const s = await call('GET');
  const live = $('#live');
  if (s.ok) {
    failures = 0;
    live.className = 'live on';
    applyState(s);
  } else {
    failures++;
    live.className = 'live err';
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const base = djPassword() ? 8000 : (CFG.pollMs || 15000);
  const wait = base * Math.min(4, 1 + failures);
  pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible') await refresh();
    schedulePoll();
  }, wait);
}

// ------------------------------------------------------------------ song requests
const hearts = new Set(store.get('hearts', []));
const saveHearts = () => store.set('hearts', [...hearts].slice(-200));

function queueItem(item) {
  const li = el('li', { 'data-id': item.id });
  li.append(
    el('span', { class: 'q-n' }),
    el('div', { class: 'q-main' }, el('div', { class: 'q-title' }), el('div', { class: 'q-artist' }), el('div', { class: 'q-by' })),
    el('div', { class: 'q-actions' },
      el('button', { class: 'heart', type: 'button', 'aria-label': 'Heart this request', onclick: () => heart(item.id, li) }),
      el('button', { class: 'dj-act played', type: 'button', 'aria-label': 'Mark played', title: 'Mark played', onclick: () => djAction('djPlayed', item.id, li), text: '✓' }),
      el('button', { class: 'dj-act remove', type: 'button', 'aria-label': 'Remove from queue', title: 'Remove', onclick: () => djAction('djRemove', item.id, li), text: '✕' })),
  );
  return li;
}

function renderQueue() {
  if (!state) return;
  const list = $('#queue');
  const dj = !!djPassword();
  const seen = new Map($$('li', list).map((li) => [li.dataset.id, li]));
  const keep = new Set();
  state.queue.forEach((item, n) => {
    let li = seen.get(item.id);
    if (!li || li.classList.contains('leaving')) { li = queueItem(item); }
    keep.add(item.id);
    $('.q-n', li).textContent = n + 1;
    $('.q-title', li).textContent = item.title;
    $('.q-artist', li).textContent = item.artist;
    $('.q-by', li).textContent = 'asked by ' + item.by;
    const h = $('.heart', li);
    h.textContent = '♥ ' + item.votes;
    h.classList.toggle('mine', hearts.has(item.id));
    $$('.dj-act', li).forEach((b) => { b.hidden = !dj; });
    list.append(li); // keeps queue order
  });
  for (const [id, li] of seen) {
    if (keep.has(id) || li.classList.contains('leaving')) continue;
    li.classList.add('leaving');
    setTimeout(() => li.remove(), 380);
  }
  $('#queue-count').textContent = state.queue.length ? `· ${state.queue.length}` : '';
  $('#queue-empty').hidden = state.queue.length > 0;
  const played = $('#played');
  played.replaceChildren(...state.played.map((p) => el('li', {},
    el('span', { text: `${p.title} · ${p.artist}` }),
    dj ? el('button', { class: 'restore', type: 'button', text: 'undo', onclick: () => djAction('djRestore', p.id) }) : null)));
  $('#played-wrap').hidden = state.played.length === 0;
}

async function heart(id, li) {
  if (hearts.has(id)) return toast('You already hearted this one 💗');
  const btn = $('.heart', li);
  btn.disabled = true;
  const r = await call('POST', { action: 'vote', id });
  btn.disabled = false;
  if (!r.ok) return toast(r.error || 'Could not heart that');
  hearts.add(id); saveHearts();
  applyState(r.state);
}

function initRequests() {
  const form = $('#req-form'), msg = $('#req-msg');
  if (!API) {
    form.hidden = true;
    $('#req-offline').hidden = false;
    $('.queue-card').hidden = true;
    return;
  }
  const by = form.elements.by;
  by.value = store.get('name', '');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { title: form.elements.title.value.trim(), artist: form.elements.artist.value.trim(), by: by.value.trim() };
    if (!data.title || !data.artist || !data.by) {
      setMsg(msg, 'Fill in the title, artist and your name 🙏', 'err');
      (!data.title ? form.elements.title : !data.artist ? form.elements.artist : by).focus();
      return;
    }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    setMsg(msg, 'Sending…');
    const r = await call('POST', { action: 'request', ...data });
    btn.disabled = false;
    if (!r.ok) return setMsg(msg, r.error || 'Something went wrong. Try again!', 'err');
    store.set('name', data.by);
    hearts.add(r.id); saveHearts();
    applyState(r.state);
    const pos = r.state.queue.findIndex((q) => q.id === r.id) + 1;
    setMsg(msg, r.merged ? 'Someone already asked for that one, so we added your ♥ to it!' : `Sent! 🎶 You're #${pos} in the queue.`, 'ok');
    form.elements.title.value = '';
    form.elements.artist.value = '';
    confetti(50);
  });
}

// ------------------------------------------------------------------ settings pushed from the sheet / DJ portal
function renderSettings() {
  const s = state.settings || {};
  const notice = $('#notice');
  notice.hidden = !s.notice;
  notice.textContent = s.notice || '';
  const now = $('#now-spinning');
  now.hidden = !s.nowSpinning;
  $('#now-dj').textContent = s.nowSpinning || '';
  $$('.djs li').forEach((li) => li.classList.toggle('on', !!s.nowSpinning && li.dataset.dj === s.nowSpinning));
  const paused = !s.requestsOpen;
  $('#req-paused').hidden = !paused;
  $$('#req-form input, #req-form button').forEach((i) => { i.disabled = paused; });
  const raffleClosed = !s.raffleOpen;
  $$('#raffle-form input, #raffle-form button').forEach((i) => { i.disabled = raffleClosed; });
  if (raffleClosed) setMsg($('#raffle-msg'), 'Raffle entries are closed.', 'err');
  else if ($('#raffle-msg').textContent === 'Raffle entries are closed.') setMsg($('#raffle-msg'), '');
}

// ------------------------------------------------------------------ raffle
const followed = new Set(store.get('follows', []));
function renderFollows() {
  $$('#follows a').forEach((a) => a.classList.toggle('done', followed.has(a.dataset.follow)));
  const n = followed.size;
  const p = $('#follow-progress');
  p.textContent = n >= 5 ? 'All five followed ✓ you are good to enter!' : `${n} of 5 followed`;
  p.classList.toggle('all', n >= 5);
}

function renderTicket() {
  const t = store.get('ticket');
  const box = $('#ticket');
  if (!t) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(
    el('span', { text: "🎟️ You're in the raffle!" }),
    el('b', { text: '#' + t.ticket }),
    el('span', { text: `${t.handle} on ${t.platform === 'telegram' ? 'Telegram' : 'Instagram'}` }),
  );
}

function renderRaffleState() {
  const r = state.raffle || {};
  $('#raffle-count').textContent = r.entries ? `🎟️ ${r.entries} ${r.entries === 1 ? 'entry' : 'entries'} so far · winner drawn at the party` : 'Be the first to enter!';
  const w = $('#winner');
  if (r.winner && r.winner.handle) {
    w.hidden = false;
    w.textContent = `🎉 Raffle winner: ${r.winner.handle} (${r.winner.platform}). Find Vortex to grab your tee!`;
    const key = r.winner.platform + r.winner.handle;
    if (store.get('winnerSeen') !== key) { store.set('winnerSeen', key); confetti(120); }
  } else {
    w.hidden = true;
  }
}

function initRaffle() {
  $$('#follows a').forEach((a) => a.addEventListener('click', () => {
    followed.add(a.dataset.follow);
    store.set('follows', [...followed]);
    setTimeout(renderFollows, 400);
  }));
  renderFollows();
  renderTicket();
  const form = $('#raffle-form'), msg = $('#raffle-msg');
  if (!API) {
    form.hidden = true;
    $('#raffle-offline').hidden = false;
    $('#raffle-count').textContent = '';
    return;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const handle = form.elements.handle.value.trim();
    const platform = form.elements.platform.value;
    if (!handle) { setMsg(msg, 'Add your @ first', 'err'); form.elements.handle.focus(); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    setMsg(msg, 'Entering…');
    const r = await call('POST', { action: 'raffle', handle, platform, follows: [...followed] });
    btn.disabled = false;
    if (!r.ok) return setMsg(msg, r.error || 'Something went wrong. Try again!', 'err');
    store.set('ticket', { ticket: r.ticket, handle: r.handle, platform: r.platform });
    renderTicket();
    applyState(r.state);
    form.elements.handle.value = '';
    const missing = 5 - followed.size;
    setMsg(msg, r.already ? `You were already in with ticket #${r.ticket} ✓`
      : missing > 0 ? `You're in! Follow the other ${missing} above so your entry counts.` : "You're in! Good luck 🍀", 'ok');
    if (!r.already) confetti(110);
  });
}

// ------------------------------------------------------------------ DJ portal
function setDjMode(on) {
  document.body.classList.toggle('dj', on);
  $('#dj-bar').hidden = !on;
  renderQueue();
  schedulePoll();
}

function fillDjPanel() {
  const s = (state && state.settings) || {};
  const sheet = session.get('sheetUrl');
  $('#dj-sheet').hidden = !sheet;
  if (sheet) $('#dj-sheet').href = sheet;
  $('#dj-open-req').checked = s.requestsOpen !== false;
  $('#dj-open-raffle').checked = s.raffleOpen !== false;
  $('#dj-now').value = s.nowSpinning || '';
  $('#dj-notice').value = s.notice || '';
}

async function djAction(action, id, li) {
  const password = djPassword();
  if (!password) return;
  if (li) li.classList.add('leaving');
  const r = await call('POST', { action, id, password });
  if (!r.ok) {
    if (li) li.classList.remove('leaving');
    if (r.code === 401) { session.del('djpw'); setDjMode(false); }
    return toast(r.error || 'That did not work');
  }
  applyState(r.state);
  toast(action === 'djPlayed' ? 'Marked played ✓' : action === 'djRemove' ? 'Removed from the queue' : 'Back in the queue');
}

function initDj() {
  const modal = $('#dj-modal'), form = $('#dj-form'), panel = $('#dj-panel'), msg = $('#dj-msg'), pmsg = $('#dj-panel-msg');
  let opener = null;
  const open = (e) => {
    opener = e && e.currentTarget;
    modal.hidden = false;
    const logged = !!djPassword();
    form.hidden = logged;
    panel.hidden = !logged;
    if (logged) fillDjPanel();
    setMsg(msg, API ? '' : "The request box isn't connected yet (no Apps Script URL in js/config.js).", API ? '' : 'err');
    setTimeout(() => (logged ? $('#dj-open-req') : form.elements.password).focus(), 50);
  };
  const shut = () => { modal.hidden = true; if (opener) opener.focus(); };
  $('#dj-open').addEventListener('click', open);
  $('#dj-bar-open').addEventListener('click', open);
  $('[data-close]', modal).addEventListener('click', shut);
  modal.addEventListener('click', (e) => { if (e.target === modal) shut(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) shut(); });
  if (new URLSearchParams(location.search).has('dj')) setTimeout(open, 300);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!API) return;
    const password = form.elements.password.value;
    setMsg(msg, 'Checking…');
    const r = await call('POST', { action: 'djLogin', password });
    if (!r.ok) return setMsg(msg, r.error || 'Could not log in', 'err');
    session.set('djpw', password);
    if (r.sheetUrl) session.set('sheetUrl', r.sheetUrl);
    form.elements.password.value = '';
    applyState(r.state);
    setDjMode(true);
    form.hidden = true;
    panel.hidden = false;
    fillDjPanel();
    setMsg(pmsg, "You're in. Remove or mark played right from the queue.", 'ok');
  });
  $('#dj-save').addEventListener('click', async () => {
    setMsg(pmsg, 'Saving…');
    const r = await call('POST', {
      action: 'djSettings', password: djPassword(),
      requestsOpen: $('#dj-open-req').checked, raffleOpen: $('#dj-open-raffle').checked,
      nowSpinning: $('#dj-now').value, notice: $('#dj-notice').value,
    });
    if (!r.ok) return setMsg(pmsg, r.error || 'Could not save', 'err');
    applyState(r.state);
    setMsg(pmsg, 'Saved ✓ The site updates for everyone within a few seconds.', 'ok');
  });
  $('#dj-clear').addEventListener('click', async () => {
    if (!confirm('Clear every request in the queue?')) return;
    const r = await call('POST', { action: 'djClear', password: djPassword() });
    if (!r.ok) return setMsg(pmsg, r.error || 'Could not clear', 'err');
    applyState(r.state);
    setMsg(pmsg, `Cleared ${r.cleared} request${r.cleared === 1 ? '' : 's'}.`, 'ok');
  });
  $('#dj-draw').addEventListener('click', async () => {
    if (!confirm('Draw the raffle winner now? It shows on the site for everyone.')) return;
    setMsg(pmsg, 'Drawing…');
    const r = await call('POST', { action: 'djDraw', password: djPassword() });
    if (!r.ok) return setMsg(pmsg, r.error || 'Could not draw', 'err');
    applyState(r.state);
    setMsg(pmsg, `🎉 Winner: ${r.winner.handle} (${r.winner.platform}, ticket #${r.winner.ticket})`, 'ok');
  });
  $('#dj-hide-winner').addEventListener('click', async () => {
    const r = await call('POST', { action: 'djHideWinner', password: djPassword() });
    if (!r.ok) return setMsg(pmsg, r.error || 'Could not hide it', 'err');
    applyState(r.state);
    setMsg(pmsg, 'Winner banner hidden.', 'ok');
  });
  $('#dj-logout').addEventListener('click', () => {
    session.del('djpw');
    session.del('sheetUrl');
    setDjMode(false);
    form.hidden = false;
    panel.hidden = true;
    setMsg(msg, 'Logged out.');
  });
  if (djPassword()) setDjMode(true);
}

// ------------------------------------------------------------------ boot
function boot() {
  initStatus();
  initReveal();
  initRoomBar();
  initMap();
  initViewer();
  initShare();
  initFlyers();
  initYouTube();
  initRequests();
  initRaffle();
  initDj();
  if (API) {
    $('#live').className = 'live';
    refresh().then(schedulePoll);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  }
  window.__pawsessed = { refresh, partyStatus, get state() { return state; }, api: API };
}
boot();
