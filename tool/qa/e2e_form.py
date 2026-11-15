"""Prova "Compila modulo": apre i moduli di prova, compila alcuni campi, ingrandisce, salva e controlla il PDF."""
import os, sys, subprocess
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:3000')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-form'
os.makedirs(OUT, exist_ok=True)
ok = True


def check(n, c):
    global ok
    print(('OK  ' if c else 'FAIL'), n, flush=True)
    ok = ok and bool(c)


def open_tool(pg, pdf):
    pg.goto(f'{BASE}/it/tools/form-filler/', wait_until='load', timeout=240000)
    pg.wait_for_timeout(1500)
    pg.set_input_files('input[type=file]', os.path.join(HERE, 'forms', pdf))
    pg.wait_for_selector('[data-ff-field]', timeout=90000)
    pg.wait_for_timeout(1500)


def type_in(pg, text):
    inp = pg.locator('[data-app-fullscreen] input[id^="ff-"]')
    inp.fill(text)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='it-IT', accept_downloads=True, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: print('  PAGEERROR', str(e)[:300]))
    pg.on('console', lambda m: m.type == 'error' and print('  CONSOLE', m.text[:300]))

    # ---------- modulo "piatto": campi rilevati automaticamente
    open_tool(pg, 'modulo-piatto.pdf')
    n = pg.locator('[data-ff-field]').count()
    check(f'modulo piatto: {n} campi rilevati (attesi 18)', n == 18)
    pg.screenshot(path=f'{OUT}/1-aperto.png')
    # primo campo con "Successivo"
    pg.locator('[data-app-fullscreen] button', has_text='compilati').click()
    pg.wait_for_timeout(900)
    check('pannello del campo aperto', pg.locator('[data-app-fullscreen] input[id^="ff-"]').count() == 1)
    lab = pg.locator('[data-app-fullscreen] .rounded-t-3xl span.truncate').inner_text()
    check(f'etichetta del primo campo = "{lab}"', lab == 'Cognome')
    type_in(pg, 'Rossi')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    type_in(pg, 'Maria Lucia')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    type_in(pg, 'RSSMLC80A41H501Z')
    pg.screenshot(path=f'{OUT}/2-campo.png')
    zoom = pg.locator('[data-app-fullscreen] button.tabular-nums').first
    # chiudi pannello, cerca la casella "Sì" e toccala
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(500)
    zoom_txt = pg.locator('[data-app-fullscreen] button.min-w-\\[3\\.5rem\\]').inner_text()
    check(f'zoom automatico sul campo ({zoom_txt})', zoom_txt != '100%')
    pg.locator('[data-ff-field][aria-label="Sì"]').click(); pg.wait_for_timeout(400)
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    # cella di tabella
    pg.locator('[data-ff-field][aria-label="Telefono · Valore"]').click(); pg.wait_for_timeout(800)
    type_in(pg, '333 1234567')
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    # riquadro note (multilinea)
    pg.locator('[data-ff-field][aria-label="Note e richieste particolari"]').last.click(); pg.wait_for_timeout(800)
    pg.locator('[data-app-fullscreen] textarea').fill('Preferisco il turno serale.\nAllergia alle arachidi.')
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    # zoom con i pulsanti
    pg.locator('[data-app-fullscreen] button.min-w-\\[3\\.5rem\\]').click(); pg.wait_for_timeout(500)
    pg.locator('[data-app-fullscreen] button[aria-label="Ingrandisci"]').click(); pg.wait_for_timeout(900)
    check('pulsante ingrandisci', pg.locator('[data-app-fullscreen] button.min-w-\\[3\\.5rem\\]').inner_text() == '140%')
    pg.locator('[data-app-fullscreen] button.min-w-\\[3\\.5rem\\]').click(); pg.wait_for_timeout(900)
    pg.screenshot(path=f'{OUT}/3-compilato.png')
    with pg.expect_download() as d:
        pg.locator('[data-app-fullscreen] button', has_text='Salva').click()
    f1 = f'{OUT}/piatto_compilato.pdf'
    d.value.save_as(f1)
    txt = subprocess.run(['pdftotext', '-layout', f1, '-'], capture_output=True, text=True).stdout
    check('PDF: testo scritto (Rossi, Maria Lucia, codice fiscale, telefono, note)',
          all(s in txt for s in ['Rossi', 'Maria Lucia', 'RSSMLC80A41H501Z', '333 1234567', 'turno serale', 'arachidi']))
    subprocess.run(['pdftoppm', '-png', '-r', '60', f1, f'{OUT}/piatto_out'])

    # ---------- modulo con campi PDF veri
    open_tool(pg, 'modulo-acroform.pdf')
    n = pg.locator('[data-ff-field]').count()
    check(f'modulo compilabile: {n} campi (attesi 9)', n == 9)
    pg.locator('[data-ff-field][aria-label="Cognome"]').click(); pg.wait_for_timeout(800)
    type_in(pg, 'Bianchi')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
    type_in(pg, 'Luca')
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    pg.locator('[data-ff-field][aria-label="Motivo"]').click(); pg.wait_for_timeout(600)
    pg.locator('[data-app-fullscreen] .rounded-t-3xl button', has_text='Formazione').click()
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    pg.locator('[data-ff-field][aria-label="Ricevuta allegata"]').click(); pg.wait_for_timeout(300)
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    pg.locator('[data-ff-field][aria-label="Contanti"]').click(); pg.wait_for_timeout(300)
    pg.locator('[data-app-fullscreen] button[aria-label="Chiudi"]').last.click(); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/4-acro.png')
    with pg.expect_download() as d:
        pg.locator('[data-app-fullscreen] button', has_text='Salva').click()
    f2 = f'{OUT}/acro_compilato.pdf'
    d.value.save_as(f2)
    vals = subprocess.run(['python3', '-c', f'''
import pypdf; r=pypdf.PdfReader("{f2}"); f=r.get_fields()
print({{k:(v.get("/V")) for k,v in f.items()}})'''], capture_output=True, text=True).stdout.strip()
    print('  valori:', vals)
    check('PDF compilabile: valori salvati', all(s in vals for s in ["'Bianchi'", "'Luca'", "'Formazione'", "'/Contanti'"]) and "'ricevuta': '/Off'" not in vals)
    b.close()
sys.exit(0 if ok else 1)
