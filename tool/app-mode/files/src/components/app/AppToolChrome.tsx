'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Tool } from '@/types/tool';
import { getToolIcon } from '@/config/icons';
import { FavoriteButton } from '@/components/ui/FavoriteButton';

/** Intestazione compatta della pagina strumento (modalità app). */
export function AppToolHeader({
  tool,
  title,
  subtitle,
  locale,
}: {
  tool: Tool;
  title: string;
  subtitle?: string;
  locale: string;
}) {
  const router = useRouter();
  const Icon = getToolIcon(tool.icon);

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(`/${locale}`);
  };

  return (
    <header className="flex items-center gap-2 py-2" data-testid="tool-page-header">
      <button
        type="button"
        onClick={goBack}
        aria-label="Indietro"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[hsl(var(--color-foreground))] active:bg-[hsl(var(--color-muted))]"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden="true" />
      </button>
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--color-primary)/0.1)]"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5 text-[hsl(var(--color-primary))]" />
      </div>
      <div className="min-w-0 flex-1">
        <h1
          className="truncate text-lg font-bold leading-tight text-[hsl(var(--color-foreground))]"
          data-testid="tool-page-title"
        >
          {title}
        </h1>
        {subtitle && (
          <p className="line-clamp-1 text-xs text-[hsl(var(--color-muted-foreground))]" data-testid="tool-page-subtitle">
            {subtitle}
          </p>
        )}
      </div>
      <FavoriteButton toolId={tool.id} size="sm" />
    </header>
  );
}

/** Strumenti correlati come "chip" scorrevoli (modalità app). */
export function AppRelatedTools({
  tools,
  locale,
  localizedRelatedTools,
}: {
  tools: Tool[];
  locale: string;
  localizedRelatedTools: Record<string, { title: string; description: string }>;
}) {
  const t = useTranslations();
  if (!tools.length) return null;
  return (
    <section className="mt-8" aria-labelledby="app-related-heading" data-testid="tool-page-related-tools">
      <h2 id="app-related-heading" className="mb-2 px-1 text-sm font-semibold text-[hsl(var(--color-muted-foreground))]">
        {t('tools.relatedTools')}
      </h2>
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-2" style={{ scrollbarWidth: 'none' }}>
        {tools.map((rt) => {
          const Icon = getToolIcon(rt.icon);
          const name =
            localizedRelatedTools[rt.id]?.title ||
            rt.id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          return (
            <Link
              key={rt.id}
              href={`/${locale}/tools/${rt.slug}`}
              className="flex shrink-0 items-center gap-2 rounded-full border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--color-foreground))] active:bg-[hsl(var(--color-muted))]"
            >
              <Icon className="h-4 w-4 text-[hsl(var(--color-primary))]" aria-hidden="true" />
              {name}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
