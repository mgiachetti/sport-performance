package expo.modules.cmjframes

import android.graphics.Bitmap
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class CmjFrameException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

/** Frame times `inspect` hands back at most (83 s at 240 fps); the samples are all counted. */
private const val MAX_FRAME_TIMES = 20_000

/**
 * Exact frames and duration of a CMJ recording (B-604, ADR 0085).
 *
 * `MediaMetadataRetriever.getFrameAtTime` with `OPTION_CLOSEST` decodes from the
 * previous key frame up to the frame at the asked time: the frame itself, not the
 * nearest key frame (`OPTION_CLOSEST_SYNC`, about one per second, which is what
 * `expo-video-thumbnails` asks for). The retriever of the last recording stays
 * open between calls, so stepping frame by frame does not reopen the file.
 */
class CmjFramesModule : Module() {
  private val lock = Any()
  private var retriever: MediaMetadataRetriever? = null
  private var openPath: String? = null

  private fun pathOf(uri: String): String {
    val parsed = Uri.parse(uri)
    return if (parsed.scheme == null || parsed.scheme == "file") {
      parsed.path ?: throw CmjFrameException("Invalid video URI")
    } else {
      throw CmjFrameException("Only local video files are supported")
    }
  }

  private fun retrieverFor(uri: String): MediaMetadataRetriever {
    val path = pathOf(uri)
    val current = retriever
    if (current != null && openPath == path) return current
    close()
    val created = MediaMetadataRetriever()
    try {
      created.setDataSource(path)
    } catch (e: Exception) {
      created.release()
      throw CmjFrameException("Unable to open the video", e)
    }
    retriever = created
    openPath = path
    return created
  }

  private fun close() {
    try {
      retriever?.release()
    } catch (e: Exception) {
      // Already released: nothing left to free.
    }
    retriever = null
    openPath = null
  }

  /** `METADATA_KEY_CAPTURE_FRAMERATE`: the `com.android.capture.fps` the camera wrote, if any. */
  private fun captureFrameRate(path: String): Double? {
    val reader = MediaMetadataRetriever()
    return try {
      reader.setDataSource(path)
      reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)
        ?.toDoubleOrNull()
        ?.takeIf { it > 0 }
    } catch (e: Exception) {
      null
    } finally {
      try {
        reader.release()
      } catch (e: Exception) {
        // Released already.
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CmjFrames")

    /** Duration of the video track from the file's metadata, in ms. */
    AsyncFunction("durationMs") { uri: String ->
      synchronized(lock) {
        val value = retrieverFor(uri).extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
        value?.toDoubleOrNull() ?: throw CmjFrameException("The video has no duration")
      }
    }

    /** JPEG of the frame shown at `timeMs`, in the cache; returns its `file://` URI. */
    AsyncFunction("frameAt") { uri: String, timeMs: Double, quality: Double ->
      synchronized(lock) {
        val timeUs = Math.round(timeMs * 1000.0)
        val bitmap = retrieverFor(uri).getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
          ?: throw CmjFrameException("Could not decode the frame")
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        val directory = File(context.cacheDir, "CmjFrames")
        directory.mkdirs()
        val file = File(directory, "${UUID.randomUUID()}.jpg")
        try {
          FileOutputStream(file).use { output ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, (quality * 100).toInt().coerceIn(1, 100), output)
          }
        } finally {
          bitmap.recycle()
        }
        Uri.fromFile(file).toString()
      }
    }

    /**
     * Timing of a video taken from the gallery (ADR 0102): the presentation time of
     * its first video samples (up to [MAX_FRAME_TIMES], in decode order), how many
     * samples the track has, its duration, the frame rate the container declares and
     * the capture rate the camera wrote (`com.android.capture.fps`, which a file
     * re-timed for slow playback keeps). Reads the demuxed samples: nothing is decoded.
     */
    AsyncFunction("inspect") { uri: String ->
      val path = pathOf(uri)
      val extractor = MediaExtractor()
      try {
        try {
          extractor.setDataSource(path)
        } catch (e: Exception) {
          throw CmjFrameException("Unable to open the video", e)
        }
        val track = (0 until extractor.trackCount).firstOrNull { index ->
          extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
        } ?: throw CmjFrameException("The file has no video track")
        val format = extractor.getTrackFormat(track)
        extractor.selectTrack(track)
        val times = ArrayList<Double>()
        var count = 0
        while (true) {
          val time = extractor.sampleTime
          if (time < 0) break
          count++
          if (times.size < MAX_FRAME_TIMES) times.add(time.toDouble())
          if (!extractor.advance()) break
        }
        val nominalFps = if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) {
          try {
            format.getInteger(MediaFormat.KEY_FRAME_RATE).toDouble()
          } catch (e: ClassCastException) {
            format.getFloat(MediaFormat.KEY_FRAME_RATE).toDouble()
          }
        } else {
          null
        }
        val durationMs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
          format.getLong(MediaFormat.KEY_DURATION) / 1000.0
        } else {
          0.0
        }
        val result = mutableMapOf<String, Any>(
          "frameTimesUs" to times,
          "sampleCount" to count,
          "durationMs" to durationMs,
          "sizeBytes" to File(path).length().toDouble()
        )
        nominalFps?.let { result["nominalFps"] = it }
        captureFrameRate(path)?.let { result["captureFps"] = it }
        result
      } finally {
        extractor.release()
      }
    }

    /** Closes the open recording (the marking ended). */
    AsyncFunction("release") {
      synchronized(lock) { close() }
    }

    OnDestroy {
      synchronized(lock) { close() }
    }
  }
}
