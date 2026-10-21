/**
 * Riconoscimento automatico del formato per la pagina "Converti".
 * Dato un file, sceglie lo strumento che lo converte (in PDF o dal PDF).
 */

/** Estensione (minuscola, senza punto) → strumento che la converte in PDF. */
export const TO_PDF: Record<string, string> = {
  doc: 'word-to-pdf',
  docx: 'word-to-pdf',
  odt: 'word-to-pdf',
  rtf: 'rtf-to-pdf',
  xls: 'excel-to-pdf',
  xlsx: 'excel-to-pdf',
  ods: 'excel-to-pdf',
  csv: 'excel-to-pdf',
  ppt: 'pptx-to-pdf',
  pptx: 'pptx-to-pdf',
  odp: 'pptx-to-pdf',
  jpg: 'jpg-to-pdf',
  jpeg: 'jpg-to-pdf',
  png: 'png-to-pdf',
  webp: 'webp-to-pdf',
  bmp: 'bmp-to-pdf',
  heic: 'heic-to-pdf',
  heif: 'heic-to-pdf',
  tif: 'tiff-to-pdf',
  tiff: 'tiff-to-pdf',
  svg: 'svg-to-pdf',
  psd: 'psd-to-pdf',
  psb: 'psd-to-pdf',
  txt: 'txt-to-pdf',
  md: 'markdown-to-pdf',
  markdown: 'markdown-to-pdf',
  json: 'json-to-pdf',
  xps: 'xps-to-pdf',
  epub: 'epub-to-pdf',
  mobi: 'mobi-to-pdf',
  azw: 'mobi-to-pdf',
  azw3: 'mobi-to-pdf',
  fb2: 'fb2-to-pdf',
  djvu: 'djvu-to-pdf',
  djv: 'djvu-to-pdf',
  cbz: 'cbz-to-pdf',
  eml: 'email-to-pdf',
  msg: 'email-to-pdf',
};

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'svg']);

/** Tipo MIME → estensione, per i file senza estensione (es. condivisi da altre app). */
const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/csv': 'csv',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/json': 'json',
  'application/epub+zip': 'epub',
  'message/rfc822': 'eml',
};

export function extensionOf(file: { name: string; type?: string }): string {
  const name = file.name.toLowerCase();
  if (name.endsWith('.fb2.zip')) return 'fb2';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  if (ext) return ext;
  return MIME_EXT[(file.type || '').toLowerCase()] || '';
}

/** Conversioni possibili partendo da un PDF, in ordine di utilità sul telefono. */
export const FROM_PDF: { slug: string; it: string; en: string; hint: { it: string; en: string } }[] = [
  { slug: 'pdf-to-docx', it: 'Word', en: 'Word', hint: { it: 'DOCX modificabile', en: 'Editable DOCX' } },
  { slug: 'pdf-to-jpg', it: 'JPG', en: 'JPG', hint: { it: 'Un’immagine per pagina', en: 'One image per page' } },
  { slug: 'pdf-to-png', it: 'PNG', en: 'PNG', hint: { it: 'Immagini senza perdita', en: 'Lossless images' } },
  { slug: 'pdf-to-excel', it: 'Excel', en: 'Excel', hint: { it: 'Tabelle in XLSX', en: 'Tables to XLSX' } },
  { slug: 'pdf-to-pptx', it: 'PowerPoint', en: 'PowerPoint', hint: { it: 'Una slide per pagina', en: 'One slide per page' } },
  { slug: 'pdf-to-markdown', it: 'Testo / Markdown', en: 'Text / Markdown', hint: { it: 'Solo il testo', en: 'Text only' } },
  { slug: 'pdf-to-pdfa', it: 'PDF/A', en: 'PDF/A', hint: { it: 'Per l’archiviazione', en: 'For archiving' } },
  { slug: 'pdf-to-greyscale', it: 'Bianco e nero', en: 'Greyscale', hint: { it: 'PDF in scala di grigi', en: 'Greyscale PDF' } },
  { slug: 'pdf-to-webp', it: 'WebP', en: 'WebP', hint: { it: 'Immagini leggere', en: 'Light images' } },
  { slug: 'pdf-to-tiff', it: 'TIFF', en: 'TIFF', hint: { it: 'Immagini per la stampa', en: 'Print images' } },
  { slug: 'pdf-to-svg', it: 'SVG', en: 'SVG', hint: { it: 'Grafica vettoriale', en: 'Vector graphics' } },
  { slug: 'pdf-to-bmp', it: 'BMP', en: 'BMP', hint: { it: 'Immagini bitmap', en: 'Bitmap images' } },
  { slug: 'pdf-to-cbz', it: 'Fumetto CBZ', en: 'Comic CBZ', hint: { it: 'Per lettori di fumetti', en: 'For comic readers' } },
  { slug: 'pdf-to-json', it: 'JSON', en: 'JSON', hint: { it: 'Dati strutturati', en: 'Structured data' } },
  { slug: 'extract-images', it: 'Estrai immagini', en: 'Extract images', hint: { it: 'Le foto contenute', en: 'Embedded pictures' } },
];

/** Altre azioni utili quando si apre un PDF. */
export const PDF_ACTIONS: { slug: string; it: string; en: string }[] = [
  { slug: 'edit-pdf', it: 'Modifica', en: 'Edit' },
  { slug: 'sign-pdf', it: 'Firma', en: 'Sign' },
  { slug: 'pdf-reader', it: 'Leggi', en: 'Read' },
  { slug: 'compress-pdf', it: 'Comprimi', en: 'Compress' },
  { slug: 'organize-pdf', it: 'Organizza pagine', en: 'Organize pages' },
  { slug: 'split-pdf', it: 'Dividi', en: 'Split' },
  { slug: 'ocr-pdf', it: 'OCR (testo da scansione)', en: 'OCR' },
  { slug: 'encrypt-pdf', it: 'Proteggi con password', en: 'Protect' },
];

export type Detection =
  | { kind: 'tool'; slug: string; files: File[] }
  | { kind: 'pdf'; files: File[] }
  | { kind: 'unsupported'; ext: string };

/** Decide cosa fare con i file scelti. */
export function detect(files: File[]): Detection {
  if (!files.length) return { kind: 'unsupported', ext: '' };
  const exts = files.map(extensionOf);
  if (files.length === 1) {
    const ext = exts[0];
    if (ext === 'pdf') return { kind: 'pdf', files };
    const slug = TO_PDF[ext];
    return slug ? { kind: 'tool', slug, files } : { kind: 'unsupported', ext };
  }
  // Più file
  if (exts.every((e) => IMAGE_EXT.has(e))) return { kind: 'tool', slug: 'image-to-pdf', files };
  if (exts.every((e) => e === 'pdf')) return { kind: 'tool', slug: 'merge-pdf', files };
  const bad = exts.find((e) => e !== 'pdf' && !TO_PDF[e]);
  if (bad !== undefined) return { kind: 'unsupported', ext: bad };
  // Formati misti: "Unisci PDF" accetta documenti, immagini e testi e crea un unico PDF.
  return { kind: 'tool', slug: 'merge-pdf', files };
}
