package dev.pdfcraft.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var server: AssetServer
    private var hookScript: String = ""
    private var documentStartHook = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback
        fileCallback = null
        if (callback == null) return@registerForActivityResult
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
        if (uris.isEmpty()) data.data?.let { uris.add(it) }
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        server = AssetServer(assets, SharedFiles.root(this))
        hookScript = assets.open("bridge/download-hook.js").bufferedReader().use { it.readText() }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.addJavascriptInterface(DownloadBridge(this), "PDFCraftAndroid")

        // Permette al sito interno di usare SharedArrayBuffer (motore LibreOffice per Word/ODT/Excel/PowerPoint).
        // Disponibile solo con versioni recenti di "Android System WebView".
        if (WebViewFeature.isFeatureSupported(WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
        ) {
            try {
                WebViewCompat.getProfile(webView).setCrossOriginIsolatedAllowlist(setOf(AssetServer.ORIGIN))
            } catch (e: Exception) {
                // Funzione non disponibile: si useranno i convertitori di riserva.
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, hookScript, setOf(AssetServer.ORIGIN))
            documentStartHook = true
        }

        // Le richieste fatte dai service worker del sito devono passare anch'esse dal nostro server interno.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
        ) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    server.handle(request.url, request.method, request.requestHeaders)
            })
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                server.handle(request.url, request.method, request.requestHeaders)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.isForMainFrame && handleNavigation(request.url)

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (!documentStartHook) view.evaluateJavascript(hookScript, null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!documentStartHook) view.evaluateJavascript(hookScript, null)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val mimes = AcceptTypes.toMimeTypes(params.acceptTypes) { ext ->
                    MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
                }
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    if (mimes.size == 1) {
                        type = mimes[0]
                    } else {
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, mimes)
                    }
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }
                return try {
                    pickFiles.launch(intent)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            // window.open(...) dal sito: lo gestiamo senza aprire una seconda finestra.
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val popup = WebView(this@MainActivity)
                popup.webViewClient = object : WebViewClient() {
                    private var handled = false
                    private fun take(url: Uri?) {
                        if (handled || url == null) return
                        handled = true
                        if (!handleNavigation(url)) webView.loadUrl(url.toString())
                        popup.post { popup.destroy() }
                    }

                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        take(request.url)
                        return true
                    }

                    override fun onPageStarted(v: WebView, url: String?, favicon: Bitmap?) {
                        if (url != null && url != "about:blank") {
                            v.stopLoading()
                            take(Uri.parse(url))
                        }
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }
        }

        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            if (url.startsWith("blob:") || url.startsWith("data:") || url.startsWith(AssetServer.ORIGIN)) {
                saveViaPage(url, name)
            } else {
                downloadExternal(url, name, mimeType)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Prima chiediamo alla pagina (es. chiudere un editor a schermo intero).
                webView.evaluateJavascript(
                    "(window.__pdfcraftAppBack && window.__pdfcraftAppBack()) ? '1' : '0'"
                ) { result ->
                    if (result?.contains("1") == true) return@evaluateJavascript
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })

        SharedFiles.cleanup(this)
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else if (!handleIncoming(intent)) {
            webView.loadUrl("${AssetServer.ORIGIN}/$lang/")
        }
    }

    private val lang: String
        get() = if (java.util.Locale.getDefault().language == "it") "it" else "en"

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncoming(intent)
    }

    /** File aperti o condivisi da altre app: li passa alla pagina "Converti". */
    private fun handleIncoming(intent: Intent?): Boolean {
        val uris = SharedFiles.urisFrom(intent)
        if (uris.isEmpty()) return false
        Toast.makeText(this, "Apro il file…", Toast.LENGTH_SHORT).show()
        Thread {
            val id = try {
                SharedFiles.stage(this, uris)
            } catch (e: Exception) {
                null
            }
            runOnUiThread {
                if (id != null) {
                    webView.loadUrl("${AssetServer.ORIGIN}/$lang/convert/?shared=$id")
                } else {
                    Toast.makeText(this, "Impossibile leggere il file", Toast.LENGTH_LONG).show()
                    if (webView.url == null) webView.loadUrl("${AssetServer.ORIGIN}/$lang/")
                }
            }
        }.start()
        return true
    }

    /** true = navigazione gestita da noi (non caricarla nel WebView). */
    private fun handleNavigation(url: Uri): Boolean {
        val s = url.toString()
        return when {
            url.scheme == "https" && url.host == AssetServer.HOST -> false
            s.startsWith("blob:") || s.startsWith("data:") -> {
                saveViaPage(s, "")
                true
            }
            s == "about:blank" -> false
            else -> {
                openExternally(url)
                true
            }
        }
    }

    private fun saveViaPage(url: String, name: String) {
        val js = "window.__pdfcraftSaveUrl && window.__pdfcraftSaveUrl(" +
            JSONObject.quote(url) + "," + JSONObject.quote(name) + ")"
        webView.evaluateJavascript(js, null)
    }

    private fun openExternally(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Nessuna app per aprire questo link", Toast.LENGTH_SHORT).show()
        }
    }

    private fun downloadExternal(url: String, name: String, mimeType: String?) {
        try {
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "D. Docs lab/$name")
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, "Download avviato: $name", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            openExternally(Uri.parse(url))
        }
    }

    fun onFileSaved(uri: Uri, name: String, mime: String) {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle("File salvato")
            .setMessage("$name\n\nSi trova in Download › D. Docs lab.")
            .setPositiveButton("Apri") { _, _ ->
                val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try {
                    startActivity(intent)
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(this, "Nessuna app per aprire questo file", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Condividi") { _, _ ->
                val send = Intent(Intent.ACTION_SEND).setType(mime)
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(Intent.createChooser(send, name))
            }
            .setNegativeButton("OK", null)
            .show()
    }

    fun onSaveFailed(message: String?) {
        Toast.makeText(this, "Salvataggio non riuscito" + (message?.let { ": $it" } ?: ""), Toast.LENGTH_LONG).show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.destroy()
        super.onDestroy()
    }
}
