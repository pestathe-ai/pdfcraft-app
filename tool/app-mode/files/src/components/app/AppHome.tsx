'use client';

import Link from 'next/link';
import { RefreshCw, ChevronRight, Lock, LayoutGrid } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { FavoriteToolsSection } from '@/components/tools/FavoriteToolsSection';
import { getToolById } from '@/config/tools';
import { getToolIcon } from '@/config/icons';
import type { Locale } from '@/lib/i18n/config';
import { AppBrandMark, BRAND } from '@/components/app/AppBrandMark';

const QUICK: { slug: string; it: string; en: string }[] = [
  { slug: 'edit-pdf', it: 'Modifica', en: 'Edit' },
  { slug: 'sign-pdf', it: 'Firma', en: 'Sign' },
  { slug: 'merge-pdf', it: 'Unisci', en: 'Merge' },
  { slug: 'split-pdf', it: 'Dividi', en: 'Split' },
  { slug: 'compress-pdf', it: 'Comprimi', en: 'Compress' },
  { slug: 'organize-pdf', it: 'Organizza', en: 'Organize' },
  { slug: 'ocr-pdf', it: 'OCR', en: 'OCR' },
  { slug: 'encrypt-pdf', it: 'Proteggi', en: 'Protect' },
  { slug: 'image-to-pdf', it: 'Foto in PDF', en: 'Photos to PDF' },
  { slug: 'pdf-reader', it: 'Leggi', en: 'Read' },
  { slug: 'rotate-pdf', it: 'Ruota', en: 'Rotate' },
  { slug: 'add-watermark', it: 'Filigrana', en: 'Watermark' },
];

/** Pagina iniziale in modalità app: azioni rapide invece della pagina promozionale del sito. */
export function AppHome({
  locale,
  localizedToolContent = {},
}: {
  locale: Locale;
  localizedToolContent?: Record<string, { title: string; description: string }>;
}) {
  const it = locale === 'it';
  return (
    <div className="min-h-screen flex flex-col bg-[hsl(var(--color-background))]">
      <Header locale={locale} />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <div className="mx-auto max-w-3xl px-4 pt-20 pb-28">
          <Link
            href={`/${locale}/convert/`}
            className="flex items-center gap-4 rounded-3xl bg-gradient-to-br from-[hsl(var(--color-primary))] to-[hsl(var(--color-accent))] p-5 text-white shadow-lg active:opacity-90"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              <RefreshCw className="h-7 w-7" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xl font-bold">{it ? 'Converti' : 'Convert'}</span>
              <span className="block text-sm text-white/90">
                {it ? 'Scegli un file: il formato si riconosce da solo' : 'Pick a file: the format is detected automatically'}
              </span>
            </span>
            <ChevronRight className="h-6 w-6 shrink-0" aria-hidden="true" />
          </Link>

          <h2 className="mb-3 mt-7 text-base font-semibold text-[hsl(var(--color-foreground))]">
            {it ? 'Azioni rapide' : 'Quick actions'}
          </h2>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            {QUICK.map((q) => {
              const tool = getToolById(q.slug);
              if (!tool) return null;
              const Icon = getToolIcon(tool.icon);
              return (
                <Link
                  key={q.slug}
                  href={`/${locale}/tools/${tool.slug}/`}
                  className="flex flex-col items-center gap-1.5 rounded-2xl py-1 text-center active:bg-[hsl(var(--color-muted))]"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--color-primary)/0.1)]">
                    <Icon className="h-6 w-6 text-[hsl(var(--color-primary))]" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-medium leading-tight text-[hsl(var(--color-foreground))]">
                    {it ? q.it : q.en}
                  </span>
                </Link>
              );
            })}
          </div>

          <FavoriteToolsSection
            locale={locale}
            className="mt-8"
            maxItems={8}
            localizedToolsContent={localizedToolContent}
          />

          <Link
            href={`/${locale}/tools/`}
            className="mt-8 flex items-center gap-3 rounded-2xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4 active:bg-[hsl(var(--color-muted))]"
          >
            <LayoutGrid className="h-6 w-6 text-[hsl(var(--color-primary))]" aria-hidden="true" />
            <span className="flex-1 font-semibold text-[hsl(var(--color-foreground))]">
              {it ? 'Tutti gli strumenti' : 'All tools'}
            </span>
            <ChevronRight className="h-5 w-5 text-[hsl(var(--color-muted-foreground))]" aria-hidden="true" />
          </Link>

          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-[hsl(var(--color-muted-foreground))]">
            <Lock className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
            {it ? 'I file restano sul telefono: nulla viene caricato online.' : 'Files stay on your phone: nothing is uploaded.'}
          </p>

          <div className="mt-10 flex flex-col items-center gap-2 text-center">
            <AppBrandMark size={44} />
            <p className="text-sm font-semibold text-[hsl(var(--color-foreground))]">{BRAND.app}</p>
            <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
              {it ? "un'app" : 'an app by'} <span className="font-semibold">{BRAND.studio}</span>
            </p>
            <p className="text-[11px] text-[hsl(var(--color-muted-foreground))]">
              {it ? 'Basata su PDFCraft, software libero (AGPL-3.0)' : 'Based on PDFCraft, free software (AGPL-3.0)'}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
