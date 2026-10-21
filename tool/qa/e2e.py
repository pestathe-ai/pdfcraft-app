"""Prove end-to-end dei flussi principali della modalità app (telefono 390x844)."""
import os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://127.0.0.1:8765')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e'
os.makedirs(OUT, exist_ok=True)
ok = True
def check(name, cond):
    global ok
    print(('OK  ' if cond else 'FAIL'), name, flush=True)
    ok = ok and bool(cond)

def phone(b, **kw):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='it-IT', accept_downloads=True, **kw)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: print('  PAGEERROR', str(e)[:200]))
    return ctx, pg

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = phone(b)
    # Home
    pg.goto(f'{BASE}/it/', wait_until='load'); pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{OUT}/home.png', full_page=True)
    check('home: card Converti', pg.query_selector('a[href="/it/convert/"]') is not None)
    check('home: barra in basso', pg.query_selector('.app-bottom-nav') is not None)
    # Converti: ODT -> Word in PDF con file già caricato
    pg.goto(f'{BASE}/it/convert/', wait_until='load'); pg.wait_for_timeout(1500)
    pg.set_input_files('[data-testid=convert-input]', os.path.join(HERE, 'sample.odt'))
    pg.wait_for_url('**/tools/word-to-pdf/**', timeout=60000); pg.wait_for_timeout(4000)
    check('converti: ODT apre Word in PDF col file', 'sample.odt' in pg.inner_text('main'))
    pg.screenshot(path=f'{OUT}/convert-odt.png')
    # Converti: PDF -> scelta -> PDF in Word
    pg.goto(f'{BASE}/it/convert/', wait_until='load'); pg.wait_for_timeout(1500)
    pg.set_input_files('[data-testid=convert-input]', os.path.join(HERE, 'sample.pdf')); pg.wait_for_timeout(800)
    pg.screenshot(path=f'{OUT}/convert-pdf.png', full_page=True)
    pg.click('button:has-text("Word")')
    pg.wait_for_url('**/tools/pdf-to-docx/**', timeout=60000); pg.wait_for_timeout(4000)
    check('converti: PDF -> Word col file', 'sample.pdf' in pg.inner_text('main'))
    # Modifica PDF a schermo intero + tasto Indietro
    pg.goto(f'{BASE}/it/tools/edit-pdf/', wait_until='load'); pg.wait_for_timeout(1500)
    pg.set_input_files('input[type=file]', os.path.join(HERE, 'sample.pdf')); pg.wait_for_timeout(6000)
    check('modifica: schermo intero', pg.query_selector('[data-app-fullscreen]') is not None)
    pg.screenshot(path=f'{OUT}/edit-direct.png')
    pg.click('[data-app-fullscreen] button:has-text("Annota")'); pg.wait_for_timeout(7000)
    pg.screenshot(path=f'{OUT}/edit-annot.png')
    check('modifica: Indietro chiude', pg.evaluate('window.__pdfcraftAppBack && window.__pdfcraftAppBack()') is True)
    pg.wait_for_timeout(500)
    check('modifica: chiuso', pg.query_selector('[data-app-fullscreen]') is None)
    ctx.close()
    # ODT senza isolamento (come nel WebView senza SharedArrayBuffer): convertitore di riserva
    ctx, pg = phone(b, service_workers='block')
    def strip(route):
        r = route.fetch()
        h = {k: v for k, v in r.headers.items() if k.lower() not in ('cross-origin-opener-policy', 'cross-origin-embedder-policy')}
        route.fulfill(response=r, headers=h)
    ctx.route('**/*', strip)
    pg.goto(f'{BASE}/it/tools/word-to-pdf/', wait_until='load'); pg.wait_for_timeout(2500)
    check('odt: pagina non isolata', pg.evaluate('crossOriginIsolated') is False)
    pg.set_input_files('input[type=file]', os.path.join(HERE, 'sample.odt')); pg.wait_for_timeout(1500)
    pg.click('button:has-text("Converti in PDF")')
    for _ in range(40):
        pg.wait_for_timeout(1500)
        if pg.query_selector('button:has-text("Scarica")'): break
    btn = pg.query_selector('button:has-text("Scarica")')
    check('odt: PDF creato', btn is not None)
    if btn:
        with pg.expect_download() as d: btn.click()
        d.value.save_as(f'{OUT}/odt.pdf')
        check('odt: file scaricato', os.path.getsize(f'{OUT}/odt.pdf') > 5000)
    b.close()
sys.exit(0 if ok else 1)
