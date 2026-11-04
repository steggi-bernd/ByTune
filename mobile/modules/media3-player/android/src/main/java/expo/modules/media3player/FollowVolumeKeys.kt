package expo.modules.media3player

import android.content.Context
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState

/**
 * While this phone steers another device's music, the volume keys change that
 * device's volume. Android gives the keys to the session that's playing, so this
 * one says it is, without a sound or a notification of its own.
 */
internal object FollowVolumeKeys {
  private const val STEP = 5
  private var session: MediaSession? = null
  private var keys: VolumeProvider? = null

  fun set(context: Context, level: Int) {
    if (level < 0) {
      session?.release()
      session = null
      keys = null
      return
    }
    val known = keys
    if (known != null) {
      known.currentVolume = level
      return
    }
    val provider = object : VolumeProvider(VOLUME_CONTROL_ABSOLUTE, 100, level) {
      override fun onSetVolumeTo(wanted: Int) {
        currentVolume = wanted.coerceIn(0, 100)
        ZoneKeepAliveService.controls?.invoke("volume:$currentVolume")
      }

      override fun onAdjustVolume(direction: Int) {
        currentVolume = (currentVolume + direction * STEP).coerceIn(0, 100)
        ZoneKeepAliveService.controls?.invoke("volume:$currentVolume")
      }
    }
    keys = provider
    session = MediaSession(context, "songsta-follow").apply {
      // Without a callback Android drops what it would tell the provider.
      setCallback(object : MediaSession.Callback() {})
      setPlaybackToRemote(provider)
      setPlaybackState(PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, 0L, 1f).build())
      isActive = true
    }
  }
}
