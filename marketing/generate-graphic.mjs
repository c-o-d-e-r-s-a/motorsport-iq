import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'social-media-lead-graphic.html');
const pngPath = path.join(__dirname, 'Social-Media-Lead-Motorsport-IQ.png');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
await page.screenshot({ path: pngPath, type: 'png' });
await browser.close();
console.log(`PNG saved to: ${pngPath}`);
