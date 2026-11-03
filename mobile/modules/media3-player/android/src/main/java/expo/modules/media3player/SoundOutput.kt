package expo.modules.media3player

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRouter
import android.media.MediaRouter2
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings

/**
 * Where the sound comes out right now: the phone, something on a cable, a
 * Bluetooth device. Choosing another is Android's own dialog, which knows them all.
 */
internal class SoundOutput(private val context: Context, private val changed: (Map<String, String>) -> Unit) {
  private val audio = context.getSystemService(AudioManager::class.java)
  private val router = context.getSystemService(MediaRouter::class.java)
  private val main = Handler(Looper.getMainLooper())
  private val music = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
  private var last: Map<String, String>? = null

  private val look = Runnable {
    val now = current()
    if (now != last) {
      last = now
      changed(now)
    }
  }

  /** The system's answers follow a moment after its news. */
  private fun lookSoon() {
    main.removeCallbacks(look)
    main.postDelayed(look, SETTLE_MS)
  }

  private val routes = object : MediaRouter.SimpleCallback() {
    override fun onRouteSelected(router: MediaRouter?, type: Int, info: MediaRouter.RouteInfo?) = lookSoon()

    override fun onRouteChanged(router: MediaRouter?, info: MediaRouter.RouteInfo?) = lookSoon()
  }

  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = lookSoon()

    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = lookSoon()
  }

  fun start() {
    router.addCallback(MediaRouter.ROUTE_TYPE_LIVE_AUDIO, routes)
    audio.registerAudioDeviceCallback(devices, main)
  }

  fun stop() {
    main.removeCallbacks(look)
    router.removeCallback(routes)
    audio.unregisterAudioDeviceCallback(devices)
  }

  private fun kindOf(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER,
    AudioDeviceInfo.TYPE_BLE_BROADCAST,
    AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY,
    AudioDeviceInfo.TYPE_AUX_LINE,
    AudioDeviceInfo.TYPE_LINE_ANALOG,
    AudioDeviceInfo.TYPE_LINE_DIGITAL,
    AudioDeviceInfo.TYPE_DOCK -> "wired"
    AudioDeviceInfo.TYPE_HDMI,
    AudioDeviceInfo.TYPE_HDMI_ARC,
    AudioDeviceInfo.TYPE_HDMI_EARC -> "tv"
    else -> "phone"
  }

  /** Older Androids don't say which one music goes to: then what's plugged in or paired beats the speaker. */
  private fun playingThrough(): AudioDeviceInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) audio.getAudioDevicesForAttributes(music).firstOrNull()
    else audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).minByOrNull { listOf("bluetooth", "wired", "tv", "phone").indexOf(kindOf(it.type)) }

  /** The name only for what isn't the phone itself. */
  fun current(): Map<String, String> {
    val device = playingThrough()
    val kind = device?.let { kindOf(it.type) } ?: "phone"
    val route = router.getSelectedRoute(MediaRouter.ROUTE_TYPE_LIVE_AUDIO).getName(context)?.toString().orEmpty()
    val name = when (kind) {
      "phone" -> ""
      // Only a Bluetooth device's own name is worth anything: on a cable it's the port's.
      "bluetooth" -> device?.productName?.toString()?.takeIf { it.isNotBlank() } ?: route
      else -> route
    }
    return mapOf("kind" to kind, "name" to name)
  }

  /** Android's list of outputs. It came to apps properly with Android 14; before that it's reached the way the system's own apps do, or Bluetooth's settings. */
  fun choose() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && MediaRouter2.getInstance(context).showSystemOutputSwitcher()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val dialog = Intent("com.android.systemui.action.LAUNCH_MEDIA_OUTPUT_DIALOG").setPackage("com.android.systemui").putExtra("package_name", context.packageName)
      if (context.packageManager.queryBroadcastReceivers(dialog, 0).any { it.activityInfo.exported }) {
        context.sendBroadcast(dialog)
        return
      }
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val panel = Intent("com.android.settings.panel.action.MEDIA_OUTPUT")
        .putExtra("com.android.settings.panel.extra.PACKAGE_NAME", context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (runCatching { context.startActivity(panel) }.isSuccess) return
    }
    runCatching { context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
  }

  private companion object {
    const val SETTLE_MS = 300L
  }
}
