'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Undo2, Trash2, Check, X } from 'lucide-react';

interface Point { x: number; y: number; t: number }
type Stroke = { color: string; width: number; points: Point[] };

const COLORS = [
  { value: '#0b2a8a', label: 'Blu' },
  { value: '#111111', label: 'Nero' },
];

/**
 * Riquadro per firmare col dito (o con la penna). Restituisce un PNG trasparente
 * ritagliato attorno alla firma.
 */
export function SignaturePad({
  onDone,
  onCancel,
  it = true,
}: {
  onDone: (png: { dataUrl: string; width: number; height: number }) => void;
  onCancel: () => void;
  it?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0].value);
  const [thick, setThick] = useState(3);
  const [count, setCount] = useState(0);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of [...strokes.current, ...(current.current ? [current.current] : [])]) drawStroke(ctx, s);
  }, []);

  // Dimensiona il canvas sullo spazio disponibile (anche quando si ruota il telefono)
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current, w = wrapRef.current;
      if (!c || !w) return;
      const dpr = window.devicePixelRatio || 1;
      const r = w.getBoundingClientRect();
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redraw]);

  const pos = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    current.current = { color, width: thick, points: [pos(e)] };
    redraw();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!current.current) return;
    e.preventDefault();
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [e.nativeEvent];
    const r = canvasRef.current!.getBoundingClientRect();
    for (const ev of evs) current.current.points.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, t: ev.timeStamp });
    redraw();
  };
  const onUp = () => {
    if (!current.current) return;
    strokes.current.push(current.current);
    current.current = null;
    setCount(strokes.current.length);
    redraw();
  };

  const undo = () => {
    strokes.current.pop();
    setCount(strokes.current.length);
    redraw();
  };
  const clear = () => {
    strokes.current = [];
    setCount(0);
    redraw();
  };

  const done = () => {
    if (!strokes.current.length) return;
    // Ritaglia attorno all'inchiostro, ad alta risoluzione
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes.current) for (const p of s.points) {
      minX = Math.min(minX, p.x - s.width * 2); minY = Math.min(minY, p.y - s.width * 2);
      maxX = Math.max(maxX, p.x + s.width * 2); maxY = Math.max(maxY, p.y + s.width * 2);
    }
    const pad = 6, scale = 3;
    const w = Math.max(1, Math.ceil(maxX - minX + pad * 2));
    const h = Math.max(1, Math.ceil(maxY - minY + pad * 2));
    const out = document.createElement('canvas');
    out.width = w * scale;
    out.height = h * scale;
    const ctx = out.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, (-minX + pad) * scale, (-minY + pad) * scale);
    for (const s of strokes.current) drawStroke(ctx, s);
    onDone({ dataUrl: out.toDataURL('image/png'), width: w, height: h });
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[hsl(var(--color-background))]" role="dialog" aria-modal="true">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[hsl(var(--color-border))] px-1">
        <button type="button" onClick={onCancel} aria-label={it ? 'Annulla' : 'Cancel'} className="flex h-11 w-11 items-center justify-center rounded-full active:bg-[hsl(var(--color-muted))]">
          <X className="h-6 w-6" />
        </button>
        <span className="flex-1 text-sm font-semibold">{it ? 'Firma col dito' : 'Draw your signature'}</span>
        <button
          type="button"
          onClick={done}
          disabled={count === 0}
          className="mr-1 flex items-center gap-1.5 rounded-full bg-[hsl(var(--color-primary))] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> {it ? 'Usa firma' : 'Use'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 p-3">
        <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-2xl border-2 border-dashed border-[hsl(var(--color-border))] bg-white">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 touch-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          <div className="pointer-events-none absolute inset-x-6 bottom-[30%] border-b-2 border-gray-300" />
          {count === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-gray-400">
              {it ? 'Firma qui con il dito' : 'Sign here with your finger'}
              <br />
              <span className="text-xs">{it ? 'Suggerimento: gira il telefono in orizzontale' : 'Tip: turn your phone sideways'}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--color-border))] px-3 py-2">
        <div className="flex items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              aria-label={c.label}
              className={`h-9 w-9 rounded-full border-2 ${color === c.value ? 'border-[hsl(var(--color-primary))] ring-2 ring-[hsl(var(--color-primary)/0.3)]' : 'border-transparent'}`}
              style={{ background: c.value }}
            />
          ))}
          {[2, 3, 5].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setThick(t)}
              aria-label={`${t}`}
              className={`flex h-9 w-9 items-center justify-center rounded-full ${thick === t ? 'bg-[hsl(var(--color-primary)/0.15)]' : ''}`}
            >
              <span className="rounded-full bg-[hsl(var(--color-foreground))]" style={{ width: t * 2.5, height: t * 2.5 }} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={count === 0} aria-label={it ? 'Annulla tratto' : 'Undo'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]">
            <Undo2 className="h-5 w-5" />
          </button>
          <button type="button" onClick={clear} disabled={count === 0} aria-label={it ? 'Cancella' : 'Clear'} className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-[hsl(var(--color-muted))]">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Disegna un tratto morbido: curve tra i punti medi, spessore che varia con la velocità. */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, s.width * 0.6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let prevW = s.width;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const dt = Math.max(1, p1.t - p0.t);
    const v = dist / dt; // px/ms
    const target = s.width * Math.max(0.55, Math.min(1.25, 1.25 - v * 0.35));
    const w = prevW * 0.7 + target * 0.3;
    const m0 = i > 1 ? { x: (pts[i - 2].x + p0.x) / 2, y: (pts[i - 2].y + p0.y) / 2 } : p0;
    const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(m0.x, m0.y);
    ctx.quadraticCurveTo(p0.x, p0.y, m1.x, m1.y);
    ctx.stroke();
    prevW = w;
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  ctx.beginPath();
  ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
