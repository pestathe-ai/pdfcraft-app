package dev.pdfcraft.app

import android.content.ContentValues
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Riceve dal sito i file prodotti (PDF, immagini, zip...) a pezzi in base64
 * e li salva nella cartella Download/D. Docs lab del telefono.
 * Esposto a JavaScript come window.PDFCraftAndroid.
 */
class DownloadBridge(private val activity: MainActivity) {

    private class Pending(val name: String, val mime: String, val file: File, val out: FileOutputStream)

    private val pending = ConcurrentHashMap<String, Pending>()

    @JavascriptInterface
    fun begin(name: String?, mime: String?): String {
        val id = UUID.randomUUID().toString()
        val dir = File(activity.cacheDir, "downloads").apply { mkdirs() }
        val file = File(dir, id)
        pending[id] = Pending(name ?: "", mime ?: "", file, FileOutputStream(file))
        return id
    }

    @JavascriptInterface
    fun chunk(id: String, base64: String) {
        val p = pending[id] ?: return
        try {
            p.out.write(Base64.decode(base64, Base64.DEFAULT))
        } catch (e: Exception) {
            abort(id, e.message)
        }
    }

    @JavascriptInterface
    fun end(id: String) {
        val p = pending.remove(id) ?: return
        try {
            p.out.close()
            val mime = resolveMime(p.mime, p.name)
            val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
            val name = FileNames.sanitize(p.name, ext)
            val uri = saveToDownloads(p.file, name, mime)
            activity.runOnUiThread { activity.onFileSaved(uri, name, mime) }
        } catch (e: Exception) {
            activity.runOnUiThread { activity.onSaveFailed(e.message) }
        } finally {
            p.file.delete()
        }
    }

    @JavascriptInterface
    fun fail(id: String?, message: String?) {
        if (!id.isNullOrEmpty()) abort(id, message) else activity.runOnUiThread { activity.onSaveFailed(message) }
    }

    private fun abort(id: String, message: String?) {
        pending.remove(id)?.let {
            try { it.out.close() } catch (_: Exception) {}
            it.file.delete()
        }
        activity.runOnUiThread { activity.onSaveFailed(message) }
    }

    private fun resolveMime(mime: String, name: String): String {
        val clean = mime.substringBefore(';').trim().lowercase()
        if (clean.isNotEmpty() && clean != "application/octet-stream") return clean
        val ext = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    private fun saveToDownloads(source: File, name: String, mime: String): Uri {
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/D. Docs lab")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Impossibile creare il file in Download")
        try {
            resolver.openOutputStream(uri)!!.use { out -> source.inputStream().use { it.copyTo(out, 256 * 1024) } }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return uri
    }
}
