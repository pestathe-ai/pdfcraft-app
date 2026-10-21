/* PDFCraft per Android: adatta i visualizzatori PDF.js allo schermo del telefono. */
(function () {
  if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
  var css = [
    '.CustomComment{display:none!important}',
    '#viewerContainer{right:0!important;width:auto!important}',
    '.CustomToolbar{overflow-x:auto!important;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
    '.CustomToolbar::-webkit-scrollbar{display:none}',
    '.CustomToolbar ul{flex-wrap:nowrap!important}',
    '.CustomToolbar li,.CustomToolbar button{flex:0 0 auto!important;min-width:40px;min-height:40px}',
    '#sidebarResizer{display:none!important}',
    '.toolbarButton{min-width:36px;min-height:36px}'
  ].join('\n');
  function addStyle() {
    if (document.getElementById('pdfcraft-app-mobile')) return;
    var st = document.createElement('style');
    st.id = 'pdfcraft-app-mobile';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function fit() {
    var app = window.PDFViewerApplication;
    if (app && app.pdfViewer && app.pdfViewer.pagesCount) {
      try { app.pdfViewer.currentScaleValue = 'page-width'; } catch (e) {}
    }
  }
  function fitSoon() { [100, 600, 1500].forEach(function (ms) { setTimeout(fit, ms); }); }
  addStyle();
  function hook() {
    var app = window.PDFViewerApplication;
    if (!app || !app.initializedPromise) return setTimeout(hook, 200);
    app.initializedPromise.then(function () {
      if (app.eventBus) app.eventBus.on('pagesinit', fitSoon);
      fitSoon();
    });
  }
  hook();
  window.addEventListener('resize', fitSoon);
})();
