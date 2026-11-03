package expo.modules.media3player

import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class QueueItem : Record {
  @Field var id: String = ""
  @Field var url: String = ""
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String = ""
  @Field var artworkUrl: String? = null
  @Field var gainDb: Double? = null
}

private const val TICK_MS = 500L

/**
 * The player as JavaScript sees it: commands in, one state event out. The
 * app keeps the queue's order itself and hands it over; shuffling is the app
 * reordering what comes next, so the list on screen is what actually plays.
 */
@UnstableApi
class Media3PlayerModule : Module() {
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private val main = Handler(Looper.getMainLooper())
  private var networkWatch: ConnectivityManager.NetworkCallback? = null
  private var lastNetwork: Network? = null
  private var lastNetworkState: Map<String, Boolean>? = null

  private val tick = object : Runnable {
    override fun run() {
      val player = controllerFuture?.takeIf { it.isDone }?.get() ?: return
      emitState(player)
      if (player.isPlaying) main.postDelayed(this, TICK_MS)
    }
  }

  private val listener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      emitState(player)
      main.removeCallbacks(tick)
      if (player.isPlaying) main.postDelayed(tick, TICK_MS)
    }

    override fun onPlayerError(error: PlaybackException) {
      sendEvent("onError", mapOf("message" to (error.localizedMessage ?: error.errorCodeName), "code" to error.errorCodeName))
    }
  }

  private fun stateOf(player: Player): Map<String, Any?> = mapOf(
    "isPlaying" to player.isPlaying,
    "playWhenReady" to player.playWhenReady,
    "isBuffering" to (player.playbackState == Player.STATE_BUFFERING),
    "isEnded" to (player.playbackState == Player.STATE_ENDED),
    "index" to player.currentMediaItemIndex,
    "count" to player.mediaItemCount,
    "positionMs" to player.currentPosition.coerceAtLeast(0).toDouble(),
    "durationMs" to (if (player.duration == C.TIME_UNSET) 0.0 else player.duration.toDouble()),
    "bandwidthBps" to Throughput.bitsPerSecond().toDouble(),
    "audio" to listOf(AudioInfo.decoder, AudioInfo.output, "speed ${player.playbackParameters.speed}").filter { it.isNotEmpty() }.joinToString(" · "),
    "repeat" to when (player.repeatMode) {
      Player.REPEAT_MODE_ALL -> "all"
      Player.REPEAT_MODE_ONE -> "one"
      else -> "off"
    }
  )

  private fun emitState(player: Player) {
    sendEvent("onState", stateOf(player))
  }

  /** Connects to the playback service on first use and runs the command once it answers. */
  private fun withPlayer(block: (MediaController) -> Unit) {
    val context = appContext.reactContext ?: return
    val future = controllerFuture ?: MediaController.Builder(
      context,
      SessionToken(context, ComponentName(context, PlaybackService::class.java))
    ).buildAsync().also {
      controllerFuture = it
      it.addListener({ runCatching { it.get().addListener(listener) } }, MoreExecutors.directExecutor())
    }
    future.addListener({
      runCatching { future.get() }
        .onSuccess(block)
        .onFailure { sendEvent("onError", mapOf("message" to (it.message ?: "The player did not start"))) }
    }, ContextMainExecutor(main))
  }

  private fun networkState(caps: NetworkCapabilities?): Map<String, Boolean> = mapOf(
    "connected" to (caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true),
    "metered" to (caps != null && !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
  )

  /** Signal strength comes through here too: only a real change goes on. */
  private fun networkReport(network: Network?, caps: NetworkCapabilities?) {
    val state = networkState(caps)
    if (network != lastNetwork) Throughput.forget()
    if (network == lastNetwork && state == lastNetworkState) return
    lastNetwork = network
    lastNetworkState = state
    sendEvent("onNetwork", state)
  }

  private fun watchNetwork() {
    val context = appContext.reactContext ?: return
    val watch = object : ConnectivityManager.NetworkCallback() {
      override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
        networkReport(network, networkCapabilities)
      }

      override fun onLost(network: Network) {
        networkReport(null, null)
      }
    }
    context.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(watch)
    networkWatch = watch
  }

  private fun downloads(): SongDownloads = SongDownloads(appContext.reactContext as Context)

  /** After a failed stream the player stands idle, and seeking alone would not start it again. */
  private fun prepareIfIdle(player: Player) {
    if (player.playbackState == Player.STATE_IDLE) player.prepare()
  }

  private fun QueueItem.toMediaItem(): MediaItem {
    val extras = Bundle()
    gainDb?.let { extras.putDouble(GAIN_EXTRA, it) }
    val meta = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .setAlbumTitle(album)
      .setIsPlayable(true)
      .setIsBrowsable(false)
      .setExtras(extras)
    artworkUrl?.takeIf { it.isNotEmpty() }?.let { meta.setArtworkUri(Uri.parse(it)) }
    val uri = Uri.parse(url)
    return MediaItem.Builder()
      .setMediaId(id)
      .setUri(uri)
      .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
      .setMediaMetadata(meta.build())
      .build()
  }

  override fun definition() = ModuleDefinition {
    Name("Media3Player")

    Events("onState", "onError", "onNetwork")

    OnCreate {
      watchNetwork()
    }

    OnDestroy {
      main.removeCallbacks(tick)
      controllerFuture?.let { MediaController.releaseFuture(it) }
      controllerFuture = null
      networkWatch?.let { watch ->
        appContext.reactContext?.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(watch)
      }
      networkWatch = null
    }

    AsyncFunction("setAuth") { server: String, headers: Map<String, String>, addresses: List<String> ->
      PlaybackAuth.server = server
      PlaybackAuth.addresses = addresses
      PlaybackAuth.headers = headers
    }

    /** `restart`: the decoder hears of it when it starts anew, so the song under way starts it anew. */
    AsyncFunction("setKeep24Bit") { on: Boolean, restart: Boolean ->
      AudioInfo.keep24Bit = on
      if (restart) {
        withPlayer { player ->
          if (player.mediaItemCount > 0) {
            player.stop()
            player.prepare()
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getNetwork") {
      val manager = (appContext.reactContext as Context).getSystemService(ConnectivityManager::class.java)
      networkState(manager.getNetworkCapabilities(manager.activeNetwork))
    }

    AsyncFunction("downloadStart") { url: String, headers: Map<String, String>, fileName: String, title: String, artist: String, wifiOnly: Boolean ->
      downloads().start(url, headers, fileName, title, artist, wifiOnly).toDouble()
    }

    AsyncFunction("downloadQuery") { jobs: List<Double> ->
      downloads().query(jobs.map { it.toLong() })
    }

    AsyncFunction("downloadFinish") { job: Double, fileName: String ->
      downloads().finish(job.toLong(), fileName)
    }

    AsyncFunction("downloadCancel") { job: Double ->
      downloads().cancel(job.toLong())
    }

    AsyncFunction("downloadDelete") { path: String ->
      downloads().delete(path)
    }

    AsyncFunction("downloadExisting") { paths: List<String> ->
      downloads().existing(paths)
    }

    AsyncFunction("setQueue") { items: List<QueueItem>, startIndex: Int, startMs: Double, play: Boolean ->
      withPlayer { player ->
        player.setMediaItems(items.map { it.toMediaItem() }, startIndex, startMs.toLong())
        player.prepare()
        player.playWhenReady = play
      }
    }.runOnQueue(Queues.MAIN)

    /** Replaces everything after the playing song; the song itself plays on undisturbed. */
    AsyncFunction("replaceUpcoming") { items: List<QueueItem> ->
      withPlayer { player ->
        val next = player.currentMediaItemIndex + 1
        if (next < player.mediaItemCount) player.removeMediaItems(next, player.mediaItemCount)
        player.addMediaItems(items.map { it.toMediaItem() })
      }
    }.runOnQueue(Queues.MAIN)

    /** Another copy of the playing song, from the same place in it. */
    AsyncFunction("replaceCurrent") { item: QueueItem, positionMs: Double ->
      withPlayer { player ->
        val index = player.currentMediaItemIndex
        // A queue that had ended stays over: another copy of its last song is no reason to start again.
        if (player.playbackState == Player.STATE_ENDED) player.playWhenReady = false
        player.replaceMediaItem(index, item.toMediaItem())
        player.seekTo(index, positionMs.toLong())
        prepareIfIdle(player)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("addItems") { items: List<QueueItem> ->
      withPlayer { player -> player.addMediaItems(items.map { it.toMediaItem() }) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("removeItem") { index: Int ->
      withPlayer { player -> player.removeMediaItem(index) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("moveItem") { from: Int, to: Int ->
      withPlayer { player -> player.moveMediaItem(from, to) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") {
      withPlayer { player ->
        if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition(0)
        prepareIfIdle(player)
        player.play()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") {
      withPlayer { player -> player.pause() }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionMs: Double ->
      withPlayer { player -> player.seekTo(positionMs.toLong()) }
    }.runOnQueue(Queues.MAIN)

    /** To a song of the queue: playing, or as it was when a swipe leaves a paused player paused. */
    AsyncFunction("skipTo") { index: Int, play: Boolean ->
      withPlayer { player ->
        player.seekTo(index, 0)
        prepareIfIdle(player)
        player.playWhenReady = play
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("next") {
      withPlayer { player ->
        player.seekToNext()
        prepareIfIdle(player)
      }
    }.runOnQueue(Queues.MAIN)

    /** Back to the song's start, or to the song before when it has only just begun. */
    AsyncFunction("previous") {
      withPlayer { player ->
        player.seekToPrevious()
        prepareIfIdle(player)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRepeat") { mode: String ->
      withPlayer { player ->
        player.repeatMode = when (mode) {
          "all" -> Player.REPEAT_MODE_ALL
          "one" -> Player.REPEAT_MODE_ONE
          else -> Player.REPEAT_MODE_OFF
        }
      }
    }.runOnQueue(Queues.MAIN)

    /** The service outlives the app's own screens: what it is doing right now. */
    AsyncFunction("getState") { promise: Promise ->
      withPlayer { player -> promise.resolve(stateOf(player)) }
    }.runOnQueue(Queues.MAIN)
  }
}

/** Runs the future's callback on the main thread, where the controller lives. */
private class ContextMainExecutor(private val handler: Handler) : java.util.concurrent.Executor {
  override fun execute(command: Runnable) {
    handler.post(command)
  }
}
