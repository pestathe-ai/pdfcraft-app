# PDFCraft per Android

App Android che contiene **PDFCraft** ([PDFCraftTool/pdfcraft](https://github.com/PDFCraftTool/pdfcraft)),
il kit di strumenti PDF open source: unire, dividere, comprimere, ruotare, convertire, firmare,
OCR e molto altro. Tutto gira **sul telefono**: i tuoi file non vengono caricati su nessun server.

## Installazione
1. Dal telefono apri l'ultima release in *Releases* e scarica **PDFCraft.apk**.
2. Apri il file scaricato → consenti l'installazione da questa fonte → **Installa**
   (se Play Protect avvisa: *Installa comunque*).

## Novità 0.3
- **Firma col dito** (in *Firma PDF*, modalità predefinita): disegni la firma sullo schermo, tocchi la pagina
  per posizionarla, la sposti e ridimensioni col dito, aggiungi se vuoi la data di oggi e salvi.
  Le firme disegnate vengono ricordate per la volta successiva. La modalità *Avanzata* resta disponibile.

## Novità 0.2
- **Interfaccia da app**: home con azioni rapide, barra in basso (Home · Converti · Strumenti), pagine strumento compatte senza testi promozionali.
- **Converti**: scegli un file qualsiasi, il formato si riconosce da solo e si apre il convertitore giusto con il file già caricato. Per i PDF propone in cosa convertirli.
- **Apri con / Condividi**: da qualsiasi app puoi aprire o condividere un documento con PDFCraft.
- **Editor a schermo intero**: Modifica PDF, Firma, Timbri e Lettore occupano tutto lo schermo; il tasto Indietro li chiude.
- **ODT**: conversione completa con LibreOffice se il WebView lo permette (Android System WebView recente), altrimenti convertitore di riserva integrato.
- Testi cinesi rimasti nell'originale tradotti (Firma, Oscura PDF); pulsanti più grandi, niente contenuti fuori schermo.

Le modifiche al sito sono in `tool/app-mode/` e vengono applicate a PDFCraft originale ad ogni build.

## Come funziona
- Il sito di PDFCraft viene compilato in CI (versione fissata in `UPSTREAM_REF`) e messo dentro l'APK.
- Un piccolo "server interno" (`AssetServer.kt`) lo serve al WebView con le intestazioni giuste.
- Quando uno strumento produce un file, l'app lo salva in **Download › PDFCraft** e propone *Apri* o *Condividi*.
- Il pulsante "Indietro" torna alla pagina precedente.

## Limiti noti
- L'APK è grande (circa 200 MB): tutti gli strumenti sono inclusi per funzionare offline.
- Lingue incluse: solo **italiano** e **inglese** (le altre 16 pesavano ~1 GB). Scegliere un'altra
  lingua dal menu del sito porta a una pagina "non trovata".
- Le conversioni DOC, RTF, Excel e PowerPoint usano LibreOffice in WebAssembly: servono un WebView
  recente (che permetta SharedArrayBuffer) e un po' di memoria. ODT e DOCX hanno comunque un convertitore di riserva.
- Il convertitore ODT di riserva produce pagine come immagini (testo non selezionabile) e un'impaginazione semplificata.
- Alcuni testi minori dell'originale sono ancora in inglese.
- Alcune funzioni facoltative (es. lingue extra per l'OCR) scaricano dati da internet la prima volta.

## Licenza
PDFCraft è distribuito con licenza **AGPL-3.0**; anche questo progetto la adotta (vedi `LICENSE`).
Il codice sorgente completo è in questo repository.
