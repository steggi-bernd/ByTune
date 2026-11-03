package expo.modules.media3player

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import java.io.File

/**
 * Songs to keep on the phone. Android's own download service fetches them, also
 * with the app closed and over a bad connection, and shows the progress. A
 * finished file moves to the app's folder, out of that service's hands: it
 * cleans up after a while what it takes for forgotten.
 */
internal class SongDownloads(private val context: Context) {
  private val system: DownloadManager
    get() = context.getSystemService(DownloadManager::class.java)

  private val songs: File
    get() = File(context.getExternalFilesDir(null) ?: context.filesDir, "songs").apply { mkdirs() }

  fun start(url: String, headers: Map<String, String>, fileName: String, title: String, artist: String, wifiOnly: Boolean): Long {
    File(context.getExternalFilesDir(INCOMING), fileName).delete()
    val request = DownloadManager.Request(Uri.parse(url))
      .setTitle(title)
      .setDescription(artist)
      .setDestinationInExternalFilesDir(context, INCOMING, fileName)
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
      .setAllowedOverMetered(!wifiOnly)
      .setAllowedOverRoaming(!wifiOnly)
    headers.forEach { (name, value) -> request.addRequestHeader(name, value) }
    return system.enqueue(request)
  }

  /** How they stand; one the service no longer knows isn't in the list. */
  fun query(jobs: List<Long>): List<Map<String, Any>> {
    if (jobs.isEmpty()) return emptyList()
    val found = ArrayList<Map<String, Any>>()
    system.query(DownloadManager.Query().setFilterById(*jobs.toLongArray()))?.use { row ->
      while (row.moveToNext()) {
        val status = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        val reason = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
        found.add(
          mapOf(
            "job" to row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)).toDouble(),
            "status" to when (status) {
              DownloadManager.STATUS_SUCCESSFUL -> "done"
              DownloadManager.STATUS_FAILED -> "failed"
              DownloadManager.STATUS_RUNNING -> "running"
              DownloadManager.STATUS_PAUSED -> if (reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI) "wifi" else "waiting"
              else -> "waiting"
            },
            "loaded" to row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).toDouble(),
            "total" to row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).toDouble()
          )
        )
      }
    }
    return found
  }

  /** Takes a finished file over from the service; null when there is none after all. */
  fun finish(job: Long, fileName: String): Map<String, Any>? {
    val local = system.query(DownloadManager.Query().setFilterById(job))?.use { row ->
      if (row.moveToFirst()) row.getString(row.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)) else null
    }
    val from = local?.let { Uri.parse(it).path }?.let { File(it) } ?: File(context.getExternalFilesDir(INCOMING), fileName)
    val to = File(songs, fileName)
    if (!from.exists()) {
      system.remove(job)
      return null
    }
    to.delete()
    if (!from.renameTo(to)) {
      from.copyTo(to, overwrite = true)
      from.delete()
    }
    system.remove(job)
    return mapOf("file" to to.absolutePath, "bytes" to to.length().toDouble())
  }

  fun cancel(job: Long) {
    system.remove(job)
  }

  fun delete(path: String) {
    val file = File(path)
    if (file.canonicalPath.startsWith(songs.canonicalPath + File.separator)) file.delete()
  }

  fun existing(paths: List<String>): List<String> = paths.filter { File(it).exists() }

  private companion object {
    const val INCOMING = "incoming"
  }
}
