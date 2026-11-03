package expo.modules.media3player

import android.app.DownloadManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import android.os.IBinder
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * Songs to keep on the phone, fetched by the app itself, over the same way and
 * with the same login as the player: Android's own download service stayed
 * silent on a real phone where playing worked fine. What's fetched so far stays
 * in a `.part` file, so a broken connection or a closed app goes on from there.
 * [SongDownloadService] keeps the process alive while the app is out of sight.
 */
internal object SongDownloads {
  private const val AT_A_TIME = 2
  private const val TRIES = 5
  private const val WIFI_LOOK_MS = 3000L

  private class Job(
    val id: Long,
    val url: String,
    val headers: Map<String, String>,
    val fileName: String,
    val wifiOnly: Boolean
  ) {
    @Volatile var status = "waiting"
    @Volatile var reason = 0
    @Volatile var problem = ""
    @Volatile var loaded = 0L
    @Volatile var total = -1L
    @Volatile var file: File? = null
    @Volatile var cancelled = false
  }

  private class Refused(val code: Int) : IOException("The server answered $code")

  private val pool = Executors.newFixedThreadPool(AT_A_TIME) { work -> Thread(work, "song-download").apply { isDaemon = true } }
  private val jobs = ConcurrentHashMap<Long, Job>()
  private val nextId = AtomicLong(System.currentTimeMillis())

  private fun songs(context: Context): File =
    File(context.getExternalFilesDir(null) ?: context.filesDir, "songs").apply { mkdirs() }

  private fun working(job: Job): Boolean = job.status == "waiting" || job.status == "wifi" || job.status == "running"

  fun start(context: Context, url: String, headers: Map<String, String>, fileName: String, wifiOnly: Boolean): Long {
    val app = context.applicationContext
    val job = Job(nextId.incrementAndGet(), url, headers, fileName, wifiOnly)
    jobs[job.id] = job
    SongDownloadService.keepAlive(app)
    pool.execute {
      run(app, job)
      if (!busy()) SongDownloadService.letGo()
    }
    return job.id
  }

  fun busy(): Boolean = jobs.values.any(::working)

  private fun run(context: Context, job: Job) {
    val folder = songs(context)
    val done = File(folder, job.fileName)
    if (done.exists() && done.length() > 0) {
      // Fetched before, and the app closed before it heard.
      job.file = done
      job.status = "done"
      return
    }
    val part = File(folder, "${job.fileName}.part")
    var failures = 0
    while (!job.cancelled) {
      if (job.wifiOnly && isMetered(context)) {
        job.status = "wifi"
        Thread.sleep(WIFI_LOOK_MS)
        continue
      }
      try {
        job.status = "running"
        fetch(job, part)
        if (job.cancelled) break
        if (!part.renameTo(done)) throw IOException("The finished file couldn't be moved")
        job.file = done
        job.status = "done"
        return
      } catch (err: Refused) {
        job.reason = err.code
        job.problem = when (err.code) {
          401, 403 -> "The server refused this login"
          404 -> "The server doesn't have this song any more"
          else -> "The server answered ${err.code}"
        }
        job.status = "failed"
        return
      } catch (err: IOException) {
        failures += 1
        job.problem = wordsFor(err)
        if (failures >= TRIES) {
          job.status = "failed"
          return
        }
        job.status = "waiting"
        Thread.sleep(min(30_000L, 2000L * failures))
      }
    }
    part.delete()
  }

  private fun fetch(job: Job, part: File) {
    val connection = URL(job.url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      job.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      connection.setRequestProperty("Accept-Encoding", "identity")
      val have = if (part.exists()) part.length() else 0L
      if (have > 0) connection.setRequestProperty("Range", "bytes=$have-")
      val code = connection.responseCode
      // Asked for what comes after the end: it was all there already.
      if (code == 416 && have > 0) return
      if (code != 200 && code != 206) throw Refused(code)
      val resuming = code == 206
      val length = connection.contentLengthLong
      job.total = if (length < 0) -1 else if (resuming) have + length else length
      job.loaded = if (resuming) have else 0
      FileOutputStream(part, resuming).use { out ->
        connection.inputStream.use { input ->
          val buffer = ByteArray(64 * 1024)
          while (!job.cancelled) {
            val count = input.read(buffer)
            if (count < 0) break
            out.write(buffer, 0, count)
            job.loaded += count
          }
        }
      }
      if (!job.cancelled && job.total > 0 && part.length() < job.total) throw IOException("The connection broke off")
    } finally {
      connection.disconnect()
    }
  }

  private fun wordsFor(err: IOException): String = when {
    err is UnknownHostException -> "Can't reach the server"
    err is SocketTimeoutException -> "The server stopped answering"
    err.message?.contains("ENOSPC") == true || err.message?.contains("No space") == true -> "There's no room left on the phone"
    else -> err.message ?: "The connection broke off"
  }

  private fun isMetered(context: Context): Boolean =
    context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered

  /** How they stand; one this run of the app doesn't know isn't in the list. */
  fun query(ids: List<Long>): List<Map<String, Any>> = ids.mapNotNull { id ->
    jobs[id]?.let { job ->
      mapOf(
        "job" to job.id.toDouble(),
        "status" to job.status,
        "reason" to job.reason,
        "problem" to job.problem,
        "loaded" to job.loaded.toDouble(),
        "total" to job.total.toDouble()
      )
    }
  }

  /** The finished file; null when there is none after all. */
  fun finish(id: Long): Map<String, Any>? {
    val file = jobs.remove(id)?.file ?: return null
    return mapOf("file" to file.absolutePath, "bytes" to file.length().toDouble())
  }

  /** A number from before this run may still lie with Android's own download service, from older versions of the app. */
  fun cancel(context: Context, id: Long) {
    val job = jobs.remove(id)
    if (job != null) {
      job.cancelled = true
      File(songs(context), "${job.fileName}.part").delete()
      if (!busy()) SongDownloadService.letGo()
    } else {
      runCatching { context.getSystemService(DownloadManager::class.java).remove(id) }
    }
  }

  fun delete(context: Context, path: String) {
    val file = File(path)
    if (file.canonicalPath.startsWith(songs(context).canonicalPath + File.separator)) file.delete()
  }

  fun existing(paths: List<String>): List<String> = paths.filter { File(it).exists() }
}

/** Keeps the app's process going while songs download and nobody is looking. */
class SongDownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val note = notification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(NOTE_ID, note)
    running = this
    // Only now: stopped before it went to the foreground, Android would take the whole app down.
    if (!SongDownloads.busy()) stopSelf()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = null
    super.onDestroy()
  }

  /** Android's limit for this kind of work per day: what's fetched so far stays for later. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  private fun notification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
      Notification.Builder(this, CHANNEL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      android.app.PendingIntent.getActivity(this, 0, it, android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return builder
      .setSmallIcon(R.drawable.notification_mark)
      .setContentTitle("Downloading songs")
      .setOngoing(true)
      .setContentIntent(open)
      .build()
  }

  companion object {
    private const val NOTE_ID = 7402
    private const val CHANNEL = "downloads"
    @Volatile private var running: SongDownloadService? = null

    /** Not allowed from the background on newer Androids: then it goes on for as long as the app is left alone. */
    fun keepAlive(context: Context) {
      runCatching {
        val intent = Intent(context, SongDownloadService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      }
    }

    fun letGo() {
      running?.stopSelf()
    }
  }
}
