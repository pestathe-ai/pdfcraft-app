'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, FileText, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { type Locale } from '@/lib/i18n/config';
import { detect, FROM_PDF, PDF_ACTIONS, type Detection } from '@/lib/app/convert-map';
import { setPendingFiles } from '@/lib/app/pending-files';
import { getToolById } from '@/config/tools';
import { getToolContent } from '@/config/tool-content';

const TXT = {
  it: {
    title: 'Converti',
    subtitle: 'Scegli un file qualsiasi: il formato viene riconosciuto in automatico.',
    pick: 'Scegli file',
    pickHint: 'Word, ODT, Excel, PowerPoint, immagini, ePub, testo, PDF…',
    pdfQuestion: 'È un PDF: in cosa vuoi convertirlo?',
    opening: 'Apro',
    unsupported: (ext: string) =>
      ext ? `Il formato .${ext} non è supportato.` : 'Formato del file non riconosciuto.',
    another: 'Scegli un altro file',
    loadingShared: 'Carico il file condiviso…',
    formats: 'Formati riconosciuti',
    orElse: 'Oppure:',
  },
  en: {
    title: 'Convert',
    subtitle: 'Pick any file: its format is detected automatically.',
    pick: 'Choose files',
    pickHint: 'Word, ODT, Excel, PowerPoint, images, ePub, text, PDF…',
    pdfQuestion: 'It’s a PDF: convert it to…',
    opening: 'Opening',
    unsupported: (ext: string) => (ext ? `The .${ext} format is not supported.` : 'Unrecognised file format.'),
    another: 'Choose another file',
    loadingShared: 'Loading shared file…',
    formats: 'Recognised formats',
    orElse: 'Or:',
  },
};

function toolTitle(locale: string, slug: string): string {
  const tool = getToolById(slug);
  const content = tool ? getToolContent(locale as Locale, tool.id) : undefined;
  return content?.title || slug;
}

export default function ConvertPageClient({ locale }: { locale: string }) {
  const L = locale === 'it' ? TXT.it : TXT.en;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Detection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const go = useCallback(
    async (slug: string, files: File[]) => {
      setBusy(`${L.opening} “${toolTitle(locale, slug)}”…`);
      await setPendingFiles(slug, files);
      router.push(`/${locale}/tools/${slug}/`);
    },
    [L.opening, locale, router]
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const d = detect(files);
      setState(d);
      if (d.kind === 'tool') void go(d.slug, d.files);
    },
    [go]
  );

  // File condivisi con l'app da altre app Android ("Condividi" / "Apri con").
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('shared');
    if (!id || !/^[a-z0-9-]+$/i.test(id)) return;
    setBusy(L.loadingShared);
    (async () => {
      try {
        const list: { name: string; type: string; path: string }[] = await (
          await fetch(`/__shared/${id}/index.json`)
        ).json();
        const files = await Promise.all(
          list.map(async (f) => {
            const blob = await (await fetch(`/__shared/${id}/${f.path}`)).blob();
            return new File([blob], f.name, { type: f.type || blob.type });
          })
        );
        setBusy(null);
        handleFiles(files);
      } catch {
        setBusy(null);
        setState({ kind: 'unsupported', ext: '' });
      }
    })();
  }, [L.loadingShared, handleFiles]);

  const reset = () => {
    setState(null);
    setBusy(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header locale={locale as Locale} />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <div className="mx-auto max-w-3xl px-4 pt-20 pb-28">
          <h1 className="text-2xl font-bold text-[hsl(var(--color-foreground))]">{L.title}</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">{L.subtitle}</p>

          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
            data-testid="convert-input"
          />

          {busy ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-5">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--color-primary))]" aria-hidden="true" />
              <span className="font-medium text-[hsl(var(--color-foreground))]">{busy}</span>
            </div>
          ) : state?.kind === 'pdf' ? (
            <section className="mt-6">
              <div className="mb-3 flex items-center gap-3 rounded-2xl bg-[hsl(var(--color-muted))] p-3">
                <FileText className="h-6 w-6 shrink-0 text-red-500" aria-hidden="true" />
                <span className="truncate text-sm font-medium">{state.files[0].name}</span>
              </div>
              <h2 className="mb-3 text-base font-semibold text-[hsl(var(--color-foreground))]">{L.pdfQuestion}</h2>
              <div className="grid grid-cols-2 gap-3">
                {FROM_PDF.map((opt) => (
                  <button
                    key={opt.slug}
                    type="button"
                    onClick={() => go(opt.slug, state.files)}
                    className="flex min-h-[72px] flex-col items-start justify-center rounded-2xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3 text-left active:bg-[hsl(var(--color-muted))]"
                  >
                    <span className="flex w-full items-center justify-between font-semibold text-[hsl(var(--color-foreground))]">
                      {locale === 'it' ? opt.it : opt.en}
                      <ArrowRight className="h-4 w-4 text-[hsl(var(--color-primary))]" aria-hidden="true" />
                    </span>
                    <span className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
                      {locale === 'it' ? opt.hint.it : opt.hint.en}
                    </span>
                  </button>
                ))}
              </div>
              <h2 className="mb-3 mt-6 text-base font-semibold text-[hsl(var(--color-foreground))]">{L.orElse}</h2>
              <div className="flex flex-wrap gap-2">
                {PDF_ACTIONS.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    onClick={() => go(a.slug, state.files)}
                    className="rounded-full border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--color-foreground))] active:bg-[hsl(var(--color-muted))]"
                  >
                    {locale === 'it' ? a.it : a.en}
                  </button>
                ))}
              </div>
              <button type="button" onClick={reset} className="mt-4 w-full rounded-xl py-3 text-sm font-medium text-[hsl(var(--color-primary))]">
                {L.another}
              </button>
            </section>
          ) : (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-6 flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-[hsl(var(--color-primary)/0.4)] bg-[hsl(var(--color-primary)/0.05)] px-4 py-10 active:bg-[hsl(var(--color-primary)/0.1)]"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--color-primary))] text-white shadow-lg">
                  <FileUp className="h-8 w-8" aria-hidden="true" />
                </span>
                <span className="text-lg font-semibold text-[hsl(var(--color-foreground))]">{L.pick}</span>
                <span className="text-sm text-[hsl(var(--color-muted-foreground))]">{L.pickHint}</span>
              </button>
              {state?.kind === 'unsupported' && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {L.unsupported(state.ext)}
                </div>
              )}
              <p className="mt-6 text-xs leading-relaxed text-[hsl(var(--color-muted-foreground))]">
                <span className="font-semibold">{L.formats}:</span> PDF, DOC, DOCX, ODT, RTF, XLS, XLSX, ODS, CSV, PPT,
                PPTX, ODP, JPG, PNG, WebP, BMP, HEIC, TIFF, SVG, PSD, TXT, MD, JSON, XPS, EPUB, MOBI, AZW, FB2, DJVU, CBZ, EML, MSG
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
