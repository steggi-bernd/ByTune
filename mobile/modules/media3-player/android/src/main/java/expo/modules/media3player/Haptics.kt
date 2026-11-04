package expo.modules.media3player

import android.content.Context
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * What a swipe feels like. Phones with a good motor get Android's own primitives
 * (a rise that builds up, a thud at its end); others the nearest they can do.
 */
internal object Haptics {
  private fun vibrator(context: Context): Vibrator =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) context.getSystemService(VibratorManager::class.java).defaultVibrator
    else context.getSystemService(Vibrator::class.java)

  private fun buzz(vibrator: Vibrator, effect: VibrationEffect) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
    } else {
      vibrator.vibrate(effect)
    }
  }

  /** The primitives in a row, when this phone has them all. */
  private fun composed(vibrator: Vibrator, vararg steps: Triple<Int, Float, Int>): VibrationEffect? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    if (!vibrator.areAllPrimitivesSupported(*steps.map { it.first }.toIntArray())) return null
    val composition = VibrationEffect.startComposition()
    for ((primitive, scale, delay) in steps) composition.addPrimitive(primitive, scale, delay)
    return composition.compose()
  }

  private fun predefined(id: Int, millis: Long, amplitude: Int): VibrationEffect =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) VibrationEffect.createPredefined(id) else VibrationEffect.createOneShot(millis, amplitude)

  /** A build-up over about half a second: stronger and stronger steps where the motor can, closer pulses where it can't. */
  private fun rising(vibrator: Vibrator): VibrationEffect {
    if (vibrator.hasAmplitudeControl()) {
      val timings = longArrayOf(70, 70, 70, 70, 70, 70, 70)
      val amplitudes = intArrayOf(20, 40, 65, 95, 130, 170, 215)
      return VibrationEffect.createWaveform(timings, amplitudes, -1)
    }
    return VibrationEffect.createWaveform(longArrayOf(0, 25, 150, 25, 100, 25, 60, 30), -1)
  }

  fun play(context: Context, kind: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val vibrator = vibrator(context)
    if (!vibrator.hasVibrator()) return
    if (kind == "cancel") {
      vibrator.cancel()
      return
    }
    val sdkR = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
    val effect = when (kind) {
      "tick" ->
        (if (sdkR) composed(vibrator, Triple(VibrationEffect.Composition.PRIMITIVE_TICK, 0.7f, 0)) else null)
          ?: predefined(VibrationEffect.EFFECT_TICK, 12, 90)
      "press" ->
        (if (sdkR) composed(vibrator, Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.55f, 0)) else null)
          ?: predefined(VibrationEffect.EFFECT_CLICK, 16, 120)
      "arm" ->
        (if (sdkR) composed(vibrator, Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.8f, 0)) else null)
          ?: predefined(VibrationEffect.EFFECT_CLICK, 20, 140)
      "charge" ->
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          composed(
            vibrator,
            Triple(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.5f, 0),
            Triple(VibrationEffect.Composition.PRIMITIVE_SLOW_RISE, 0.9f, 20)
          )
        } else {
          null
        }) ?: rising(vibrator)
      "charged" ->
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          composed(
            vibrator,
            Triple(VibrationEffect.Composition.PRIMITIVE_THUD, 1f, 0),
            Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 30)
          )
        } else {
          null
        }) ?: predefined(VibrationEffect.EFFECT_HEAVY_CLICK, 60, 255)
      else ->
        (if (sdkR) {
          composed(
            vibrator,
            Triple(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 0),
            Triple(VibrationEffect.Composition.PRIMITIVE_TICK, 0.7f, 70)
          )
        } else {
          null
        }) ?: predefined(VibrationEffect.EFFECT_DOUBLE_CLICK, 40, 200)
    }
    runCatching { buzz(vibrator, effect) }
  }
}
