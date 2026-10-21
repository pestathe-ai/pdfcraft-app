// Inserito dall'app in ogni pagina: intercetta i "download" del sito
// (link con blob:, data: o attributo download) e passa il file all'app Android.
(function () {
  if (window.__pdfcraftAndroidHook) return;
  window.__pdfcraftAndroidHook = true;
  var B = window.PDFCraftAndroid;
  if (!B) return;

  var CHUNK = 786432; // multiplo di 3: i pezzi in base64 si possono decodificare uno per uno

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function saveBlob(blob, name) {
    var id = B.begin(name || '', blob.type || '');
    return blob.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      for (var off = 0; off < u8.length; off += CHUNK) {
        B.chunk(id, toBase64(u8.subarray(off, off + CHUNK)));
      }
      B.end(id);
    }).catch(function (e) { B.fail(id, String(e)); });
  }

  function saveUrl(url, name) {
    return fetch(url)
      .then(function (r) { return r.blob(); })
      .then(function (b) { return saveBlob(b, name); })
      .catch(function (e) { B.fail('', String(e)); });
  }

  function nameFrom(a) {
    var n = a.getAttribute('download');
    if (!n) {
      try {
        var u = new URL(a.href);
        if (u.protocol !== 'blob:' && u.protocol !== 'data:') n = decodeURIComponent(u.pathname.split('/').pop());
      } catch (e) {}
    }
    return n || '';
  }

  function handle(a) {
    var href = a.href || '';
    if (!href) return false;
    var isBlob = href.indexOf('blob:') === 0 || href.indexOf('data:') === 0;
    if (!isBlob && !a.hasAttribute('download')) return false;
    saveUrl(href, nameFrom(a));
    return true;
  }

  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (handle(this)) return;
    return origClick.apply(this, arguments);
  };

  var origDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && handle(this)) return false;
    return origDispatch.apply(this, arguments);
  };

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a') : null;
    if (a && handle(a)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);

  window.__pdfcraftSaveUrl = saveUrl;
})();
