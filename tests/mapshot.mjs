// Screenshots of just the map (phone size, after the walk has drawn) for design passes.
//   node tests/mapshot.mjs [name]   -> tests/shots/map-<name>.png and map-<name>-zoom.png
import puppeteer from 'puppeteer-core';
import { startServer } from './serve.mjs';
const name = process.argv[2] || 'v';
const { server, port } = await startServer(0);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto(`http://localhost:${port}/?api=off`, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.evaluate(() => document.querySelector('#map').scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 3600));
await (await p.$('#map-card')).screenshot({ path: `tests/shots/map-${name}.png` });
await p.evaluate(() => document.querySelector('#map-card').click());
await new Promise((r) => setTimeout(r, 1200));
await p.screenshot({ path: `tests/shots/map-${name}-zoom.png` });
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
server.close();
