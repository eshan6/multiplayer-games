/**
 * Turn `dist/` into what the published page needs.
 *
 *     npm run build && node tools/pack_for_page.mjs
 *
 * Writes `dist-page/`:
 *
 *   page.html      the page body: title, font link, styles inline, markup,
 *                  and one module script. No <html>, <head> or <body> — the
 *                  host wraps the page in its own.
 *   assets/        everything the script loads, published beside the page
 *   files.json     the list of those files, for the publish call
 *
 * Two things differ from a plain static build, both because of where the page
 * is hosted:
 *
 * - **Models go out as base64 text.** The host serves a fixed set of file
 *   types and .glb is not among them. Each `x.glb` becomes `x.glb.txt`, and
 *   the script's references are rewritten to match; `bytes()` in
 *   src/assets.ts decodes them.
 * - **The stylesheet is inlined.** Only the page's own markup may carry CSS.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'dist';
const OUT = 'dist-page';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });

const files = [];
let bytesOut = 0;
for (const name of readdirSync(join(SRC, 'assets')).sort()) {
  const from = join(SRC, 'assets', name);
  if (name.endsWith('.css')) continue;
  let to = name;
  if (name.endsWith('.glb')) {
    to = `${name}.txt`;
    writeFileSync(join(OUT, 'assets', to), readFileSync(from).toString('base64'));
  } else if (name.endsWith('.js')) {
    // Point every model URL at its packed name. Only URLs: the same file
    // names also appear as lookup keys, which must stay as they are.
    writeFileSync(join(OUT, 'assets', to), readFileSync(from, 'utf8').replace(/new URL\("([^"]+)\.glb"/g, 'new URL("$1.glb.txt"'));
  } else {
    cpSync(from, join(OUT, 'assets', to));
  }
  bytesOut += readFileSync(join(OUT, 'assets', to)).length;
  files.push(`assets/${to}`);
}

const html = readFileSync(join(SRC, 'index.html'), 'utf8');
const css = readdirSync(join(SRC, 'assets'))
  .filter((n) => n.endsWith('.css'))
  .map((n) => readFileSync(join(SRC, 'assets', n), 'utf8'))
  .join('\n');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const font = html.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/)[0];
const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script[^>]*><\/script>/g, '')
  .trim();
const entry = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
writeFileSync(join(OUT, 'page.html'), `${title}\n${font}\n<style>\n${css}\n</style>\n${body}\n<script type="module" src="${entry}"></script>\n`);
writeFileSync(join(OUT, 'files.json'), JSON.stringify(files));
console.log(`[page] ${files.length} files, ${(bytesOut / 1e6).toFixed(1)} MB, entry ${entry}`);
