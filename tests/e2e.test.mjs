// Browser tests: real Chrome against the site + the real Code.gs running on an in-memory sheet.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { startServer } from './serve.mjs';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser, srv, base, api;
const errors = [];

test.before(async () => {
  srv = await startServer(0);
  base = `http://localhost:${srv.port}/`;
  api = `http://localhost:${srv.port}/api/exec`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => {
  await browser.close();
  srv.server.close();
});

async function open({ width = 390, height = 844, live = true, query = '' } = {}) {
  // each page is its own "device": separate storage, separate client id
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/i\.ytimg\.com|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const q = [live ? `api=${api}` : '', query].filter(Boolean).join('&');
  await page.goto(base + (q ? '?' + q : ''), { waitUntil: 'domcontentloaded' });
  if (live) await page.waitForFunction(() => window.__pawsessed && window.__pawsessed.state, { timeout: 10000 });
  return page;
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (page, sel) => page.$eval(sel, (e) => !e.hidden && !!(e.offsetWidth || e.offsetHeight));
const refresh = (page) => page.evaluate(() => window.__pawsessed.refresh());

test('room number and building are on screen as soon as the page loads (no scrolling, no JS needed)', async () => {
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setViewport({ width: 360, height: 740, isMobile: true });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const box = await page.$eval('#room-num', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, text: e.textContent }; });
  assert.equal(box.text, '7416');
  assert.ok(box.bottom < 740, `room number is above the fold (bottom at ${box.bottom}px)`);
  assert.match(await text(page, '.room-where'), /Building D.*4th floor/);
  await page.close();
});

test('no sideways scrolling on a small phone, and no console errors', async () => {
  for (const width of [320, 360, 390, 1280]) {
    const page = await open({ width, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${width}px wide page scrolls sideways by ${overflow}px`);
    await page.close();
  }
  assert.deepEqual(errors, []);
});

test('party status: countdown, live, between nights, wrap-up (Wisconsin time)', async () => {
  const page = await open({ live: false });
  const at = (iso) => page.evaluate((t) => window.__pawsessed.partyStatus(new Date(t).getTime()), iso);
  let s = await at('2026-10-09T17:30:00-05:00');
  assert.equal(s.state, 'soon'); assert.match(s.text, /tonight at 8PM · in 2h 30m/);
  s = await at('2026-10-09T23:15:00-05:00');
  assert.equal(s.state, 'live'); assert.match(s.text, /Night 1 of 3/);
  s = await at('2026-10-10T01:30:00-05:00');
  assert.equal(s.state, 'live'); assert.match(s.text, /30m left/);
  s = await at('2026-10-10T11:00:00-05:00');
  assert.equal(s.state, 'soon'); assert.match(s.text, /tonight/);
  s = await at('2026-10-10T03:00:00-05:00');
  assert.equal(s.state, 'soon'); assert.match(s.text, /tonight at 8PM · in 17h/);
  s = await at('2026-10-11T21:00:00-05:00');
  assert.match(s.text, /Night 3 of 3/);
  s = await at('2026-10-12T02:30:00-05:00');
  assert.equal(s.state, 'over');
  await page.close();
});

test('without a backend, requests and raffle say they open soon and nothing is sent', async () => {
  const page = await open({ live: false });
  assert.equal(await visible(page, '#req-offline'), true);
  assert.equal(await visible(page, '#raffle-offline'), true);
  assert.equal(await page.$eval('#req-form', (f) => f.hidden), true);
  await page.close();
});

test('song request: send, see it in the queue, duplicate becomes a heart', async () => {
  const page = await open();
  await page.type('#req-form [name=title]', 'Sandstorm');
  await page.type('#req-form [name=artist]', 'Darude');
  await page.type('#req-form [name=by]', 'Nico');
  await page.click('#req-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#req-msg').textContent.includes('in the queue'));
  assert.match(await text(page, '#req-msg'), /#1 in the queue/);
  assert.equal(await page.$$eval('#queue li', (l) => l.length), 1);
  assert.match(await text(page, '#queue li'), /Sandstorm.*Darude.*asked by Nico/s);
  assert.equal(await page.$eval('#req-form [name=by]', (i) => i.value), 'Nico', 'name is remembered');
  // empty fields are caught before sending
  await page.click('#req-form button[type=submit]');
  assert.match(await text(page, '#req-msg'), /Fill in/);
  // a second device asks for the same song
  const other = await open();
  await other.type('#req-form [name=title]', 'sandstorm');
  await other.type('#req-form [name=artist]', 'DARUDE');
  await other.type('#req-form [name=by]', 'Sam');
  await other.click('#req-form button[type=submit]');
  await other.waitForFunction(() => document.querySelector('#req-msg').textContent.includes('♥'));
  assert.match(await text(other, '#queue li .heart'), /♥ 2/);
  await other.close();
  await page.close();
});

test('hearts: a third device can heart a request once', async () => {
  const page = await open();
  await page.waitForSelector('#queue li .heart');
  await page.click('#queue li .heart');
  await page.waitForFunction(() => /♥ 3/.test(document.querySelector('#queue li .heart').textContent));
  await page.click('#queue li .heart');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('already'));
  await page.close();
});

test('ticking Played in the Google Sheet takes the song off the site', async () => {
  srv.gas.call.post({ action: 'request', title: 'Gasoline', artist: 'The Weeknd', by: 'Leo', client: 'client-gggg-0001' });
  const page = await open();
  await page.waitForFunction(() => [...document.querySelectorAll('#queue .q-title')].some((e) => e.textContent === 'Gasoline'));
  const sheet = srv.gas.sheet('Requests');
  const rowIndex = sheet.cells.findIndex((r) => r && r[2] === 'Gasoline');
  sheet.set(rowIndex + 1, 7, true); // the DJ ticks the Played checkbox
  srv.gas.ctx.onEdit();
  await refresh(page);
  await page.waitForFunction(() => ![...document.querySelectorAll('#queue li:not(.leaving) .q-title')].some((e) => e.textContent === 'Gasoline'));
  assert.equal(await visible(page, '#played-wrap'), true);
  assert.match(await text(page, '#played'), /Gasoline/);
  await page.close();
});

test('DJ portal: wrong password fails, "vortex" works, remove and mark played', async () => {
  srv.gas.call.post({ action: 'request', title: 'Remove Me', artist: 'X', by: 'Y', client: 'client-hhhh-0001' });
  srv.gas.call.post({ action: 'request', title: 'Play Me', artist: 'X', by: 'Y', client: 'client-hhhh-0002' });
  const page = await open();
  await page.waitForFunction(() => document.querySelectorAll('#queue li').length >= 2);
  assert.equal(await page.$$eval('#queue .dj-act', (b) => b.filter((x) => !x.hidden).length), 0, 'guests do not see DJ buttons');
  await page.click('#dj-open');
  await page.type('#dj-form [name=password]', 'wrong');
  await page.click('#dj-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#dj-msg').textContent.includes('Wrong password'));
  await page.$eval('#dj-form [name=password]', (i) => { i.value = ''; });
  await page.type('#dj-form [name=password]', 'vortex');
  await page.click('#dj-form button[type=submit]');
  await page.waitForSelector('#dj-panel:not([hidden])');
  assert.equal(await visible(page, '#dj-bar'), true);
  await page.click('#dj-modal [data-close]');
  const clickFor = async (title, cls) => page.evaluate((t, c) => {
    const li = [...document.querySelectorAll('#queue li')].find((l) => l.querySelector('.q-title').textContent === t);
    li.querySelector('.dj-act.' + c).click();
  }, title, cls);
  await clickFor('Remove Me', 'remove');
  await page.waitForFunction(() => ![...document.querySelectorAll('#queue li:not(.leaving) .q-title')].some((e) => e.textContent === 'Remove Me'));
  await clickFor('Play Me', 'played');
  await page.waitForFunction(() => document.querySelector('#played').textContent.includes('Play Me'));
  const rows = srv.gas.sheet('Requests').rows();
  assert.equal(rows.find((r) => r[2] === 'Remove Me')[7], true, 'Removed ticked in the sheet');
  assert.equal(rows.find((r) => r[2] === 'Play Me')[6], true, 'Played ticked in the sheet');
  // undo from the played list
  await page.evaluate(() => [...document.querySelectorAll('#played li')].find((l) => l.textContent.includes('Play Me')).querySelector('.restore').click());
  await page.waitForFunction(() => [...document.querySelectorAll('#queue .q-title')].some((e) => e.textContent === 'Play Me'));
  await page.close();
});

test('DJ settings: announcement, now spinning, pausing requests', async () => {
  const page = await open();
  await page.evaluate(() => sessionStorage.setItem('pl:djpw', JSON.stringify('vortex')));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__pawsessed && window.__pawsessed.state);
  await page.click('#dj-bar-open');
  await page.waitForSelector('#dj-panel:not([hidden])');
  await new Promise((r) => setTimeout(r, 150)); // the portal moves focus to its first control after opening
  await page.select('#dj-now', 'Bunitsi');
  await page.click('#dj-notice');
  await page.type('#dj-notice', "Pizza's here! 🍕");
  await page.$eval('#dj-open-req', (c) => { c.checked = false; });
  await page.click('#dj-save');
  await page.waitForFunction(() => document.querySelector('#dj-panel-msg').textContent.includes('Saved'));
  const guest = await open();
  assert.match(await text(guest, '#notice'), /Pizza's here/);
  assert.match(await text(guest, '#now-dj'), /Bunitsi/);
  assert.equal(await guest.$eval('.djs li[data-dj="Bunitsi"]', (l) => l.classList.contains('on')), true);
  assert.equal(await visible(guest, '#req-paused'), true);
  assert.equal(await guest.$eval('#req-form button[type=submit]', (b) => b.disabled), true);
  // reopen for the next tests
  await page.$eval('#dj-open-req', (c) => { c.checked = true; });
  await page.$eval('#dj-notice', (i) => { i.value = ''; });
  await page.click('#dj-save');
  await page.waitForFunction(() => document.querySelector('#dj-panel-msg').textContent.includes('Saved'));
  await guest.close();
  await page.close();
});

test('raffle: follow taps are tracked, entry gets a ticket, the winner shows up', async () => {
  const page = await open();
  await page.evaluate(() => {
    document.addEventListener('click', (e) => { if (e.target.closest('#follows a')) e.preventDefault(); }, true);
    document.querySelectorAll('#follows a').forEach((a) => a.click());
  });
  await page.waitForFunction(() => document.querySelector('#follow-progress').textContent.includes('All five'));
  await page.type('#raffle-form [name=handle]', '@nico.imouto');
  await page.click('#raffle-form button[type=submit]');
  await page.waitForSelector('#ticket:not([hidden])');
  assert.match(await text(page, '#ticket'), /#1.*@nico\.imouto on Instagram/s);
  assert.match(await text(page, '#raffle-count'), /1 entry/);
  const row = srv.gas.sheet('Raffle').rows()[0];
  assert.equal(row[3], '@nico.imouto');
  assert.equal(row[5].split(', ').length, 5, 'all five follows recorded');
  // telegram entry with a bad username is rejected with a friendly message
  await page.click('#raffle-form input[value=telegram]');
  await page.type('#raffle-form [name=handle]', 'abc');
  await page.click('#raffle-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#raffle-msg').textContent.includes('Telegram username'));
  srv.gas.ctx.drawRaffleWinner();
  await refresh(page);
  await page.waitForSelector('#winner:not([hidden])');
  assert.match(await text(page, '#winner'), /@nico\.imouto/);
  await page.close();
});

test('promo loop opens full screen and closes with Escape', async () => {
  const page = await open();
  await page.click('#peek');
  await page.waitForSelector('#viewer:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#viewer', { hidden: true });
  await page.close();
});

test('flyer lightbox opens, steps through flyers and closes', async () => {
  const page = await open({ width: 1280, height: 900 });
  await page.$eval('.flyer[data-i="0"]', (b) => b.click());
  await page.waitForSelector('#lightbox:not([hidden])');
  assert.match(await text(page, '#lightbox-cap'), /Pawsessed Lagoon/);
  await page.keyboard.press('ArrowRight');
  assert.match(await text(page, '#lightbox-cap'), /Vortex/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#lightbox', { hidden: true });
  await page.close();
});

test('every local asset the page references exists', async () => {
  const page = await open({ live: false });
  const urls = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('[src],[href],[poster]').forEach((e) => {
      for (const a of ['src', 'href', 'poster']) {
        const v = e.getAttribute(a);
        if (v && !/^(https?:|#|mailto:|data:)/.test(v)) out.add(new URL(v, location.href).href);
      }
    });
    return [...out];
  });
  for (const u of urls) {
    const status = await page.evaluate(async (x) => (await fetch(x, { method: 'HEAD' })).status, u);
    assert.equal(status, 200, u);
  }
  await page.close();
});

test('DJ portal can draw the raffle winner and shows the Google Sheet link', async () => {
  srv.gas.call.post({ action: 'raffle', handle: 'portal_pick', platform: 'telegram', client: 'client-pppp-0001' });
  const page = await open();
  await page.click('#dj-open');
  await page.type('#dj-form [name=password]', 'vortex');
  await page.click('#dj-form button[type=submit]');
  await page.waitForSelector('#dj-panel:not([hidden])');
  assert.match(await page.$eval('#dj-sheet', (a) => a.href), /docs\.google\.com\/spreadsheets/);
  assert.equal(await visible(page, '#dj-sheet'), true);
  page.on('dialog', (d) => d.accept());
  await page.click('#dj-draw');
  await page.waitForFunction(() => document.querySelector('#dj-panel-msg').textContent.includes('Winner'));
  await page.waitForSelector('#winner:not([hidden])');
  await page.click('#dj-hide-winner');
  await page.waitForSelector('#winner', { hidden: true });
  await page.close();
});
