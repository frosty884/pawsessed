// Renders the rebuilt flyers in this folder to JPGs for the past-parties strip.
//   node tools/flyers/render.mjs      (from the site folder)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '..', 'assets', 'flyers');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
for (const name of ['waifu4laifu']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 900, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(HERE, name + '.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = path.join(HERE, name + '.png');
  await page.screenshot({ path: png });
  execFileSync('python', ['-c', `from PIL import Image; Image.open(r'${png}').convert('RGB').save(r'${path.join(OUT, name + '.jpg')}', quality=84, optimize=True, progressive=True)`]);
  console.log('wrote', name + '.jpg');
  await page.close();
}
await browser.close();
