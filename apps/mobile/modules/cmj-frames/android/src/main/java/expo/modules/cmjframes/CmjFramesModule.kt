package expo.modules.cmjframes

import android.graphics.Bitmap
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

    /** Closes the open recording (the marking ended). */
    AsyncFunction("release") {
      synchronized(lock) { close() }
    }

    OnDestroy {
      synchronized(lock) { close() }
    }
  }
}
