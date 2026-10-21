'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

/**
 * Come NextIntlClientProvider, ma se manca una traduzione mostra un testo leggibile
 * (es. "optionsTitle" → "Options title") invece della chiave grezza.
 */
function humanize(key: string): string {
  const last = key.split('.').pop() || key;
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="UTC"
      getMessageFallback={({ key }) => humanize(key)}
      onError={() => {}}
    >
      {children}
    </NextIntlClientProvider>
  );
}
