package expo.modules.media3player

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlin.math.min
import kotlin.math.pow

/** What the streams need from the app: where the server answers now, its other addresses, its login headers. */
object PlaybackAuth {
  @Volatile var server: String = ""
  @Volatile var addresses: List<String> = emptyList()
  @Volatile var headers: Map<String, String> = emptyMap()
}

/** What the sound is going through, for a look when something sounds off. */
object AudioInfo {
  @Volatile var decoder: String = ""
  @Volatile var output: String = ""
  /** a 24-bit file decodes to float and keeps its resolution up to the system's mixer */
  @Volatile var keep24Bit: Boolean = false
}

/**
 * Float is a choice, and only for files that have more than 16 bits to keep.
 * Everything else stays on the way every phone's decoders are used to. One phone
 * played a 24-bit song far too fast, maybe because of this; the emulator never did.
 */
@UnstableApi
private class SongRenderers(context: Context) : DefaultRenderersFactory(context) {
  override fun buildAudioRenderers(
    context: Context,
    extensionRendererMode: Int,
    mediaCodecSelector: MediaCodecSelector,
    enableDecoderFallback: Boolean,
    audioSink: AudioSink,
    eventHandler: Handler,
    eventListener: AudioRendererEventListener,
    out: ArrayList<Renderer>
  ) {
    out.add(object : MediaCodecAudioRenderer(context, codecAdapterFactory, mediaCodecSelector, enableDecoderFallback, eventHandler, eventListener, audioSink) {
      override fun getMediaFormat(format: Format, codecMimeType: String, codecMaxInputSize: Int, codecOperatingRate: Float): MediaFormat {
        val media = super.getMediaFormat(format, codecMimeType, codecMaxInputSize, codecOperatingRate)
        if (!AudioInfo.keep24Bit || !Util.isEncodingHighResolutionPcm(format.pcmEncoding)) {
          if (Build.VERSION.SDK_INT >= 29) media.removeKey(MediaFormat.KEY_PCM_ENCODING)
          else media.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
        }
        return media
      }
    })
  }
}

const val GAIN_EXTRA = "gainDb"

/**
 * Plays the queue: one ExoPlayer in a media session, so it keeps going in the
 * background and answers the lock screen, the notification and headset
 * buttons. Songs in a row play without a gap.
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
      .setTransferListener(Throughput)
    val streams = ResolvingDataSource.Factory(DefaultDataSource.Factory(this, http)) { spec ->
      val server = PlaybackAuth.server
      val uri = spec.uri.toString()
      // What's in the queue keeps the address it was made with; the server may answer elsewhere by now.
      val moved = PlaybackAuth.addresses.firstOrNull { it != server && uri.startsWith(it) }
      when {
        server.isEmpty() -> spec
        moved != null -> spec.withUri(Uri.parse(server + uri.substring(moved.length))).withAdditionalHeaders(PlaybackAuth.headers)
        // The login goes only to the server it belongs to.
        uri.startsWith(server) -> spec.withAdditionalHeaders(PlaybackAuth.headers)
        else -> spec
      }
    }
    // A kept MP3 from the server has no seek table: it seeks by its steady bitrate.
    val extractors = DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true)
    val renderers = SongRenderers(this).setEnableAudioFloatOutput(true)
    val player = ExoPlayer.Builder(this, renderers)
      .setMediaSourceFactory(DefaultMediaSourceFactory(streams, extractors))
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

      override fun onIsLoadingChanged(isLoading: Boolean) {
        if (!isLoading) Throughput.playerWaits()
      }
    })
    player.addAnalyticsListener(object : AnalyticsListener {
      override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
        AudioInfo.decoder = decoderName
      }

      override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
        val samples = when (audioTrackConfig.encoding) {
          C.ENCODING_PCM_16BIT -> "16-bit"
          C.ENCODING_PCM_24BIT -> "24-bit"
          C.ENCODING_PCM_32BIT -> "32-bit"
          C.ENCODING_PCM_FLOAT -> "float"
          else -> "encoding ${audioTrackConfig.encoding}"
        }
        val channels = Integer.bitCount(audioTrackConfig.channelConfig)
        AudioInfo.output = "${audioTrackConfig.sampleRate} Hz ${samples} ${channels}ch"
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
