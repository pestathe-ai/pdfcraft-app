'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Download, Loader2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Type, Check, PenLine, Eye, EyeOff, Trash2, X, CalendarDays,
} from 'lucide-react';
import { AppFullscreen } from '@/components/app/AppFullscreen';
import { SignaturePad } from '@/components/app/SignaturePad';
import { loadPdfjs, loadPdfLib } from '@/lib/pdf/loader';
import { detectFields, toGray, labelForBox, humanizeFieldName, type TextBox } from '@/lib/app/form-detect';

/* ------------------------------------------------------------------ tipi */

type Kind = 'text' | 'multiline' | 'check' | 'radio' | 'choice' | 'sign';

interface Sig { dataUrl: string; width: number; height: number }

interface Field {
  id: string;
  page: number;
  kind: Kind;
  /** posizione e dimensioni in frazioni della pagina mostrata (origine in alto a sinistra) */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: string;
  checked: boolean;
  source: 'acro' | 'auto' | 'free';
  acroName?: string;
  exportValue?: string;
  options?: { value: string; label: string }[];
  sig?: Sig;
}

interface PageInfo {
  /** dimensioni della pagina mostrata, in punti */
  w: number;
  h: number;
  rot: number;
  img?: string;
  imgPx?: number;
}

/* Tipi minimi di pdf.js usati qui */
interface PdfViewport {
  width: number;
  height: number;
  transform: number[];
  convertToViewportRectangle(r: number[]): number[];
}
interface PdfTextItem { str: string; transform: number[]; width: number; height: number }
interface PdfAnnotation {
  subtype: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: string | string[];
  exportValue?: string;
  buttonValue?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  multiLine?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  alternativeText?: string;
  options?: { exportValue: string; displayValue: string }[];
  rect: number[];
}
interface PdfPage {
  rotate: number;
  getViewport(o: { scale: number }): PdfViewport;
  getAnnotations(o?: { intent?: string }): Promise<PdfAnnotation[]>;
  getTextContent(): Promise<{ items: (PdfTextItem | { type: string })[] }>;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; annotationMode?: number }): { promise: Promise<void> };
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> }
interface PdfjsLike {
  getDocument(o: { data: Uint8Array }): { promise: Promise<PdfDoc> };
  Util: { transform(a: number[], b: number[]): number[] };
  AnnotationMode?: { DISABLE: number; ENABLE_FORMS: number };
}

/* ------------------------------------------------------------------ utilità */

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const GAP = 12; // spazio tra le pagine (px)
const PAD = 12; // margine ai lati delle pagine (px)

/** Solo i caratteri che i caratteri standard del PDF sanno scrivere. */
function pdfSafe(s: string): string {
  return s.replace(/[^\n\x20-\x7E\xA0-\xFF€‘’“”–—…•]/g, '?');
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, sizePt: number): number {
  if (typeof document === 'undefined') return text.length * sizePt * 0.5;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * sizePt * 0.5;
  measureCtx.font = `${sizePt}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Corpo del testo (in punti) per un campo: proporzionato all'altezza, ridotto se non sta in larghezza. */
function textSize(f: Field, p: PageInfo, widthOf: (t: string, s: number) => number = measure): number {
  const hPt = f.h * p.h;
  const wPt = f.w * p.w;
  let size = f.kind === 'multiline' ? 11 : clamp(hPt * 0.62, 6, 14);
  if (f.kind !== 'multiline') {
    while (size > 6 && widthOf(f.value, size) > wPt - 4) size -= 0.5;
  }
  return size;
}

/** Va a capo per i campi su più righe. */
function wrap(text: string, size: number, maxW: number, widthOf: (t: string, s: number) => number = measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (widthOf(t, size) <= maxW || !line) line = t;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

const isDateLabel = (l: string) => /\bdata\b|nato\/?a? il|^il$|giorno|scadenza|date/i.test(l);
const inputModeFor = (l: string): React.HTMLAttributes<HTMLInputElement>['inputMode'] => {
  if (/e-?mail|pec\b/i.test(l)) return 'email';
  if (/tel|cell|telefono|fax/i.test(l)) return 'tel';
  if (/\bcap\b|importo|€|n\.\s*$|^n\.?$|numero|civico|anno|età|quantità/i.test(l)) return 'decimal';
  return 'text';
};

/* ------------------------------------------------------------------ componente */

export function FormFill({ file, onClose, locale }: { file: File; onClose: () => void; locale: string }) {
  const it = locale !== 'en';
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState<string | null>(it ? 'Apro il documento…' : 'Opening…');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cw, setCw] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<null | 'text' | 'check' | 'sign'>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [padFor, setPadFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const scrollTimer = useRef<number | undefined>(undefined);

  const scroller = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  /** con campi PDF veri non disegniamo i loro contenuti originali: li mostra la sovrapposizione */
  const noFormsMode = useRef<number | undefined>(undefined);
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const pendingScroll = useRef<string | null>(null);
  const draftKey = `ddocs-form:${file.name}:${file.size}:${file.lastModified}`;

  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2800);
  }, []);

  /* --- larghezza disponibile */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /* --- apertura: pagine, campi compilabili, rilevamento automatico */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = (await loadPdfjs()) as unknown as PdfjsLike;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        docRef.current = doc;
        noFormsMode.current = pdfjs.AnnotationMode?.ENABLE_FORMS;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          const vp = pg.getViewport({ scale: 1 });
          infos.push({ w: vp.width, h: vp.height, rot: ((pg.rotate % 360) + 360) % 360 });
        }
        if (cancelled) return;
        setPages(infos);

        const all: Field[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          setStatus(it ? `Cerco gli spazi da compilare… pagina ${i} di ${doc.numPages}` : `Looking for fields… page ${i}/${doc.numPages}`);
          const pg = await doc.getPage(i);
          const S = 2; // pixel per punto per l'analisi
          const vp = pg.getViewport({ scale: S });
          const W = Math.round(vp.width), H = Math.round(vp.height);

          // testo della pagina (per le etichette)
          const texts: TextBox[] = [];
          try {
            const tc = await pg.getTextContent();
            for (const raw of tc.items) {
              const item = raw as PdfTextItem;
              if (typeof item.str !== 'string' || !item.str.trim()) continue;
              const tx = pdfjs.Util.transform(vp.transform, item.transform);
              if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue; // testo ruotato: lo ignoriamo
              const fh = Math.abs(tx[3]);
              const x = tx[4], y = tx[5];
              texts.push({ str: item.str, x1: x, x2: x + item.width * S, y1: y - fh * 0.85, y2: y + fh * 0.2 });
            }
          } catch {
            /* nessun testo */
          }

          // 1) campi PDF veri (AcroForm)
          let annots: PdfAnnotation[] = [];
          try { annots = await pg.getAnnotations({ intent: 'display' }); } catch { annots = []; }
          const widgets = annots.filter((a) => a.subtype === 'Widget' && a.fieldName && !a.pushButton && !a.hidden);
          for (const a of widgets) {
            const r = vp.convertToViewportRectangle(a.rect);
            const x1 = Math.min(r[0], r[2]), x2 = Math.max(r[0], r[2]);
            const y1 = Math.min(r[1], r[3]), y2 = Math.max(r[1], r[3]);
            const box = { x1, x2, y1, y2 };
            let kind: Kind = 'text';
            if (a.fieldType === 'Btn') kind = a.radioButton ? 'radio' : 'check';
            else if (a.fieldType === 'Ch') kind = 'choice';
            else if (a.fieldType === 'Sig') kind = 'sign';
            else if (a.multiLine) kind = 'multiline';
            const fv = Array.isArray(a.fieldValue) ? a.fieldValue[0] ?? '' : a.fieldValue ?? '';
            const near = labelForBox(box, texts, S, kind === 'check' || kind === 'radio' ? 'check' : 'text');
            all.push({
              id: uid(), page: i - 1, kind,
              x: x1 / W, y: y1 / H, w: (x2 - x1) / W, h: (y2 - y1) / H,
              label: a.alternativeText?.trim() || near || humanizeFieldName(a.fieldName || ''),
              value: kind === 'check' || kind === 'radio' ? '' : String(fv),
              checked: kind === 'radio' ? fv === a.buttonValue : kind === 'check' ? !!fv && fv !== 'Off' : false,
              source: 'acro',
              acroName: a.fieldName,
              exportValue: kind === 'radio' ? a.buttonValue : a.exportValue,
              options: a.options?.map((o) => ({ value: o.exportValue, label: o.displayValue || o.exportValue })),
            });
          }
          if (widgets.length) continue;

          // 2) PDF "normale": cerco righe, puntini, caselle, celle vuote
          const canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) continue;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          await pg.render({ canvasContext: ctx, viewport: vp, annotationMode: noFormsMode.current }).promise;
          const img = ctx.getImageData(0, 0, W, H);
          const found = detectFields(toGray(img.data, W, H), texts, S);
          for (const f of found) {
            const isSign = f.kind !== 'check' && /\bfirma\b|signature|sottoscrizione/i.test(f.label);
            all.push({
              id: uid(), page: i - 1,
              kind: f.kind === 'check' ? 'check' : isSign ? 'sign' : f.kind,
              x: f.x1 / W, y: f.y1 / H, w: (f.x2 - f.x1) / W, h: (f.y2 - f.y1) / H,
              label: f.label, value: '', checked: false, source: 'auto',
            });
          }
          canvas.width = canvas.height = 0;
        }
        if (cancelled) return;

        // bozza lasciata a metà?
        let restored = false;
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const d = JSON.parse(raw) as { fields: Field[] };
            if (Array.isArray(d.fields) && d.fields.length) {
              setFields(d.fields);
              restored = true;
            }
          }
        } catch {
          /* niente bozza */
        }
        if (!restored) setFields(all);
        setStatus(null);
        if (restored) showToast(it ? 'Ho ripreso la compilazione lasciata a metà' : 'Restored your unfinished draft');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, it, draftKey, showToast]);

  /* --- salva la bozza mentre compili */
  useEffect(() => {
    if (status || !fields.length) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ fields })); } catch { /* spazio pieno */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [fields, status, draftKey]);

  /* --- immagini delle pagine, alla risoluzione giusta per lo zoom */
  const pageW1 = Math.max(100, cw - 2 * PAD); // larghezza pagina a zoom 1 (px)
  const pageW = pageW1 * zoom;
  const renderJob = useRef(0);
  const renderVisible = useCallback(async () => {
    const doc = docRef.current;
    const el = scroller.current;
    if (!doc || !el || !pages.length || !cw) return;
    const job = ++renderJob.current;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const want = Math.min(4096, Math.ceil((pageW * dpr) / 256) * 256);
    const sr = el.getBoundingClientRect();
    const nodes = el.querySelectorAll<HTMLElement>('[data-ff-page]');
    for (const node of Array.from(nodes)) {
      const i = Number(node.dataset.ffPage);
      const r = node.getBoundingClientRect();
      const near = r.bottom > sr.top - sr.height && r.top < sr.bottom + sr.height;
      const p = pages[i];
      if (!near || (p.imgPx && p.imgPx >= want * 0.9)) continue;
      const pg = await doc.getPage(i + 1);
      if (job !== renderJob.current) return;
      const base = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: want / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp, annotationMode: noFormsMode.current }).promise;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      canvas.width = canvas.height = 0;
      if (!blob || job !== renderJob.current) return;
      const url = URL.createObjectURL(blob);
      setPages((prev) => prev.map((q, k) => {
        if (k !== i) return q;
        if (q.img) URL.revokeObjectURL(q.img);
        return { ...q, img: url, imgPx: want };
      }));
    }
  }, [pages, cw, pageW]);

  useEffect(() => {
    const t = window.setTimeout(() => void renderVisible(), 250);
    return () => window.clearTimeout(t);
  }, [renderVisible, zoom, cw, pages.length]);

  useEffect(() => () => {
    pages.forEach((p) => p.img && URL.revokeObjectURL(p.img));
    void docRef.current?.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- zoom con ancoraggio (il punto sotto le dita resta fermo) */
  const zoomTo = useCallback((z: number, cx?: number, cy?: number) => {
    const el = scroller.current;
    const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
    if (el) {
      const r = el.getBoundingClientRect();
      const px = cx ?? r.width / 2;
      const py = cy ?? r.height / 2;
      anchor.current = {
        fx: (el.scrollLeft + px) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + py) / Math.max(1, el.scrollHeight),
        cx: px,
        cy: py,
      };
    }
    setZoom(nz);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.fx * el.scrollWidth - a.cx;
    el.scrollTop = a.fy * el.scrollHeight - a.cy;
  }, [zoom]);

  // pizzico con due dita
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinch.current = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinch.current;
    if (!p || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const r = scroller.current!.getBoundingClientRect();
    const z = clamp(p.z0 * (d / p.d0), MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z - zoom) > 0.01) zoomTo(z, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinch.current = null;
  };

  /* --- campi */
  const ordered = useMemo(
    () => [...fields].sort((a, b) => a.page - b.page || (Math.abs(a.y - b.y) < 0.008 ? a.x - b.x : a.y - b.y)),
    [fields],
  );
  const sel = fields.find((f) => f.id === selected) || null;
  const selIndex = sel ? ordered.findIndex((f) => f.id === sel.id) : -1;
  const filled = fields.filter((f) => (f.kind === 'check' || f.kind === 'radio' ? f.checked : f.kind === 'sign' ? !!f.sig || !!f.value : !!f.value.trim())).length;

  const update = useCallback((id: string, patch: Partial<Field>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const toggle = useCallback((f: Field) => {
    setFields((prev) => prev.map((x) => {
      if (f.kind === 'radio') {
        if (x.acroName === f.acroName && x.kind === 'radio') return { ...x, checked: x.id === f.id ? !f.checked : false };
        return x;
      }
      return x.id === f.id ? { ...x, checked: !x.checked } : x;
    }));
  }, []);

  /** Porta il campo in vista, ingrandendo se è troppo piccolo per scriverci comodamente. */
  const focusField = useCallback((f: Field) => {
    const p = pages[f.page];
    if (!p) return;
    const pageH1 = pageW1 * (p.h / p.w);
    const zw = 0.62 / Math.max(0.02, f.w);
    const zh = 24 / Math.max(1, f.h * pageH1);
    const target = clamp(Math.max(zoom, Math.min(zw, 3.2), Math.min(zh, 3.5)), MIN_ZOOM, MAX_ZOOM);
    pendingScroll.current = f.id;
    if (Math.abs(target - zoom) > 0.01) setZoom(target);
    else setScrollTick((n) => n + 1); // solo riposizionamento
  }, [pages, pageW1, zoom]);

  useLayoutEffect(() => {
    const id = pendingScroll.current;
    const el = scroller.current;
    if (!id || !el) return;
    pendingScroll.current = null;
    const node = el.querySelector<HTMLElement>(`[data-ff-field="${id}"]`);
    if (!node) return;
    const sr = el.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    // campo largo: mostra l'inizio (dove si scrive); campo stretto: al centro
    const left = nr.width > sr.width * 0.85
      ? el.scrollLeft + (nr.left - sr.left) - 12
      : el.scrollLeft + (nr.left - sr.left) + nr.width / 2 - sr.width / 2;
    const top = el.scrollTop + (nr.top - sr.top) - sr.height * 0.22;
    el.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
  }, [zoom, selected, scrollTick]);

  const select = useCallback((f: Field | null) => {
    setSelected(f ? f.id : null);
    if (f) focusField(f);
  }, [focusField]);

  const go = (dir: 1 | -1) => {
    if (!ordered.length) return;
    const i = selIndex < 0 ? (dir > 0 ? 0 : ordered.length - 1) : (selIndex + dir + ordered.length) % ordered.length;
    select(ordered[i]);
  };

  // tasto Indietro di Android: prima chiude il pannello del campo
  useEffect(() => {
    if (!selected) return;
    const stack = (window.__pdfcraftBackStack ||= []);
    const fn = () => { setSelected(null); return true; };
    stack.push(fn);
    return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1); };
  }, [selected]);

  /* --- tocchi sulla pagina: aggiungi campo, doppio tocco = zoom */
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const onPageClick = (pageIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const p = pages[pageIdx];
    if (mode) {
      const wPt = mode === 'sign' ? 150 : mode === 'check' ? 12 : 170;
      const hPt = mode === 'sign' ? 50 : mode === 'check' ? 12 : 18;
      const w = wPt / p.w, h = hPt / p.h;
      const f: Field = {
        id: uid(), page: pageIdx, kind: mode === 'text' ? 'text' : mode,
        x: clamp(mode === 'text' ? fx - 0.01 : fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h,
        label: mode === 'text' ? (it ? 'Testo aggiunto' : 'Added text') : mode === 'check' ? (it ? 'Spunta' : 'Tick') : (it ? 'Firma' : 'Signature'),
        value: '', checked: mode === 'check', source: 'free',
      };
      setFields((prev) => [...prev, f]);
      setMode(null);
      if (mode === 'check') return;
      setSelected(f.id);
      if (mode === 'sign') setPadFor(f.id);
      return;
    }
    const now = Date.now();
    const lt = lastTap.current;
    if (lt && now - lt.t < 320 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30) {
      lastTap.current = null;
      const sr = scroller.current!.getBoundingClientRect();
      zoomTo(zoom > 1.6 ? 1 : 2.5, e.clientX - sr.left, e.clientY - sr.top);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    if (selected) setSelected(null);
  };

  /* --- trascina / ridimensiona i campi aggiunti o trovati automaticamente */
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; f: Field; pw: number; ph: number; moved: boolean } | null>(null);
  const startDrag = (e: React.PointerEvent, f: Field, m: 'move' | 'size') => {
    if (f.source === 'acro' || f.id !== selected) return;
    const pageEl = (e.currentTarget as HTMLElement).closest('[data-ff-page]') as HTMLElement;
    const r = pageEl.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: f.id, mode: m, sx: e.clientX, sy: e.clientY, f, pw: r.width, ph: r.height, moved: false };
    e.stopPropagation();
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.pw, dy = (e.clientY - d.sy) / d.ph;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    d.moved = true;
    if (d.mode === 'move') update(d.id, { x: clamp(d.f.x + dx, 0, 1 - d.f.w), y: clamp(d.f.y + dy, 0, 1 - d.f.h) });
    else update(d.id, { w: clamp(d.f.w + dx, 0.02, 1 - d.f.x), h: clamp(d.f.h + dy, 0.01, 1 - d.f.y) });
  };
  const endDrag = () => { drag.current = null; };

  const onFieldTap = (f: Field, e: React.MouseEvent) => {
    e.stopPropagation();
    if (drag.current?.moved) return;
    if ((f.kind === 'check' || f.kind === 'radio') && f.id === selected) { toggle(f); return; }
    if ((f.kind === 'check' || f.kind === 'radio') && !selected) { toggle(f); setSelected(f.id); return; }
    select(f);
  };

  /* --- salvataggio */
  const save = useCallback(async () => {
    setBusy(true);
    try {
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const helv = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const widthOf = (t: string, s: number) => helv.widthOfTextAtSize(pdfSafe(t), s);

      // 1) campi PDF veri
      const acro = fields.filter((f) => f.source === 'acro' && f.acroName && f.kind !== 'sign');
      if (acro.length) {
        try {
          const form = doc.getForm();
          try { if (form.hasXFA()) form.deleteXFA(); } catch { /* niente XFA */ }
          const done = new Set<string>();
          for (const f of acro) {
            const name = f.acroName!;
            try {
              if (f.kind === 'text' || f.kind === 'multiline') form.getTextField(name).setText(pdfSafe(f.value));
              else if (f.kind === 'check') {
                const cb = form.getCheckBox(name);
                if (f.checked) cb.check(); else cb.uncheck();
              } else if (f.kind === 'radio') {
                if (done.has(name)) continue;
                const on = acro.find((x) => x.acroName === name && x.checked);
                const g = form.getRadioGroup(name);
                if (on?.exportValue) g.select(on.exportValue); else g.clear();
                done.add(name);
              } else if (f.kind === 'choice' && f.value) {
                try { form.getDropdown(name).select(f.value); } catch { form.getOptionList(name).select(f.value); }
              }
            } catch {
              /* campo particolare: lo saltiamo */
            }
          }
          try { form.updateFieldAppearances(helv); } catch { /* aspetto predefinito */ }
        } catch {
          /* modulo illeggibile: scriviamo comunque il testo sopra */
        }
      }

      // 2) testo, spunte e firme disegnati sulla pagina
      for (const f of fields) {
        const drawn = f.source !== 'acro' || f.kind === 'sign';
        if (!drawn) continue;
        const hasContent = f.kind === 'check' ? f.checked : f.kind === 'sign' ? !!f.sig || !!f.value.trim() : !!f.value.trim();
        if (!hasContent) continue;
        const page = doc.getPage(f.page);
        const shown = pages[f.page];
        const crop = page.getCropBox();
        const rot = ((page.getRotation().angle % 360) + 360) % 360;
        const { x: cx, y: cy, width: W, height: H } = crop;
        // punto della pagina mostrata (frazioni) → coordinate PDF
        const at = (fx: number, fy: number) => {
          if (rot === 90) return { x: cx + fy * W, y: cy + fx * H };
          if (rot === 180) return { x: cx + (1 - fx) * W, y: cy + fy * H };
          if (rot === 270) return { x: cx + (1 - fy) * W, y: cy + (1 - fx) * H };
          return { x: cx + fx * W, y: cy + (1 - fy) * H };
        };
        const rotate = pdfLib.degrees(rot);
        const ptX = 1 / shown.w, ptY = 1 / shown.h; // un punto, in frazioni della pagina mostrata

        if (f.kind === 'check' || f.kind === 'radio') {
          // spunta disegnata come linea: si vede in qualsiasi lettore PDF
          const size = Math.min(f.w * shown.w, f.h * shown.h);
          const ox = f.x + (f.w * shown.w - size) / 2 * ptX;
          const oy = f.y + (f.h * shown.h - size) / 2 * ptY;
          const P = (u: number, v: number) => at(ox + u * size * ptX, oy + v * size * ptY);
          const ink = { thickness: Math.max(1, size * 0.13), color: pdfLib.rgb(0.05, 0.12, 0.45), lineCap: pdfLib.LineCapStyle.Round };
          page.drawLine({ start: P(0.18, 0.55), end: P(0.42, 0.8), ...ink });
          page.drawLine({ start: P(0.42, 0.8), end: P(0.84, 0.2), ...ink });
        } else if (f.kind === 'sign' && f.sig) {
          const img = await doc.embedPng(f.sig.dataUrl);
          const boxW = f.w * shown.w, boxH = f.h * shown.h;
          const s = Math.min(boxW / f.sig.width, boxH / f.sig.height);
          const w = f.sig.width * s, h = f.sig.height * s;
          const o = at(f.x + ((boxW - w) / 2) * ptX, f.y + f.h - ((boxH - h) / 2) * ptY);
          page.drawImage(img, { x: o.x, y: o.y, width: w, height: h, rotate });
        } else {
          const text = pdfSafe(f.value);
          if (f.kind === 'multiline') {
            const size = 11;
            const lines = wrap(text, size, f.w * shown.w - 6, widthOf);
            lines.forEach((ln, k) => {
              const o = at(f.x + 3 * ptX, f.y + (4 + size * (k + 0.85) * 1.2) * ptY);
              page.drawText(ln, { x: o.x, y: o.y, size, font: helv, rotate });
            });
          } else {
            const size = textSize({ ...f, value: text }, shown, widthOf);
            const base = f.y + f.h / 2 + (size * 0.36) * ptY; // linea di base centrata nel campo
            const o = at(f.x + 2 * ptX, base);
            page.drawText(text.replace(/\n/g, ' '), { x: o.x, y: o.y, size, font: helv, rotate });
          }
        }
      }

      const bytes = await doc.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '') + (it ? '_compilato.pdf' : '_filled.pdf');
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      try { localStorage.removeItem(draftKey); } catch { /* ok */ }
    } catch (e) {
      showToast((it ? 'Salvataggio non riuscito: ' : 'Save failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [fields, pages, file, it, draftKey, showToast]);

  /* ------------------------------------------------------------------ disegno */

  // Area di tocco: un po' più grande del campo, ma solo fin dove non tocca i campi vicini
  const margins = useMemo(() => {
    const m = new Map<string, { mx: number; my: number }>();
    for (const f of fields) {
      let mx = 1, my = 1;
      for (const o of fields) {
        if (o === f || o.page !== f.page) continue;
        const ovX = Math.min(f.x + f.w, o.x + o.w) - Math.max(f.x, o.x);
        const ovY = Math.min(f.y + f.h, o.y + o.h) - Math.max(f.y, o.y);
        if (ovX > 0) my = Math.min(my, Math.max(0, (o.y >= f.y + f.h ? o.y - (f.y + f.h) : f.y - (o.y + o.h)) / 2));
        if (ovY > 0) mx = Math.min(mx, Math.max(0, (o.x >= f.x + f.w ? o.x - (f.x + f.w) : f.x - (o.x + o.w)) / 2));
      }
      m.set(f.id, { mx, my });
    }
    return m;
  }, [fields]);

  const sheetOpen = !!sel;
  const label = (f: Field) => f.label || `${it ? 'Campo' : 'Field'} ${ordered.findIndex((x) => x.id === f.id) + 1}`;

  return (
    <AppFullscreen
      title={file.name}
      onClose={onClose}
      actions={
        <button
          type="button"
          onClick={save}
          disabled={busy || !!status}
          className="mr-1 flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--color-primary))] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {it ? 'Salva' : 'Save'}
        </button>
      }
    >
      <div className="flex h-full flex-col">
        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-auto bg-[hsl(var(--color-muted))]"
          style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onScroll={() => {
            window.clearTimeout(scrollTimer.current);
            scrollTimer.current = window.setTimeout(() => void renderVisible(), 200);
          }}
        >
          <div style={{ width: pageW + 2 * PAD, padding: `${PAD}px ${PAD}px ${sheetOpen ? '55vh' : `${PAD + 8}px`}` }}>
            {!status && !error && (
              <div className="mb-3 rounded-xl bg-[hsl(var(--color-background))] px-3 py-2.5 text-sm text-[hsl(var(--color-foreground))]" style={{ width: pageW1 }}>
                {fields.length ? (
                  <>
                    <b>{it ? `${fields.length} spazi da compilare` : `${fields.length} fields`}</b>
                    {it ? ' · tocca un riquadro giallo per scrivere. Pizzica o tocca due volte per ingrandire.' : ' · tap a yellow box to fill it. Pinch or double-tap to zoom.'}
                  </>
                ) : it ? (
                  <>Non ho trovato spazi da compilare: usa <b>Aa Testo</b> e tocca dove vuoi scrivere.</>
                ) : (
                  <>No fields found: use <b>Aa Text</b> and tap where you want to write.</>
                )}
              </div>
            )}
            {pages.map((p, i) => (
              <div
                key={i}
                data-ff-page={i}
                className={`relative bg-white shadow ${mode ? 'cursor-crosshair' : ''}`}
                style={{ width: pageW, height: pageW * (p.h / p.w), marginBottom: GAP }}
                onClick={(e) => onPageClick(i, e)}
              >
                {p.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.img} alt={`${it ? 'Pagina' : 'Page'} ${i + 1}`} className="pointer-events-none absolute inset-0 h-full w-full select-none" draggable={false} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                )}
                {fields.filter((f) => f.page === i).map((f) => {
                  const scale = pageW / p.w; // px per punto
                  const wpx = f.w * pageW, hpx = f.h * pageW * (p.h / p.w);
                  const mg = margins.get(f.id) || { mx: 0, my: 0 };
                  const pageHpx = pageW * (p.h / p.w);
                  const hitW = Math.max(wpx, Math.min(44, wpx + 2 * mg.mx * pageW));
                  const hitH = Math.max(hpx, Math.min(44, hpx + 2 * mg.my * pageHpx));
                  const isSel = f.id === selected;
                  const empty = f.kind === 'check' || f.kind === 'radio' ? !f.checked : f.kind === 'sign' ? !f.sig && !f.value : !f.value.trim();
                  const size = f.kind === 'text' || f.kind === 'choice' || f.kind === 'sign' ? textSize(f, p) * scale : 11 * scale;
                  return (
                    <div
                      key={f.id}
                      data-ff-field={f.id}
                      role="button"
                      tabIndex={0}
                      aria-label={label(f)}
                      onClick={(e) => onFieldTap(f, e)}
                      onKeyDown={(e) => { if (e.key === 'Enter') select(f); }}
                      onPointerDown={(e) => startDrag(e, f, 'move')}
                      className="absolute flex items-center justify-center"
                      style={{
                        left: `calc(${f.x * 100}% - ${(hitW - wpx) / 2}px)`,
                        top: `calc(${f.y * 100}% - ${(hitH - hpx) / 2}px)`,
                        width: hitW, height: hitH, zIndex: isSel ? 3 : 2,
                        touchAction: isSel && f.source !== 'acro' ? 'none' : undefined,
                      }}
                    >
                      <div
                        className="relative overflow-hidden"
                        style={{
                          width: wpx, height: hpx,
                          borderRadius: f.kind === 'radio' ? '50%' : 3,
                          background: !showBoxes && !isSel ? 'transparent' : empty ? 'rgba(255, 196, 0, 0.32)' : 'rgba(29, 58, 138, 0.07)',
                          outline: isSel ? '2.5px solid #1D3A8A' : showBoxes ? `1.5px ${empty ? 'solid' : 'dashed'} rgba(29, 58, 138, ${empty ? 0.6 : 0.35})` : 'none',
                          boxShadow: isSel ? '0 0 0 6px rgba(29, 58, 138, 0.18)' : undefined,
                          color: '#0b2a8a',
                          fontFamily: 'Helvetica, Arial, sans-serif',
                          fontSize: size,
                          lineHeight: f.kind === 'multiline' ? 1.2 : 1,
                        }}
                      >
                        {(f.kind === 'check' || f.kind === 'radio') && f.checked && (
                          <span className="absolute inset-0 flex items-center justify-center font-bold" style={{ fontSize: Math.min(wpx, hpx) * 0.95, lineHeight: 1 }}>
                            {f.kind === 'radio' ? '●' : '✓'}
                          </span>
                        )}
                        {f.kind === 'sign' && f.sig && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={f.sig.dataUrl} alt="" className="pointer-events-none h-full w-full object-contain" />
                        )}
                        {f.kind === 'sign' && !f.sig && !f.value && showBoxes && (
                          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-[#1D3A8A]/60">✍︎ {it ? 'firma' : 'sign'}</span>
                        )}
                        {(f.kind === 'text' || f.kind === 'choice' || (f.kind === 'sign' && !f.sig)) && f.value && (
                          <span className="absolute inset-y-0 left-0 flex items-center whitespace-pre" style={{ paddingLeft: 2 * scale }}>
                            {f.kind === 'choice' ? f.options?.find((o) => o.value === f.value)?.label ?? f.value : f.value}
                          </span>
                        )}
                        {f.kind === 'multiline' && f.value && (
                          <span className="absolute inset-0 whitespace-pre-wrap break-words" style={{ padding: `${4 * scale}px ${3 * scale}px` }}>{f.value}</span>
                        )}
                      </div>
                      {isSel && f.source !== 'acro' && (
                        <span
                          aria-label={it ? 'Ridimensiona' : 'Resize'}
                          onPointerDown={(e) => startDrag(e, f, 'size')}
                          className="absolute h-7 w-7 rounded-full border-2 border-white bg-[#1D3A8A] shadow"
                          style={{ left: (hitW + wpx) / 2 - 14, top: (hitH + hpx) / 2 - 14, touchAction: 'none' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {(status || error) && (
            <div className="absolute inset-x-4 top-6 flex items-center gap-3 rounded-2xl bg-[hsl(var(--color-background))] p-4 shadow">
              {status && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--color-primary))]" />}
              <span className={`text-sm ${error ? 'text-red-600' : ''}`}>{error ? `${it ? 'Impossibile aprire il PDF: ' : 'Cannot open PDF: '}${error}` : status}</span>
            </div>
          )}
        </div>

        {/* Barra degli strumenti */}
        {!sheetOpen && (
          <div className="shrink-0 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 pb-2 pt-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <button type="button" onClick={() => zoomTo(zoom / 1.4)} disabled={zoom <= MIN_ZOOM} aria-label={it ? 'Riduci' : 'Zoom out'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"><ZoomOut className="h-5 w-5" /></button>
                <button type="button" onClick={() => zoomTo(1)} className="h-11 min-w-[3.5rem] rounded-full text-sm font-semibold tabular-nums active:bg-[hsl(var(--color-muted))]">{Math.round(zoom * 100)}%</button>
                <button type="button" onClick={() => zoomTo(zoom * 1.4)} disabled={zoom >= MAX_ZOOM} aria-label={it ? 'Ingrandisci' : 'Zoom in'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"><ZoomIn className="h-5 w-5" /></button>
              </div>
              <div className="flex items-center">
                <button type="button" onClick={() => go(-1)} disabled={!fields.length} aria-label={it ? 'Campo precedente' : 'Previous field'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"><ChevronLeft className="h-6 w-6" /></button>
                <button type="button" onClick={() => go(1)} disabled={!fields.length} className="h-11 rounded-full px-2 text-sm font-semibold tabular-nums active:bg-[hsl(var(--color-muted))]">
                  {filled}/{fields.length} {it ? 'compilati' : 'filled'}
                </button>
                <button type="button" onClick={() => go(1)} disabled={!fields.length} aria-label={it ? 'Campo successivo' : 'Next field'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"><ChevronRight className="h-6 w-6" /></button>
              </div>
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {([
                ['text', <Type key="t" className="h-5 w-5" />, it ? 'Aa Testo' : 'Aa Text'],
                ['check', <Check key="c" className="h-5 w-5" />, it ? 'Spunta' : 'Tick'],
                ['sign', <PenLine key="s" className="h-5 w-5" />, it ? 'Firma' : 'Sign'],
              ] as const).map(([m, icon, lab]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(mode === m ? null : m); if (mode !== m) showToast(it ? 'Tocca il punto della pagina' : 'Tap the spot on the page'); }}
                  className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-xs font-medium ${mode === m ? 'bg-[hsl(var(--color-primary)/0.15)] text-[hsl(var(--color-primary))]' : 'active:bg-[hsl(var(--color-muted))]'}`}
                >
                  {icon}{lab}
                </button>
              ))}
              <button type="button" onClick={() => setShowBoxes((v) => !v)} className="flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-xs font-medium active:bg-[hsl(var(--color-muted))]">
                {showBoxes ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                {showBoxes ? (it ? 'Anteprima' : 'Preview') : (it ? 'Riquadri' : 'Boxes')}
              </button>
            </div>
          </div>
        )}

        {/* Pannello del campo selezionato */}
        {sel && (
          <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-3xl border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-4 pb-3 pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-base font-semibold">{label(sel)}</span>
              <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--color-muted-foreground))]">{selIndex + 1}/{ordered.length}</span>
              <button type="button" onClick={() => setSelected(null)} aria-label={it ? 'Chiudi' : 'Close'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-[hsl(var(--color-muted))]"><X className="h-5 w-5" /></button>
            </div>

            {sel.kind === 'text' && (
              <input
                key={sel.id}
                id={`ff-${sel.id}`}
                autoFocus
                value={sel.value}
                onChange={(e) => update(sel.id, { value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(1); } }}
                enterKeyHint="next"
                inputMode={inputModeFor(sel.label)}
                autoCapitalize={/cod.*fisc|iban|targa/i.test(sel.label) ? 'characters' : 'sentences'}
                className="h-12 w-full rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 text-[17px] outline-none focus:border-[hsl(var(--color-primary))]"
                placeholder={it ? 'Scrivi qui…' : 'Type here…'}
              />
            )}
            {sel.kind === 'multiline' && (
              <textarea
                key={sel.id}
                autoFocus
                rows={4}
                value={sel.value}
                onChange={(e) => update(sel.id, { value: e.target.value })}
                className="w-full rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2 text-[17px] outline-none focus:border-[hsl(var(--color-primary))]"
                placeholder={it ? 'Scrivi qui…' : 'Type here…'}
              />
            )}
            {sel.kind === 'text' && isDateLabel(sel.label) && (
              <button type="button" onClick={() => update(sel.id, { value: new Date().toLocaleDateString('it-IT') })} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--color-border))] px-3 py-2 text-sm">
                <CalendarDays className="h-4 w-4" /> {it ? 'Oggi' : 'Today'}
              </button>
            )}
            {(sel.kind === 'check' || sel.kind === 'radio') && (
              <button
                type="button"
                onClick={() => toggle(sel)}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold ${sel.checked ? 'bg-[hsl(var(--color-primary))] text-white' : 'border border-[hsl(var(--color-border))]'}`}
              >
                <Check className="h-5 w-5" /> {sel.checked ? (it ? 'Spuntata' : 'Ticked') : (it ? 'Tocca per spuntare' : 'Tap to tick')}
              </button>
            )}
            {sel.kind === 'choice' && (
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto">
                {(sel.options || []).map((o) => (
                  <button key={o.value} type="button" onClick={() => update(sel.id, { value: o.value })} className={`min-h-[44px] rounded-xl px-3 py-2 text-left text-sm ${sel.value === o.value ? 'bg-[hsl(var(--color-primary))] text-white' : 'border border-[hsl(var(--color-border))]'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {sel.kind === 'sign' && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setPadFor(sel.id)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--color-primary))] font-semibold text-white">
                  <PenLine className="h-5 w-5" /> {sel.sig ? (it ? 'Rifai la firma' : 'Redo signature') : (it ? 'Firma col dito' : 'Sign with finger')}
                </button>
                {sel.sig && (
                  <button type="button" onClick={() => update(sel.id, { sig: undefined })} className="h-12 rounded-xl border border-[hsl(var(--color-border))] px-4 text-sm">{it ? 'Togli' : 'Clear'}</button>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => go(-1)} className="flex h-11 items-center gap-1 rounded-xl border border-[hsl(var(--color-border))] px-3 text-sm font-medium"><ChevronLeft className="h-5 w-5" />{it ? 'Prec.' : 'Prev'}</button>
              {sel.source !== 'acro' && (
                <button
                  type="button"
                  onClick={() => { setFields((prev) => prev.filter((f) => f.id !== sel.id)); setSelected(null); }}
                  aria-label={it ? 'Elimina questo campo' : 'Delete this field'}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-[hsl(var(--color-border))] text-red-600"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
              <button type="button" onClick={() => go(1)} className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-[hsl(var(--color-primary))] text-sm font-semibold text-white">{it ? 'Successivo' : 'Next'}<ChevronRight className="h-5 w-5" /></button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-4 bottom-36 z-[80] rounded-xl bg-black/80 px-4 py-3 text-center text-sm text-white">{toast}</div>
      )}

      {padFor && (
        <SignaturePad
          it={it}
          onCancel={() => setPadFor(null)}
          onDone={(png) => { update(padFor, { sig: png }); setPadFor(null); }}
        />
      )}
    </AppFullscreen>
  );
}
