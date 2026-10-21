package dev.pdfcraft.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AssetPathsTest {
    @Test
    fun rootAndFolders() {
        assertEquals(listOf("index.html"), AssetPaths.candidates("/"))
        assertEquals(listOf("it/index.html"), AssetPaths.candidates("/it/"))
        assertEquals(listOf("it/tools/merge-pdf/index.html"), AssetPaths.candidates("/it/tools/merge-pdf/"))
    }

    @Test
    fun pathWithoutSlash() {
        assertEquals(listOf("it/index.html", "it.html", "it"), AssetPaths.candidates("/it"))
    }

    @Test
    fun files() {
        assertEquals(listOf("_next/static/chunks/main.js"), AssetPaths.candidates("/_next/static/chunks/main.js"))
        assertEquals(listOf("libreoffice-wasm/soffice.wasm.bin"), AssetPaths.candidates("/libreoffice-wasm/soffice.wasm.bin"))
    }

    @Test
    fun rejectsTraversal() {
        assertNull(AssetPaths.normalize("/../secret"))
        assertEquals(emptyList<String>(), AssetPaths.candidates("/a/../../b.js"))
        assertEquals("a/b.js", AssetPaths.normalize("//a/./b.js"))
    }

    @Test
    fun mimeTypes() {
        assertEquals("application/wasm", AssetPaths.mimeType("x/qpdf.wasm"))
        assertEquals("text/javascript", AssetPaths.mimeType("a/b.mjs"))
        assertEquals("text/x-component", AssetPaths.mimeType("it/index.txt", isRscRequest = true))
        assertEquals("text/plain", AssetPaths.mimeType("it/index.txt"))
        assertEquals("application/octet-stream", AssetPaths.mimeType("soffice.data.bin"))
    }

    @Test
    fun acceptTypes() {
        val lookup = { ext: String -> mapOf("pdf" to "application/pdf", "png" to "image/png")[ext] }
        assertArrayEquals(arrayOf("application/pdf"), AcceptTypes.toMimeTypes(arrayOf(".pdf"), lookup))
        assertArrayEquals(arrayOf("application/pdf", "image/png"), AcceptTypes.toMimeTypes(arrayOf(".pdf,.png"), lookup))
        assertArrayEquals(arrayOf("image/*"), AcceptTypes.toMimeTypes(arrayOf("image/*"), lookup))
        assertArrayEquals(arrayOf("*/*"), AcceptTypes.toMimeTypes(arrayOf(".pdf", ".xyz"), lookup))
        assertArrayEquals(arrayOf("*/*"), AcceptTypes.toMimeTypes(arrayOf(""), lookup))
        assertArrayEquals(arrayOf("*/*"), AcceptTypes.toMimeTypes(null, lookup))
    }

    @Test
    fun fileNames() {
        assertEquals("unito.pdf", FileNames.sanitize("unito.pdf", "pdf"))
        assertEquals("documento.pdf", FileNames.sanitize("", "pdf"))
        assertEquals("a_b.pdf", FileNames.sanitize("a:b", "pdf"))
        assertEquals("file.zip", FileNames.sanitize("dir/file.zip", "pdf"))
    }
}
