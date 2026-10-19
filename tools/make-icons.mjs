// extension/icons/icon.svg から 16/32/48/128px の PNG を生成する（npm run icons）。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'extension', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(dir, `icon${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written to', dir);
