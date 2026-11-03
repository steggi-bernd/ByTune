package expo.modules.media3player

import android.os.SystemClock
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * How fast the connection delivers while the player wants data. Media3's own
 * meter divides what came by how long a transfer stayed open, and a download
 * stands still while the buffer is full: a paused FLAC reads as a dead line and
 * the next song comes as 64 kbps. Here only the time data could flow counts.
 */
@UnstableApi
object Throughput : TransferListener {
  private const val SAMPLE_BYTES = 256 * 1024L
  private const val SAMPLE_MS = 2000L
  private const val WINDOW_MS = 60_000L
  /** After a wait this much comes out of the socket's own buffer, at no speed at all. */
  private const val SKIP_AFTER_WAIT_BYTES = 256 * 1024L

  private class Sample(val at: Long, val bytes: Long, val ms: Long)
  private class Flow(var startedAt: Long) {
    var bytes = 0L
    var skip = 0L
  }

  private val flows = HashMap<DataSource, Flow>()
  private val samples = ArrayDeque<Sample>()
  private var known = 0L

  private fun now(): Long = SystemClock.elapsedRealtime()

  private fun note(flow: Flow, at: Long) {
    val ms = at - flow.startedAt
    if (flow.bytes > 0 && ms > 0) samples.addLast(Sample(at, flow.bytes, ms))
    flow.startedAt = at
    flow.bytes = 0
  }

  override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit

  @Synchronized
  override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
    if (isNetwork) flows[source] = Flow(now())
  }

  @Synchronized
  override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
    val flow = (if (isNetwork) flows[source] else null) ?: return
    val at = now()
    if (flow.skip > 0) {
      flow.skip -= bytesTransferred
      if (flow.skip <= 0) flow.startedAt = at
      return
    }
    flow.bytes += bytesTransferred
    if (flow.bytes >= SAMPLE_BYTES || at - flow.startedAt >= SAMPLE_MS) note(flow, at)
  }

  @Synchronized
  override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
    if (isNetwork) flows.remove(source)?.let { note(it, now()) }
  }

  /** The player has enough for now: what stands open stands still until it wants more. */
  @Synchronized
  fun playerWaits() {
    val at = now()
    for (flow in flows.values) {
      note(flow, at)
      flow.skip = SKIP_AFTER_WAIT_BYTES
    }
  }

  /** Another network: what was measured on the last one says nothing about this one. */
  @Synchronized
  fun forget() {
    samples.clear()
    known = 0
    val at = now()
    for (flow in flows.values) {
      flow.startedAt = at
      flow.bytes = 0
    }
  }

  /** 0 until something was measured on this network. */
  @Synchronized
  fun bitsPerSecond(): Long {
    val oldest = now() - WINDOW_MS
    while (samples.isNotEmpty() && samples.first().at < oldest) samples.removeFirst()
    if (samples.isNotEmpty()) known = samples.sumOf { it.bytes } * 8000 / samples.sumOf { it.ms }.coerceAtLeast(1)
    return known
  }
}
