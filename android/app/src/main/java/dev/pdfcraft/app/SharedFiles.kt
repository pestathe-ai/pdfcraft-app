package dev.pdfcraft.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * File ricevuti da altre app ("Condividi" / "Apri con"): vengono copiati in una
 * cartella temporanea e serviti al sito sotto /__shared/<id>/ (vedi AssetServer).
 */
object SharedFiles {
    private const val MAX_AGE_MS = 24L * 60 * 60 * 1000

    fun root(context: Context): File = File(context.cacheDir, "shared").apply { mkdirs() }

    fun urisFrom(intent: Intent?): List<Uri> {
        if (intent == null) return emptyList()
        val out = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.data?.let { out.add(it) }
            Intent.ACTION_SEND -> streamExtra(intent)?.let { out.add(it) }
            Intent.ACTION_SEND_MULTIPLE -> out.addAll(streamListExtra(intent))
        }
        if (out.isEmpty()) intent.clipData?.let { clip ->
            if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
                for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { out.add(it) }
            }
        }
        return out.filter { it.scheme == "content" || it.scheme == "file" }
    }

    @Suppress("DEPRECATION")
    private fun streamExtra(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun streamListExtra(intent: Intent): List<Uri> =
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)) ?: emptyList()

    /** Copia i file e restituisce l'id da passare alla pagina. */
    fun stage(context: Context, uris: List<Uri>): String {
        val id = UUID.randomUUID().toString()
        val dir = File(root(context), id).apply { mkdirs() }
        val list = JSONArray()
        uris.forEachIndexed { i, uri ->
            val name = FileNames.sanitize(displayName(context, uri), null)
            val type = context.contentResolver.getType(uri) ?: ""
            val target = File(dir, i.toString())
            context.contentResolver.openInputStream(uri)!!.use { input ->
                target.outputStream().use { input.copyTo(it, 256 * 1024) }
            }
            list.put(JSONObject().put("name", name).put("type", type).put("path", i.toString()))
        }
        File(dir, "index.json").writeText(list.toString())
        return id
    }

    private fun displayName(context: Context, uri: Uri): String? {
        if (uri.scheme == "file") return uri.lastPathSegment
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (e: Exception) {
            null
        } ?: uri.lastPathSegment
    }

    fun cleanup(context: Context) {
        val now = System.currentTimeMillis()
        root(context).listFiles()?.forEach { f ->
            if (now - f.lastModified() > MAX_AGE_MS) f.deleteRecursively()
        }
    }
}
