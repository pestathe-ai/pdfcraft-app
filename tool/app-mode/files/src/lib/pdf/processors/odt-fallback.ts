/**
 * Convertitore ODT → PDF di riserva, senza LibreOffice.
 *
 * Usato quando il motore LibreOffice (WebAssembly) non è disponibile, per esempio
 * nel WebView di Android senza isolamento cross-origin. Legge il documento
 * OpenDocument (content.xml / styles.xml), lo trasforma in HTML con gli stili
 * principali (grassetto, corsivo, colori, allineamenti, elenchi, tabelle,
 * immagini, interruzioni di pagina) e lo impagina in PDF.
 * Il testo nel PDF risultante è un'immagine (non selezionabile).
 */

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
};

interface StyleInfo {
  css: string[];
  parent?: string;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
}

interface PageLayout {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
}

function toMm(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const m = v.trim().match(/^(-?[\d.]+)\s*(cm|mm|in|pt|px)?$/);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'cm': return n * 10;
    case 'in': return n * 25.4;
    case 'pt': return (n * 25.4) / 72;
    case 'px': return (n * 25.4) / 96;
    default: return n;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(el: Element, ns: string, name: string): string | null {
  return el.getAttributeNS(ns, name);
}

/** Converte le proprietà di uno stile ODF in dichiarazioni CSS. */
function readStyle(el: Element): StyleInfo {
  const css: string[] = [];
  const info: StyleInfo = { css, parent: attr(el, NS.style, 'parent-style-name') || undefined };
  for (const p of Array.from(el.children)) {
    if (p.namespaceURI !== NS.style) continue;
    const get = (ns: string, n: string) => attr(p, ns, n);
    if (p.localName === 'text-properties') {
      const fw = get(NS.fo, 'font-weight'); if (fw) css.push(`font-weight:${fw}`);
      const fs = get(NS.fo, 'font-style'); if (fs) css.push(`font-style:${fs}`);
      const size = get(NS.fo, 'font-size'); if (size && !size.endsWith('%')) css.push(`font-size:${size}`);
      const color = get(NS.fo, 'color'); if (color) css.push(`color:${color}`);
      const bg = get(NS.fo, 'background-color'); if (bg && bg !== 'transparent') css.push(`background-color:${bg}`);
      const fam = get(NS.style, 'font-name') || get(NS.fo, 'font-family');
      if (fam) css.push(`font-family:'${fam.replace(/'/g, '')}', serif`);
      const deco: string[] = [];
      const u = get(NS.style, 'text-underline-style'); if (u && u !== 'none') deco.push('underline');
      const lt = get(NS.style, 'text-line-through-style'); if (lt && lt !== 'none') deco.push('line-through');
      if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
      const pos = get(NS.style, 'text-position');
      if (pos?.startsWith('super')) css.push('vertical-align:super;font-size:0.7em');
      else if (pos?.startsWith('sub')) css.push('vertical-align:sub;font-size:0.7em');
      const tt = get(NS.fo, 'text-transform'); if (tt) css.push(`text-transform:${tt}`);
    } else if (p.localName === 'paragraph-properties') {
      const ta = get(NS.fo, 'text-align');
      if (ta) css.push(`text-align:${ta === 'start' ? 'left' : ta === 'end' ? 'right' : ta}`);
      for (const k of ['margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'text-indent', 'line-height', 'padding']) {
        const v = get(NS.fo, k); if (v) css.push(`${k}:${v}`);
      }
      const bg = get(NS.fo, 'background-color'); if (bg && bg !== 'transparent') css.push(`background-color:${bg}`);
      const border = get(NS.fo, 'border'); if (border && border !== 'none') css.push(`border:${border}`);
      if (get(NS.fo, 'break-before') === 'page') info.pageBreakBefore = true;
      if (get(NS.fo, 'break-after') === 'page') info.pageBreakAfter = true;
    } else if (p.localName === 'table-cell-properties') {
      const bg = get(NS.fo, 'background-color'); if (bg && bg !== 'transparent') css.push(`background-color:${bg}`);
      for (const k of ['border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'padding']) {
        const v = get(NS.fo, k); if (v) css.push(`${k}:${v}`);
      }
      const va = get(NS.style, 'vertical-align'); if (va) css.push(`vertical-align:${va}`);
    } else if (p.localName === 'table-properties') {
      const w = get(NS.style, 'width'); if (w) css.push(`width:${w}`);
      const ta = get(NS.table, 'align'); if (ta === 'center') css.push('margin-left:auto;margin-right:auto');
    }
  }
  return info;
}

class OdtToHtml {
  private styles = new Map<string, StyleInfo>();
  private orderedLists = new Set<string>();
  private images: Map<string, string>;
  private listStyleStack: string[] = [];

  constructor(images: Map<string, string>) {
    this.images = images;
  }

  addStyles(root: Element | null) {
    if (!root) return;
    for (const el of Array.from(root.getElementsByTagNameNS(NS.style, 'style'))) {
      const name = attr(el, NS.style, 'name');
      if (name) this.styles.set(name, readStyle(el));
    }
    for (const el of Array.from(root.getElementsByTagNameNS(NS.text, 'list-style'))) {
      const name = attr(el, NS.style, 'name');
      const first = el.firstElementChild;
      if (name && first?.localName === 'list-level-style-number') this.orderedLists.add(name);
    }
  }

  /** CSS di uno stile, compresi gli stili da cui eredita. */
  private styleCss(name: string | null, depth = 0): string {
    if (!name || depth > 10) return '';
    const st = this.styles.get(name);
    if (!st) return '';
    return [this.styleCss(st.parent || null, depth + 1), st.css.join(';')].filter(Boolean).join(';');
  }

  private breaks(name: string | null): { before: boolean; after: boolean } {
    let before = false, after = false;
    let n = name, guard = 0;
    while (n && guard++ < 10) {
      const st = this.styles.get(n);
      if (!st) break;
      before ||= !!st.pageBreakBefore; after ||= !!st.pageBreakAfter;
      n = st.parent || null;
    }
    return { before, after };
  }

  private children(el: Element): string {
    let out = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) out += escapeHtml(node.textContent || '');
      else if (node.nodeType === 1) out += this.node(node as Element);
    }
    return out;
  }

  private block(tag: string, styleName: string | null, inner: string): string {
    const { before, after } = this.breaks(styleName);
    const css = this.styleCss(styleName);
    const cls = [before ? 'pb-before' : '', after ? 'pb-after' : ''].filter(Boolean).join(' ');
    return `<${tag}${cls ? ` class="${cls}"` : ''}${css ? ` style="${escapeHtml(css)}"` : ''}>${inner || '&#8203;'}</${tag}>`;
  }

  node(el: Element): string {
    const ns = el.namespaceURI, n = el.localName;
    if (ns === NS.text) {
      switch (n) {
        case 'p':
          return this.block('p', attr(el, NS.text, 'style-name'), this.children(el));
        case 'h': {
          const lvl = Math.min(6, Math.max(1, parseInt(attr(el, NS.text, 'outline-level') || '1', 10)));
          return this.block(`h${lvl}`, attr(el, NS.text, 'style-name'), this.children(el));
        }
        case 'span': {
          const css = this.styleCss(attr(el, NS.text, 'style-name'));
          const inner = this.children(el);
          return css ? `<span style="${escapeHtml(css)}">${inner}</span>` : inner;
        }
        case 'a':
          return `<span style="color:#1a56db;text-decoration:underline">${this.children(el)}</span>`;
        case 's':
          return '&nbsp;'.repeat(parseInt(attr(el, NS.text, 'c') || '1', 10));
        case 'tab':
          return '<span class="tab"></span>';
        case 'line-break':
          return '<br>';
        case 'list': {
          const sn = attr(el, NS.text, 'style-name') || this.listStyleStack[this.listStyleStack.length - 1] || null;
          const ordered = !!sn && this.orderedLists.has(sn);
          this.listStyleStack.push(sn || '');
          let i = 0;
          let inner = '';
          for (const item of Array.from(el.children)) {
            if (item.localName !== 'list-item' && item.localName !== 'list-header') continue;
            i++;
            const marker = item.localName === 'list-header' ? '' : ordered ? `${i}.` : '•';
            inner += `<div class="li"><span class="mk">${marker}</span><div class="lc">${this.children(item)}</div></div>`;
          }
          this.listStyleStack.pop();
          return `<div class="list">${inner}</div>`;
        }
        case 'list-item':
        case 'list-header':
          return `<div>${this.children(el)}</div>`;
        case 'section':
          return `<div>${this.children(el)}</div>`;
        case 'note': {
          const cit = el.getElementsByTagNameNS(NS.text, 'note-citation')[0]?.textContent || '*';
          return `<sup>${escapeHtml(cit)}</sup>`;
        }
        case 'soft-page-break':
        case 'bookmark':
        case 'bookmark-start':
        case 'bookmark-end':
        case 'sequence-decls':
        case 'tracked-changes':
          return '';
        default:
          return this.children(el);
      }
    }
    if (ns === NS.table) {
      switch (n) {
        case 'table': {
          const css = this.styleCss(attr(el, NS.table, 'style-name'));
          return `<table style="border-collapse:collapse;${escapeHtml(css)}">${this.children(el)}</table>`;
        }
        case 'table-header-rows':
        case 'table-rows':
        case 'table-row-group':
          return this.children(el);
        case 'table-row':
          return `<tr>${this.children(el)}</tr>`;
        case 'table-cell': {
          const css = this.styleCss(attr(el, NS.table, 'style-name'));
          const cs = attr(el, NS.table, 'number-columns-spanned');
          const rs = attr(el, NS.table, 'number-rows-spanned');
          const span = `${cs && cs !== '1' ? ` colspan="${cs}"` : ''}${rs && rs !== '1' ? ` rowspan="${rs}"` : ''}`;
          return `<td${span} style="border:0.5pt solid #999;padding:1pt 4pt 3pt 4pt;${escapeHtml(css)}">${this.children(el)}</td>`;
        }
        case 'covered-table-cell':
        case 'table-columns':
        case 'table-column':
          return '';
        default:
          return this.children(el);
      }
    }
    if (ns === NS.draw) {
      if (n === 'frame') {
        const w = attr(el, NS.svg, 'width'), h = attr(el, NS.svg, 'height');
        const img = el.getElementsByTagNameNS(NS.draw, 'image')[0];
        const href = img ? attr(img, NS.xlink, 'href') : null;
        const src = href ? this.images.get(href.replace(/^\.\//, '')) : null;
        if (src) {
          const style = [w ? `width:${w}` : '', h ? `height:${h}` : '', 'max-width:100%;object-fit:contain'].filter(Boolean).join(';');
          return `<img src="${src}" style="${style}">`;
        }
        const tb = el.getElementsByTagNameNS(NS.draw, 'text-box')[0];
        return tb ? `<div>${this.children(tb)}</div>` : '';
      }
      return this.children(el);
    }
    if (ns === NS.office && (n === 'annotation' || n === 'annotation-end')) return '';
    return this.children(el);
  }
}

function readPageLayout(stylesDoc: Document | null): PageLayout {
  const def: PageLayout = { widthMm: 210, heightMm: 297, marginTopMm: 20, marginBottomMm: 20, marginLeftMm: 20, marginRightMm: 20 };
  if (!stylesDoc) return def;
  const props = stylesDoc.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0];
  if (!props) return def;
  const g = (k: string) => attr(props, NS.fo, k);
  return {
    widthMm: toMm(g('page-width'), def.widthMm),
    heightMm: toMm(g('page-height'), def.heightMm),
    marginTopMm: toMm(g('margin-top'), def.marginTopMm),
    marginBottomMm: toMm(g('margin-bottom'), def.marginBottomMm),
    marginLeftMm: toMm(g('margin-left'), def.marginLeftMm),
    marginRightMm: toMm(g('margin-right'), def.marginRightMm),
  };
}

/** Converte un file .odt in PDF (immagine delle pagine). */
export async function convertOdtToPdfFallback(file: File, onStatus?: (msg: string) => void): Promise<Blob> {
  onStatus?.('Lettura del documento ODT...');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const contentXml = await zip.file('content.xml')?.async('string');
  if (!contentXml) throw new Error('File ODT non valido (content.xml mancante).');
  const stylesXml = await zip.file('styles.xml')?.async('string');

  const parser = new DOMParser();
  const content = parser.parseFromString(contentXml, 'application/xml');
  const stylesDoc = stylesXml ? parser.parseFromString(stylesXml, 'application/xml') : null;

  // Immagini incorporate → data URL
  const images = new Map<string, string>();
  const picFiles = Object.keys(zip.files).filter((p) => /^Pictures\//i.test(p) || /\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(p));
  for (const p of picFiles) {
    const f = zip.file(p);
    if (!f) continue;
    const ext = p.split('.').pop()?.toLowerCase() || 'png';
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    images.set(p, `data:${mime};base64,${await f.async('base64')}`);
  }

  const conv = new OdtToHtml(images);
  conv.addStyles(stylesDoc?.documentElement || null);
  conv.addStyles(content.documentElement);

  const body = content.getElementsByTagNameNS(NS.office, 'text')[0];
  if (!body) throw new Error('Il documento ODT non contiene testo.');
  let html = '';
  for (const child of Array.from(body.children)) html += conv.node(child);

  const layout = readPageLayout(stylesDoc);
  onStatus?.('Impaginazione...');
  return renderHtmlToPdf(html, layout);
}

const PX_PER_MM = 96 / 25.4;

async function renderHtmlToPdf(html: string, layout: PageLayout): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;

  const contentWmm = layout.widthMm - layout.marginLeftMm - layout.marginRightMm;
  const contentHmm = layout.heightMm - layout.marginTopMm - layout.marginBottomMm;
  const contentWpx = Math.round(contentWmm * PX_PER_MM);
  const pageHpx = contentHmm * PX_PER_MM;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentWpx}px;height:1000px;border:0;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#fff;}
      body{width:${contentWpx}px;color:#000;font-family:'Liberation Serif','Times New Roman',serif;font-size:12pt;line-height:1.25;}
      p,h1,h2,h3,h4,h5,h6{margin:0 0 4pt 0;overflow-wrap:anywhere;}
      h1{font-size:18pt}h2{font-size:15pt}h3{font-size:13pt}h4,h5,h6{font-size:12pt}
      .list{margin:0 0 4pt 0;}
      .li{display:flex;align-items:flex-start;}
      .mk{flex:0 0 18pt;text-align:left;}
      .lc{flex:1;min-width:0;}
      .lc p{margin:0 0 2pt 0;}
      table{margin:4pt 0;max-width:100%;}
      td{line-height:1.3;}
      td p{margin:0;}
      .tab{display:inline-block;width:1.25cm;}
      img{display:inline-block;}
      #root{background:#fff;padding-bottom:6px;}
    </style></head><body><div id="root">${html}</div></body></html>`);
    doc.close();
    await new Promise((r) => setTimeout(r, 300));
    const imgs = Array.from(doc.images);
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));

    const root = doc.getElementById('root')!;
    iframe.style.height = `${root.scrollHeight + 40}px`;
    await new Promise((r) => setTimeout(r, 50));
    const totalH = Math.ceil(root.getBoundingClientRect().height);

    // Punti in cui si può tagliare: tra un blocco e l'altro (e righe di tabella / voci di elenco).
    const cuts = new Set<number>();
    const forced = new Set<number>();
    const rootTop = root.getBoundingClientRect().top;
    root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,.li,tr,img,table').forEach((el) => {
      const r = el.getBoundingClientRect();
      cuts.add(Math.round(r.bottom - rootTop));
      if (el.classList.contains('pb-before')) forced.add(Math.round(r.top - rootTop));
      if (el.classList.contains('pb-after')) forced.add(Math.round(r.bottom - rootTop));
    });
    const sortedCuts = Array.from(cuts).sort((a, b) => a - b);
    const sortedForced = Array.from(forced).filter((v) => v > 0).sort((a, b) => a - b);

    const pages: [number, number][] = [];
    let start = 0;
    while (start < totalH - 1) {
      const limit = start + pageHpx;
      const forcedHere = sortedForced.find((f) => f > start + 1 && f <= limit);
      let end: number;
      if (forcedHere !== undefined) end = forcedHere;
      else if (limit >= totalH) end = totalH;
      else {
        const candidates = sortedCuts.filter((c) => c > start + pageHpx * 0.3 && c <= limit);
        end = candidates.length ? candidates[candidates.length - 1] : Math.floor(limit);
      }
      pages.push([start, end]);
      start = end;
    }
    if (!pages.length) pages.push([0, Math.max(1, totalH)]);

    const scale = 2;
    const canvas = await html2canvas(root, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: contentWpx,
      height: totalH,
      windowWidth: contentWpx,
    });

    const orientation = layout.widthMm > layout.heightMm ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [layout.widthMm, layout.heightMm] });
    pages.forEach(([s, e], i) => {
      if (i > 0) pdf.addPage([layout.widthMm, layout.heightMm], orientation);
      const sliceH = Math.max(1, Math.round((e - s) * scale));
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, Math.round(s * scale), canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const hMm = (e - s) / PX_PER_MM;
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', layout.marginLeftMm, layout.marginTopMm, contentWmm, hMm);
    });
    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
}
