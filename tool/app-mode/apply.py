#!/usr/bin/env python3
"""
Applica a una copia pulita di PDFCraft (upstream) le modifiche per l'app Android:
interfaccia da telefono, pagina "Converti", editor a schermo intero, ODT senza
LibreOffice, traduzioni mancanti. Ogni modifica controlla che il testo originale
esista: se PDFCraft cambia, la build si ferma con un messaggio chiaro.

Uso: python3 apply.py <cartella di PDFCraft>
"""
import json
import os
import shutil
import sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(sys.argv[1])
errors = []


def path(p):
    return os.path.join(ROOT, p)


def read(p):
    with open(path(p), encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(path(p), 'w', encoding='utf-8') as f:
        f.write(s)


def rep(p, old, new, count=1):
    s = read(p)
    if old not in s:
        errors.append(f'{p}: testo non trovato: {old[:80]!r}')
        return
    s = s.replace(old, new) if count == 0 else s.replace(old, new, count)
    write(p, s)


def rep_all(p, pairs):
    s = read(p)
    for old, new in pairs:
        if old not in s:
            errors.append(f'{p}: testo non trovato: {old[:80]!r}')
            continue
        s = s.replace(old, new)
    write(p, s)


def add_import(p, line):
    s = read(p)
    if line in s:
        return
    i = s.index('\nimport ')
    j = s.index('\n', i + 1)
    write(p, s[: j + 1] + line + '\n' + s[j + 1 :])


# ---------------------------------------------------------------- nuovi file
src_files = os.path.join(HERE, 'files')
for base, _, names in os.walk(src_files):
    for n in names:
        s = os.path.join(base, n)
        rel = os.path.relpath(s, src_files)
        os.makedirs(os.path.dirname(path(rel)), exist_ok=True)
        shutil.copyfile(s, path(rel))

# ---------------------------------------------------------------- stili
with open(os.path.join(HERE, 'app-mode.css'), encoding='utf-8') as f:
    css = f.read()
g = read('src/app/globals.css')
if 'Modalità app Android' not in g:
    write('src/app/globals.css', g + '\n' + css)

# ---------------------------------------------------------------- Button: attributi per lo stile
rep('src/components/ui/Button.tsx',
    "        aria-label={ariaLabel}\n        className=",
    "        aria-label={ariaLabel}\n        data-variant={variant}\n        data-size={size}\n        className=")

# ---------------------------------------------------------------- layout della lingua
L = 'src/app/[locale]/layout.tsx'
rep(L, "import '@/app/globals.css';",
    "import '@/app/globals.css';\nimport { APP_MODE } from '@/lib/app-mode';\n"
    "import { AppBottomNav } from '@/components/app/AppBottomNav';\n"
    "import { PendingFileInjector } from '@/components/app/PendingFileInjector';\n"
    "import { IntlProvider } from '@/components/app/IntlProvider';")
rep(L, "import { NextIntlClientProvider } from 'next-intl';\n", "")
rep(L, "<NextIntlClientProvider messages={messages}>", "<IntlProvider locale={locale} messages={messages}>")
rep(L, "</NextIntlClientProvider>", "</IntlProvider>")
rep(L, "<div lang={locale} dir={direction} className=",
    "<div lang={locale} dir={direction} data-app={APP_MODE ? 'android' : undefined} className=")
rep(L, "        {children}\n      </div>",
    "        {children}\n        {APP_MODE && <AppBottomNav locale={locale} />}\n        {APP_MODE && <PendingFileInjector />}\n      </div>")

# ---------------------------------------------------------------- intestazione del sito
H = 'src/components/layout/Header.tsx'
add_import(H, "import { APP_MODE } from '@/lib/app-mode';")
rep_all(H, [
    ('<div className="container mx-auto px-4">\n        <div className="flex h-20 items-center justify-between">',
     "<div className={`container mx-auto ${APP_MODE ? 'px-3' : 'px-4'}`}>\n        <div className={`flex ${APP_MODE ? 'h-14' : 'h-20'} items-center justify-between`}>"),
    ('<div className="flex flex-1 items-center justify-end gap-3">',
     "<div className={`flex flex-1 items-center justify-end ${APP_MODE ? 'gap-1' : 'gap-3'}`}>"),
    ("            {/* Update Check Button */}\n            <UpdateCheckButton />",
     "            {/* Update Check Button */}\n            {!APP_MODE && <UpdateCheckButton />}"),
    ("            {/* GitHub Repository Link */}\n            <a",
     "            {/* GitHub Repository Link */}\n            {!APP_MODE && <a"),
    ('              <Github className="h-5 w-5" aria-hidden="true" />\n            </a>\n\n            {/* Theme Toggle */}',
     '              <Github className="h-5 w-5" aria-hidden="true" />\n            </a>}\n\n            {/* Theme Toggle */}'),
    ("    { href: `/${locale}/studio`, label: 'Studio' },",
     "    ...(APP_MODE ? [] : [{ href: `/${locale}/studio`, label: 'Studio' }]),"),
    ("    { href: `/${locale}/workflow`, label: t('navigation.workflow') || 'Workflow' },",
     "    ...(APP_MODE ? [] : [{ href: `/${locale}/workflow`, label: t('navigation.workflow') || 'Workflow' }]),"),
])

# ---------------------------------------------------------------- pagina strumento compatta
T = 'src/components/tools/ToolPage.tsx'
rep(T, "import { sanitizeHtml } from '@/lib/utils/html-sanitizer';",
    "import { sanitizeHtml } from '@/lib/utils/html-sanitizer';\nimport { APP_MODE } from '@/lib/app-mode';\n"
    "import { AppToolHeader, AppRelatedTools } from '@/components/app/AppToolChrome';")
rep(T, '          <div className="max-w-7xl mx-auto px-4 pt-24 pb-8">',
    '''          {APP_MODE ? (
            <div className="max-w-3xl mx-auto px-3 pt-16 pb-28" data-app-tool-page>
              <AppToolHeader tool={tool} title={content.title || toolDisplayName} subtitle={content.metaDescription} locale={locale} />
              <section className="mt-3" data-testid="tool-page-interface" aria-label="Tool interface">
                {children}
              </section>
              <AppRelatedTools tools={relatedTools} locale={locale} localizedRelatedTools={localizedRelatedTools} />
            </div>
          ) : (
          <div className="max-w-7xl mx-auto px-4 pt-24 pb-8">''')
rep(T, '''              localizedRelatedTools={localizedRelatedTools}
            />
          </div>
        </main>

        <Footer locale={locale as Locale} />''', '''              localizedRelatedTools={localizedRelatedTools}
            />
          </div>
          )}
        </main>

        {!APP_MODE && <Footer locale={locale as Locale} />}''')

# ---------------------------------------------------------------- scheda strumento: riga compatta
C = 'src/components/tools/ToolCard.tsx'
rep(C, "import { FavoriteButton } from '@/components/ui/FavoriteButton';",
    "import { FavoriteButton } from '@/components/ui/FavoriteButton';\nimport { APP_MODE } from '@/lib/app-mode';")
rep(C, '''  return (
    <Link
      href={toolUrl}
      className={`block focus:outline-none''', '''  if (APP_MODE) {
    // Riga compatta, come la lista di un'app
    return (
      <div className={`relative ${className}`} data-testid="tool-card">
        <Link
          href={toolUrl}
          className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--color-border)/0.6)] bg-[hsl(var(--color-card))] py-3 pl-3 pr-12 active:bg-[hsl(var(--color-muted))]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--color-primary)/0.1)]" aria-hidden="true">
            <IconComponent className="h-5 w-5 text-[hsl(var(--color-primary))]" data-icon={tool.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-[hsl(var(--color-card-foreground))]" data-testid="tool-card-name">
              {toolName}
            </span>
            <span className="block truncate text-xs text-[hsl(var(--color-muted-foreground))]" data-testid="tool-card-description">
              {description}
            </span>
          </span>
        </Link>
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <FavoriteButton toolId={tool.id} size="sm" />
        </div>
      </div>
    );
  }

  return (
    <Link
      href={toolUrl}
      className={`block focus:outline-none''')

# ---------------------------------------------------------------- home e pagina strumenti
HP = 'src/app/[locale]/HomePageClient.tsx'
add_import(HP, "import { APP_MODE } from '@/lib/app-mode';\nimport { AppHome } from '@/components/app/AppHome';")
rep(HP, "export default function HomePageClient({ locale, localizedToolContent }: HomePageClientProps) {\n",
    "export default function HomePageClient({ locale, localizedToolContent }: HomePageClientProps) {\n"
    "  if (APP_MODE) return <AppHome locale={locale} localizedToolContent={localizedToolContent} />;\n"
    "  return <WebHomePage locale={locale} localizedToolContent={localizedToolContent} />;\n}\n\n"
    "function WebHomePage({ locale, localizedToolContent }: HomePageClientProps) {\n")
rep('src/app/[locale]/tools/ToolsPageClient.tsx',
    '      <main className="flex-1">\n        {/* Page Header */}',
    '      <main className="flex-1" data-tools-page>\n        {/* Page Header */}')

# ---------------------------------------------------------------- Modifica PDF a schermo intero
E = 'src/components/tools/edit-pdf/EditPDFTool.tsx'
add_import(E, "import { APP_MODE } from '@/lib/app-mode';\nimport { AppFullscreen } from '@/components/app/AppFullscreen';")
anchor = '      {file && (\n        <div className="space-y-4">\n          {/* File summary & mode switcher */}'
rep(E, anchor, '''      {file && APP_MODE && (
        <AppFullscreen
          title={file.name}
          onClose={handleClear}
          actions={
            <div className="flex shrink-0 items-center rounded-full bg-[hsl(var(--color-muted))] p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setEditMode('direct')}
                className={`rounded-full px-3 py-2 ${editMode === 'direct' ? 'bg-blue-600 text-white' : 'text-[hsl(var(--color-muted-foreground))]'}`}
              >
                {locale === 'it' ? 'Testo' : 'Text'}
              </button>
              <button
                type="button"
                onClick={() => setEditMode('annotator')}
                className={`rounded-full px-3 py-2 ${editMode === 'annotator' ? 'bg-blue-600 text-white' : 'text-[hsl(var(--color-muted-foreground))]'}`}
              >
                {locale === 'it' ? 'Annota' : 'Annotate'}
              </button>
            </div>
          }
        >
          {savedNotice && (
            <div className="border-b border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-950/30">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">{savedNotice}</p>
            </div>
          )}
          {editMode === 'direct' ? (
            <div className="relative h-full">
              <iframe
                ref={iframeRef}
                src={`/direct-pdf-editor/index.html?lang=${encodeURIComponent(locale || 'en')}`}
                className="h-full w-full border-0"
                title="PDF Editor"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                allow="local-fonts"
                onLoad={handleIframeLoad}
              />
              {!isEditorReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-gray-950/80">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                </div>
              )}
            </div>
          ) : (
            <LegacyAnnotatorTool
              file={file}
              onFileChange={setFile}
              hideHeaderCard={true}
              onClear={handleClear}
              className="border-0 p-2 shadow-none"
            />
          )}
        </AppFullscreen>
      )}

''' + anchor.replace('{file && (', '{file && !APP_MODE && (', 1))
rep(E, "{locale === 'zh' ? '直接编辑正文与图片' : 'Direct Content Edit'}",
    "{locale === 'zh' ? '直接编辑正文与图片' : locale === 'it' ? 'Modifica testo e immagini' : 'Direct Content Edit'}", 0)
rep(E, "{locale === 'zh' ? '经典批注与涂鸦' : 'Classic Annotator'}",
    "{locale === 'zh' ? '经典批注与涂鸦' : locale === 'it' ? 'Annota e disegna' : 'Classic Annotator'}", 0)

A = 'src/components/tools/edit-pdf/LegacyAnnotatorTool.tsx'
add_import(A, "import { APP_MODE } from '@/lib/app-mode';")
rep_all(A, [
    ('''              src={`/pdfjs-annotation-viewer/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`}
              className="w-full h-[700px] border-0"''',
     '''              src={`/pdfjs-annotation-viewer/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`}
              className={APP_MODE ? 'w-full h-[calc(100dvh-4.5rem)] border-0' : 'w-full h-[700px] border-0'}'''),
    ("    <div className={`space-y-6 ${className}`.trim()}>",
     "    <div className={`${APP_MODE ? 'space-y-2' : 'space-y-6'} ${className}`.trim()}>"),
    ('''          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-[hsl(var(--color-border))] bg-white p-2"
            aria-label={tTools('textHistory')}
          >''',
     '''          {(!APP_MODE || textUndoCount > 0 || textRedoCount > 0) && <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-[hsl(var(--color-border))] bg-white p-2"
            aria-label={tTools('textHistory')}
          >'''),
    ('''              ↪ {tTools('textRedo')}
            </Button>
          </div>''', '''              ↪ {tTools('textRedo')}
            </Button>
          </div>}'''),
])

# ---------------------------------------------------------------- Firma PDF
S = 'src/components/tools/sign/SignPDFTool.tsx'
rep(S, "import { useTranslations } from 'next-intl';",
    "import { useTranslations, useLocale } from 'next-intl';\nimport { APP_MODE } from '@/lib/app-mode';\n"
    "import { AppFullscreen } from '@/components/app/AppFullscreen';")
s = read(S)
k = s.index("  return (\n    <div className={`space-y-6 ${className}`.trim()}>")
s = s[:k] + '''  const uiLocale = useLocale();
  const L = uiLocale === 'zh'
    ? { exTitle: '从已签署 PDF 提取签名 / 印章', exBadge: '支持 Adobe Acrobat', exDesc: '上传已签名的 PDF，智能识别笔迹或印章并剥离纸张白底，一键存入签名库随时使用。', lib: '📂 签名库', img: '🖼️ 导入图片签名', fromPdf: '从 PDF 提取', save: '保存已签署 PDF' }
    : uiLocale === 'it'
    ? { exTitle: 'Firme e timbri', exBadge: 'Compatibile Adobe Acrobat', exDesc: 'Usa una firma salvata, importa un\\u2019immagine o estrai firma/timbro da un PDF già firmato.', lib: '📂 Le mie firme', img: '🖼️ Firma da immagine', fromPdf: 'Estrai da PDF', save: 'Salva PDF firmato' }
    : { exTitle: 'Signatures & stamps', exBadge: 'Adobe Acrobat compatible', exDesc: 'Use a saved signature, import an image, or extract a signature/stamp from an already signed PDF.', lib: '📂 Signature library', img: '🖼️ Image signature', fromPdf: 'Extract from PDF', save: 'Save signed PDF' };

''' + s[k:]
write(S, s)
rep_all(S, [
    ("<span>从已签署 PDF 提取签名 / 印章</span>", "<span>{L.exTitle}</span>"),
    ("                支持 Adobe Acrobat\n", "                {L.exBadge}\n"),
    ("              上传已签名的 PDF，智能识别笔迹或印章并剥离纸张白底，一键存入签名库随时使用。\n", "              {L.exDesc}\n"),
    ("<span>📂 签名库</span>", "<span>{L.lib}</span>"),
    ("<span>🖼️ 导入图片签名</span>", "<span>{L.img}</span>"),
    ("<span>从 PDF 提取</span>", "<span>{L.fromPdf}</span>"),
    ("`签名“${res.name}”已成功存入签名库！您可以在工具栏的签名笔或签名库中直接使用。`",
     "`Firma \"${res.name}\" salvata: la trovi nello strumento firma o in \"Le mie firme\".`"),
    ("`无法读取图片“${file.name}”，请使用 PNG、JPEG、WebP 或 SVG 文件。`",
     "`Impossibile leggere l'immagine \"${file.name}\": usa PNG, JPEG, WebP o SVG.`"),
    ("name || '签名图片'", "name || 'Firma'"),
    ("'本地图片导入'", "'Immagine importata'"),
    ("`签名“${saved.name}”已成功导入并在当前文档激活！可在页面点击放置并拖动边角自由缩放。`",
     "`Firma \"${saved.name}\" pronta: tocca la pagina per posizionarla e trascina gli angoli per ridimensionarla.`"),
    ("`签名“${saved.name}”已存入签名库！打开 PDF 后即可随时选用盖章。`",
     "`Firma \"${saved.name}\" salvata: aprendo un PDF potrai usarla subito.`"),
    ("'点击工具栏中的签名笔工具（或使用上方快捷导入图片/从 PDF 提取）'", "'Tocca lo strumento firma nella barra (o importa un\\'immagine / estrai da PDF)'"),
    ("'选择手写绘制、输入文本，或直接上传现成的透明 PNG 图片签名'", "'Disegna la firma, scrivila, o carica un\\'immagine PNG trasparente'"),
    ("'在页面点击放置签名，可随意拖拽四角自由调整大小（Resize）与旋转'", "'Tocca la pagina per posizionarla; trascina gli angoli per ridimensionare e ruotare'"),
    ("'完成签署后，点击下方的“保存已签署 PDF”'", "'Alla fine tocca \"Salva PDF firmato\"'"),
    ("      {/* PDF Viewer */}\n      {signState.file && (", '''      {/* PDF Viewer (app: schermo intero) */}
      {signState.file && APP_MODE && (
        <AppFullscreen
          title={signState.file.name}
          onClose={handleClear}
          actions={
            <button
              type="button"
              onClick={() => setIsLibraryOpen(true)}
              className="shrink-0 rounded-full px-3 py-2 text-xs font-semibold text-[hsl(var(--color-primary))] active:bg-[hsl(var(--color-muted))]"
            >
              {L.lib}
            </button>
          }
        >
          <div className="flex h-full flex-col">
            <iframe
              key={signState.file.name + signState.file.lastModified}
              ref={iframeRef}
              src={VIEWER_HTML}
              onLoad={handleIframeLoad}
              className="min-h-0 w-full flex-1 bg-gray-100"
              style={{ border: 'none' }}
              title="PDF Signature Editor"
            />
            <div className="shrink-0 border-t border-[hsl(var(--color-border))] p-3">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleSave}
                disabled={!signState.viewerReady || isProcessing}
                loading={isProcessing}
              >
                {isProcessing ? (t('status.processing') || 'Processing...') : (tTools('signPdf.saveButton') || L.save)}
              </Button>
            </div>
          </div>
        </AppFullscreen>
      )}

      {/* PDF Viewer */}
      {signState.file && !APP_MODE && ('''),
])

rep_all('src/components/tools/sign/SignatureExtractorModal.tsx', [
    ("' - 签名'", "' - firma'"),
    ("'无法解析所选 PDF 文件'", "'Impossibile leggere il PDF selezionato'"),
    ("'渲染页面失败，请重试'", "'Impossibile mostrare la pagina, riprova'"),
    ("'已成功存入签名库！当前签名工具已准备就绪。'", "'Firma salvata in \"Le mie firme\": è pronta all\\'uso.'"),
    ("'保存签名失败，请重试'", "'Salvataggio della firma non riuscito, riprova'"),
    ("'透明签名 PNG 已开始下载！'", "'Download della firma PNG avviato.'"),
    ("'下载签名图片失败'", "'Download della firma non riuscito'"),
    ("'透明签名已成功复制到剪贴板！'", "'Firma copiata negli appunti.'"),
    ("'当前浏览器环境不支持直接复制图片到剪贴板，请使用下载功能'", "'Copia delle immagini non supportata qui: usa il download.'"),
    ("'复制到剪贴板失败'", "'Copia non riuscita'"),
    ('title="从已签署 PDF 提取签名 / 印章"', 'title="Estrai firma o timbro da un PDF firmato"'),
    ("上传已签署的 PDF 文件", "Carica un PDF già firmato"),
    ("支持自动提取 Adobe Acrobat 等各类工具签署的数字签名、电子印章与手写签名，自动剔除纸张白底，生成高精透明签名并存入签名库。",
     "Estrae firme digitali, timbri e firme a mano (anche da Adobe Acrobat), toglie lo sfondo bianco e salva la firma trasparente tra le tue firme."),
    ("选择已签署 PDF 文件", "Scegli il PDF firmato"),
    ("(共 {pageCount} 页)", "({pageCount} pagine)"),
    ("◀ 上一页", "◀ Precedente"),
    ("下一页 ▶", "Successiva ▶"),
    ("更换文件", "Cambia file"),
    ("<span>检测到 {detectedZones.length} 处签名/印章区域，点击可快速定位：</span>",
     "<span>Trovate {detectedZones.length} aree con firme o timbri, tocca per selezionarle:</span>"),
    ("<span>拖拽鼠标拉框选择要提取的签名区域：</span>", "<span>Trascina per selezionare la firma da estrarre:</span>"),
    ("💡 提示：选框尽量紧贴笔迹或印章", "💡 Stringi il riquadro attorno alla firma o al timbro"),
    ("<span>正在渲染页面...</span>", "<span>Caricamento pagina...</span>"),
    ("签名选区", "Area selezionata"),
    ("透明化提取预览", "Anteprima trasparente"),
    ("正在处理...", "Elaborazione..."),
    ("请在左侧框选签名", "Seleziona la firma sulla pagina"),
    ("签名名称：", "Nome della firma:"),
    ('placeholder="例如：张三签名 / 财务专用章"', 'placeholder="es. Firma Mario Rossi / Timbro ufficio"'),
    ("笔迹色彩增强：", "Colore inchiostro:"),
    ("<span>保持原色</span>", "<span>Originale</span>"),
    ("<span>纯黑墨水</span>", "<span>Nero</span>"),
    ("<span>公文深蓝</span>", "<span>Blu</span>"),
    ("<span>公章朱红</span>", "<span>Rosso timbro</span>"),
    ("<span>去白底灵敏度：</span>", "<span>Rimozione sfondo:</span>"),
    ("<span>边缘抗锯齿平滑：</span>", "<span>Smussatura bordi:</span>"),
    ("<span>一键存入签名库</span>", "<span>Salva tra le mie firme</span>"),
    ("下载透明 PNG", "Scarica PNG"),
    ("复制到剪贴板", "Copia"),
])
rep_all('src/components/tools/sign/SignatureLibraryModal.tsx', [
    ("name || '签名图片'", "name || 'Firma'"),
    ("'本地图片导入'", "'Immagine importata'"),
    ('title="签名库管理"', 'title="Le mie firme"'),
    ("已保存 {signatures.length} 个个性化手写签名与印章，可随时重用或应用到文档。",
     "{signatures.length} firme e timbri salvati, pronti da usare nei documenti."),
    ("🖼️ 上传图片签名", "🖼️ Firma da immagine"),
    ("➕ 从已签署 PDF 提取", "➕ Estrai da PDF firmato"),
    ("暂无已保存的签名", "Nessuna firma salvata"),
    ("您可以直接上传本地透明 PNG / JPG 签名图片，或上传已在 Adobe Acrobat 中签署过的文件提取签名。",
     "Carica un'immagine della tua firma (PNG/JPG) oppure estraila da un PDF già firmato."),
    ("🖼️ 上传签名图片 (PNG/JPG)", "🖼️ Carica immagine firma (PNG/JPG)"),
    ("从已签署 PDF 提取", "Estrai da PDF firmato"),
    ('title="删除"', 'title="Elimina"'),
    ("直接盖章", "Usa"),
    ("'已复制'", "'Copiata'"),
    ("'复制'", "'Copia'"),
    ("下载", "Scarica"),
])

# ---------------------------------------------------------------- Lettore PDF a schermo intero
R = 'src/components/tools/pdf-reader/PDFReaderTool.tsx'
add_import(R, "import { APP_MODE } from '@/lib/app-mode';\nimport { AppFullscreen } from '@/components/app/AppFullscreen';")
rep(R, '''            {hasFile && pdfUrl && (
                <>
                    {/* Simple Header with File Info */}''', '''            {hasFile && pdfUrl && APP_MODE && (
                <AppFullscreen
                    title={file.name}
                    onClose={handleReset}
                    actions={
                        <button
                            type="button"
                            onClick={handleDownload}
                            aria-label="Download"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[hsl(var(--color-muted))]"
                        >
                            <Download className="h-5 w-5" />
                        </button>
                    }
                >
                    <iframe
                        ref={iframeRef}
                        src={withBasePath(`/pdfjs-viewer/viewer.html?file=${encodeURIComponent(pdfUrl)}`)}
                        onLoad={handleIframeLoad}
                        className="absolute inset-0 h-full w-full border-0"
                        title={file.name}
                    />
                </AppFullscreen>
            )}

            {hasFile && pdfUrl && !APP_MODE && (
                <>
                    {/* Simple Header with File Info */}''')

# ---------------------------------------------------------------- Timbri a schermo intero
ST = 'src/components/tools/stamps/StampsTool.tsx'
rep(ST, "import { useTranslations } from 'next-intl';",
    "import { useTranslations } from 'next-intl';\nimport { APP_MODE } from '@/lib/app-mode';\n"
    "import { AppFullscreen } from '@/components/app/AppFullscreen';")
rep(ST, "      {stampState.file && viewerUrl && (\n        <>", '''      {stampState.file && viewerUrl && APP_MODE && (
        <AppFullscreen title={stampState.file.name} onClose={handleClear}>
          <div className="flex h-full flex-col">
            <iframe
              ref={iframeRef}
              src={viewerUrl}
              onLoad={handleIframeLoad}
              className="min-h-0 w-full flex-1 bg-gray-100"
              style={{ border: 'none' }}
              title="PDF Stamp Editor"
            />
            <div className="shrink-0 border-t border-[hsl(var(--color-border))] p-3">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleSave}
                disabled={!stampState.viewerReady || isProcessing}
                loading={isProcessing}
              >
                {isProcessing ? (t('status.processing') || 'Processing...') : (tTools('saveButton') || 'Save Stamped PDF')}
              </Button>
            </div>
          </div>
        </AppFullscreen>
      )}

      {stampState.file && viewerUrl && !APP_MODE && (
        <>''')

# ---------------------------------------------------------------- visualizzatori PDF.js: script per il telefono
for v in ('public/pdfjs-viewer/viewer.html', 'public/pdfjs-annotation-viewer/web/viewer.html'):
    s = read(v)
    if 'viewer-mobile.js' not in s:
        if '</head>' not in s:
            errors.append(f'{v}: </head> non trovato')
        else:
            write(v, s.replace('</head>', '  <script src="/app-mobile/viewer-mobile.js" defer></script>\n</head>', 1))

# ---------------------------------------------------------------- Word/ODT in PDF
W = 'src/lib/pdf/processors/word-to-pdf.ts'
rep(W, "        if (!useLibreOffice && ext !== 'docx') {", '''        if (!useLibreOffice && ext === 'odt') {
            // Senza LibreOffice: convertitore ODT di riserva (impaginazione semplificata).
            try {
                const { convertOdtToPdfFallback } = await import('./odt-fallback');
                const pdfBlob = await convertOdtToPdfFallback(file, (m) => this.updateProgress(Math.min(this.progress + 10, 90), m));
                this.updateProgress(100, 'Conversion complete!');
                const baseName = file.name.replace(/\\.odt$/i, '');
                return this.createSuccessOutput(pdfBlob, `${baseName}.pdf`, { engine: 'odt-fallback' });
            } catch (e) {
                return this.createErrorOutput(
                    PDFErrorCode.PROCESSING_FAILED,
                    'Conversione ODT non riuscita.',
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        if (!useLibreOffice && ext !== 'docx') {''')
s = read(W)
i = s.find("                    if (ext === 'docx' && !this.checkCancelled()) {")
old = '''                    } else {
                        throw loErr;
                    }'''
j = s.find(old, i) if i >= 0 else -1
if j < 0:
    errors.append(f'{W}: ramo LibreOffice non trovato')
else:
    s = s[:j] + '''                    } else if (ext === 'odt' && !this.checkCancelled()) {
                        console.warn('[WordToPDF] LibreOffice failed, falling back to ODT converter:', loErr);
                        const { convertOdtToPdfFallback } = await import('./odt-fallback');
                        pdfBlob = await convertOdtToPdfFallback(file);
                        engine = 'pyodide';
                    } else {
                        throw loErr;
                    }''' + s[j + len(old):]
    write(W, s)
WT = 'src/components/tools/word-to-pdf/WordToPDFTool.tsx'
add_import(WT, "import { APP_MODE } from '@/lib/app-mode';")
rep(WT, "                        'Compatibility mode: .docx converts without server isolation headers. .doc/.odt/.rtf need COOP/COEP on your host.'",
    """                        APP_MODE
                            ? 'Modalità compatibile: DOCX e ODT vengono convertiti subito; DOC e RTF richiedono il motore completo, non disponibile su questo telefono.'
                            : 'Compatibility mode: .docx converts without server isolation headers. .doc/.odt/.rtf need COOP/COEP on your host.'""")

# ---------------------------------------------------------------- Numeri di pagina: anteprima che sta nello schermo
P = 'src/components/tools/page-numbers/PageNumbersTool.tsx'
add_import(P, "import { APP_MODE } from '@/lib/app-mode';")
rep_all(P, [
    ('''                <div
                  className="flex justify-center"
                  style={{
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top center',
                    minHeight: previewScale < 1 ? 'auto' : undefined
                  }}
                >
                  <canvas
                    ref={previewCanvasRef}
                    className="shadow-lg bg-white"
                  />''', '''                <div
                  className="flex justify-center"
                  style={APP_MODE ? undefined : {
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top center',
                    minHeight: previewScale < 1 ? 'auto' : undefined
                  }}
                >
                  <canvas
                    ref={previewCanvasRef}
                    className="shadow-lg bg-white"
                    style={APP_MODE ? { width: `${previewScale * 200}%`, maxWidth: 'none', height: 'auto' } : undefined}
                  />'''),
    ('''<div className="bg-gray-100 dark:bg-gray-800 rounded-[var(--radius-md)] p-4 overflow-auto" style={{ maxHeight: '600px', minHeight: '500px' }}>''',
     '''<div className="bg-gray-100 dark:bg-gray-800 rounded-[var(--radius-md)] p-4 overflow-auto" style={APP_MODE ? { maxHeight: '70vh' } : { maxHeight: '600px', minHeight: '500px' }}>'''),
])

# ---------------------------------------------------------------- Oscura (redact): testi cinesi → italiano
sys.path.insert(0, HERE)
from redact_it import REDACT  # noqa: E402
rep_all('src/components/tools/redact/RedactPDFTool.tsx', REDACT)

# ---------------------------------------------------------------- traduzioni mancanti (etichette di pagina)
add_en = {'addRuleButton': 'Add rule', 'deleteRuleTitle': 'Delete rule', 'optionsTitle': 'Label rules',
          'previewAlgorithmDesc': 'Labels are computed from your rules, page by page.',
          'previewAlgorithmTitle': 'How labels are assigned', 'previewFolded': 'Show fewer pages',
          'previewLoadAll': 'Show all pages', 'processing': 'Processing...', 'styleAlphaLower': 'a, b, c...',
          'styleAlphaUpper': 'A, B, C...', 'styleArabic': '1, 2, 3...', 'styleRomanLower': 'i, ii, iii...',
          'styleRomanUpper': 'I, II, III...'}
add_it = {'addRuleButton': 'Aggiungi regola', 'deleteRuleTitle': 'Elimina regola', 'optionsTitle': 'Regole delle etichette',
          'previewAlgorithmDesc': 'Le etichette vengono calcolate dalle tue regole, pagina per pagina.',
          'previewAlgorithmTitle': 'Come vengono assegnate', 'previewFolded': 'Mostra meno pagine',
          'previewLoadAll': 'Mostra tutte le pagine', 'processing': 'Elaborazione...', 'styleAlphaLower': 'a, b, c...',
          'styleAlphaUpper': 'A, B, C...', 'styleArabic': '1, 2, 3...', 'styleRomanLower': 'i, ii, iii...',
          'styleRomanUpper': 'I, II, III...'}
for fn, add in (('messages/en.json', add_en), ('messages/it.json', add_it)):
    d = json.loads(read(fn), object_pairs_hook=OrderedDict)
    pl = d.setdefault('common', OrderedDict()).setdefault('pageLabels', OrderedDict())
    for k2, v2 in add.items():
        pl.setdefault(k2, v2)
    write(fn, json.dumps(d, ensure_ascii=False, indent=2) + '\n')

# ---------------------------------------------------------------- titolo italiano mancante (Oscura PDF)
rep('src/config/tool-content/index.ts', """  // Fallback to English
  return toolContentEn[toolId];""", """  // Titoli italiani mancanti nella versione originale
  if (locale === 'it' && toolId === 'redact-pdf' && toolContentEn[toolId]) {
    return {
      ...toolContentEn[toolId],
      title: 'Oscura PDF',
      metaDescription: 'Nascondi per sempre testi e immagini sensibili: nero, bianco, mosaico o sfocatura.',
    };
  }

  // Fallback to English
  return toolContentEn[toolId];""")

# ---------------------------------------------------------------- Firma col dito (nuova modalità)
S = 'src/components/tools/sign/SignPDFTool.tsx'
add_import(S, "import { FingerSign } from '@/components/app/FingerSign';")
rep(S, "  const uiLocale = useLocale();\n",
    "  const uiLocale = useLocale();\n  const [fingerMode, setFingerMode] = useState(true);\n")
rep(S, "      {/* PDF Viewer (app: schermo intero) */}\n      {signState.file && APP_MODE && (",
    "      {/* Firma col dito (app) */}\n"
    "      {signState.file && APP_MODE && fingerMode && (\n"
    "        <FingerSign file={signState.file} onClose={handleClear} locale={uiLocale} />\n"
    "      )}\n\n"
    "      {/* PDF Viewer (app: schermo intero) */}\n      {signState.file && APP_MODE && !fingerMode && (")
rep(S, "      {/* File Upload Area - Only show when no file */}", """      {/* Scelta della modalità di firma (app) */}
      {APP_MODE && !signState.file && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[hsl(var(--color-muted))] p-1" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={fingerMode}
            onClick={() => setFingerMode(true)}
            className={`rounded-xl px-3 py-3 text-left ${fingerMode ? 'bg-[hsl(var(--color-background))] shadow' : ''}`}
          >
            <span className="block text-sm font-semibold">✍️ {uiLocale === 'it' ? 'Col dito' : 'With finger'}</span>
            <span className="block text-xs text-[hsl(var(--color-muted-foreground))]">{uiLocale === 'it' ? 'Firma sullo schermo e posizionala' : 'Draw on screen and place it'}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!fingerMode}
            onClick={() => setFingerMode(false)}
            className={`rounded-xl px-3 py-3 text-left ${!fingerMode ? 'bg-[hsl(var(--color-background))] shadow' : ''}`}
          >
            <span className="block text-sm font-semibold">🧰 {uiLocale === 'it' ? 'Avanzata' : 'Advanced'}</span>
            <span className="block text-xs text-[hsl(var(--color-muted-foreground))]">{uiLocale === 'it' ? 'Testo, firme salvate, timbri' : 'Text, saved signatures, stamps'}</span>
          </button>
        </div>
      )}

      {/* File Upload Area - Only show when no file */}""")

# ---------------------------------------------------------------- esito
if errors:
    print('ERRORI applicando la modalità app:')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('Modalità app applicata.')
