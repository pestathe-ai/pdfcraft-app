"""Moduli di prova per la compilazione: uno 'piatto' (righe, puntini, caselle, tabella) e uno con campi AcroForm."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, HexColor

W, H = A4

def flat(path):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont('Helvetica-Bold', 16); c.drawString(56, H - 70, 'DOMANDA DI ISCRIZIONE AL CORSO')
    c.setFont('Helvetica', 10)
    y = H - 120
    # 1) etichetta + riga vettoriale
    for lab in ['Cognome', 'Nome', 'Codice fiscale']:
        c.drawString(56, y, lab + ':')
        c.setLineWidth(0.6); c.line(150, y - 2, 540, y - 2)
        y -= 28
    # 2) puntini nel testo
    c.drawString(56, y, 'Nato/a a ........................................................ il ..............................'); y -= 28
    c.drawString(56, y, 'Residente in via ________________________________________ n. ______'); y -= 28
    # 3) caselle
    c.drawString(56, y, 'Ha già frequentato corsi?')
    for i, lab in enumerate(['Sì', 'No']):
        x = 210 + i * 70
        c.rect(x, y - 2, 10, 10); c.drawString(x + 16, y, lab)
    y -= 40
    # 4) tabella
    c.setFont('Helvetica-Bold', 10); c.drawString(56, y, 'Recapiti'); y -= 8
    cols = [56, 200, 370, 540]; rows = 4; rh = 22
    top = y
    for r in range(rows + 1):
        c.line(cols[0], top - r * rh, cols[-1], top - r * rh)
    for x in cols:
        c.line(x, top, x, top - rows * rh)
    c.setFont('Helvetica-Bold', 9)
    for i, t in enumerate(['Tipo', 'Valore', 'Note']):
        c.drawString(cols[i] + 4, top - 15, t)
    c.setFont('Helvetica', 9)
    for i, t in enumerate(['Telefono', 'Email', 'PEC']):
        c.drawString(cols[0] + 4, top - (i + 1) * rh - 15, t)
    y = top - rows * rh - 36
    # 5) riquadro note
    c.setFont('Helvetica', 10); c.drawString(56, y, 'Note e richieste particolari:'); y -= 8
    c.rect(56, y - 90, 484, 90)
    y -= 130
    c.drawString(56, y, 'Luogo e data ______________________')
    c.drawString(330, y, 'Firma ______________________')
    c.save()

def acro(path):
    c = canvas.Canvas(path, pagesize=A4)
    f = c.acroForm
    c.setFont('Helvetica-Bold', 16); c.drawString(56, H - 70, 'MODULO RIMBORSO SPESE')
    c.setFont('Helvetica', 10)
    y = H - 120
    for name, lab in [('cognome', 'Cognome'), ('nome', 'Nome'), ('iban', 'IBAN')]:
        c.drawString(56, y, lab)
        f.textfield(name=name, x=150, y=y - 6, width=390, height=18, borderWidth=0.5, fontSize=10)
        y -= 30
    c.drawString(56, y, 'Importo (€)'); f.textfield(name='importo', x=150, y=y - 6, width=120, height=18, borderWidth=0.5); y -= 30
    c.drawString(56, y, 'Motivo'); f.choice(name='motivo', x=150, y=y - 6, width=200, height=18, options=['Trasferta', 'Materiale', 'Formazione'], value='Trasferta'); y -= 30
    c.drawString(56, y, 'Ricevuta allegata'); f.checkbox(name='ricevuta', x=150, y=y - 4, size=14, buttonStyle='check'); y -= 30
    c.drawString(56, y, 'Pagamento:')
    for i, v in enumerate(['Bonifico', 'Contanti']):
        f.radio(name='pagamento', value=v, x=150 + i * 110, y=y - 4, size=14, selected=False); c.drawString(170 + i * 110, y, v)
    y -= 30
    c.drawString(56, y, 'Descrizione'); f.textfield(name='descrizione', x=150, y=y - 70, width=390, height=76, fieldFlags='multiline', borderWidth=0.5)
    c.save()

flat('modulo-piatto.pdf')
acro('modulo-acroform.pdf')
print('ok')
