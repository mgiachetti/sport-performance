package expo.modules.highspeedcamera

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * High-speed video on Android (ADR 0102).
 *
 * Android hands 120 and 240 fps to third-party apps only through a constrained
 * high-speed session (`CameraConstrainedHighSpeedCaptureSession`), with the sizes
 * and ranges of `StreamConfigurationMap.getHighSpeedVideoSizes()` /
 * `getHighSpeedVideoFpsRangesFor(size)`; the normal AE ranges CameraX reports
 * (what `react-native-vision-camera` reads) stop at 30 or 60 on phones like the
 * Galaxy S24 Ultra. This module lists the back cameras with that capability and
 * exposes a preview + recorder view (`HighSpeedCameraView`).
 */
class HighSpeedCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HighSpeedCamera")

    /** Back cameras with constrained high-speed video: sizes and the ranges of each. */
    AsyncFunction("getCameras") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      listHighSpeedCameras(context)
    }

    View(HighSpeedCameraView::class) {
      Events("onReady", "onRecorded", "onError")

      Prop("cameraId") { view: HighSpeedCameraView, value: String ->
        view.props = view.props.copy(cameraId = value)
      }
      Prop("videoWidth") { view: HighSpeedCameraView, value: Int ->
        view.props = view.props.copy(width = value)
      }
      Prop("videoHeight") { view: HighSpeedCameraView, value: Int ->
        view.props = view.props.copy(height = value)
      }
      Prop("fps") { view: HighSpeedCameraView, value: Int ->
        view.props = view.props.copy(fps = value)
      }
      Prop("maxDurationMs") { view: HighSpeedCameraView, value: Int ->
        view.props = view.props.copy(maxDurationMs = value)
      }
      Prop("maxFileSizeBytes") { view: HighSpeedCameraView, value: Double ->
        view.props = view.props.copy(maxFileSizeBytes = value.toLong())
      }
      Prop("orientation") { view: HighSpeedCameraView, value: String ->
        view.props = view.props.copy(followDevice = value == "device")
      }
      Prop("active") { view: HighSpeedCameraView, value: Boolean ->
        view.props = view.props.copy(active = value)
      }
      Prop("recording") { view: HighSpeedCameraView, value: Boolean ->
        view.props = view.props.copy(recording = value)
      }

      OnViewDidUpdateProps { view: HighSpeedCameraView ->
        view.applyProps()
      }

      OnViewDestroys { view: HighSpeedCameraView ->
        view.destroy()
      }
    }

    OnActivityEntersBackground {
      HighSpeedCameraView.forEachLive { it.setHostPaused(true) }
    }

    OnActivityEntersForeground {
      HighSpeedCameraView.forEachLive { it.setHostPaused(false) }
    }
  }
}

internal fun listHighSpeedCameras(context: Context): List<Map<String, Any>> {
  val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
  val cameras = mutableListOf<Map<String, Any>>()
  for (id in manager.cameraIdList) {
    val characteristics = try {
      manager.getCameraCharacteristics(id)
    } catch (e: Exception) {
      continue
    }
    if (characteristics.get(CameraCharacteristics.LENS_FACING) != CameraMetadata.LENS_FACING_BACK) continue
    val capabilities = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: continue
    if (!capabilities.contains(
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO
      )
    ) {
      continue
    }
    val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: continue
    val sizes = try {
      map.highSpeedVideoSizes.map { size ->
        mapOf(
          "width" to size.width,
          "height" to size.height,
          "fpsRanges" to map.getHighSpeedVideoFpsRangesFor(size).map { range ->
            mapOf("min" to range.lower, "max" to range.upper)
          }
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
    if (sizes.isEmpty()) continue
    cameras.add(mapOf("id" to id, "sizes" to sizes))
  }
  return cameras
}
