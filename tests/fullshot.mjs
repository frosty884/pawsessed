// Full-page phone screenshots with every scroll-reveal triggered and the map drawn, split into parts.
//   node tests/fullshot.mjs [name] [width]   -> tests/shots/<name>-part<N>.png
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { startServer } from './serve.mjs';
const name = process.argv[2] || 'full';
const width = Number(process.argv[3] || 390);
const { server, port, gas } = await startServer(0);
// a little life in the queue and raffle for the review
gas.call.post({ action: 'request', title: 'Sandstorm', artist: 'Darude', by: 'Nico', client: 'client-aaaa-0001' });
gas.call.post({ action: 'request', title: 'Gasoline', artist: 'The Weeknd', by: 'Leo', client: 'client-bbbb-0002' });
gas.call.post({ action: 'raffle', handle: 'someone_cool', platform: 'instagram', client: 'client-cccc-0003' });
gas.call.post({ action: 'djSettings', password: 'vortex', nowSpinning: 'Bunitsi' });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
await p.goto(`http://localhost:${port}/?api=http://localhost:${port}/api/exec`, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
// walk down the page so every reveal fires, then let the map finish drawing
const h = await p.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < h; y += 500) { await p.evaluate((y) => window.scrollTo(0, y), y); await new Promise((r) => setTimeout(r, 120)); }
await new Promise((r) => setTimeout(r, 2800));
await p.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 400));
const file = `tests/shots/${name}-full.png`;
await p.screenshot({ path: file, fullPage: true });
await b.close();
server.close();
execFileSync('python', ['-c', `
from PIL import Image
im = Image.open(r'${file}')
n = (im.height + 1599) // 1600
for i in range(n):
    im.crop((0, i * 1600, im.width, min(im.height, (i + 1) * 1600))).save(r'tests/shots/${name}-part%d.png' % i)
print(im.size, n, 'parts')
`], { stdio: 'inherit' });
console.log(errs.length ? errs.join('\n') : 'no console errors');
