package dev.pdfcraft.app

/**
 * Logica pura (senza Android) per tradurre un percorso URL del sito
 * nei file dentro assets/www. Testata con JUnit in CI.
 */
object AssetPaths {
    const val ROOT = "www"

    /** Ripulisce il percorso: niente slash iniziale, niente "..", niente segmenti vuoti doppi. */
    fun normalize(urlPath: String): String? {
        val trailingSlash = urlPath.endsWith("/")
        val parts = urlPath.split("/").filter { it.isNotEmpty() && it != "." }
        if (parts.any { it == ".." }) return null
        val joined = parts.joinToString("/")
        return if (trailingSlash && joined.isNotEmpty()) "$joined/" else joined
    }

    /** File da provare, in ordine, per un percorso URL (relativi alla cartella www). */
    fun candidates(urlPath: String): List<String> {
        val p = normalize(urlPath) ?: return emptyList()
        if (p.isEmpty()) return listOf("index.html")
        if (p.endsWith("/")) return listOf("${p}index.html")
        val last = p.substringAfterLast('/')
        return if (!last.contains('.')) {
            listOf("$p/index.html", "$p.html", p)
        } else {
            listOf(p)
        }
    }

    fun extension(path: String): String =
        path.substringAfterLast('/').substringAfterLast('.', "").lowercase()

    /** Tipo MIME in base all'estensione. Il WebView ne ha bisogno per wasm, moduli JS, ecc. */
    fun mimeType(path: String, isRscRequest: Boolean = false): String {
        val ext = extension(path)
        if (ext == "txt" && isRscRequest) return "text/x-component"
        return when (ext) {
            "html", "htm" -> "text/html"
            "js", "mjs", "cjs" -> "text/javascript"
            "css" -> "text/css"
            "json", "map" -> "application/json"
            "wasm" -> "application/wasm"
            "txt" -> "text/plain"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "avif" -> "image/avif"
            "ico" -> "image/x-icon"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "ttf" -> "font/ttf"
            "otf" -> "font/otf"
            "pdf" -> "application/pdf"
            "xml" -> "application/xml"
            "webmanifest" -> "application/manifest+json"
            "gz" -> "application/gzip"
            "zip", "whl" -> "application/zip"
            else -> "application/octet-stream"
        }
    }

    /** Il tipo è testuale? (serve per dichiarare la codifica UTF-8). */
    fun isText(mime: String): Boolean =
        mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml" ||
            mime == "application/xml" || mime == "application/manifest+json"
}

/** Converte i filtri di <input accept="..."> in tipi MIME per il selettore file di Android. */
object AcceptTypes {
    fun toMimeTypes(acceptTypes: Array<String>?, lookup: (String) -> String?): Array<String> {
        val items = acceptTypes.orEmpty()
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
        if (items.isEmpty()) return arrayOf("*/*")
        val result = LinkedHashSet<String>()
        for (item in items) {
            val mime = when {
                item.contains('/') -> item
                item.startsWith('.') -> lookup(item.removePrefix("."))
                else -> lookup(item)
            } ?: return arrayOf("*/*") // estensione sconosciuta: meglio mostrare tutti i file
            result.add(mime)
        }
        return result.toTypedArray()
    }
}

/** Nome file sicuro e con estensione coerente con il tipo. */
object FileNames {
    fun sanitize(name: String?, fallbackExt: String?): String {
        var n = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[\\u0000-\\u001f:*?\"<>|]"), "_").trim().trim('.')
        if (n.isEmpty()) n = "documento"
        if (n.length > 120) {
            val ext = n.substringAfterLast('.', "")
            n = n.take(110) + if (ext.isNotEmpty() && ext.length < 8) ".$ext" else ""
        }
        if (!n.contains('.') && !fallbackExt.isNullOrEmpty()) n = "$n.$fallbackExt"
        return n
    }
}
