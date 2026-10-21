# Controlli automatici (solo per sviluppo)

Script usati per provare il sito "come su un telefono" (390×844) con Playwright:
- `server.py DIR PORT` — serve la build statica con le intestazioni COOP/COEP (e i file `.gz` decompressi).
- `shoot.py OUT [strumenti...]` — screenshot di ogni strumento prima/dopo aver caricato un PDF e misure
  (larghezza fuori schermo, pulsanti piccoli, testo cinese visibile).
- `sweep.sh OUT` — come sopra, su tutti gli strumenti in parallelo.
- `sheet.py DIR OUT nomi...` — affianca più screenshot in un'unica immagine.
