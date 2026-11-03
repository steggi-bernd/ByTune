package expo.modules.media3player

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlin.math.min
import kotlin.math.pow

/** What the streams need from the app: the server's address and its login headers. */
object PlaybackAuth {
  @Volatile var server: String = ""
  @Volatile var headers: Map<String, String> = emptyMap()
}

const val GAIN_EXTRA = "gainDb"

/**
 * Plays the queue: one ExoPlayer in a media session, so it keeps going in the
 * background and answers the lock screen, the notification and headset
 * buttons. Songs in a row play without a gap. Decoding runs in float, so a
 * 24-bit file keeps its resolution up to the system's mixer.
 */
@UnstableApi
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    val http = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(30_000)
    // The login goes only to the server it belongs to.
    val streams = ResolvingDataSource.Factory(DefaultDataSource.Factory(this, http)) { spec ->
      val server = PlaybackAuth.server
      if (server.isNotEmpty() && spec.uri.toString().startsWith(server)) spec.withAdditionalHeaders(PlaybackAuth.headers) else spec
    }
    val renderers = DefaultRenderersFactory(this).setEnableAudioFloatOutput(true)
    val player = ExoPlayer.Builder(this, renderers)
      .setMediaSourceFactory(DefaultMediaSourceFactory(streams))
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
        /* handleAudioFocus = */ true
      )
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
    player.addListener(object : Player.Listener {
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        applyGain(player, mediaItem)
      }
    })

    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = MediaSession.Builder(this, player).setCallback(SessionCallback())
    if (open != null) builder.setSessionActivity(open)
    session = builder.build()
    // The app's mark in the status bar and on the media notification, not Media3's own.
    setMediaNotificationProvider(
      DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(R.drawable.notification_mark) }
    )
  }

  /** Quieter songs stay as they are: a gain only ever lowers the volume, so nothing clips. */
  private fun applyGain(player: Player, item: MediaItem?) {
    val extras = item?.mediaMetadata?.extras
    val gain = if (extras?.containsKey(GAIN_EXTRA) == true) extras.getDouble(GAIN_EXTRA) else 0.0
    player.volume = min(1.0, 10.0.pow(gain / 20.0)).toFloat()
  }

  /** A controller's items carry their address in the request metadata; the player needs it as the URI. */
  private inner class SessionCallback : MediaSession.Callback {
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>
    ): ListenableFuture<MutableList<MediaItem>> {
      val playable = mediaItems.map { it.buildUpon().setUri(it.requestMetadata.mediaUri).build() }
      return Futures.immediateFuture(playable.toMutableList())
    }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  /** Swiped away from the recent apps: stops unless it is still playing. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    val player = session?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0 || player.playbackState == Player.STATE_ENDED) {
      stopSelf()
    }
  }

  override fun onDestroy() {
    session?.run {
      player.release()
      release()
    }
    session = null
    super.onDestroy()
  }
}
