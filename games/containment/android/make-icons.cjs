// Renders the launcher icons into res/ with the pre-installed Playwright Chromium.
//   node games/containment/android/make-icons.cjs
// The motif is the title screen's: a blue cordon closing around a red pathogen,
// on the game's gunmetal chrome.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const RES = path.join(__dirname, 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// Drawn on a 108-unit canvas: the adaptive-icon foreground size, with the
// motif kept inside the central 66-unit safe zone.
function motif() {
  const spikes = Array.from({ length: 10 }, (_, k) => {
    const a = (k / 10) * Math.PI * 2;
    const x1 = 54 + Math.cos(a) * 12, y1 = 54 + Math.sin(a) * 12;
    const x2 = 54 + Math.cos(a) * 17.5, y2 = 54 + Math.sin(a) * 17.5;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d6322b" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="${x2}" cy="${y2}" r="2.4" fill="#d6322b"/>`;
  }).join('');
  return `
    <circle cx="54" cy="54" r="29" fill="none" stroke="#3a9ad9" stroke-width="4.5"/>
    <circle cx="54" cy="54" r="29" fill="none" stroke="#8cc6ee" stroke-width="1" stroke-dasharray="3 5" opacity=".7" transform="rotate(8 54 54)"/>
    ${spikes}
    <circle cx="54" cy="54" r="12" fill="#d6322b"/>
    <circle cx="50" cy="50" r="3.2" fill="#f08c84" opacity=".8"/>`;
}

const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${motif()}</svg>`;
// Legacy icon (Android 7 and earlier): the same motif on a rounded chrome plate.
const legacy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 88 88">
  <rect x="12" y="12" width="84" height="84" rx="18" fill="#10171c" stroke="#43606f" stroke-width="1.5"/>
  ${motif()}</svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (svg, px, file) => {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: true });
  };
  for (const [d, k] of Object.entries(DENSITIES)) {
    await shot(foreground, Math.round(108 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'));
    await shot(legacy, Math.round(48 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher.png'));
  }
  await shot(legacy, 512, path.join(__dirname, 'icon-512.png'));
  await browser.close();
})();
