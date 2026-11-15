'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Download, Loader2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Type, Check, X, Minus, Signature, UserRound, Undo2, Trash2,
  CalendarDays, AArrowDown, AArrowUp, Move, Plus, Sparkles,
} from 'lucide-react';
import { AppFullscreen } from '@/components/app/AppFullscreen';
import { SignaturePad } from '@/components/app/SignaturePad';
import { loadPdfjs, loadPdfLib } from '@/lib/pdf/loader';
import { getSavedSignatures, saveSignature, type PDFCraftSignature } from '@/lib/pdf/signature-storage';
import { detectFields, toGray, labelForBox, humanizeFieldName, type TextBox } from '@/lib/app/form-detect';

/* ------------------------------------------------------------------ tipi */

type Kind = 'text' | 'multiline' | 'check' | 'radio' | 'choice' | 'sign' | 'mark' | 'line';
type MarkStyle = 'check' | 'cross' | 'dot';
type Tool = null | 'text' | MarkStyle | 'line' | 'sign';

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
  /** corpo del testo scelto a mano (punti) */
  size?: number;
  /** forma del segno per spunte e segni aggiunti */
  mark?: MarkStyle;
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
const GAP = 12; // spazio tra le pagine (px a zoom 1)
const PAD = 10; // margine attorno alle pagine (px a zoom 1)
const INK = '#0D1F73'; // inchiostro "penna blu"
const INK_RGB = [0.05, 0.12, 0.45] as const;
const BRAND = '#1D3A8A';
const PROFILE_KEY = 'ddocs-profile';

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

const isTextual = (f: Field) => f.kind === 'text' || f.kind === 'multiline';
const isTick = (f: Field) => f.kind === 'check' || f.kind === 'radio' || f.kind === 'mark';
/** Campi da "visitare" con Avanti/Indietro (le caselle si spuntano con un tocco). */
const isStop = (f: Field) => f.kind === 'text' || f.kind === 'multiline' || f.kind === 'choice' || f.kind === 'sign';
const isEmpty = (f: Field) =>
  isTick(f) ? !f.checked : f.kind === 'sign' ? !f.sig && !f.value.trim() : f.kind === 'line' ? false : !f.value.trim();

/** Corpo del testo (in punti): quello scelto, o proporzionato all'altezza; ridotto se non sta nel campo. */
function fontFor(f: Field, p: PageInfo, widthOf: (t: string, s: number) => number = measure): number {
  if (f.kind === 'multiline') return f.size ?? 11;
  const base = f.size ?? clamp(f.h * p.h * 0.62, 6, 14);
  if (f.source === 'free') return base;
  let s = base;
  while (s > 6 && widthOf(f.value, s) > f.w * p.w - 4) s -= 0.5;
  return s;
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

const isDateLabel = (l: string) => /\bdata\b|nat[oa](\/a)? il|^il$|giorno|scadenza|\bdate\b/i.test(l);
const inputModeFor = (l: string): React.HTMLAttributes<HTMLInputElement>['inputMode'] => {
  if (/e-?mail|pec\b/i.test(l)) return 'email';
  if (/tel|cell|telefono|fax/i.test(l)) return 'tel';
  if (/\bcap\b|importo|€|n\.\s*$|^n\.?$|numero|civico|anno|età|quantità/i.test(l)) return 'decimal';
  return 'text';
};

/* ------------------------------------------------------------------ profilo (compilazione automatica) */

type ProfileKey = 'nome' | 'cognome' | 'cf' | 'nascitaData' | 'nascitaLuogo' | 'indirizzo' | 'citta' | 'cap' | 'prov' | 'tel' | 'email';
type Profile = Partial<Record<ProfileKey, string>>;

const PROFILE_FIELDS: { k: ProfileKey; it: string; en: string; re: RegExp; mode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }[] = [
  { k: 'nascitaData', it: 'Data di nascita', en: 'Date of birth', re: /nat[oa](\/a)?\s+il|data\s+di\s+nascita|nascita.*\bdata|date of birth|birth\s*date/i },
  { k: 'nascitaLuogo', it: 'Luogo di nascita', en: 'Place of birth', re: /nat[oa](\/a)?\s+a\b|luogo\s+di\s+nascita|comune\s+di\s+nascita|place of birth/i },
  { k: 'cf', it: 'Codice fiscale', en: 'Tax code', re: /codice\s*fiscale|cod\.?\s*fisc|^c\.?\s?f\.?$|tax\s*code/i },
  { k: 'email', it: 'Email', en: 'Email', re: /e-?mail|\bpec\b/i, mode: 'email' },
  { k: 'tel', it: 'Telefono', en: 'Phone', re: /telefono|\btel\b|cellulare|\bcell\b|phone|mobile/i, mode: 'tel' },
  { k: 'cap', it: 'CAP', en: 'Postcode', re: /\bc\.?a\.?p\.?\b|\bzip\b|postal|postcode/i, mode: 'numeric' },
  { k: 'prov', it: 'Provincia', en: 'Province', re: /\bprov\b|provincia/i },
  { k: 'cognome', it: 'Cognome', en: 'Surname', re: /cognome|surname|last\s*name/i },
  { k: 'nome', it: 'Nome', en: 'First name', re: /\bnome\b|first\s*name|^name$/i },
  { k: 'indirizzo', it: 'Indirizzo', en: 'Address', re: /indirizzo|\bvia\b|address/i },
  { k: 'citta', it: 'Città', en: 'City', re: /citt[aà]|\bcomune\b|residente\s+a\b|localit|\bcity\b|\btown\b/i },
];
const FULL_NAME_RE = /nome\s+e\s+cognome|cognome\s+e\s+nome|nominativo|sottoscritt|full\s*name/i;

/** Per le celle di tabella ("Telefono · Note") conta la riga solo se la colonna è quella del valore. */
function mainLabel(label: string): string | null {
  const parts = label.split(' · ');
  if (parts.length > 1 && /note|osservazion|comment|descrizion/i.test(parts[parts.length - 1])) return null;
  return parts[0];
}

function profileKeyFor(raw: string): ProfileKey | null {
  const label = mainLabel(raw);
  if (!label || FULL_NAME_RE.test(label)) return null;
  for (const p of PROFILE_FIELDS) if (p.re.test(label)) return p.k;
  return null;
}

function suggestionsFor(raw: string, pr: Profile): string[] {
  const label = mainLabel(raw);
  if (!label) return [];
  if (FULL_NAME_RE.test(label)) {
    const out: string[] = [];
    if (pr.nome && pr.cognome) out.push(`${pr.nome} ${pr.cognome}`, `${pr.cognome} ${pr.nome}`);
    return out;
  }
  const k = profileKeyFor(label);
  return k && pr[k] ? [pr[k]!] : [];
}

function loadProfile(): Profile {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') as Profile; } catch { return {}; }
}

/* ------------------------------------------------------------------ disegno dei segni */

function MarkGlyph({ style, color = INK }: { style: MarkStyle; color?: string }) {
  return (
    <svg viewBox="0 0 1 1" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {style === 'dot' ? (
        <circle cx="0.5" cy="0.5" r="0.27" fill={color} />
      ) : style === 'cross' ? (
        <path d="M0.2 0.2 L0.8 0.8 M0.8 0.2 L0.2 0.8" stroke={color} strokeWidth="0.13" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M0.18 0.55 L0.42 0.8 L0.84 0.2" stroke={color} strokeWidth="0.13" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      )}
    </svg>
  );
}

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
  const [menu, setMenu] = useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const [padFor, setPadFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>({});
  const [savedSigs, setSavedSigs] = useState<PDFCraftSignature[]>([]);
  const [histLen, setHistLen] = useState(0);
  const [kbTick, setKbTick] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const noFormsMode = useRef<number | undefined>(undefined);
  const fieldsRef = useRef<Field[]>([]);
  fieldsRef.current = fields;
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const hist = useRef<Field[][]>([]);
  const editSnap = useRef<string | null>(null);
  const pendingCommit = useRef<{ left: number; top: number } | null>(null);
  const animating = useRef(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  const draftKey = `ddocs-form:${file.name}:${file.size}:${file.lastModified}`;

  const showToast = useCallback((m: string, ms = 2800) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), ms);
  }, []);

  useEffect(() => {
    setProfile(loadProfile());
    try { setSavedSigs(getSavedSignatures()); } catch { /* nessuna */ }
  }, []);

  /* --- storia per "Annulla" */
  const snapshot = useCallback(() => {
    hist.current.push(fieldsRef.current);
    if (hist.current.length > 60) hist.current.shift();
    setHistLen(hist.current.length);
  }, []);
  const undo = useCallback(() => {
    const prev = hist.current.pop();
    setHistLen(hist.current.length);
    if (!prev) return;
    editSnap.current = null;
    setSelected(null);
    setMenu(false);
    setFields(prev.filter((f) => !(f.source === 'free' && f.kind === 'text' && !f.value.trim())));
  }, []);

  /* --- dimensioni dell'area: larghezza per le pagine, altezza per la tastiera */
  const lastH = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCw(el.clientWidth);
      if (Math.abs(el.clientHeight - lastH.current) > 40) setKbTick((n) => n + 1);
      lastH.current = el.clientHeight;
    });
    ro.observe(el);
    setCw(el.clientWidth);
    lastH.current = el.clientHeight;
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

          const texts: TextBox[] = [];
          try {
            const tc = await pg.getTextContent();
            for (const raw of tc.items) {
              const item = raw as PdfTextItem;
              if (typeof item.str !== 'string' || !item.str.trim()) continue;
              const tx = pdfjs.Util.transform(vp.transform, item.transform);
              if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue;
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

        let restored: Field[] | null = null;
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const d = JSON.parse(raw) as { fields: Field[] };
            if (Array.isArray(d.fields) && d.fields.length) restored = d.fields;
          }
        } catch {
          /* niente bozza */
        }
        const list = restored || all;
        setFields(list);
        setStatus(null);
        const pr = loadProfile();
        const canFill = list.filter((f) => isTextual(f) && !f.value && suggestionsFor(f.label, pr).length).length;
        if (restored) showToast(it ? 'Ho ripreso la compilazione lasciata a metà' : 'Restored your unfinished draft');
        else if (list.length)
          showToast(
            it
              ? `Trovati ${list.length} spazi da compilare: tocca un riquadro blu.${canFill ? ` ${canFill} si possono riempire dal Profilo.` : ''}`
              : `Found ${list.length} fields: tap a blue box.`,
            4500,
          );
        else showToast(it ? 'Nessuno spazio trovato: tocca dove vuoi scrivere.' : 'No fields found: tap where you want to write.', 4500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, it, draftKey, showToast]);

  /* --- bozza salvata mentre compili */
  useEffect(() => {
    if (status || !fields.length) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ fields })); } catch { /* spazio pieno */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [fields, status, draftKey]);

  /* --- geometria (a zoom 1 tutto è lineare: a zoom z basta moltiplicare) */
  const pageW1 = Math.max(100, cw - 2 * PAD);
  const pageW = pageW1 * zoom;
  const tops1 = useMemo(() => {
    const t: number[] = [];
    let y = PAD;
    for (const p of pages) { t.push(y); y += pageW1 * (p.h / p.w) + GAP; }
    t.push(y - GAP + PAD); // fine del contenuto
    return t;
  }, [pages, pageW1]);
  const contentH1 = tops1[tops1.length - 1] || 0;

  const sel = fields.find((f) => f.id === selected) || null;
  const typing = !!sel && (isTextual(sel) || sel.kind === 'choice' || sel.kind === 'sign');
  const extraBottom = typing ? Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5) : 96;

  /** Rettangolo di un campo in coordinate del contenuto, a zoom z. */
  const fieldRect = useCallback((f: Field, z: number) => {
    const p = pages[f.page];
    const ph1 = pageW1 * (p.h / p.w);
    return { x: z * (PAD + f.x * pageW1), y: z * (tops1[f.page] + f.y * ph1), w: z * f.w * pageW1, h: z * f.h * ph1 };
  }, [pages, pageW1, tops1]);

  /* --- immagini delle pagine alla risoluzione giusta per lo zoom */
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

  /* ------------------------------------------------------------------ zoom fluido
   * Durante il gesto si scala il contenuto con una trasformazione CSS (niente ricalcoli);
   * alla fine si "fissa" lo zoom: la pagina si ridisegna alla nuova misura nella stessa posizione. */

  const commit = useCallback((z: number, left: number, top: number) => {
    const el = scroller.current, c = content.current;
    if (!el || !c) return;
    if (Math.abs(z - zoomRef.current) < 1e-4) {
      c.style.transition = '';
      c.style.transform = '';
      el.scrollLeft = left;
      el.scrollTop = top;
      animating.current = false;
      return;
    }
    pendingCommit.current = { left, top };
    setZoom(z);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current, c = content.current;
    const pc = pendingCommit.current;
    if (!el || !c || !pc) return;
    pendingCommit.current = null;
    c.style.transition = '';
    c.style.transform = '';
    el.scrollLeft = pc.left;
    el.scrollTop = pc.top;
    animating.current = false;
  }, [zoom]);

  /** Limiti di scorrimento a zoom z. */
  const limits = useCallback((z: number) => {
    const el = scroller.current!;
    return {
      maxL: Math.max(0, cw * z - el.clientWidth),
      maxT: Math.max(0, contentH1 * z + extraBottom - el.clientHeight),
    };
  }, [cw, contentH1, extraBottom]);

  /** Anima fino a zoom z1 con lo scorrimento (left, top), poi fissa. */
  const animateTo = useCallback((z1: number, left: number, top: number, ms = 240) => {
    const el = scroller.current, c = content.current;
    if (!el || !c) return;
    const z0 = zoomRef.current;
    const { maxL, maxT } = limits(z1);
    const L = clamp(left, 0, maxL), T = clamp(top, 0, maxT);
    if (Math.abs(z1 - z0) < 1e-4) {
      el.scrollTo({ left: L, top: T, behavior: 'smooth' });
      return;
    }
    const k = z1 / z0;
    animating.current = true;
    c.style.transformOrigin = '0 0';
    c.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`;
    // un punto Q del contenuto finisce in Q*k - (L,T): la traslazione compensa lo scorrimento attuale
    c.style.transform = `translate(${el.scrollLeft - L}px, ${el.scrollTop - T}px) scale(${k})`;
    window.setTimeout(() => commit(z1, L, T), ms + 10);
  }, [commit, limits]);

  /** Zoom centrato su un punto dello schermo (coordinate rispetto all'area). */
  const zoomAt = useCallback((z: number, cx: number, cy: number) => {
    const el = scroller.current;
    if (!el) return;
    const z1 = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const k = z1 / zoomRef.current;
    animateTo(z1, (el.scrollLeft + cx) * k - cx, (el.scrollTop + cy) * k - cy);
  }, [animateTo]);

  // pizzico con due dita (listener non passivi per bloccare lo scorrimento del browser)
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const animateRef = useRef(animateTo);
  animateRef.current = animateTo;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let g: { d0: number; P0x: number; P0y: number; s0x: number; s0y: number; k: number; mx: number; my: number } | null = null;
    const mid = (t: TouchList) => {
      const r = el.getBoundingClientRect();
      return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2 || animating.current) return;
      const m = mid(e.touches);
      g = { d0: Math.max(10, m.d), P0x: el.scrollLeft + m.x, P0y: el.scrollTop + m.y, s0x: el.scrollLeft, s0y: el.scrollTop, k: 1, mx: m.x, my: m.y };
      const c = content.current!;
      c.style.transition = '';
      c.style.transformOrigin = '0 0';
      c.style.willChange = 'transform';
    };
    const move = (e: TouchEvent) => {
      if (!g || e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      const z0 = zoomRef.current;
      const zv = clamp(z0 * (m.d / g.d0), MIN_ZOOM * 0.75, MAX_ZOOM * 1.2);
      g.k = zv / z0; g.mx = m.x; g.my = m.y;
      const tx = m.x + g.s0x - g.P0x * g.k;
      const ty = m.y + g.s0y - g.P0y * g.k;
      content.current!.style.transform = `translate(${tx}px, ${ty}px) scale(${g.k})`;
    };
    const end = (e: TouchEvent) => {
      if (!g || e.touches.length >= 2) return;
      const gg = g;
      g = null;
      const c = content.current!;
      c.style.willChange = '';
      const z0 = zoomRef.current;
      const z1 = clamp(z0 * gg.k, MIN_ZOOM, MAX_ZOOM);
      const k1 = z1 / z0;
      const L = gg.P0x * k1 - gg.mx, T = gg.P0y * k1 - gg.my;
      const { maxL, maxT } = limitsRef.current(z1);
      const Lc = clamp(L, 0, maxL), Tc = clamp(T, 0, maxT);
      if (Math.abs(k1 - gg.k) > 1e-3 || Math.abs(Lc - L) > 1 || Math.abs(Tc - T) > 1) {
        // fuori dai limiti: torna dentro con un'animazione breve
        animating.current = true;
        c.style.transition = 'transform 200ms cubic-bezier(.2,.8,.2,1)';
        c.style.transform = `translate(${gg.s0x - Lc}px, ${gg.s0y - Tc}px) scale(${k1})`;
        window.setTimeout(() => {
          // durante il gesto lo scorrimento non è cambiato: la traslazione è rispetto a s0
          commitRef.current(z1, Lc, Tc);
        }, 210);
      } else {
        commitRef.current(z1, Lc, Tc);
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  /* ------------------------------------------------------------------ campi */

  const ordered = useMemo(
    () => [...fields].sort((a, b) => a.page - b.page || (Math.abs(a.y - b.y) < 0.008 ? a.x - b.x : a.y - b.y)),
    [fields],
  );
  const stops = useMemo(() => ordered.filter(isStop), [ordered]);
  const selStop = sel ? stops.findIndex((f) => f.id === sel.id) : -1;
  const doneCount = stops.filter((f) => !isEmpty(f)).length;

  const update = useCallback((id: string, patch: Partial<Field>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  /** Testo aggiunto: la casella si allarga col testo. */
  const freeBox = useCallback((f: Field, value: string, size: number): Partial<Field> => {
    const p = pages[f.page];
    const wPt = Math.max(36, measure(value || ' ', size) + size * 0.9 + 4);
    return { value, size, w: Math.min(wPt / p.w, 1 - f.x), h: (size * 1.45) / p.h };
  }, [pages]);

  const setValue = useCallback((f: Field, value: string) => {
    if (editSnap.current !== f.id) { snapshot(); editSnap.current = f.id; }
    if (f.source === 'free' && f.kind === 'text') update(f.id, freeBox(f, value, f.size ?? 11));
    else update(f.id, { value });
  }, [snapshot, update, freeBox]);

  const toggle = useCallback((f: Field, style?: MarkStyle) => {
    snapshot();
    setFields((prev) => prev.map((x) => {
      if (f.kind === 'radio') {
        if (x.acroName === f.acroName && x.kind === 'radio') return { ...x, checked: x.id === f.id ? !f.checked : false };
        return x;
      }
      if (x.id !== f.id) return x;
      // con lo strumento ✗ o ● su una casella già spuntata in altro modo: cambia solo il segno
      if (style && x.checked && (x.mark ?? 'check') !== style) return { ...x, mark: style };
      return { ...x, checked: !x.checked, mark: style ?? x.mark };
    }));
  }, [snapshot]);

  /** Chiude il campo aperto: toglie i testi aggiunti rimasti vuoti e ricorda i dati nel profilo. */
  const leave = useCallback((id: string | null) => {
    const cur = fieldsRef.current.find((f) => f.id === id);
    if (!cur) return;
    if (cur.source === 'free' && cur.kind === 'text' && !cur.value.trim()) {
      setFields((prev) => prev.filter((f) => f.id !== cur.id));
    } else if (cur.kind === 'text' && cur.source !== 'free' && cur.value.trim()) {
      const k = profileKeyFor(cur.label);
      if (k) {
        setProfile((pr) => {
          if (pr[k]) return pr;
          const next = { ...pr, [k]: cur.value.trim() };
          try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* ok */ }
          return next;
        });
      }
    }
  }, []);
  const deselect = useCallback(() => {
    leave(selected);
    editSnap.current = null;
    setSelected(null);
    setMenu(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [selected, leave]);

  /** Porta il campo in vista; se il testo sarebbe troppo piccolo, ingrandisce (con animazione). */
  const focusField = useCallback((f: Field) => {
    const el = scroller.current;
    const p = pages[f.page];
    if (!el || !p) return;
    const z0 = zoomRef.current;
    let z1 = z0;
    if (isTextual(f)) {
      const fontPx1 = fontFor(f, p) * (pageW1 / p.w);
      const zh = 18 / Math.max(1, fontPx1); // testo di circa 18 px sullo schermo
      const zw = (el.clientWidth - 28) / Math.max(1, f.w * pageW1); // campo intero nello schermo
      const target = clamp(zh <= zw ? zh : Math.max(zw, Math.min(zh, 2.2)), MIN_ZOOM, 4);
      if (z0 < target * 0.85 || z0 > target * 1.9) z1 = target;
    }
    const r = fieldRect(f, z1);
    const vw = el.clientWidth, vh = el.clientHeight;
    const left = r.w <= vw - 28 ? r.x + r.w / 2 - vw / 2 : r.x - 14;
    const top = r.y - Math.min(vh * 0.28, 160);
    const inView = (() => {
      const cur = fieldRect(f, z0);
      return cur.x >= el.scrollLeft && cur.x + Math.min(cur.w, vw - 28) <= el.scrollLeft + vw && cur.y >= el.scrollTop + 8 && cur.y + cur.h <= el.scrollTop + vh * 0.55;
    })();
    if (z1 === z0 && inView) return;
    animateTo(z1, left, top);
  }, [pages, pageW1, fieldRect, animateTo]);

  /** Dopo l'apertura/chiusura della tastiera: rimette in vista il campo aperto. */
  useEffect(() => {
    if (!selected) return;
    const el = scroller.current;
    const node = el?.querySelector<HTMLElement>(`[data-ff-box="${selected}"]`);
    if (!el || !node) return;
    const sr = el.getBoundingClientRect(), nr = node.getBoundingClientRect();
    let dy = 0, dx = 0;
    if (nr.bottom > sr.bottom - 16) dy = nr.top - sr.top - Math.min(sr.height * 0.3, 120);
    else if (nr.top < sr.top + 8) dy = nr.top - sr.top - 24;
    if (nr.left < sr.left) dx = nr.left - sr.left - 14;
    if (dx || dy) el.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbTick]);

  /** Mentre scrivi, il cursore resta sullo schermo. */
  useEffect(() => {
    if (!sel || sel.kind !== 'text') return;
    const el = scroller.current;
    const inp = document.getElementById(`ff-${sel.id}`) as HTMLInputElement | null;
    if (!el || !inp) return;
    const p = pages[sel.page];
    const scale = pageW / p.w;
    const caret = measure(sel.value.slice(0, inp.selectionStart ?? sel.value.length), fontFor(sel, p)) * scale + 2 * scale;
    const sr = el.getBoundingClientRect(), ir = inp.getBoundingClientRect();
    const x = ir.left + caret;
    if (x > sr.right - 28) el.scrollBy({ left: x - sr.right + sr.width * 0.35 });
    else if (x < sr.left + 8) el.scrollBy({ left: x - sr.left - sr.width * 0.3 });
  }, [sel, pages, pageW]);

  const select = useCallback((f: Field, opts?: { menu?: boolean }) => {
    if (selected && selected !== f.id) leave(selected);
    editSnap.current = null;
    setSelected(f.id);
    setMenu(!!opts?.menu || f.source === 'free' || (isTextual(f) && f.source !== 'acro'));
    focusField(f);
  }, [selected, focusField, leave]);

  const go = (dir: 1 | -1, onlyEmpty = false) => {
    const list = onlyEmpty ? stops.filter((f) => isEmpty(f) || f.id === selected) : stops;
    if (!list.length) { if (onlyEmpty) showToast(it ? 'Tutti i campi sono compilati 👍' : 'All fields are filled 👍'); return; }
    const cur = list.findIndex((f) => f.id === selected);
    let i: number;
    if (cur >= 0) i = cur + dir;
    else {
      // dal punto della pagina che stai guardando
      const el = scroller.current!;
      const y = el.scrollTop;
      const z = zoomRef.current;
      i = dir > 0 ? list.findIndex((f) => fieldRect(f, z).y >= y - 4) : -1;
      if (i < 0) i = dir > 0 ? 0 : list.length - 1;
    }
    if (i >= list.length || i < 0) {
      if (onlyEmpty && list.filter(isEmpty).length === 0) { deselect(); showToast(it ? 'Tutti i campi sono compilati 👍' : 'All fields are filled 👍'); return; }
      i = (i + list.length) % list.length;
    }
    const f = list[i];
    select(f);
    if (f.kind === 'sign' && !f.sig && !savedSigs.length) setPadFor(f.id);
  };

  // tasto Indietro di Android: prima chiude pannelli e strumenti
  useEffect(() => {
    if (!selected && !tool && !profileOpen) return;
    const stack = (window.__pdfcraftBackStack ||= []);
    const fn = () => {
      if (profileOpen) setProfileOpen(false);
      else if (selected) deselect();
      else setTool(null);
      return true;
    };
    stack.push(fn);
    return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1); };
  }, [selected, tool, profileOpen, deselect]);

  /* --- aggiunta di elementi dove tocchi */
  const addAt = useCallback((t: Exclude<Tool, null>, pageIdx: number, fx: number, fy: number, deferZoom = false): string | undefined => {
    const p = pages[pageIdx];
    snapshot();
    if (t === 'text') {
      const size = 11;
      const base: Field = {
        id: uid(), page: pageIdx, kind: 'text', x: clamp(fx - 2 / p.w, 0, 0.98), y: 0, w: 0, h: 0,
        label: it ? 'Testo' : 'Text', value: '', checked: false, source: 'free', size,
      };
      const box = freeBox(base, '', size);
      const f = { ...base, ...box, y: clamp(fy - (box.h as number) / 2, 0, 1 - (box.h as number)) };
      setFields((prev) => [...prev, f]);
      editSnap.current = f.id;
      setSelected(f.id);
      setMenu(true);
      window.clearTimeout(zoomTimer.current);
      if (deferZoom) zoomTimer.current = window.setTimeout(() => focusField(f), 320);
      else focusField(f);
      return f.id;
    }
    if (t === 'line') {
      const w = 90 / p.w, h = 10 / p.h;
      const f: Field = { id: uid(), page: pageIdx, kind: 'line', x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h, label: it ? 'Linea' : 'Line', value: '', checked: true, source: 'free' };
      setFields((prev) => [...prev, f]);
      setSelected(f.id);
      setMenu(true);
      return;
    }
    if (t === 'sign') {
      const last = savedSigs[0];
      const wPt = 140;
      const hPt = last ? (wPt * last.height) / last.width : 46;
      const w = wPt / p.w, h = hPt / p.h;
      const f: Field = {
        id: uid(), page: pageIdx, kind: 'sign', x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h,
        label: it ? 'Firma' : 'Signature', value: '', checked: false, source: 'free',
        sig: last ? { dataUrl: last.dataUrl, width: last.width, height: last.height } : undefined,
      };
      setFields((prev) => [...prev, f]);
      setSelected(f.id);
      setMenu(true);
      if (!last) setPadFor(f.id);
      return;
    }
    // ✓ ✗ ●
    const s = 11;
    const w = s / p.w, h = s / p.h;
    const f: Field = {
      id: uid(), page: pageIdx, kind: 'mark', mark: t, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h,
      label: t === 'check' ? (it ? 'Spunta' : 'Tick') : t === 'cross' ? (it ? 'Croce' : 'Cross') : (it ? 'Punto' : 'Dot'),
      value: '', checked: true, source: 'free',
    };
    setFields((prev) => [...prev, f]);
  }, [pages, it, snapshot, freeBox, focusField, savedSigs]);

  /* --- tocchi sulla pagina */
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const zoomTimer = useRef<number | undefined>(undefined);
  /** testo appena creato con un tocco: se arriva subito un secondo tocco era un doppio tocco (zoom) */
  const justCreated = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const dropJustCreated = () => {
    const jc = justCreated.current;
    justCreated.current = null;
    window.clearTimeout(zoomTimer.current);
    if (!jc) return;
    const f = fieldsRef.current.find((x) => x.id === jc.id);
    if (!f || f.value) return;
    hist.current.pop();
    setHistLen(hist.current.length);
    setFields((prev) => prev.filter((x) => x.id !== jc.id));
    editSnap.current = null;
    setSelected(null);
    setMenu(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const onPageClick = (pageIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (animating.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const now = Date.now();
    const lt = lastTap.current;
    const isDouble = !!lt && now - lt.t < 300 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30;
    lastTap.current = isDouble ? null : { t: now, x: e.clientX, y: e.clientY };

    if (tool) {
      addAt(tool, pageIdx, fx, fy);
      if (tool === 'text' || tool === 'sign' || tool === 'line') setTool(null);
      return;
    }
    if (isDouble) {
      dropJustCreated();
      const sr = scroller.current!.getBoundingClientRect();
      zoomAt(zoomRef.current > 1.6 ? 1 : 2.5, e.clientX - sr.left, e.clientY - sr.top);
      return;
    }
    // tocco vicino a un campo (entro ~22 px): apre quel campo
    const pageW_ = r.width, pageH_ = r.height;
    let best: Field | null = null, bd = 22;
    for (const f of fieldsRef.current) {
      if (f.page !== pageIdx) continue;
      const dx = Math.max(f.x - fx, 0, fx - (f.x + f.w)) * pageW_;
      const dy = Math.max(f.y - fy, 0, fy - (f.y + f.h)) * pageH_;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = f; }
    }
    if (best) { onFieldTap(best); return; }
    if (selected) { deselect(); return; }
    // tocco su uno spazio vuoto: scrivi lì
    const id = addAt('text', pageIdx, fx, fy, true);
    if (id) justCreated.current = { id, t: now, x: e.clientX, y: e.clientY };
  };

  /* --- tocchi sui campi: tocco, pressione lunga, trascinamento */
  const press = useRef<{ id: string; x: number; y: number; timer: number; fired: boolean } | null>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; f: Field; pw: number; ph: number; moved: boolean } | null>(null);

  const onFieldTap = (f: Field) => {
    if (tool && tool !== 'text' && tool !== 'sign' && tool !== 'line' && (f.kind === 'check' || f.kind === 'radio')) { toggle(f, f.kind === 'check' ? tool : undefined); return; }
    if (f.id === selected) return;
    if (f.kind === 'check' || f.kind === 'radio') {
      if (selected) deselect();
      toggle(f);
      return;
    }
    select(f);
    if (f.kind === 'sign' && !f.sig && !savedSigs.length) setPadFor(f.id);
  };

  const startDrag = (e: React.PointerEvent, f: Field, mode: 'move' | 'size') => {
    const pageEl = (e.currentTarget as HTMLElement).closest('[data-ff-page]') as HTMLElement;
    const r = pageEl.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: f.id, mode, sx: e.clientX, sy: e.clientY, f, pw: r.width, ph: r.height, moved: false };
    e.stopPropagation();
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    if (!d.moved) snapshot();
    d.moved = true;
    const dx = (e.clientX - d.sx) / d.pw, dy = (e.clientY - d.sy) / d.ph;
    if (d.mode === 'move') update(d.id, { x: clamp(d.f.x + dx, 0, 1 - d.f.w), y: clamp(d.f.y + dy, 0, 1 - d.f.h) });
    else {
      const w = clamp(d.f.w + dx, 0.02, 1 - d.f.x);
      if (d.f.kind === 'sign' && d.f.sig && d.f.source === 'free') {
        const p = pages[d.f.page];
        update(d.id, { w, h: Math.min(1 - d.f.y, (w * p.w * (d.f.sig.height / d.f.sig.width)) / p.h) });
      } else if (d.f.kind === 'line') update(d.id, { w });
      else update(d.id, { w, h: clamp(d.f.h + dy, 0.01, 1 - d.f.y) });
    }
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) e.stopPropagation();
    window.setTimeout(() => { drag.current = null; }, 0);
  };

  const onFieldPointerDown = (e: React.PointerEvent, f: Field) => {
    if (f.id === selected && f.source === 'free' && (f.kind === 'mark' || f.kind === 'line' || f.kind === 'sign')) { startDrag(e, f, 'move'); return; }
    if (f.id === selected) return;
    const id = f.id;
    const timer = window.setTimeout(() => {
      if (press.current?.id !== id) return;
      press.current.fired = true;
      try { navigator.vibrate?.(12); } catch { /* ok */ }
      if (selected && selected !== id) deselect();
      editSnap.current = null;
      setSelected(id);
      setMenu(true);
    }, 480);
    press.current = { id, x: e.clientX, y: e.clientY, timer, fired: false };
  };
  const onFieldPointerMove = (e: React.PointerEvent) => {
    if (drag.current) { moveDrag(e); return; }
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { window.clearTimeout(p.timer); press.current = null; }
  };
  const onFieldPointerUp = (e: React.PointerEvent) => {
    if (press.current && !press.current.fired) { window.clearTimeout(press.current.timer); press.current = null; }
    endDrag(e);
  };
  const onFieldClick = (e: React.MouseEvent, f: Field) => {
    e.stopPropagation();
    if (press.current?.fired) { press.current = null; return; }
    press.current = null;
    if (drag.current?.moved) return;
    if (tool && !((f.kind === 'check' || f.kind === 'radio') && tool !== 'text' && tool !== 'sign' && tool !== 'line')) {
      // con uno strumento attivo si aggiunge l'elemento dove hai toccato, anche sopra un campo
      const pageEl = (e.currentTarget as HTMLElement).closest('[data-ff-page]') as HTMLElement;
      const r = pageEl.getBoundingClientRect();
      addAt(tool, f.page, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      if (tool === 'text' || tool === 'sign' || tool === 'line') setTool(null);
      return;
    }
    // doppio tocco (anche sopra un campo) = zoom
    const now = Date.now();
    const lt = lastTap.current;
    const isDouble = !!lt && now - lt.t < 300 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30;
    lastTap.current = isDouble ? null : { t: now, x: e.clientX, y: e.clientY };
    if (isDouble) {
      const jc = justCreated.current;
      if (jc && jc.id === f.id) dropJustCreated();
      else if (animating.current) return;
      const sr = scroller.current!.getBoundingClientRect();
      zoomAt(zoomRef.current > 1.6 ? 1 : 2.5, e.clientX - sr.left, e.clientY - sr.top);
      return;
    }
    if (animating.current) return;
    onFieldTap(f);
  };

  /* --- piccoli comandi sull'elemento selezionato */
  const resize = (f: Field, dir: 1 | -1) => {
    const p = pages[f.page];
    snapshot();
    editSnap.current = null;
    if (isTextual(f)) {
      const size = clamp(Math.round(fontFor(f, p)) + dir, 6, 30);
      if (f.source === 'free' && f.kind === 'text') update(f.id, freeBox(f, f.value, size));
      else update(f.id, { size });
    } else {
      const k = dir > 0 ? 1.2 : 1 / 1.2;
      const w = clamp(f.w * k, 4 / p.w, 0.5), h = clamp(f.h * k, 4 / p.h, 0.5);
      update(f.id, { w, h, x: clamp(f.x + (f.w - w) / 2, 0, 1 - w), y: clamp(f.y + (f.h - h) / 2, 0, 1 - h) });
    }
  };
  const remove = (f: Field) => {
    snapshot();
    setFields((prev) => prev.filter((x) => x.id !== f.id));
    editSnap.current = null;
    setSelected(null);
    setMenu(false);
  };

  /* --- profilo */
  const fillable = useMemo(
    () => fields.filter((f) => f.kind === 'text' && !f.value.trim() && suggestionsFor(f.label, profile).length),
    [fields, profile],
  );
  const fillFromProfile = () => {
    if (!fillable.length) return;
    snapshot();
    const ids = new Map(fillable.map((f) => [f.id, suggestionsFor(f.label, profile)[0]]));
    setFields((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, value: ids.get(f.id)! } : f)));
    setProfileOpen(false);
    showToast(it ? (ids.size === 1 ? 'Compilato 1 campo dal profilo' : `Compilati ${ids.size} campi dal profilo`) : `Filled ${ids.size} fields from your profile`);
  };
  const saveProfile = (next: Profile) => {
    setProfile(next);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* ok */ }
  };

  /* --- salvataggio */
  const save = useCallback(async () => {
    if (selected) deselect();
    setBusy(true);
    try {
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const helv = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const widthOf = (t: string, s: number) => helv.widthOfTextAtSize(pdfSafe(t), s);
      const ink = pdfLib.rgb(INK_RGB[0], INK_RGB[1], INK_RGB[2]);
      const all = fieldsRef.current.filter((f) => !(f.source === 'free' && f.kind === 'text' && !f.value.trim()));

      // 1) campi PDF veri
      const acro = all.filter((f) => f.source === 'acro' && f.acroName && f.kind !== 'sign');
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

      // 2) testo, segni, linee e firme disegnati sulla pagina
      for (const f of all) {
        const drawn = f.source !== 'acro' || f.kind === 'sign';
        if (!drawn || isEmpty(f)) continue;
        const page = doc.getPage(f.page);
        const shown = pages[f.page];
        const crop = page.getCropBox();
        const rot = ((page.getRotation().angle % 360) + 360) % 360;
        const { x: cx, y: cy, width: W, height: H } = crop;
        const at = (fx: number, fy: number) => {
          if (rot === 90) return { x: cx + fy * W, y: cy + fx * H };
          if (rot === 180) return { x: cx + (1 - fx) * W, y: cy + fy * H };
          if (rot === 270) return { x: cx + (1 - fy) * W, y: cy + (1 - fx) * H };
          return { x: cx + fx * W, y: cy + (1 - fy) * H };
        };
        const rotate = pdfLib.degrees(rot);
        const ptX = 1 / shown.w, ptY = 1 / shown.h;

        if (isTick(f)) {
          const style: MarkStyle = f.kind === 'radio' ? 'dot' : f.mark ?? 'check';
          const size = Math.min(f.w * shown.w, f.h * shown.h);
          const ox = f.x + ((f.w * shown.w - size) / 2) * ptX;
          const oy = f.y + ((f.h * shown.h - size) / 2) * ptY;
          const P = (u: number, v: number) => at(ox + u * size * ptX, oy + v * size * ptY);
          const pen = { thickness: Math.max(0.8, size * 0.13), color: ink, lineCap: pdfLib.LineCapStyle.Round };
          if (style === 'dot') page.drawCircle({ ...P(0.5, 0.5), size: size * 0.27, color: ink });
          else if (style === 'cross') {
            page.drawLine({ start: P(0.2, 0.2), end: P(0.8, 0.8), ...pen });
            page.drawLine({ start: P(0.8, 0.2), end: P(0.2, 0.8), ...pen });
          } else {
            page.drawLine({ start: P(0.18, 0.55), end: P(0.42, 0.8), ...pen });
            page.drawLine({ start: P(0.42, 0.8), end: P(0.84, 0.2), ...pen });
          }
        } else if (f.kind === 'line') {
          page.drawLine({ start: at(f.x, f.y + f.h / 2), end: at(f.x + f.w, f.y + f.h / 2), thickness: 1.2, color: ink });
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
            const size = fontFor(f, shown);
            const lines = wrap(text, size, f.w * shown.w - 6, widthOf);
            lines.forEach((ln, k) => {
              const o = at(f.x + 3 * ptX, f.y + (4 + size * (k + 0.85) * 1.2) * ptY);
              page.drawText(ln, { x: o.x, y: o.y, size, font: helv, color: ink, rotate });
            });
          } else {
            const size = fontFor({ ...f, value: text }, shown, widthOf);
            const base = f.y + f.h / 2 + size * 0.36 * ptY;
            const o = at(f.x + 2 * ptX, base);
            page.drawText(text.replace(/\n/g, ' '), { x: o.x, y: o.y, size, font: helv, color: ink, rotate });
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
  }, [selected, deselect, pages, file, it, draftKey, showToast]);

  /* ------------------------------------------------------------------ disegno */

  // area di tocco: almeno 40 px, ma senza invadere i campi vicini
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

  const label = (f: Field) => f.label || `${it ? 'Campo' : 'Field'} ${stops.findIndex((x) => x.id === f.id) + 1}`;
  const keepFocus = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault();
  const focusRef = useCallback((n: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (n && document.activeElement !== n) n.focus({ preventScroll: true });
  }, []);
  const suggestions = sel && sel.kind === 'text' ? suggestionsFor(sel.label, profile).filter((s) => s !== sel.value) : [];
  const isLastStop = selStop >= 0 && selStop === stops.length - 1;

  const TOOLS: { t: Exclude<Tool, null>; icon: React.ReactNode; it: string; en: string; hint: [string, string] }[] = [
    { t: 'text', icon: <Type className="h-5 w-5" />, it: 'Testo', en: 'Text', hint: ['Tocca dove vuoi scrivere', 'Tap where you want to type'] },
    { t: 'check', icon: <Check className="h-5 w-5" strokeWidth={3} />, it: 'Spunta', en: 'Tick', hint: ['Tocca per mettere ✓ (anche più volte)', 'Tap to place ✓'] },
    { t: 'cross', icon: <X className="h-5 w-5" strokeWidth={3} />, it: 'Croce', en: 'Cross', hint: ['Tocca per mettere ✗ (anche più volte)', 'Tap to place ✗'] },
    { t: 'dot', icon: <span className="block h-3 w-3 rounded-full bg-current" />, it: 'Punto', en: 'Dot', hint: ['Tocca per mettere ● (anche più volte)', 'Tap to place ●'] },
    { t: 'line', icon: <Minus className="h-5 w-5" strokeWidth={3} />, it: 'Linea', en: 'Line', hint: ['Tocca per mettere una linea', 'Tap to place a line'] },
    { t: 'sign', icon: <Signature className="h-5 w-5" />, it: 'Firma', en: 'Sign', hint: ['Tocca dove vuoi firmare', 'Tap where you want to sign'] },
  ];
  const activeTool = TOOLS.find((x) => x.t === tool);

  return (
    <AppFullscreen
      title={file.name}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={undo}
            disabled={!histLen}
            aria-label={it ? 'Annulla' : 'Undo'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"
          >
            <Undo2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !!status}
            className="mr-1 flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--color-primary))] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {it ? 'Salva' : 'Save'}
          </button>
        </>
      }
    >
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          <div
            ref={scroller}
            className="absolute inset-0 overflow-auto bg-[#E7EAF0] dark:bg-[hsl(var(--color-muted))]"
            style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
            onScroll={() => {
              window.clearTimeout(scrollTimer.current);
              scrollTimer.current = window.setTimeout(() => void renderVisible(), 200);
            }}
          >
            <div ref={content} style={{ width: cw * zoom, paddingTop: PAD * zoom, paddingBottom: PAD * zoom + extraBottom, paddingLeft: PAD * zoom, paddingRight: PAD * zoom }}>
              {pages.map((p, i) => {
                const pageH = pageW * (p.h / p.w);
                const scale = pageW / p.w; // px per punto
                return (
                  <div
                    key={i}
                    data-ff-page={i}
                    className="relative bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]"
                    style={{ width: pageW, height: pageH, marginBottom: i < pages.length - 1 ? GAP * zoom : 0, cursor: tool ? 'crosshair' : undefined }}
                    onClick={(e) => onPageClick(i, e)}
                  >
                    {p.img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.img} alt={`${it ? 'Pagina' : 'Page'} ${i + 1}`} className="pointer-events-none absolute inset-0 h-full w-full select-none" draggable={false} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                    )}
                    {fields.filter((f) => f.page === i).map((f) => {
                      const wpx = f.w * pageW, hpx = f.h * pageH;
                      const mg = margins.get(f.id) || { mx: 0, my: 0 };
                      const hitW = Math.max(wpx, Math.min(40, wpx + 2 * mg.mx * pageW));
                      const hitH = Math.max(hpx, Math.min(40, hpx + 2 * mg.my * pageH));
                      const isSel = f.id === selected;
                      const empty = isEmpty(f);
                      const fontPx = isTextual(f) || f.kind === 'choice' || f.kind === 'sign' ? fontFor(f, p) * scale : 0;
                      const free = f.source === 'free';
                      const draggable = isSel && free && (f.kind === 'mark' || f.kind === 'line' || f.kind === 'sign');
                      const showBox = !free && empty;
                      return (
                        <div
                          key={f.id}
                          data-ff-field={f.id}
                          role="button"
                          tabIndex={-1}
                          aria-label={label(f)}
                          onClick={(e) => onFieldClick(e, f)}
                          onPointerDown={(e) => onFieldPointerDown(e, f)}
                          onPointerMove={onFieldPointerMove}
                          onPointerUp={onFieldPointerUp}
                          onPointerCancel={onFieldPointerUp}
                          onContextMenu={(e) => e.preventDefault()}
                          className="absolute flex items-center justify-center"
                          style={{
                            left: `calc(${f.x * 100}% - ${(hitW - wpx) / 2}px)`,
                            top: `calc(${f.y * 100}% - ${(hitH - hpx) / 2}px)`,
                            width: hitW, height: hitH, zIndex: isSel ? 4 : free ? 3 : 2,
                            touchAction: draggable ? 'none' : undefined,
                            WebkitUserSelect: 'none', userSelect: isSel && isTextual(f) ? 'text' : 'none',
                          }}
                        >
                          <div
                            data-ff-box={f.id}
                            className="relative"
                            style={{
                              width: wpx, height: hpx,
                              borderRadius: f.kind === 'radio' ? '50%' : 2,
                              background: isSel && isTextual(f) ? 'rgba(255,255,255,0.85)' : showBox ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                              outline: isSel
                                ? `2px ${free ? 'dashed' : 'solid'} ${BRAND}`
                                : showBox ? '1px solid rgba(37, 99, 235, 0.6)' : 'none',
                              outlineOffset: free && isSel ? 2 : 0,
                              boxShadow: isSel && !free ? '0 0 0 5px rgba(29, 58, 138, 0.16)' : undefined,
                              color: INK,
                              fontFamily: 'Helvetica, Arial, sans-serif',
                              fontSize: fontPx || undefined,
                              lineHeight: f.kind === 'multiline' ? 1.2 : 1,
                            }}
                          >
                            {isTick(f) && f.checked && <MarkGlyph style={f.kind === 'radio' ? 'dot' : f.mark ?? 'check'} />}
                            {f.kind === 'line' && (
                              <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ height: Math.max(1, 1.2 * scale), background: INK }} />
                            )}
                            {f.kind === 'sign' && f.sig && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={f.sig.dataUrl} alt="" className="pointer-events-none h-full w-full object-contain" draggable={false} />
                            )}
                            {f.kind === 'sign' && !f.sig && showBox && (
                              <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 overflow-hidden text-[11px] font-semibold uppercase tracking-wide text-[#1D3A8A]/70">
                                <Signature className="h-3.5 w-3.5 shrink-0" /> {it ? 'firma' : 'sign'}
                              </span>
                            )}
                            {/* testo: modificabile direttamente sul campo */}
                            {f.kind === 'text' && isSel ? (
                              <input
                                id={`ff-${f.id}`}
                                ref={focusRef}
                                value={f.value}
                                onChange={(e) => setValue(f, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); if (isLastStop || free) deselect(); else go(1); }
                                }}
                                enterKeyHint={isLastStop || free ? 'done' : 'next'}
                                inputMode={inputModeFor(f.label)}
                                autoCapitalize={/cod.*fisc|iban|targa|prov/i.test(f.label) ? 'characters' : 'sentences'}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label={label(f)}
                                className="absolute inset-0 m-0 h-full w-full border-0 bg-transparent p-0 outline-none"
                                style={{ font: 'inherit', fontSize: fontPx, color: INK, paddingLeft: 2 * scale, caretColor: BRAND }}
                              />
                            ) : f.kind === 'multiline' && isSel ? (
                              <textarea
                                id={`ff-${f.id}`}
                                ref={focusRef}
                                value={f.value}
                                onChange={(e) => setValue(f, e.target.value)}
                                aria-label={label(f)}
                                className="absolute inset-0 m-0 h-full w-full resize-none border-0 bg-transparent outline-none"
                                style={{ font: 'inherit', fontSize: fontPx, lineHeight: 1.2, color: INK, padding: `${4 * scale}px ${3 * scale}px`, caretColor: BRAND }}
                              />
                            ) : (f.kind === 'text' || f.kind === 'choice') && f.value ? (
                              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center whitespace-pre" style={{ paddingLeft: 2 * scale }}>
                                {f.kind === 'choice' ? f.options?.find((o) => o.value === f.value)?.label ?? f.value : f.value}
                              </span>
                            ) : f.kind === 'multiline' && f.value ? (
                              <span className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words" style={{ padding: `${4 * scale}px ${3 * scale}px` }}>{f.value}</span>
                            ) : null}
                          </div>

                          {/* maniglie */}
                          {isSel && free && f.kind === 'text' && (
                            <span
                              aria-label={it ? 'Sposta' : 'Move'}
                              onPointerDown={(e) => startDrag(e, f, 'move')}
                              onPointerMove={moveDrag}
                              onPointerUp={endDrag}
                              onMouseDown={keepFocus}
                              onClick={(e) => e.stopPropagation()}
                              className="absolute flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#1D3A8A] text-white shadow"
                              style={{ left: (hitW - wpx) / 2 - 38, top: hitH / 2 - 16, touchAction: 'none' }}
                            >
                              <Move className="h-4 w-4" />
                            </span>
                          )}
                          {isSel && free && (f.kind === 'sign' || f.kind === 'line') && (
                            <span
                              aria-label={it ? 'Ridimensiona' : 'Resize'}
                              onPointerDown={(e) => startDrag(e, f, 'size')}
                              onPointerMove={moveDrag}
                              onPointerUp={endDrag}
                              onClick={(e) => e.stopPropagation()}
                              className="absolute h-7 w-7 rounded-full border-2 border-white bg-[#1D3A8A] shadow"
                              style={{ left: (hitW + wpx) / 2 - 10, top: f.kind === 'line' ? hitH / 2 - 14 : (hitH + hpx) / 2 - 10, touchAction: 'none' }}
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* menu dell'elemento selezionato (come in Fill & Sign) */}
                    {sel && sel.page === i && menu && (() => {
                      const f = sel;
                      const fy = f.y * pageH, fx = f.x * pageW, fw = f.w * pageW;
                      const above = fy > 56;
                      const btn = 'flex h-10 min-w-[2.5rem] items-center justify-center px-2.5 text-white active:bg-white/15';
                      const canSize = (isTextual(f) && f.source !== 'acro') || f.kind === 'mark';
                      const canStyle = f.kind === 'mark' || (f.kind === 'check' && f.source !== 'acro');
                      const canDelete = f.source !== 'acro';
                      if (!canSize && !canStyle && !canDelete) return null;
                      return (
                        <div
                          className="absolute z-10 flex overflow-hidden rounded-xl bg-[#14213D] shadow-lg"
                          style={{
                            left: clamp(fx + fw / 2, 90, pageW - 90),
                            top: above ? fy - 50 : fy + f.h * pageH + 12,
                            transform: 'translateX(-50%)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={keepFocus}
                        >
                          {canStyle && (['check', 'cross', 'dot'] as MarkStyle[]).map((s) => (
                            <button
                              key={s}
                              type="button"
                              aria-label={s}
                              onClick={() => { snapshot(); update(f.id, { mark: s, checked: true }); }}
                              className={`${btn} ${(f.mark ?? 'check') === s && f.checked ? 'bg-white/20' : ''}`}
                            >
                              <span className="relative block h-5 w-5"><MarkGlyph style={s} color="#fff" /></span>
                            </button>
                          ))}
                          {canSize && (
                            <>
                              <button type="button" aria-label={it ? 'Più piccolo' : 'Smaller'} onClick={() => resize(f, -1)} className={btn}><AArrowDown className="h-5 w-5" /></button>
                              <button type="button" aria-label={it ? 'Più grande' : 'Bigger'} onClick={() => resize(f, 1)} className={btn}><AArrowUp className="h-5 w-5" /></button>
                            </>
                          )}
                          {canDelete && (
                            <button type="button" aria-label={it ? 'Elimina' : 'Delete'} onClick={() => remove(f)} className={`${btn} text-red-300`}><Trash2 className="h-5 w-5" /></button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>

          {/* barre sopra la pagina */}
          {!status && !error && !typing && !tool && stops.length > 0 && (
            <button
              type="button"
              onClick={() => go(1, true)}
              className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#14213D]/90 py-2 pl-3.5 pr-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur active:opacity-90"
            >
              <span className="tabular-nums">{doneCount}/{stops.length} {it ? 'compilati' : 'filled'}</span>
              <span className="flex items-center rounded-full bg-white/15 py-0.5 pl-2 pr-1">
                {doneCount === stops.length ? (it ? 'Fatto' : 'Done') : (it ? 'Avanti' : 'Next')}<ChevronRight className="h-4 w-4" />
              </span>
            </button>
          )}
          {activeTool && (
            <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-2xl bg-[#14213D]/95 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-lg">
              <span className="min-w-0 flex-1">{it ? activeTool.hint[0] : activeTool.hint[1]}</span>
              <button type="button" onClick={() => setTool(null)} className="h-9 rounded-full bg-white/15 px-4 font-semibold">{it ? 'Fine' : 'Done'}</button>
            </div>
          )}
          {(status || error) && (
            <div className="absolute inset-x-4 top-6 z-10 flex items-center gap-3 rounded-2xl bg-[hsl(var(--color-background))] p-4 shadow">
              {status && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--color-primary))]" />}
              <span className={`text-sm ${error ? 'text-red-600' : ''}`}>{error ? `${it ? 'Impossibile aprire il PDF: ' : 'Cannot open PDF: '}${error}` : status}</span>
            </div>
          )}
          {toast && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 rounded-xl bg-black/80 px-4 py-3 text-center text-sm text-white">{toast}</div>
          )}
        </div>

        {/* barra sopra la tastiera: campo aperto */}
        {sel && typing ? (
          <div className="shrink-0 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))]" onMouseDown={keepFocus} data-ff-bar>
            {(suggestions.length > 0 || (sel.kind === 'text' && isDateLabel(sel.label))) && (
              <div className="flex gap-2 overflow-x-auto px-2 pt-2" style={{ scrollbarWidth: 'none' }}>
                {suggestions.map((s) => (
                  <button key={s} type="button" onMouseDown={keepFocus} onClick={() => setValue(sel, s)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--color-primary)/0.1)] px-3 py-2 text-sm font-medium text-[hsl(var(--color-primary))]">
                    <UserRound className="h-4 w-4" />{s}
                  </button>
                ))}
                {sel.kind === 'text' && isDateLabel(sel.label) && (
                  <button type="button" onMouseDown={keepFocus} onClick={() => setValue(sel, new Date().toLocaleDateString('it-IT'))} className="flex shrink-0 items-center gap-1.5 rounded-full border border-[hsl(var(--color-border))] px-3 py-2 text-sm">
                    <CalendarDays className="h-4 w-4" /> {it ? 'Oggi' : 'Today'}
                  </button>
                )}
              </div>
            )}
            {sel.kind === 'choice' && (
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto px-2 pt-2">
                {(sel.options || []).map((o) => (
                  <button key={o.value} type="button" onClick={() => { snapshot(); update(sel.id, { value: o.value }); }} className={`min-h-[44px] rounded-xl px-3 py-2 text-left text-sm ${sel.value === o.value ? 'bg-[hsl(var(--color-primary))] text-white' : 'border border-[hsl(var(--color-border))]'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {sel.kind === 'sign' && (
              <div className="flex items-center gap-2 overflow-x-auto px-2 pt-2" style={{ scrollbarWidth: 'none' }}>
                {savedSigs.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={it ? 'Usa questa firma' : 'Use this signature'}
                    onClick={() => { snapshot(); update(sel.id, { sig: { dataUrl: s.dataUrl, width: s.width, height: s.height } }); }}
                    className={`flex h-12 w-24 shrink-0 items-center justify-center rounded-xl border bg-white p-1 ${sel.sig?.dataUrl === s.dataUrl ? 'border-[#1D3A8A] ring-2 ring-[#1D3A8A]/30' : 'border-[hsl(var(--color-border))]'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
                <button type="button" onClick={() => setPadFor(sel.id)} className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-[hsl(var(--color-primary))] px-3 text-sm font-semibold text-white">
                  <Plus className="h-4 w-4" />{it ? 'Nuova firma' : 'New'}
                </button>
                {sel.sig && sel.source !== 'free' && (
                  <button type="button" onClick={() => { snapshot(); update(sel.id, { sig: undefined }); }} className="h-12 shrink-0 rounded-xl border border-[hsl(var(--color-border))] px-3 text-sm">{it ? 'Togli' : 'Clear'}</button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 px-1 py-1.5">
              <button type="button" onMouseDown={keepFocus} onClick={() => go(-1)} disabled={selStop <= 0} aria-label={it ? 'Campo precedente' : 'Previous field'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"><ChevronUp className="h-6 w-6" /></button>
              <button type="button" onMouseDown={keepFocus} onClick={() => go(1)} disabled={selStop < 0 || isLastStop} aria-label={it ? 'Campo successivo' : 'Next field'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]"><ChevronDown className="h-6 w-6" /></button>
              <div className="min-w-0 flex-1 px-1 leading-tight">
                <div className="truncate text-sm font-semibold" data-ff-label>{label(sel)}</div>
                {selStop >= 0 && <div className="text-[11px] tabular-nums text-[hsl(var(--color-muted-foreground))]">{selStop + 1} {it ? 'di' : 'of'} {stops.length}</div>}
              </div>
              <button type="button" onClick={deselect} className="h-10 rounded-full bg-[hsl(var(--color-primary))] px-5 text-sm font-semibold text-white">{it ? 'Fatto' : 'Done'}</button>
            </div>
          </div>
        ) : (
          /* barra degli strumenti */
          <div className="shrink-0 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-1 pb-1.5 pt-1">
            <div className="grid grid-cols-7">
              {TOOLS.map((x) => (
                <button
                  key={x.t}
                  type="button"
                  onClick={() => { if (selected) deselect(); setTool(tool === x.t ? null : x.t); }}
                  className={`mx-0.5 flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium ${tool === x.t ? 'bg-[hsl(var(--color-primary)/0.15)] text-[hsl(var(--color-primary))]' : 'active:bg-[hsl(var(--color-muted))]'}`}
                >
                  <span className="flex h-6 items-center">{x.icon}</span>{it ? x.it : x.en}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { if (selected) deselect(); setTool(null); setProfileOpen(true); }}
                className="relative mx-0.5 flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium active:bg-[hsl(var(--color-muted))]"
              >
                <span className="flex h-6 items-center"><UserRound className="h-5 w-5" /></span>{it ? 'Profilo' : 'Profile'}
                {fillable.length > 0 && <span className="absolute right-1.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[#1D3A8A] px-1 text-[10px] font-bold text-white">{fillable.length}</span>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* profilo: i dati che si ripetono in tutti i moduli */}
      {profileOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/40" onClick={() => setProfileOpen(false)}>
          <div className="mt-auto flex max-h-[88%] flex-col rounded-t-3xl bg-[hsl(var(--color-background))]" onClick={(e) => e.stopPropagation()} data-ff-profile>
            <div className="flex items-center gap-2 px-4 pb-2 pt-4">
              <UserRound className="h-5 w-5 text-[hsl(var(--color-primary))]" />
              <span className="flex-1 text-base font-bold">{it ? 'Il tuo profilo' : 'Your profile'}</span>
              <button type="button" onClick={() => setProfileOpen(false)} aria-label={it ? 'Chiudi profilo' : 'Close profile'} className="flex h-10 w-10 items-center justify-center rounded-full active:bg-[hsl(var(--color-muted))]"><X className="h-5 w-5" /></button>
            </div>
            <p className="px-4 pb-2 text-xs text-[hsl(var(--color-muted-foreground))]">
              {it ? 'I dati restano solo su questo telefono e vengono proposti nei campi con lo stesso nome. Quello che scrivi nei moduli viene ricordato qui.' : 'Stored only on this phone and suggested in matching fields.'}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              {[...PROFILE_FIELDS].sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k)).map((p) => (
                <label key={p.k} className="mb-2 block">
                  <span className="mb-0.5 block text-xs font-medium text-[hsl(var(--color-muted-foreground))]">{it ? p.it : p.en}</span>
                  <input
                    value={profile[p.k] || ''}
                    onChange={(e) => saveProfile({ ...profile, [p.k]: e.target.value })}
                    inputMode={p.mode}
                    autoCapitalize={p.k === 'cf' || p.k === 'prov' ? 'characters' : 'words'}
                    data-ff-profile-key={p.k}
                    className="h-11 w-full rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 text-[16px] outline-none focus:border-[hsl(var(--color-primary))]"
                  />
                </label>
              ))}
            </div>
            <div className="border-t border-[hsl(var(--color-border))] p-3">
              <button
                type="button"
                onClick={fillFromProfile}
                disabled={!fillable.length}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--color-primary))] font-semibold text-white disabled:opacity-40"
              >
                <Sparkles className="h-5 w-5" />
                {fillable.length
                  ? (it ? `Riempi ${fillable.length} campi di questo modulo` : `Fill ${fillable.length} fields`)
                  : (it ? 'Nessun campo da riempire col profilo' : 'No matching empty fields')}
              </button>
            </div>
          </div>
        </div>
      )}

      {padFor && (
        <SignaturePad
          it={it}
          onCancel={() => {
            const f = fieldsRef.current.find((x) => x.id === padFor);
            if (f && f.source === 'free' && !f.sig) { setFields((prev) => prev.filter((x) => x.id !== padFor)); setSelected(null); }
            setPadFor(null);
          }}
          onDone={(png) => {
            snapshot();
            const f = fieldsRef.current.find((x) => x.id === padFor);
            const p = f ? pages[f.page] : null;
            const patch: Partial<Field> = { sig: png };
            if (f && p && f.source === 'free') patch.h = Math.min(1 - f.y, (f.w * p.w * (png.height / png.width)) / p.h);
            update(padFor, patch);
            try {
              saveSignature({ name: it ? 'Firma col dito' : 'Finger signature', dataUrl: png.dataUrl, width: png.width, height: png.height, sourceDoc: 'form' });
              setSavedSigs(getSavedSignatures());
            } catch { /* spazio pieno */ }
            setPadFor(null);
          }}
        />
      )}
    </AppFullscreen>
  );
}

const ORDER: ProfileKey[] = ['nome', 'cognome', 'cf', 'nascitaData', 'nascitaLuogo', 'indirizzo', 'citta', 'cap', 'prov', 'tel', 'email'];
