'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

type BackHandler = () => boolean;

declare global {
  interface Window {
    /** Chiamata dall'app Android quando si preme "Indietro": true = gestito dalla pagina. */
    __pdfcraftAppBack?: () => boolean;
    __pdfcraftBackStack?: BackHandler[];
  }
}

/** Registra un gestore per il tasto Indietro di Android (l'ultimo registrato vince). */
export function useAppBackHandler(handler: () => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stack = (window.__pdfcraftBackStack ||= []);
    const fn: BackHandler = () => {
      ref.current();
      return true;
    };
    stack.push(fn);
    window.__pdfcraftAppBack = () => {
      const top = window.__pdfcraftBackStack?.[window.__pdfcraftBackStack.length - 1];
      return top ? top() : false;
    };
    return () => {
      const i = stack.indexOf(fn);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}

/**
 * Area di lavoro a schermo intero (per editor e visualizzatori sul telefono).
 * Barra in alto con chiusura, titolo e azioni; il contenuto occupa il resto dello schermo.
 */
export function AppFullscreen({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useAppBackHandler(onClose);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-[hsl(var(--color-background))]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-app-fullscreen
    >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[hsl(var(--color-border))] px-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[hsl(var(--color-muted))]"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[hsl(var(--color-foreground))]">{title}</span>
        {actions}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
