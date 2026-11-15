/**
 * Rilevamento automatico degli spazi da compilare in un PDF "normale"
 * (senza campi compilabili): righe, puntini/trattini, caselle, celle di
 * tabella vuote e riquadri. Lavora sull'immagine della pagina (quindi va
 * bene anche per molti PDF scansionati) più le posizioni del testo.
 *
 * Tutte le coordinate sono in pixel dell'immagine analizzata; `ppt` = pixel
 * per punto tipografico (1/72 di pollice) a quella risoluzione.
 */

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextBox extends Box {
  str: string;
}

export type DetectedKind = 'text' | 'multiline' | 'check';

export interface DetectedField extends Box {
  kind: DetectedKind;
  label: string;
  /** da dove viene: riga, puntini, cella, riquadro, casella */
  source: 'line' | 'leader' | 'cell' | 'box' | 'check';
}

export interface Gray {
  width: number;
  height: number;
  /** luminosità 0..255, una per pixel */
  lum: Uint8Array;
}

const DARK = 160;

/** Converte i pixel RGBA in luminosità (sfondo trasparente = bianco). */
export function toGray(data: Uint8ClampedArray, width: number, height: number): Gray {
  const lum = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[p] = Math.round(l * a + 255 * (1 - a));
  }
  return { width, height, lum };
}

/** Toglie i puntini isolati (sporco delle scansioni): un pixel scuro resta solo se ha almeno 2 vicini scuri. */
export function despeckle(g: Gray): Gray {
  const { width: W, height: H, lum } = g;
  const out = new Uint8Array(lum);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (lum[i] >= DARK) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && lum[i + dy * W + dx] < DARK) n++;
      if (n < 2) out[i] = 255;
    }
  }
  return { width: W, height: H, lum: out };
}

/** "Ingrossa" di r pixel in verticale ('v') o in orizzontale ('h'): le righe un po' storte restano continue. */
function dilate(g: Gray, r: number, axis: 'v' | 'h'): Gray {
  const { width: W, height: H, lum } = g;
  const out = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (lum[y * W + x] >= DARK) continue;
      for (let d = -r; d <= r; d++) {
        if (axis === 'v') { const yy = y + d; if (yy >= 0 && yy < H) out[yy * W + x] = 0; }
        else { const xx = x + d; if (xx >= 0 && xx < W) out[y * W + xx] = 0; }
      }
    }
  }
  return { width: W, height: H, lum: out };
}

interface Seg {
  a1: number; // inizio lungo l'asse principale
  a2: number; // fine
  b1: number; // primo indice sull'asse trasversale (riga o colonna)
  b2: number; // ultimo
}


/** Segmenti scuri orizzontali (axis 'h') o verticali ('v'), spessore ≤ maxThick. */
function segments(g: Gray, axis: 'h' | 'v', minLen: number, maxThick: number, skew = 0): Seg[] {
  const { width: W, height: H, lum } = g;
  const outer = axis === 'h' ? H : W;
  const inner = axis === 'h' ? W : H;
  const done: Seg[] = [];
  let active: Seg[] = [];
  const tol = 2;
  for (let o = 0; o < outer; o++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= inner; i++) {
      const dark = i < inner && lum[axis === 'h' ? o * W + i : i * W + o] < DARK;
      if (dark && start < 0) start = i;
      else if (!dark && start >= 0) {
        if (i - start >= minLen) runs.push([start, i - 1]);
        start = -1;
      }
    }
    const next: Seg[] = [];
    const used = new Set<Seg>();
    for (const [r1, r2] of runs) {
      const s = active.find((a) => {
        if (used.has(a)) return false;
        if (Math.abs(a.a1 - r1) <= tol && Math.abs(a.a2 - r2) <= tol) return true;
        // righe un po' storte: i pezzi si sovrappongono quasi del tutto
        const ov = Math.min(a.a2, r2) - Math.max(a.a1, r1);
        return skew > 0 && ov >= 0.8 * Math.min(a.a2 - a.a1, r2 - r1);
      });
      if (s) {
        s.b2 = o;
        s.a1 = Math.min(s.a1, r1);
        s.a2 = Math.max(s.a2, r2);
        used.add(s);
        next.push(s);
      } else {
        const n = { a1: r1, a2: r2, b1: o, b2: o };
        used.add(n);
        next.push(n);
      }
    }
    for (const a of active) if (!used.has(a)) done.push(a);
    active = next;
  }
  done.push(...active);
  return done.filter((s) => s.b2 - s.b1 + 1 <= maxThick + skew * (s.a2 - s.a1));
}

function inkInBox(g: Gray, b: Box): number {
  const x1 = Math.max(0, Math.round(b.x1)), x2 = Math.min(g.width - 1, Math.round(b.x2));
  const y1 = Math.max(0, Math.round(b.y1)), y2 = Math.min(g.height - 1, Math.round(b.y2));
  if (x2 < x1 || y2 < y1) return 0;
  let n = 0;
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (g.lum[y * g.width + x] < DARK) n++;
  return n / ((x2 - x1 + 1) * (y2 - y1 + 1));
}

/** Colonne "vuote" (senza inchiostro) tra y1..y2: restituisce gli intervalli liberi. */
function freeRuns(g: Gray, x1: number, x2: number, y1: number, y2: number, minLen: number, blocked: Box[]): [number, number][] {
  const X1 = Math.max(0, Math.round(x1)), X2 = Math.min(g.width - 1, Math.round(x2));
  const Y1 = Math.max(0, Math.round(y1)), Y2 = Math.min(g.height - 1, Math.round(y2));
  const out: [number, number][] = [];
  let start = -1;
  for (let x = X1; x <= X2 + 1; x++) {
    let free = x <= X2;
    if (free) {
      for (const b of blocked) if (x >= b.x1 && x <= b.x2 && b.y2 >= Y1 && b.y1 <= Y2) { free = false; break; }
    }
    if (free) {
      let n = 0;
      for (let y = Y1; y <= Y2; y++) if (g.lum[y * g.width + x] < DARK && ++n >= 2) { free = false; break; }
    }
    if (free && start < 0) start = x;
    else if (!free && start >= 0) {
      if (x - start >= minLen) out.push([start, x - 1]);
      start = -1;
    }
  }
  return out;
}

/** Righe di puntini o trattini disegnate come immagine (es. moduli scansionati). */
function dottedLines(g: Gray, ppt: number): Seg[] {
  const { width: W, height: H, lum } = g;
  const maxDot = Math.max(2, Math.round(3 * ppt));
  const maxGap = Math.max(3, Math.round(6 * ppt));
  const minLen = 28 * ppt;
  const iso = Math.max(3, Math.round(3 * ppt));
  const found: Seg[] = [];
  for (let y = iso; y < H - iso; y++) {
    let runs: [number, number][] = [];
    let start = -1;
    const flush = () => {
      if (runs.length >= 6) {
        const a1 = runs[0][0], a2 = runs[runs.length - 1][1];
        if (a2 - a1 >= minLen) {
          // puntini veri: sopra e sotto non c'è inchiostro (il testo invece sì)
          let ink = 0, tot = 0;
          for (const yy of [y - iso, y - iso + 1, y + iso, y + iso - 1]) {
            for (let x = a1; x <= a2; x++) { tot++; if (lum[yy * W + x] < DARK) ink++; }
          }
          const gaps = runs.slice(1).map((r, i) => r[0] - runs[i][1]);
          const mean = gaps.reduce((p, c) => p + c, 0) / gaps.length;
          const sd = Math.sqrt(gaps.reduce((p, c) => p + (c - mean) ** 2, 0) / gaps.length);
          if (ink / tot < 0.03 && sd <= Math.max(1.5, mean * 0.5)) found.push({ a1, a2, b1: y, b2: y });
        }
      }
      runs = [];
    };
    for (let x = 0; x <= W; x++) {
      const dark = x < W && lum[y * W + x] < DARK;
      if (dark && start < 0) start = x;
      else if (!dark && start >= 0) {
        const len = x - start;
        if (len > maxDot) flush();
        else {
          if (runs.length && start - runs[runs.length - 1][1] > maxGap) flush();
          runs.push([start, x - 1]);
        }
        start = -1;
      }
    }
    flush();
  }
  // unisci le righe vicine della stessa fila di puntini
  const merged: Seg[] = [];
  for (const f of found) {
    const m = merged.find((s) => f.b1 - s.b2 <= 2 && Math.min(s.a2, f.a2) - Math.max(s.a1, f.a1) > 0.5 * (f.a2 - f.a1));
    if (m) { m.b2 = f.b1; m.a1 = Math.min(m.a1, f.a1); m.a2 = Math.max(m.a2, f.a2); }
    else merged.push({ ...f });
  }
  return merged;
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
const area = (a: Box) => Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);

const LEADER = /([_]{3,}|[.]{4,}|[…]{2,}|[-]{5,})/g;

/** Larghezza approssimata di un carattere (in "em"), per dividere un pezzo di testo in proporzione. */
function charW(c: string): number {
  if ('.,:;\'!|'.includes(c) || c === ' ') return 0.28;
  if ('iljtfrI'.includes(c)) return 0.3;
  if (c === '_' ) return 0.56;
  if ('mwMW@'.includes(c)) return 0.85;
  if (c >= 'A' && c <= 'Z') return 0.67;
  return 0.53;
}

function cleanLabel(s: string): string {
  return s.replace(/[_.…]{2,}/g, ' ').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim();
}

/** Etichetta di una casella: il testo subito a destra (es. "☐ Sì"), altrimenti quello a sinistra. */
function checkLabel(f: Box, texts: TextBox[], ppt: number): string {
  const cy = (f.y1 + f.y2) / 2;
  let best: TextBox | null = null;
  for (const t of texts) {
    const tc = (t.y1 + t.y2) / 2;
    if (t.x1 >= f.x2 - ppt && t.x1 - f.x2 < 30 * ppt && Math.abs(tc - cy) < 8 * ppt && (!best || t.x1 < best.x1)) best = t;
  }
  if (best) {
    const first = cleanLabel(best.str).split(/\s{2,}/)[0];
    if (first) return first.slice(0, 60);
  }
  return labelFor(f, texts, ppt);
}

/** Etichetta di una cella di tabella: intestazione della riga + della colonna. */
function cellLabel(f: Box, texts: TextBox[], ppt: number): string {
  const cy = (f.y1 + f.y2) / 2;
  let row: TextBox | null = null;
  let col: TextBox | null = null;
  for (const t of texts) {
    const tc = (t.y1 + t.y2) / 2;
    if (t.x2 <= f.x1 + ppt && Math.abs(tc - cy) < (f.y2 - f.y1) / 2 + 2 * ppt && (!row || t.x1 < row.x1)) row = t;
    if (t.y2 <= f.y1 + ppt && f.y1 - t.y2 < 160 * ppt && Math.min(t.x2, f.x2) - Math.max(t.x1, f.x1) > 0 && (!col || t.y2 > col.y2)) col = t;
  }
  const parts = [row, col].filter(Boolean).map((t) => cleanLabel(t!.str)).filter(Boolean);
  return [...new Set(parts)].join(' · ').slice(0, 60);
}

/** Etichetta di un campo: testo subito a sinistra sulla stessa riga, oppure sopra. */
function labelFor(f: Box, texts: TextBox[], ppt: number): string {
  const cy = (f.y1 + f.y2) / 2;
  let best: TextBox | null = null;
  let bestD = Infinity;
  for (const t of texts) {
    const tc = (t.y1 + t.y2) / 2;
    if (t.x2 <= f.x1 + 2 * ppt && Math.abs(tc - cy) <= Math.max(8 * ppt, (f.y2 - f.y1) / 2 + 4 * ppt)) {
      const d = f.x1 - t.x2;
      if (d < bestD && d < 220 * ppt) { bestD = d; best = t; }
    }
  }
  if (best) {
    // del testo a sinistra prendi l'ultimo pezzo prima del campo (es. "Nato a ...... il" → "il")
    const parts = best.str.split(LEADER).map(cleanLabel).filter(Boolean);
    const lab = parts.length ? parts[parts.length - 1] : cleanLabel(best.str);
    if (lab) return lab.slice(0, 60);
  }
  // sopra: testo che si sovrappone in orizzontale, entro 40pt
  bestD = Infinity;
  best = null;
  for (const t of texts) {
    if (t.y2 <= f.y1 + 2 * ppt && f.y1 - t.y2 < 40 * ppt && Math.min(t.x2, f.x2) - Math.max(t.x1, f.x1) > 0) {
      const d = f.y1 - t.y2;
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best ? cleanLabel(best.str).slice(0, 60) : '';
}

/**
 * Trova gli spazi da compilare.
 * @param texts riquadri del testo della pagina (in pixel), dal livello di testo del PDF
 */
export function detectFields(g0: Gray, texts: TextBox[], ppt: number): DetectedField[] {
  const out: DetectedField[] = [];
  const g = despeckle(g0);
  const pt = (n: number) => n * ppt;

  // Testo "vero" (non fatto solo di puntini/trattini) e puntini di compilazione
  const words: TextBox[] = [];
  for (const t of texts) {
    if (!t.str.trim()) continue;
    const m = [...t.str.matchAll(LEADER)];
    if (!m.length) { words.push(t); continue; }
    // dividi il riquadro in proporzione alla larghezza dei caratteri: i tratti di puntini diventano campi
    const n = t.str.length;
    const pos: number[] = [0];
    for (const c of t.str) pos.push(pos[pos.length - 1] + charW(c));
    const unit = (t.x2 - t.x1) / Math.max(0.01, pos[pos.length - 1]);
    const X = (i: number) => t.x1 + pos[i] * unit;
    let last = 0;
    for (const mm of m) {
      const s = mm.index ?? 0, e = s + mm[0].length;
      if (s > last && t.str.slice(last, s).trim()) {
        words.push({ str: t.str.slice(last, s), x1: X(last), x2: X(s), y1: t.y1, y2: t.y2 });
      }
      const h = t.y2 - t.y1;
      out.push({
        kind: 'text', source: 'leader', label: '',
        x1: X(s), x2: X(e), y1: t.y2 - Math.max(h * 1.3, pt(14)), y2: t.y2 + pt(2),
      });
      last = e;
    }
    if (last < n && t.str.slice(last).trim()) words.push({ str: t.str.slice(last), x1: X(last), x2: t.x2, y1: t.y1, y2: t.y2 });
  }

  const thick = Math.max(3, Math.round(pt(2.5)));
  const hSegs = segments(g, 'h', Math.round(pt(4)), thick);
  const vSegs = segments(g, 'v', Math.round(pt(4)), thick);
  // righe lunghe: cercate anche sull'immagine "ingrossata", così una scansione un po' storta va bene lo stesso
  const r = Math.max(1, Math.round(pt(1)));
  const skew = 0.025;
  const longH = segments(dilate(g, r, 'v'), 'h', Math.round(pt(28)), thick + 2 * r, skew).map((s) => ({ ...s, b1: s.b1 + r, b2: s.b2 - r }));
  const hLines: Seg[] = [...longH];
  for (const d of dottedLines(dilate(g, 1, 'v'), ppt)) {
    if (!hLines.some((l) => Math.abs(l.b1 - d.b1) < pt(3) && Math.min(l.a2, d.a2) - Math.max(l.a1, d.a1) > 0)) hLines.push(d);
  }
  const vLines = segments(dilate(g, r, 'h'), 'v', Math.round(pt(8)), thick + 2 * r, skew).map((s) => ({ ...s, b1: s.b1 + r, b2: s.b2 - r }));
  const noText = !words.length && !out.length;

  // Escludi le righe che sono puntini/trattini di testo (già gestiti)
  const leaderBoxes = out.map((o) => o as Box);
  const isLeaderLine = (s: Seg) => leaderBoxes.some((b) => s.a1 >= b.x1 - pt(3) && s.a2 <= b.x2 + pt(3) && s.b1 >= b.y1 && s.b1 <= b.y2 + pt(2));

  // 1) Caselle di spunta: quadrati piccoli e vuoti
  const shortH = hSegs.filter((s) => s.a2 - s.a1 >= pt(5) && s.a2 - s.a1 <= pt(22));
  for (const top of shortH) {
    const len = top.a2 - top.a1;
    const bot = shortH.find(
      (b) => b !== top && b.b1 > top.b2 && Math.abs(b.a1 - top.a1) <= pt(1.5) && Math.abs(b.a2 - top.a2) <= pt(1.5) &&
        Math.abs(b.b1 - top.b1 - len) <= len * 0.35,
    );
    if (!bot) continue;
    const box = { x1: top.a1, x2: top.a2, y1: top.b1, y2: bot.b2 };
    const hasSides = vSegs.some((v) => Math.abs(v.b1 - box.x1) <= pt(1.5) && v.a2 - v.a1 >= (box.y2 - box.y1) * 0.7) &&
      vSegs.some((v) => Math.abs(v.b2 - box.x2) <= pt(1.5) && v.a2 - v.a1 >= (box.y2 - box.y1) * 0.7);
    if (!hasSides) continue;
    const pad = Math.max(2, pt(1.5));
    if (inkInBox(g, { x1: box.x1 + pad, x2: box.x2 - pad, y1: box.y1 + pad, y2: box.y2 - pad }) > 0.08) continue;
    if (out.some((o) => o.source === 'check' && overlap(o, box) > 0)) continue;
    out.push({ ...box, kind: 'check', source: 'check', label: '' });
  }

  // 2) Righe orizzontali: celle di tabella, riquadri, o righe "da scrivere sopra"
  const checks = out.filter((o) => o.kind === 'check');
  for (const L of hLines) {
    if (isLeaderLine(L)) continue;
    const y = L.b1;
    const len = L.a2 - L.a1;
    // la riga sopra più vicina che copre buona parte di questa
    let above: Seg | null = null;
    for (const U of hLines) {
      if (U === L || U.b2 >= y) continue;
      const ov = Math.min(U.a2, L.a2) - Math.max(U.a1, L.a1);
      if (ov < len * 0.5 && ov < (U.a2 - U.a1) * 0.5) continue;
      if (!above || U.b2 > above.b2) above = U;
    }
    const gap = above ? y - above.b2 : Infinity;
    const closed = above && gap >= pt(10) && gap <= pt(320) &&
      vLines.some((v) => Math.abs((v.b1 + v.b2) / 2 - L.a1) <= pt(4) && v.a1 <= above!.b2 + pt(4) && v.a2 >= y - pt(4));

    if (closed && above) {
      // cella/riquadro tra due righe: dividilo alle righe verticali che lo attraversano
      const top = above.b2 + 1, bottom = y - 1;
      const xs = vLines
        .filter((v) => v.a1 <= top + pt(2) && v.a2 >= bottom - pt(2) && v.b1 >= L.a1 - pt(2) && v.b2 <= L.a2 + pt(2))
        .map((v) => (v.b1 + v.b2) / 2)
        .sort((a, b) => a - b);
      const edges = [L.a1, ...xs, L.a2].filter((x, i, arr) => i === 0 || x - arr[i - 1] > pt(4));
      for (let i = 0; i + 1 < edges.length; i++) {
        const cx1 = edges[i] + pt(2), cx2 = edges[i + 1] - pt(2);
        if (cx2 - cx1 < pt(20)) continue;
        const inCell = words.filter((w) => w.x1 < cx2 && w.x2 > cx1 && w.y1 < bottom && w.y2 > top);
        if (inCell.length && !inCell.some((w) => /:\s*$/.test(w.str))) continue;
        // senza livello di testo (scansione): una cella già scritta è un'intestazione, non un campo
        if (noText && inkInBox(g, { x1: cx1, x2: cx2, y1: top + pt(2), y2: bottom - pt(2) }) > 0.004) continue;
        const runs = freeRuns(g, cx1, cx2, top + pt(1.5), bottom - pt(1.5), Math.round(pt(24)), checks);
        const tall = bottom - top > pt(36);
        for (const [a, b] of runs) {
          // in una cella con un'etichetta a sinistra, il campo parte dopo l'etichetta
          if (tall && b - a < (cx2 - cx1) * 0.6) continue;
          out.push({
            kind: tall ? 'multiline' : 'text', source: tall ? 'box' : 'cell', label: '',
            x1: a + (a > cx1 + 1 ? pt(3) : 0), x2: b, y1: top + pt(1), y2: bottom - pt(1),
          });
        }
      }
    } else {
      // il bordo superiore di una tabella o di un riquadro non è una riga su cui scrivere
      const isTopEdge = vLines.some((v) => Math.abs((v.b1 + v.b2) / 2 - L.a1) <= pt(4) && Math.abs(v.a1 - y) <= pt(4) && v.a2 > y + pt(6));
      if (isTopEdge) continue;
      // riga su cui scrivere: lo spazio libero appena sopra
      const h = Math.min(pt(18), above ? Math.max(pt(10), gap - pt(2)) : pt(18));
      const runs = freeRuns(g, L.a1, L.a2, y - h + pt(3), y - pt(1.5), Math.round(pt(24)), checks);
      for (const [a, b] of runs) {
        out.push({ kind: 'text', source: 'line', label: '', x1: a, x2: b, y1: y - h, y2: y + pt(1) });
      }
    }
  }

  // 3) Togli i doppioni (tieni caselle, poi puntini, poi il resto) e i campi sopra al testo
  const prio = { check: 0, leader: 1, cell: 2, line: 3, box: 4 } as const;
  out.sort((a, b) => prio[a.source] - prio[b.source] || area(a) - area(b));
  const kept: DetectedField[] = [];
  for (const f of out) {
    if (f.x2 - f.x1 < (f.kind === 'check' ? pt(4) : pt(18))) continue;
    if (kept.some((k) => overlap(k, f) > 0.5 * Math.min(area(k), area(f)))) continue;
    if (f.kind !== 'check' && words.some((w) => overlap(w, f) > 0.35 * area(w))) continue;
    kept.push(f);
  }
  for (const f of kept) {
    f.label = f.kind === 'check' ? checkLabel(f, words, ppt) : f.source === 'cell' ? cellLabel(f, words, ppt) || labelFor(f, words, ppt) : labelFor(f, words, ppt);
  }
  // ordine di lettura: dall'alto in basso, da sinistra a destra
  kept.sort((a, b) => (Math.abs(a.y1 - b.y1) < pt(6) ? a.x1 - b.x1 : a.y1 - b.y1));
  return kept;
}

/** Etichetta leggibile per un riquadro qualsiasi (es. un campo PDF compilabile senza nome chiaro). */
export function labelForBox(b: Box, texts: TextBox[], ppt: number, kind: 'check' | 'text'): string {
  const words = texts.filter((t) => t.str.trim() && !/^[_.…\-\s]+$/.test(t.str));
  return kind === 'check' ? checkLabel(b, words, ppt) : labelFor(b, words, ppt);
}

/** Rende leggibile il nome tecnico di un campo ("data_nascita", "CognomeRichiedente[0]"). */
export function humanizeFieldName(name: string): string {
  const last = name.split('.').pop() || name;
  const s = last
    .replace(/\[\d+\]$/, '')
    .replace(/([a-zà-ù])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}
