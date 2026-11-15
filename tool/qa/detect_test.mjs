// Prova del rilevamento campi: immagine da pdftoppm (scala di grigi) + testo da pdftotext -bbox-layout.
// Uso: node detect_test.mjs file.pdf [pagina] [out.png]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from '/home/claude/pdfcrafttool/pdfcraft/node_modules/esbuild/lib/main.js';

const [pdf, pageArg = '1', outPng] = process.argv.slice(2);
const page = Number(pageArg);
const dir = mkdtempSync(join(tmpdir(), 'det-'));
const src = new URL('../app-mode/files/src/lib/app/form-detect.ts', import.meta.url).pathname;
await build({ entryPoints: [src], bundle: true, format: 'esm', outfile: join(dir, 'fd.mjs'), logLevel: 'error' });
const { detectFields } = await import(join(dir, 'fd.mjs'));

const DPI = 144, ppt = DPI / 72;
execFileSync('pdftoppm', ['-gray', '-r', String(DPI), '-f', pageArg, '-l', pageArg, pdf, join(dir, 'p')]);
const pgmName = execFileSync('ls', [dir]).toString().split('\n').find((n) => n.endsWith('.pgm'));
const buf = readFileSync(join(dir, pgmName));
// PGM P5: header "P5\nW H\n255\n"
let off = 0, fields = [];
while (fields.length < 4) {
  let s = '';
  while (buf[off] !== 0x0a && buf[off] !== 0x20) s += String.fromCharCode(buf[off++]);
  off++;
  if (s) fields.push(s);
}
const [, W, H] = fields.map(Number);
const lum = new Uint8Array(buf.subarray(off, off + W * H));

const html = execFileSync('pdftotext', ['-bbox-layout', '-f', pageArg, '-l', pageArg, pdf, '-']).toString();
const texts = [];
for (const m of html.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)) {
  const words = [...m[5].matchAll(/>([^<]*)<\/word>/g)].map((w) => w[1].replace(/&amp;/g, '&'));
  texts.push({ x1: +m[1] * ppt, y1: +m[2] * ppt, x2: +m[3] * ppt, y2: +m[4] * ppt, str: words.join(' ') });
}
const t0 = Date.now();
const res = detectFields({ width: W, height: H, lum }, texts, ppt);
console.log(`${res.length} campi in ${Date.now() - t0} ms`);
for (const f of res) console.log(`${f.kind.padEnd(9)} ${f.source.padEnd(6)} [${(f.x1 / ppt) | 0},${(f.y1 / ppt) | 0} ${((f.x2 - f.x1) / ppt) | 0}x${((f.y2 - f.y1) / ppt) | 0}] "${f.label}"`);
if (outPng) {
  writeFileSync(join(dir, 'f.json'), JSON.stringify(res.map((f) => [f.x1 / ppt, f.y1 / ppt, f.x2 / ppt, f.y2 / ppt, f.kind])));
  execFileSync('python3', ['-c', `
import json,sys,subprocess
from PIL import Image, ImageDraw
subprocess.run(['pdftoppm','-png','-r','72','-f','${pageArg}','-l','${pageArg}','${pdf}','${dir}/v'])
import glob; im=Image.open(glob.glob('${dir}/v*.png')[0]).convert('RGB'); d=ImageDraw.Draw(im,'RGBA')
for x1,y1,x2,y2,k in json.load(open('${dir}/f.json')):
    d.rectangle([x1,y1,x2,y2], fill=(255,200,0,90) if k!='check' else (0,160,255,110), outline=(0,60,200,255))
im.save('${outPng}')`]);
}
