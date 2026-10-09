// Screenshots of the page at phone and desktop sizes for a visual check.
//   node tests/shots.mjs            -> tests/shots/*.png
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { server, port } = await startServer(0);
const base = `http://localhost:${port}/`;
const api = `http://localhost:${port}/api/exec`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
const errors = [];
async function shoot(name, { width, height, mobile, query = '' }) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(base + query, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, `${name}-top.png`) });
  await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
  await page.close();
}
await shoot('phone', { width: 390, height: 844, mobile: true, query: `?api=${api}` });
await shoot('phone-offline', { width: 390, height: 844, mobile: true });
await shoot('desktop', { width: 1280, height: 900, query: `?api=${api}` });
await browser.close();
server.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
