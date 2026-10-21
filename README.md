# PDFCraft per Android

App Android che contiene **PDFCraft** ([PDFCraftTool/pdfcraft](https://github.com/PDFCraftTool/pdfcraft)),
il kit di strumenti PDF open source: unire, dividere, comprimere, ruotare, convertire, firmare,
OCR e molto altro. Tutto gira **sul telefono**: i tuoi file non vengono caricati su nessun server.

## Installazione
1. Dal telefono apri l'ultima release in *Releases* e scarica **PDFCraft.apk**.
2. Apri il file scaricato → consenti l'installazione da questa fonte → **Installa**
   (se Play Protect avvisa: *Installa comunque*).

## Come funziona
- Il sito di PDFCraft viene compilato in CI (versione fissata in `UPSTREAM_REF`) e messo dentro l'APK.
- Un piccolo "server interno" (`AssetServer.kt`) lo serve al WebView con le intestazioni giuste.
- Quando uno strumento produce un file, l'app lo salva in **Download › PDFCraft** e propone *Apri* o *Condividi*.
- Il pulsante "Indietro" torna alla pagina precedente.

## Limiti noti
- L'APK è grande (tutti gli strumenti e 18 lingue sono inclusi per funzionare offline).
- Gli strumenti di conversione Office (Word/Excel/PowerPoint ↔ PDF) usano LibreOffice in WebAssembly:
  sono pesanti e richiedono una funzione del browser (SharedArrayBuffer) che nel WebView di Android
  potrebbe non essere disponibile. Se non partono, è questo il motivo.
- Alcune funzioni facoltative (es. lingue extra per l'OCR) scaricano dati da internet la prima volta.

## Licenza
PDFCraft è distribuito con licenza **AGPL-3.0**; anche questo progetto la adotta (vedi `LICENSE`).
Il codice sorgente completo è in questo repository.
