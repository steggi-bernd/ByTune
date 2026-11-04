package expo.modules.media3player

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import java.io.File
import java.security.MessageDigest

/**
 * Music in folders you picked, through Android's document picker: what's in them
 * and what the tags say. JavaScript keeps the list; a file it already knows, by its
 * address and when it changed, isn't opened again. Covers land in the app's own folder.
 */
internal object LocalFiles {
  private val AUDIO = setOf("flac", "mp3", "m4a", "m4b", "aac", "ogg", "oga", "opus", "wav")
  private val COVER_NAMES = setOf("cover", "folder", "front", "album", "albumart")
  private val PICTURE = setOf("jpg", "jpeg", "png", "webp")
  private const val DIRECTORY = DocumentsContract.Document.MIME_TYPE_DIR
  /** Far enough for any music folder; a link back to itself ends here. */
  private const val MAX_DEPTH = 24

  private fun extensionOf(name: String): String = name.substringAfterLast('.', "").lowercase()

  private fun digest(text: String): String =
    MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).take(12).joinToString("") { "%02x".format(it) }

  private class Found(
    val uri: Uri,
    val name: String,
    val path: String,
    val modified: Long,
    val size: Long,
    val folderCover: Uri?,
    val lyrics: Uri?
  )

  /** Every audio file under the folder, with what lies next to it. */
  private fun walk(context: Context, tree: Uri): List<Found> {
    val out = mutableListOf<Found>()
    val pending = ArrayDeque<Triple<String, String, Int>>()
    pending.add(Triple(DocumentsContract.getTreeDocumentId(tree), "", 0))
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
      DocumentsContract.Document.COLUMN_SIZE
    )
    while (pending.isNotEmpty()) {
      val (folder, path, depth) = pending.removeFirst()
      val here = mutableListOf<Array<Any>>()
      var cover: Uri? = null
      val lyrics = HashMap<String, Uri>()
      runCatching {
        context.contentResolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, folder), columns, null, null, null)?.use { row ->
          while (row.moveToNext()) {
            val id = row.getString(0) ?: continue
            val name = row.getString(1) ?: continue
            if (name.startsWith(".")) continue
            val mime = row.getString(2)
            if (mime == DIRECTORY) {
              if (depth < MAX_DEPTH) pending.add(Triple(id, "$path$name/", depth + 1))
              continue
            }
            val ext = extensionOf(name)
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
            when {
              ext in AUDIO -> here.add(arrayOf(uri, name, row.getLong(3), row.getLong(4)))
              ext == "lrc" -> lyrics[name.substringBeforeLast('.').lowercase()] = uri
              ext in PICTURE && name.substringBeforeLast('.').lowercase() in COVER_NAMES -> cover = uri
            }
          }
        }
      }
      for (file in here) {
        val name = file[1] as String
        out.add(Found(file[0] as Uri, name, "$path$name", file[2] as Long, file[3] as Long, cover, lyrics[name.substringBeforeLast('.').lowercase()]))
      }
    }
    return out
  }

  private fun number(text: String?): Int? = text?.substringBefore('/')?.trim()?.toIntOrNull()

  /** The album's picture, once per album: from the tags, or a cover.jpg beside the songs. */
  private fun coverOf(context: Context, reader: MediaMetadataRetriever, album: String, covers: File, folderCover: Uri?): String? {
    val file = File(covers, "${digest(album)}.jpg")
    if (file.exists()) return Uri.fromFile(file).toString()
    val bytes = reader.embeddedPicture ?: folderCover?.let { uri ->
      runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
    } ?: return null
    return runCatching {
      covers.mkdirs()
      file.writeBytes(bytes)
      Uri.fromFile(file).toString()
    }.getOrNull()
  }

  private fun read(context: Context, found: Found, covers: File): Map<String, Any?>? {
    val reader = MediaMetadataRetriever()
    return try {
      reader.setDataSource(context, found.uri)
      val artist = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
      val albumArtist = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
      val album = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
      // Without an album name each folder is a song's own picture.
      val albumKey = if (album.isNullOrBlank()) found.path.substringBeforeLast('/', "") + "/" else "${albumArtist ?: artist ?: ""}|$album".lowercase()
      val year = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR)?.toIntOrNull()
        ?: reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE)?.take(4)?.toIntOrNull()
      val rate = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull() else null
      val bits = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITS_PER_SAMPLE)?.toIntOrNull() else null
      mapOf(
        "uri" to found.uri.toString(),
        "name" to found.name,
        "path" to found.path,
        "modified" to found.modified.toDouble(),
        "size" to found.size.toDouble(),
        "title" to reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),
        "artist" to artist,
        "albumArtist" to albumArtist,
        "album" to album,
        "genre" to reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE),
        "year" to year,
        "track" to number(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)),
        "disc" to number(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)),
        "durationMs" to (reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0),
        "bitrate" to reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toDoubleOrNull(),
        "sampleRate" to rate,
        "bits" to bits,
        "cover" to coverOf(context, reader, albumKey, covers, found.folderCover),
        "lyrics" to found.lyrics?.toString()
      )
    } catch (_: Exception) {
      // Not something this phone can open: it can't play it either.
      null
    } finally {
      runCatching { reader.release() }
    }
  }

  /**
   * What's in the folder now. A file known by the same change time comes back
   * as just its address; `told` hears how far it has come.
   */
  fun scan(context: Context, tree: Uri, known: Map<String, Double>, told: (read: Int, total: Int) -> Unit): List<Map<String, Any?>> {
    val covers = File(context.filesDir, "local-covers")
    val found = walk(context, tree)
    val out = ArrayList<Map<String, Any?>>(found.size)
    found.forEachIndexed { at, file ->
      if (at % 8 == 0) told(at, found.size)
      val uri = file.uri.toString()
      if (known[uri] == file.modified.toDouble()) out.add(mapOf("uri" to uri, "unchanged" to true))
      else read(context, file, covers)?.let(out::add)
    }
    told(found.size, found.size)
    return out
  }

  /** How Android's picker names the folder: "Music/Albums" rather than its internal address. */
  fun nameOf(tree: Uri): String {
    val id = runCatching { DocumentsContract.getTreeDocumentId(tree) }.getOrDefault("")
    return id.substringAfter(':', id).ifBlank { id.substringBefore(':').ifBlank { "Folder" } }
  }

  fun readText(context: Context, uri: Uri): String? =
    runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull()
}
