'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { takePendingFiles } from '@/lib/app/pending-files';

/** Aspetta che compaia il campo "scegli file" dello strumento. */
function waitForFileInput(timeoutMs: number): Promise<HTMLInputElement | null> {
  return new Promise((resolve) => {
    const find = () =>
      document.querySelector<HTMLInputElement>('[data-testid="tool-page-interface"] input[type="file"]') ||
      document.querySelector<HTMLInputElement>('main input[type="file"]');
    const found = find();
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Se arriviamo su uno strumento dalla pagina "Converti" (o da un file condiviso
 * con l'app), carica automaticamente il file nello strumento.
 */
export function PendingFileInjector() {
  const pathname = usePathname();

  useEffect(() => {
    const m = pathname?.match(/\/tools\/([^/]+)\/?$/);
    if (!m) return;
    const slug = m[1];
    let cancelled = false;
    (async () => {
      const files = await takePendingFiles(slug);
      if (!files || !files.length || cancelled) return;
      const input = await waitForFileInput(15000);
      if (!input || cancelled) return;
      // Lascia a React il tempo di collegare i propri gestori di eventi.
      await new Promise((r) => setTimeout(r, 300));
      const dt = new DataTransfer();
      for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
