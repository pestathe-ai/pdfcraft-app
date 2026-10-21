package dev.pdfcraft.app

import android.content.res.AssetManager
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.util.zip.GZIPInputStream

/**
 * Serve il sito PDFCraft (copiato in assets/www) al WebView come se fosse
 * un vero server web, con le intestazioni che il sito si aspetta
 * (COOP/COEP per la conversione Office, tipi MIME corretti, ecc.).
 */
class AssetServer(private val assets: AssetManager, private val sharedRoot: File) {

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
    }

    fun handle(url: Uri, method: String?, requestHeaders: Map<String, String>?): WebResourceResponse? {
        if (url.scheme != "https" || url.host != HOST) return null
        val path = url.path ?: "/"
        val isRsc = requestHeaders?.keys?.any { it.equals("RSC", ignoreCase = true) } == true ||
            url.getQueryParameter("_rsc") != null

        // File condivisi da altre app (vedi SharedFiles)
        if (path.startsWith("/__shared/")) return serveShared(path)

        for (candidate in AssetPaths.candidates(path)) {
            val full = "${AssetPaths.ROOT}/$candidate"
            val stream = open(full)
            if (stream != null) {
                return respond(candidate, stream, lengthOf(full), isRsc, method)
            }
            // I file enormi (LibreOffice) sono salvati compressi: li decomprimiamo al volo.
            if (!candidate.endsWith(".gz")) {
                val gz = open("$full.gz")
                if (gz != null) {
                    return respond(candidate, GZIPInputStream(gz, 64 * 1024), -1L, isRsc, method)
                }
            }
        }
        return notFound()
    }

    private fun open(full: String): InputStream? = try {
        assets.open(full, AssetManager.ACCESS_STREAMING)
    } catch (e: IOException) {
        null
    }

    /** Dimensione nota solo per i file non compressi nell'APK (vedi noCompress in build.gradle.kts). */
    private fun lengthOf(full: String): Long = try {
        assets.openFd(full).use { it.length }
    } catch (e: IOException) {
        -1L
    }

    private fun baseHeaders(): MutableMap<String, String> = mutableMapOf(
        "Cross-Origin-Opener-Policy" to "same-origin",
        "Cross-Origin-Embedder-Policy" to "require-corp",
        "Cross-Origin-Resource-Policy" to "cross-origin",
        // Con l'allowlist del WebView (vedi MainActivity) rende la pagina "cross-origin isolated":
        // serve a LibreOffice (conversioni Word/ODT/Excel/PowerPoint).
        "Document-Isolation-Policy" to "isolate-and-require-corp",
        "Access-Control-Allow-Origin" to "*",
        "Cache-Control" to "no-cache",
        "X-Content-Type-Options" to "nosniff",
    )

    private fun respond(
        path: String,
        stream: InputStream,
        length: Long,
        isRsc: Boolean,
        method: String?,
    ): WebResourceResponse {
        val mime = AssetPaths.mimeType(path, isRsc)
        val headers = baseHeaders()
        if (length >= 0) headers["Content-Length"] = length.toString()
        val body: InputStream = if (method.equals("HEAD", ignoreCase = true)) {
            stream.close()
            ByteArrayInputStream(ByteArray(0))
        } else {
            stream
        }
        return WebResourceResponse(
            mime,
            if (AssetPaths.isText(mime)) "utf-8" else null,
            200,
            "OK",
            headers,
            body,
        )
    }

    private fun serveShared(path: String): WebResourceResponse {
        val parts = path.removePrefix("/__shared/").split('/')
        if (parts.size != 2 || !parts[0].matches(Regex("[A-Za-z0-9-]+")) || !parts[1].matches(Regex("[A-Za-z0-9._-]+"))) {
            return notFound()
        }
        val f = File(File(sharedRoot, parts[0]), parts[1])
        if (!f.isFile) return notFound()
        val mime = if (parts[1].endsWith(".json")) "application/json" else "application/octet-stream"
        val headers = baseHeaders()
        headers["Content-Length"] = f.length().toString()
        return WebResourceResponse(mime, null, 200, "OK", headers, FileInputStream(f))
    }

    private fun notFound(): WebResourceResponse {
        val page = open("${AssetPaths.ROOT}/404.html") ?: ByteArrayInputStream(ByteArray(0))
        return WebResourceResponse("text/html", "utf-8", 404, "Not Found", baseHeaders(), page)
    }
}
