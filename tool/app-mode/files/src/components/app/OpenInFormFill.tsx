'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PenLine, X } from 'lucide-react';
import { setPendingFiles } from '@/lib/app/pending-files';

const FORM_SLUG = 'form-filler';
// Spazi da riempire tipici dei moduli: righe, puntini, caselle.
const BLANK_RE = /_{4,}|\.{8,}|…{3,}|\[\s?\]|[☐□▢]/g;

interface PdfjsLite {
  getDocument(o: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getFieldObjects?: () => Promise<Record<string, unknown> | null>;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }>;
      destroy(): Promise<void>;
    }>;
  };
}

/** True se il PDF sembra un modulo (campi veri oppure spazi vuoti da riempire). */
export async function looksLikeForm(file: File): Promise<boolean> {
  try {
    const { loadPdfjs } = await import('@/lib/pdf/loader');
    const pdfjs = (await loadPdfjs()) as unknown as PdfjsLite;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const fields = await doc.getFieldObjects?.().catch(() => null);
      if (fields && Object.keys(fields).length) return true;
      let blanks = 0;
      for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        const text = tc.items.map((i) => i.str || '').join(' ');
        blanks += (text.match(BLANK_RE) || []).length;
        if (blanks >= 3) return true;
      }
      return false;
    } finally {
      void doc.destroy();
    }
  } catch {
    return false;
  }
}

/** Apre il file nello strumento "Compila". */
export function useOpenInFormFill(locale: string) {
  const router = useRouter();
  return useCallback(
    async (file: File) => {
      await setPendingFiles(FORM_SLUG, [file]);
      router.push(`/${locale}/tools/${FORM_SLUG}/`);
    },
    [locale, router]
  );
}

/**
 * Avviso dentro "Modifica PDF": se il documento è un modulo, propone di compilarlo
 * con lo strumento fatto apposta (tocchi lo spazio e scrivi) invece di modificarne il testo.
 */
export function FormFillHint({ file, locale }: { file: File; locale: string }) {
  const it = locale === 'it';
  const open = useOpenInFormFill(locale);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    setShow(false);
    looksLikeForm(file).then((yes) => alive && setShow(yes));
    return () => {
      alive = false;
    };
  }, [file]);

  if (!show) return null;
  return (
    <div
      data-form-hint
      className="absolute inset-x-3 top-3 z-20 flex items-center gap-3 rounded-2xl bg-[#1D3A8A] p-3 text-white shadow-xl"
    >
      <PenLine className="h-6 w-6 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight">{it ? 'Devi compilare questo modulo?' : 'Filling in this form?'}</p>
        <p className="text-xs leading-snug text-white/85">
          {it
            ? 'Con Compila tocchi lo spazio vuoto e scrivi: molto più facile.'
            : 'With Fill form you tap the blank and type: much easier.'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void open(file)}
        className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#1D3A8A] active:opacity-80"
      >
        {it ? 'Compila' : 'Fill'}
      </button>
      <button
        type="button"
        aria-label={it ? 'Chiudi' : 'Close'}
        onClick={() => setShow(false)}
        className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-white/15"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Voce "Compila" accanto a Testo / Annota nella barra di "Modifica PDF". */
export function OpenInFormFillButton({ file, locale }: { file: File; locale: string }) {
  const open = useOpenInFormFill(locale);
  return (
    <button
      type="button"
      data-open-form-fill
      onClick={() => void open(file)}
      className="rounded-full px-3 py-2 text-[hsl(var(--color-muted-foreground))]"
    >
      {locale === 'it' ? 'Compila' : 'Fill'}
    </button>
  );
}
