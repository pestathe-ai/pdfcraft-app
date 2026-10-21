'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PenLine, Plus, CalendarDays, Download, X, Loader2 } from 'lucide-react';
import { AppFullscreen } from '@/components/app/AppFullscreen';
import { SignaturePad } from '@/components/app/SignaturePad';
import { loadPdfjs, loadPdfLib } from '@/lib/pdf/loader';
import { getSavedSignatures, saveSignature, type PDFCraftSignature } from '@/lib/pdf/signature-storage';

interface Sig { id: string; dataUrl: string; width: number; height: number }
interface Placement {
  id: string;
  page: number; // indice 0-based
  sig: Sig;
  /** posizione e dimensioni in frazioni della pagina mostrata (0..1), origine in alto a sinistra */
  x: number;
  y: number;
  w: number;
}
interface PageInfo { w: number; h: number; img?: string }

const uid = () => Math.random().toString(36).slice(2, 10);

/** Immagine PNG con la data di oggi (gg/mm/aaaa), da posizionare come una firma. */
function dateImage(color: string): Sig {
  const text = new Date().toLocaleDateString('it-IT');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 64px sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w; c.height = 88;
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 46);
  return { id: uid(), dataUrl: c.toDataURL('image/png'), width: w / 3, height: 88 / 3 };
}

/**
 * Firma col dito: disegna la firma sullo schermo, tocca la pagina per posizionarla,
 * spostala/ridimensionala col dito e salva il PDF firmato.
 */
export function FingerSign({ file, onClose, locale }: { file: File; onClose: () => void; locale: string }) {
  const it = locale !== 'en';
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Sig | null>(null);
  const [armed, setArmed] = useState(false);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [saved, setSaved] = useState<PDFCraftSignature[]>([]);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // All'apertura: firme già salvate? Allora proponile, altrimenti apri subito il riquadro firma.
  useEffect(() => {
    const list = getSavedSignatures();
    setSaved(list);
    if (list.length) setShowPicker(true);
    else setShowPad(true);
  }, []);

  // Disegna le pagine del PDF come immagini larghe quanto lo schermo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          infos.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setPages(infos.map((p) => ({ ...p })));
        const targetW = Math.min(1400, Math.round((listRef.current?.clientWidth || 380) * (window.devicePixelRatio || 2)));
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: targetW / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width);
          canvas.height = Math.round(vp.height);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          const img = canvas.toDataURL('image/jpeg', 0.85);
          if (cancelled) return;
          setPages((prev) => prev.map((p, k) => (k === i - 1 ? { ...p, img } : p)));
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const pickSig = (s: Sig) => {
    setCurrent(s);
    setArmed(true);
    setShowPicker(false);
    setShowPad(false);
    showToast(it ? 'Tocca la pagina dove vuoi la firma' : 'Tap the page where you want it');
  };

  const onPadDone = (png: { dataUrl: string; width: number; height: number }) => {
    let sig: Sig = { id: uid(), ...png };
    if (remember) {
      try {
        const s = saveSignature({ name: it ? 'Firma col dito' : 'Finger signature', dataUrl: png.dataUrl, width: png.width, height: png.height, sourceDoc: 'finger' });
        sig = { id: s.id, ...png };
      } catch {
        /* spazio esaurito: si usa comunque */
      }
    }
    pickSig(sig);
  };

  const placeAt = (pageIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!armed || !current) {
      setSelected(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const p = pages[pageIdx];
    const w = Math.min(0.45, (current.width / p.w) * 1.2 || 0.35);
    const hFrac = (w * p.w * (current.height / current.width)) / p.h;
    const fx = (e.clientX - r.left) / r.width - w / 2;
    const fy = (e.clientY - r.top) / r.height - hFrac / 2;
    const pl: Placement = {
      id: uid(),
      page: pageIdx,
      sig: current,
      x: Math.max(0, Math.min(1 - w, fx)),
      y: Math.max(0, Math.min(1 - hFrac, fy)),
      w,
    };
    setPlacements((prev) => [...prev, pl]);
    setSelected(pl.id);
    setArmed(false);
  };

  const update = (id: string, patch: Partial<Placement>) =>
    setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // Trascinamento e ridimensionamento col dito
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; pw: number; ph: number } | null>(null);
  const startDrag = (e: React.PointerEvent, pl: Placement, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    const pageEl = (e.currentTarget as HTMLElement).closest('[data-sign-page]') as HTMLElement;
    const r = pageEl.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: pl.id, mode, sx: e.clientX, sy: e.clientY, ox: pl.x, oy: pl.y, ow: pl.w, pw: r.width, ph: r.height };
    setSelected(pl.id);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    const pl = placements.find((p) => p.id === d.id);
    if (!pl) return;
    const page = pages[pl.page];
    const aspect = (pl.sig.height / pl.sig.width) * (page.w / page.h);
    const dx = (e.clientX - d.sx) / d.pw, dy = (e.clientY - d.sy) / d.ph;
    if (d.mode === 'move') {
      const h = d.ow * aspect;
      update(d.id, { x: Math.max(0, Math.min(1 - pl.w, d.ox + dx)), y: Math.max(0, Math.min(1 - h, d.oy + dy)) });
    } else {
      const w = Math.max(0.06, Math.min(1 - d.ox, d.ow + dx));
      update(d.id, { w: Math.min(w, (1 - d.oy) / aspect) });
    }
  };
  const endDrag = () => {
    drag.current = null;
  };

  const save = useCallback(async () => {
    if (!placements.length) {
      showToast(it ? 'Aggiungi prima una firma' : 'Add a signature first');
      return;
    }
    setBusy(true);
    try {
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const embedded = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
      for (const pl of placements) {
        let img = embedded.get(pl.sig.dataUrl);
        if (!img) {
          img = await doc.embedPng(pl.sig.dataUrl);
          embedded.set(pl.sig.dataUrl, img);
        }
        const page = doc.getPage(pl.page);
        const crop = page.getCropBox();
        const rot = ((page.getRotation().angle % 360) + 360) % 360;
        const shown = pages[pl.page];
        const fh = (pl.w * shown.w * (pl.sig.height / pl.sig.width)) / shown.h;
        const { x: cx, y: cy, width: W, height: H } = crop;
        let x: number, y: number, width: number, height: number;
        if (rot === 90) {
          x = cx + (pl.y + fh) * W; y = cy + pl.x * H; width = pl.w * H; height = fh * W;
        } else if (rot === 180) {
          x = cx + (1 - pl.x) * W; y = cy + (pl.y + fh) * H; width = pl.w * W; height = fh * H;
        } else if (rot === 270) {
          x = cx + (1 - pl.y - fh) * W; y = cy + H - pl.x * H; width = pl.w * H; height = fh * W;
        } else {
          x = cx + pl.x * W; y = cy + (1 - pl.y - fh) * H; width = pl.w * W; height = fh * H;
        }
        page.drawImage(img, { x, y, width, height, rotate: pdfLib.degrees(rot) });
      }
      const bytes = await doc.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '') + (it ? '_firmato.pdf' : '_signed.pdf');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      showToast((it ? 'Errore: ' : 'Error: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [placements, file, pages, it]);

  return (
    <AppFullscreen
      title={file.name}
      onClose={onClose}
      actions={
        <button
          type="button"
          onClick={save}
          disabled={busy || !placements.length}
          className="mr-1 flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--color-primary))] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {it ? 'Salva' : 'Save'}
        </button>
      }
    >
      <div className="flex h-full flex-col">
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--color-muted))] p-3" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
          {!pages.length && !loadError && (
            <div className="flex justify-center p-10"><Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--color-primary))]" /></div>
          )}
          {pages.map((p, i) => (
            <div key={i} className="mb-3">
              <div
                data-sign-page
                className={`relative w-full overflow-hidden bg-white shadow ${armed ? 'cursor-crosshair ring-2 ring-[hsl(var(--color-primary))]' : ''}`}
                style={{ aspectRatio: `${p.w} / ${p.h}` }}
                onClick={(e) => placeAt(i, e)}
              >
                {p.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.img} alt={`${it ? 'Pagina' : 'Page'} ${i + 1}`} className="pointer-events-none absolute inset-0 h-full w-full select-none" draggable={false} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                )}
                {placements.filter((pl) => pl.page === i).map((pl) => {
                  const hPct = ((pl.w * p.w * (pl.sig.height / pl.sig.width)) / p.h) * 100;
                  const sel = selected === pl.id;
                  return (
                    <div
                      key={pl.id}
                      className={`absolute touch-none ${sel ? 'outline outline-2 outline-[hsl(var(--color-primary))]' : 'outline outline-1 outline-dashed outline-[hsl(var(--color-primary)/0.4)]'}`}
                      style={{ left: `${pl.x * 100}%`, top: `${pl.y * 100}%`, width: `${pl.w * 100}%`, height: `${hPct}%` }}
                      onPointerDown={(e) => startDrag(e, pl, 'move')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pl.sig.dataUrl} alt="" className="pointer-events-none h-full w-full select-none" draggable={false} />
                      {sel && (
                        <>
                          <button
                            type="button"
                            aria-label={it ? 'Rimuovi' : 'Remove'}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlacements((prev) => prev.filter((x) => x.id !== pl.id));
                              setSelected(null);
                            }}
                            className="absolute -right-4 -top-4 flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white shadow"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <span
                            aria-label={it ? 'Ridimensiona' : 'Resize'}
                            onPointerDown={(e) => startDrag(e, pl, 'resize')}
                            className="absolute -bottom-4 -right-4 h-8 w-8 touch-none rounded-full border-2 border-white bg-[hsl(var(--color-primary))] shadow"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-center text-xs text-[hsl(var(--color-muted-foreground))]">{i + 1} / {pages.length}</p>
            </div>
          ))}
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-[hsl(var(--color-border))] p-2">
          <button type="button" onClick={() => setShowPad(true)} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-medium active:bg-[hsl(var(--color-muted))]">
            <PenLine className="h-5 w-5 text-[hsl(var(--color-primary))]" />
            {it ? 'Nuova firma' : 'New signature'}
          </button>
          <button
            type="button"
            onClick={() => (current ? pickSig(current) : saved.length ? setShowPicker(true) : setShowPad(true))}
            className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-medium active:bg-[hsl(var(--color-muted))] ${armed ? 'bg-[hsl(var(--color-primary)/0.12)]' : ''}`}
          >
            <Plus className="h-5 w-5 text-[hsl(var(--color-primary))]" />
            {it ? 'Inserisci firma' : 'Place signature'}
          </button>
          <button type="button" onClick={() => pickSig(dateImage('#0b2a8a'))} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-medium active:bg-[hsl(var(--color-muted))]">
            <CalendarDays className="h-5 w-5 text-[hsl(var(--color-primary))]" />
            {it ? 'Data di oggi' : "Today's date"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[80] rounded-xl bg-black/80 px-4 py-3 text-center text-sm text-white">{toast}</div>
      )}

      {showPicker && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/40" onClick={() => setShowPicker(false)}>
          <div className="max-h-[75vh] w-full overflow-y-auto rounded-t-3xl bg-[hsl(var(--color-background))] p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold">{it ? 'Scegli la firma' : 'Choose a signature'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {saved.map((s) => (
                <button key={s.id} type="button" onClick={() => pickSig({ id: s.id, dataUrl: s.dataUrl, width: s.width, height: s.height })} className="flex h-24 items-center justify-center rounded-2xl border border-[hsl(var(--color-border))] bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.dataUrl} alt={s.name} className="max-h-full max-w-full" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPicker(false);
                setShowPad(true);
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--color-primary))] py-3.5 font-semibold text-white"
            >
              <PenLine className="h-5 w-5" /> {it ? 'Disegna una nuova firma' : 'Draw a new signature'}
            </button>
          </div>
        </div>
      )}

      {showPad && (
        <>
          <SignaturePad it={it} onDone={onPadDone} onCancel={() => setShowPad(false)} />
          <label className="fixed bottom-[4.5rem] left-4 z-[71] flex items-center gap-2 rounded-full bg-[hsl(var(--color-background))]/90 px-3 py-1.5 text-xs">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
            {it ? 'Ricorda questa firma' : 'Remember this signature'}
          </label>
        </>
      )}
    </AppFullscreen>
  );
}
