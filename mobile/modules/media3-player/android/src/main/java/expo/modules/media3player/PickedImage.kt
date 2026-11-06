package expo.modules.media3player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** A picture chosen for a playlist, made small enough to travel with it (the computer does the same: lib/pickPicture.ts). */
internal object PickedImage {
  private const val MAX_SIDE = 1000
  private const val MAX_BYTES = 200_000

  /** The picture as a data: address; null when it can't be read as one. */
  fun asDataUrl(context: Context, uri: Uri): String? {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
    val decode = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, decode) } ?: return null
    // A photo says which way up it was taken; the pixels don't.
    val turn = resolver.openInputStream(uri)?.use { runCatching { ExifInterface(it) }.getOrNull() }
      ?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      ?: ExifInterface.ORIENTATION_NORMAL
    val upright = rotated(decoded, turn)
    var side = MAX_SIDE
    while (side >= 200) {
      val scale = minOf(1f, side.toFloat() / max(upright.width, upright.height))
      val sized = if (scale < 1f) Bitmap.createScaledBitmap(upright, (upright.width * scale).roundToInt().coerceAtLeast(1), (upright.height * scale).roundToInt().coerceAtLeast(1), true) else upright
      for (quality in intArrayOf(86, 72)) {
        val out = ByteArrayOutputStream()
        sized.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (out.size() <= MAX_BYTES) return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
      }
      side = (side * 0.75f).roundToInt()
    }
    return null
  }

  private fun rotated(bitmap: Bitmap, orientation: Int): Bitmap {
    val degrees = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
  }
}
