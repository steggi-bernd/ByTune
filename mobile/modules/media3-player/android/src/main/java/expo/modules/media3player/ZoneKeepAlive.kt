package expo.modules.media3player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.MediaMetadata
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * While a device on the network plays what this phone steers, nothing here makes
 * a sound, and Android would put the app to sleep: then nobody moves the device
 * on to the next song. This service keeps the app awake and shows what's on.
 * A media session of its own makes it a real player for Android: on the lock
 * screen, for headset buttons, and the volume keys reach the device.
 */
class ZoneKeepAliveService : Service() {
  private var wake: PowerManager.WakeLock? = null
  private var wifi: WifiManager.WifiLock? = null
  private var session: MediaSession? = null
  private var volumeKeys: VolumeProvider? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "songsta:zones").apply {
      setReferenceCounted(false)
      acquire(LOCKS_LAST_MS)
    }
    @Suppress("DEPRECATION")
    wifi = applicationContext.getSystemService(WifiManager::class.java)?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "songsta:zones")?.apply {
      setReferenceCounted(false)
      runCatching { acquire() }
    }
    session = MediaSession(this, "songsta-zones").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() {
          controls?.invoke("toggle")
        }

        override fun onPause() {
          controls?.invoke("toggle")
        }

        override fun onSkipToNext() {
          controls?.invoke("next")
        }

        override fun onSkipToPrevious() {
          controls?.invoke("previous")
        }
      })
      isActive = true
    }
  }

  /** What Android's own players show, and whose volume its keys change. */
  private fun tellSession() {
    val session = session ?: return
    session.setMetadata(
      MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, text).build()
    )
    session.setPlaybackState(
      PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
        .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build()
    )
    val level = volume
    val keys = volumeKeys
    when {
      level < 0 && keys != null -> {
        volumeKeys = null
        session.setPlaybackToLocal(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
      }
      level >= 0 && keys != null -> keys.currentVolume = level
      level >= 0 -> {
        volumeKeys = object : VolumeProvider(VOLUME_CONTROL_ABSOLUTE, 100, level) {
          override fun onSetVolumeTo(wanted: Int) {
            currentVolume = wanted.coerceIn(0, 100)
            controls?.invoke("volume:$currentVolume")
          }

          override fun onAdjustVolume(direction: Int) {
            currentVolume = (currentVolume + direction * VOLUME_KEY_STEP).coerceIn(0, 100)
            controls?.invoke("volume:$currentVolume")
          }
        }.also { session.setPlaybackToRemote(it) }
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    tellSession()
    // Always first: stopped before it went to the foreground, Android would take the whole app down.
    val note = notification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    else startForeground(NOTE_ID, note)
    wake?.takeIf { !it.isHeld }?.acquire(LOCKS_LAST_MS)
    when (intent?.action) {
      ACTION_STOP -> stopSelf()
      ACTION_TOGGLE -> controls?.invoke("toggle")
      ACTION_NEXT -> controls?.invoke("next")
      ACTION_PREVIOUS -> controls?.invoke("previous")
      else -> Unit
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    started = false
    session?.release()
    session = null
    volumeKeys = null
    runCatching { wake?.takeIf { it.isHeld }?.release() }
    runCatching { wifi?.takeIf { it.isHeld }?.release() }
    super.onDestroy()
  }

  private fun control(action: String, code: Int): PendingIntent =
    PendingIntent.getService(this, code, Intent(this, ZoneKeepAliveService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun button(icon: Int, title: String, action: String, code: Int): Notification.Action =
    Notification.Action.Builder(Icon.createWithResource(this, icon), title, control(action, code)).build()

  private fun notification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL, "Playing on other devices", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
      Notification.Builder(this, CHANNEL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return builder
      .setSmallIcon(R.drawable.notification_mark)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .addAction(button(android.R.drawable.ic_media_previous, "Previous", ACTION_PREVIOUS, 1))
      .addAction(
        if (playing) button(android.R.drawable.ic_media_pause, "Pause", ACTION_TOGGLE, 2)
        else button(android.R.drawable.ic_media_play, "Play", ACTION_TOGGLE, 2)
      )
      .addAction(button(android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 3))
      .setStyle(Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2).apply { session?.let { setMediaSession(it.sessionToken) } })
      .build()
  }

  companion object {
    private const val NOTE_ID = 7403
    private const val CHANNEL = "songsta-zones"
    private const val ACTION_STOP = "stop"
    private const val ACTION_TOGGLE = "toggle"
    private const val ACTION_NEXT = "next"
    private const val ACTION_PREVIOUS = "previous"
    /** Android complains about locks without an end; the next word from the app renews it. */
    private const val LOCKS_LAST_MS = 6 * 60 * 60 * 1000L
    private const val VOLUME_KEY_STEP = 3

    @Volatile private var started = false
    @Volatile private var title = ""
    @Volatile private var text = ""
    @Volatile private var playing = false
    /** the device's volume 0–100; below 0 when it can't be set from here */
    @Volatile private var volume = -1

    /** The buttons in the notification. */
    @Volatile var controls: ((String) -> Unit)? = null

    fun show(context: Context, newTitle: String, newText: String, isPlaying: Boolean, newVolume: Int) {
      title = newTitle
      text = newText
      playing = isPlaying
      volume = newVolume
      // From the background Android may refuse: the app stays awake only as long as it does by itself then.
      runCatching {
        context.startForegroundService(Intent(context, ZoneKeepAliveService::class.java))
        started = true
      }
    }

    fun hide(context: Context) {
      if (!started) return
      started = false
      runCatching { context.startForegroundService(Intent(context, ZoneKeepAliveService::class.java).setAction(ACTION_STOP)) }
    }
  }
}
