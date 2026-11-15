"""Prova "Compila modulo" (v0.6): scrittura sul campo, Avanti, profilo, segni, annulla, zoom fluido, salvataggio."""
import os, sys, subprocess
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:3000')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-form'
os.makedirs(OUT, exist_ok=True)
ok = True
FS = '[data-app-fullscreen]'


def check(n, c):
    global ok
    print(('OK  ' if c else 'FAIL'), n, flush=True)
    ok = ok and bool(c)


def open_tool(pg, pdf):
    pg.goto(f'{BASE}/it/tools/form-filler/', wait_until='load', timeout=240000)
    pg.wait_for_timeout(1500)
    pg.evaluate("document.querySelectorAll('nextjs-portal').forEach(e => e.remove())")
    pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('ddocs-form:')).forEach(k => localStorage.removeItem(k))")
    pg.set_input_files('input[type=file]', os.path.join(HERE, 'forms', pdf))
    pg.wait_for_selector('[data-ff-field]', timeout=90000)
    pg.wait_for_timeout(1800)
    pg.evaluate("document.querySelectorAll('nextjs-portal').forEach(e => e.remove())")


def page_w(pg):
    return pg.locator('[data-ff-page="0"]').bounding_box()['width']


def label(pg):
    return pg.locator(f'{FS} [data-ff-label]').inner_text()


def field(pg, name):
    return pg.locator(f'[data-ff-field][aria-label="{name}"]').first


def done(pg):
    pg.locator(f'{FS} [data-ff-bar] button', has_text='Fatto').click()
    pg.wait_for_timeout(450)


def pinch(pg, cdp, cx, cy, d0, d1, steps=8):
    pts = lambda d: [{'x': cx - d / 2, 'y': cy}, {'x': cx + d / 2, 'y': cy}]
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(d0 + (d1 - d0) * i / steps)})
        pg.wait_for_timeout(16)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    pg.wait_for_timeout(700)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='it-IT', accept_downloads=True, device_scale_factor=2)
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg)
    pg.on('pageerror', lambda e: print('  PAGEERROR', str(e)[:300]))
    pg.on('console', lambda m: m.type == 'error' and 'hydrat' not in m.text.lower() and print('  CONSOLE', m.text[:300]))

    # ---------- modulo "piatto": campi rilevati automaticamente
    open_tool(pg, 'modulo-piatto.pdf')
    n = pg.locator('[data-ff-field]').count()
    check(f'modulo piatto: {n} campi rilevati (attesi 18)', n == 18)
    pg.screenshot(path=f'{OUT}/1-aperto.png')
    w1 = page_w(pg)

    # "Avanti" porta al primo campo vuoto e si scrive direttamente sul foglio
    pg.locator(f'{FS} button', has_text='compilati').click(); pg.wait_for_timeout(900)
    check(f'primo campo = "{label(pg)}"', label(pg) == 'Cognome')
    inp = pg.locator(f'{FS} [data-ff-field] input[id^="ff-"]')
    check('casella di scrittura sul campo, col cursore', inp.count() == 1 and pg.evaluate("document.activeElement && document.activeElement.id.startsWith('ff-')"))
    check(f'zoom automatico sul campo ({page_w(pg):.0f}px > {w1:.0f}px)', page_w(pg) > w1 * 1.3)
    pg.keyboard.type('Rossi'); pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    check(f'Invio → campo successivo ("{label(pg)}")', label(pg) == 'Nome')
    pg.keyboard.type('Maria Lucia'); pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    pg.keyboard.type('RSSMLC80A41H501Z')
    pg.screenshot(path=f'{OUT}/2-campo.png')
    done(pg)
    check('Fatto chiude la tastiera', pg.locator(f'{FS} [data-ff-field] input[id^="ff-"]').count() == 0)

    # casella: un tocco la spunta
    field(pg, 'Sì').click(); pg.wait_for_timeout(400)
    check('casella spuntata con un tocco', field(pg, 'Sì').locator('svg').count() == 1)

    # cella di tabella
    field(pg, 'Telefono · Valore').click(); pg.wait_for_timeout(800)
    pg.keyboard.type('333 1234567')
    done(pg)
    # riquadro note (multilinea)
    pg.locator('[data-ff-field][aria-label="Note e richieste particolari"]').last.click(); pg.wait_for_timeout(800)
    pg.locator(f'{FS} [data-ff-field] textarea').fill('Preferisco il turno serale.\nAllergia alle arachidi.')
    done(pg)

    # zoom indietro col doppio tocco, poi pizzico
    box = pg.locator('[data-ff-page="0"]').bounding_box()
    before = pg.locator('[data-ff-field]').count()
    w0 = page_w(pg)
    pg.mouse.click(200, 560); pg.wait_for_timeout(60); pg.mouse.click(200, 560); pg.wait_for_timeout(800)
    wz = page_w(pg)
    check(f'doppio tocco cambia lo zoom ({wz:.0f}px) senza lasciare testi vuoti (campi {pg.locator("[data-ff-field]").count()} / {before})', abs(wz - w0) > 50 and pg.locator('[data-ff-field]').count() == before)
    if wz > w1 * 1.2:
        pg.mouse.click(200, 560); pg.wait_for_timeout(60); pg.mouse.click(200, 560); pg.wait_for_timeout(800)
    check(f'tornato a pagina intera ({page_w(pg):.0f}px)', abs(page_w(pg) - w1) < 2)
    pinch(pg, cdp, 195, 450, 100, 260)
    wp = page_w(pg)
    check(f'pizzico ingrandisce ({wp:.0f}px, atteso ~{w1 * 2.6:.0f})', wp > w1 * 2.0)
    pg.screenshot(path=f'{OUT}/3-pizzico.png')
    pinch(pg, cdp, 195, 450, 300, 60)
    check(f'pizzico riduce fino a pagina intera ({page_w(pg):.0f}px)', abs(page_w(pg) - w1) < 2)

    # testo libero: tocco su uno spazio vuoto in fondo alla pagina
    box = pg.locator('[data-ff-page="0"]').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.55, box['y'] + box['height'] * 0.93); pg.wait_for_timeout(900)
    check('tocco su spazio vuoto → casella di testo', pg.locator(f'{FS} [data-ff-field] input[id^="ff-"]').count() == 1)
    pg.keyboard.type('Nota libera')
    done(pg)
    check('testo libero aggiunto', pg.locator('[data-ff-field]').count() == before + 1)

    # strumento ✗ + annulla (prima torna a pagina intera col doppio tocco)
    pg.mouse.click(195, 600); pg.wait_for_timeout(60); pg.mouse.click(195, 600); pg.wait_for_timeout(800)
    check(f'doppio tocco: pagina intera ({page_w(pg):.0f}px)', abs(page_w(pg) - w1) < 2)
    pg.screenshot(path=f'{OUT}/3b-dopo-doppio.png')
    if pg.locator(f'{FS} [data-ff-bar]').count():
        done(pg)
    pg.locator(f'{FS} button', has_text='Croce').click(); pg.wait_for_timeout(300)
    box = pg.locator('[data-ff-page="0"]').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.9, box['y'] + box['height'] * 0.97); pg.wait_for_timeout(300)
    pg.mouse.click(box['x'] + box['width'] * 0.95, box['y'] + box['height'] * 0.97); pg.wait_for_timeout(300)
    print('  campi', pg.locator('[data-ff-field]').count(), before)
    check('due croci aggiunte', pg.locator('[data-ff-field]').count() == before + 3)
    pg.locator(f'{FS} button', has_text='Fine').click(); pg.wait_for_timeout(200)
    pg.locator(f'{FS} button[aria-label="Annulla"]').click(); pg.wait_for_timeout(300)
    check('Annulla toglie l\'ultima croce', pg.locator('[data-ff-field]').count() == before + 2)
    pg.screenshot(path=f'{OUT}/4-compilato.png')

    with pg.expect_download() as d:
        pg.locator(f'{FS} button', has_text='Salva').click()
    f1 = f'{OUT}/piatto_compilato.pdf'
    d.value.save_as(f1)
    txt = subprocess.run(['pdftotext', '-layout', f1, '-'], capture_output=True, text=True).stdout
    check('PDF: testi scritti (Rossi, Maria Lucia, CF, telefono, note, testo libero)',
          all(s in txt for s in ['Rossi', 'Maria Lucia', 'RSSMLC80A41H501Z', '333 1234567', 'turno serale', 'arachidi', 'Nota libera']))
    subprocess.run(['pdftoppm', '-png', '-r', '70', f1, f'{OUT}/piatto_out'])

    # ---------- profilo: il modulo riaperto si riempie da solo
    open_tool(pg, 'modulo-piatto.pdf')
    pg.locator(f'{FS} button', has_text='Profilo').click(); pg.wait_for_timeout(400)
    print('  profilo:', pg.evaluate("localStorage.getItem('ddocs-profile')"))
    learned = pg.locator('[data-ff-profile-key="cognome"]').input_value()
    check(f'profilo ha imparato il cognome ("{learned}")', learned == 'Rossi')
    pg.locator('[data-ff-profile] button', has_text='Riempi').click(); pg.wait_for_timeout(500)
    field(pg, 'Cognome').click(); pg.wait_for_timeout(600)
    v = pg.locator(f'{FS} [data-ff-field] input[id^="ff-"]').input_value()
    check(f'campo Cognome riempito dal profilo ("{v}")', v == 'Rossi')
    pg.screenshot(path=f'{OUT}/5-profilo.png')
    done(pg)

    # ---------- modulo con campi PDF veri
    open_tool(pg, 'modulo-acroform.pdf')
    n = pg.locator('[data-ff-field]').count()
    check(f'modulo compilabile: {n} campi (attesi 9)', n == 9)
    field(pg, 'Cognome').click(); pg.wait_for_timeout(800)
    sug = pg.locator(f'{FS} [data-ff-bar] button', has_text='Rossi')
    check('suggerimento dal profilo sopra la tastiera', sug.count() == 1)
    pg.locator(f'{FS} [data-ff-field] input[id^="ff-"]').fill('Bianchi')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
    pg.keyboard.type('Luca')
    done(pg)
    field(pg, 'Motivo').click(); pg.wait_for_timeout(600)
    pg.locator(f'{FS} [data-ff-bar] button', has_text='Formazione').click()
    done(pg)
    field(pg, 'Ricevuta allegata').click(); pg.wait_for_timeout(300)
    field(pg, 'Contanti').click(); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/6-acro.png')
    with pg.expect_download() as d:
        pg.locator(f'{FS} button', has_text='Salva').click()
    f2 = f'{OUT}/acro_compilato.pdf'
    d.value.save_as(f2)
    vals = subprocess.run(['python3', '-c', f'''
import pypdf; r=pypdf.PdfReader("{f2}"); f=r.get_fields()
print({{k:(v.get("/V")) for k,v in f.items()}})'''], capture_output=True, text=True).stdout.strip()
    print('  valori:', vals)
    check('PDF compilabile: valori salvati', all(s in vals for s in ["'Bianchi'", "'Luca'", "'Formazione'", "'/Contanti'"]) and "'ricevuta': '/Off'" not in vals)
    b.close()
sys.exit(0 if ok else 1)
