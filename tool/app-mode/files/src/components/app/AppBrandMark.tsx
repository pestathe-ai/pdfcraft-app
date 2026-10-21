/** Marchio Dom Studio (stile "Domus"): casa-documento con la "D." di D. Docs lab. */
export const BRAND = {
  app: 'D. Docs lab',
  studio: 'Dom Studio',
  blue: '#1D3A8A',
  orange: '#F28C38',
  paper: '#FFF8F0',
};

export function AppBrandMark({ size = 36, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 108 108"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0 }}
    >
      <rect width="108" height="108" rx="26" fill={BRAND.blue} />
      <path d="M31 40 L54 24 L77 40 L77 82 Q77 85 74 85 L34 85 Q31 85 31 82 Z" fill={BRAND.paper} />
      <path d="M54 24 L77 40 L60 40 Q54 40 54 34 Z" fill={BRAND.orange} />
      <path
        fillRule="evenodd"
        d="M40 50 L52 50 A13 13 0 0 1 52 76 L40 76 Z M46 56 L51 56 A7 7 0 0 1 51 70 L46 70 Z"
        fill={BRAND.blue}
      />
      <circle cx="70" cy="73" r="3.6" fill={BRAND.orange} />
    </svg>
  );
}
