import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/lib/i18n/config';
import ConvertPageClient from './ConvertPageClient';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function ConvertPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ConvertPageClient locale={locale} />;
}
