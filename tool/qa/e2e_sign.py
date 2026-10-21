"""Prova "Firma col dito": disegna, posiziona, ridimensiona, salva e controlla il PDF."""
import os, sys, subprocess
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://127.0.0.1:8765')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e'
os.makedirs(OUT, exist_ok=True)
ok = True
def check(n, c):
    global ok
    print(('OK  ' if c else 'FAIL'), n, flush=True); ok = ok and bool(c)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='it-IT', accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: print('  PAGEERROR', str(e)[:200]))
    pg.goto(f'{BASE}/it/tools/sign-pdf/', wait_until='load'); pg.wait_for_timeout(1500)
    check('modalità col dito selezionata', pg.get_attribute('[role=radio][aria-checked=true]', 'aria-checked') == 'true' and 'Col dito' in pg.inner_text('[role=radio][aria-checked=true]'))
    pg.screenshot(path=f'{OUT}/fs-0.png')
    pg.set_input_files('input[type=file][accept*="pdf"]', os.path.join(HERE, 'sample.pdf')); pg.wait_for_timeout(3000)
    check('riquadro firma aperto', pg.query_selector('canvas.touch-none') is not None)
    box = pg.query_selector('canvas.touch-none').bounding_box()
    # disegna una "firma" con due tratti
    for k, pts in enumerate([[(0.15, 0.55), (0.25, 0.4), (0.35, 0.6), (0.45, 0.35), (0.55, 0.62), (0.7, 0.45)], [(0.6, 0.7), (0.85, 0.3)]]):
        pg.mouse.move(box['x'] + pts[0][0] * box['width'], box['y'] + pts[0][1] * box['height'])
        pg.mouse.down()
        for (x, y) in pts[1:]:
            pg.mouse.move(box['x'] + x * box['width'], box['y'] + y * box['height'], steps=8)
        pg.mouse.up()
    pg.screenshot(path=f'{OUT}/fs-1.png')
    pg.click('button:has-text("Usa firma")'); pg.wait_for_timeout(2500)
    page_el = pg.query_selector('[data-sign-page]')
    pb = page_el.bounding_box()
    pg.mouse.click(pb['x'] + pb['width'] * 0.7, pb['y'] + pb['height'] * 0.85)
    pg.wait_for_timeout(500)
    check('firma posizionata', len(pg.query_selector_all('[data-sign-page] .touch-none')) >= 1)
    # ridimensiona trascinando la maniglia
    h = pg.query_selector('[aria-label="Ridimensiona"]').bounding_box()
    pg.mouse.move(h['x'] + h['width'] / 2, h['y'] + h['height'] / 2); pg.mouse.down()
    pg.mouse.move(h['x'] - 40, h['y'] - 10, steps=6); pg.mouse.up()
    pg.click('button:has-text("Data di oggi")'); pg.wait_for_timeout(300)
    pg.mouse.click(pb['x'] + pb['width'] * 0.25, pb['y'] + pb['height'] * 0.9); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/fs-2.png')
    with pg.expect_download() as d:
        pg.click('[data-app-fullscreen] button:has-text("Salva")')
    f = f'{OUT}/firmato.pdf'; d.value.save_as(f)
    lst = subprocess.run(['pdfimages', '-list', f], capture_output=True, text=True).stdout
    imgs = [l for l in lst.splitlines()[2:] if len(l.split()) > 2 and l.split()[0] == '1' and l.split()[2] == 'image']
    check('PDF con firma e data su pagina 1', len(imgs) >= 2)
    subprocess.run(['pdftoppm', '-png', '-r', '50', '-f', '1', '-l', '1', f, f'{OUT}/firmato'])
    b.close()
sys.exit(0 if ok else 1)
