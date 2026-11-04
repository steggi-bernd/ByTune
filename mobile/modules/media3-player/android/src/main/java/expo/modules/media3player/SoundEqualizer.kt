package expo.modules.media3player

import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.Equalizer
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * The equalizer: the same ten bands as on the computer. Since Android 9 the system
 * can do exactly those; before that, its built-in bands, each with the nearest gain.
 */
@UnstableApi
internal class SoundEqualizer {
  private var dynamics: Any? = null
  private var plain: Equalizer? = null
  private var session = C.AUDIO_SESSION_ID_UNSET

  fun apply(audioSession: Int) {
    if (audioSession != session) release()
    session = audioSession
    if (!PlaybackTuning.eqOn || audioSession == C.AUDIO_SESSION_ID_UNSET) {
      release()
      return
    }
    val bands = PlaybackTuning.eqBands
    val gains = PlaybackTuning.eqGains
    if (bands.isEmpty() || bands.size != gains.size) return
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) applyDynamics(audioSession, bands, gains)
      else applyPlain(audioSession, bands, gains)
    }
  }

  @RequiresApi(Build.VERSION_CODES.P)
  private fun applyDynamics(audioSession: Int, bands: IntArray, gains: FloatArray) {
    // A band reaches up to halfway to the next one, the last to the end of hearing.
    val edge = { i: Int -> if (i + 1 < bands.size) sqrt(bands[i].toFloat() * bands[i + 1]) else 20_000f }
    val running = dynamics as? DynamicsProcessing
    if (running != null) {
      for (i in bands.indices) running.setPreEqBandAllChannelsTo(i, DynamicsProcessing.EqBand(true, edge(i), gains[i]))
      return
    }
    val config = DynamicsProcessing.Config.Builder(DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION, 2, true, bands.size, false, 0, false, 0, false)
      .setPreferredFrameDuration(10f)
      .build()
    val eq = DynamicsProcessing.Eq(true, true, bands.size)
    for (i in bands.indices) eq.setBand(i, DynamicsProcessing.EqBand(true, edge(i), gains[i]))
    config.setPreEqAllChannelsTo(eq)
    dynamics = DynamicsProcessing(0, audioSession, config).apply { enabled = true }
  }

  private fun applyPlain(audioSession: Int, bands: IntArray, gains: FloatArray) {
    val eq = plain ?: Equalizer(0, audioSession).also { plain = it }
    val (lowest, highest) = eq.bandLevelRange.let { it[0].toInt() to it[1].toInt() }
    for (band in 0 until eq.numberOfBands) {
      val hz = eq.getCenterFreq(band.toShort()) / 1000
      val nearest = bands.indices.minByOrNull { abs(bands[it] - hz) } ?: continue
      eq.setBandLevel(band.toShort(), (gains[nearest] * 100).toInt().coerceIn(lowest, highest).toShort())
    }
    eq.enabled = true
  }

  fun release() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) (dynamics as? DynamicsProcessing)?.let { runCatching { it.release() } }
    dynamics = null
    plain?.let { runCatching { it.release() } }
    plain = null
  }
}
