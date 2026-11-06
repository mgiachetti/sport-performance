package expo.modules.highspeedcamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Range
import android.view.OrientationEventListener
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.Collections
import java.util.UUID
import java.util.WeakHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToInt

/** The props of the view, as React sends them. */
data class HighSpeedProps(
  val cameraId: String = "",
  val width: Int = 0,
  val height: Int = 0,
  val fps: Int = 0,
  val maxDurationMs: Int = 0,
  val maxFileSizeBytes: Long = 0L,
  /** Orientation of the recording: the phone's (`true`) or the interface's. */
  val followDevice: Boolean = false,
  val active: Boolean = false,
  val recording: Boolean = false
) {
  val valid: Boolean
    get() = cameraId.isNotEmpty() && width > 0 && height > 0 && fps > 0

  /** What the session is opened with: a change reopens it. */
  val sessionKey: String
    get() = "$cameraId:${width}x$height@$fps"
}

/** What the camera thread is asked to reach (taken on the main thread). */
private data class Desired(
  val props: HighSpeedProps,
  val run: Boolean,
  val surface: Surface?,
  val orientationHint: Int
)

/**
 * Preview + MP4 recorder over a constrained high-speed session (ADR 0102).
 *
 * The session holds two surfaces at the high-speed size (the most it accepts):
 * the preview (`SurfaceView` with a fixed buffer size) and a persistent input
 * surface (`MediaCodec.createPersistentInputSurface`) that each `MediaRecorder`
 * records from, so a new recording needs no new session. The recording runs at
 * the fixed `[fps, fps]` the high-speed session requires (also given as session
 * parameters on API 28+, a hint for the sensor mode); the preview runs at the
 * widest variable range ending at `fps`, because Samsung's HAL aborts on a
 * preview-only burst at the fixed range. No audio.
 *
 * Threads: props, surface and layout on the main thread; every camera and
 * recorder call on one camera thread, which reconciles what it runs with the
 * last `Desired` it was sent. Events go back on the main thread.
 */
@SuppressLint("ViewConstructor")
class HighSpeedCameraView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback {

  private val onReady by EventDispatcher()
  private val onRecorded by EventDispatcher()
  private val onError by EventDispatcher()

  var props = HighSpeedProps()

  // Main thread state.
  private val mainHandler = Handler(Looper.getMainLooper())
  private val surfaceView = SurfaceView(context)
  private var appliedSize: Pair<Int, Int>? = null
  private var surfaceReady = false
  private var hostPaused = false
  private var attached = false
  private var destroyed = false
  private var deviceDegrees = 0
  private var sensorOrientation = 90
  private var sensorCameraId: String? = null

  private val orientationListener = object : OrientationEventListener(context) {
    override fun onOrientationChanged(orientation: Int) {
      if (orientation == ORIENTATION_UNKNOWN) return
      deviceDegrees = ((orientation + 45) / 90 * 90) % 360
    }
  }

  // Camera thread state.
  private val cameraThread = HandlerThread("HighSpeedCamera").apply { start() }
  private val cameraHandler = Handler(cameraThread.looper)
  private val cameraExecutor = Executor { command -> cameraHandler.post(command) }
  private var latest: Desired? = null
  /** Bumped on every close: callbacks of an older camera or session are ignored. */
  private var generation = 0
  private var openKey: String? = null
  private var openSurface: Surface? = null
  private var device: CameraDevice? = null
  private var session: CameraConstrainedHighSpeedCaptureSession? = null
  private var recorderSurface: Surface? = null
  private var previewRequests: List<CaptureRequest>? = null
  private var recordRequests: List<CaptureRequest>? = null
  private var recorder: MediaRecorder? = null
  private var recordingFile: File? = null
  private var recordingFps = 0
  /**
   * A recording ran for the current `recording = true`: one that stopped alone
   * (maximum duration) does not start again until React sets it to `false`.
   */
  private var recordedForRequest = false

  /**
   * When the session was configured and when its first preview result arrived
   * (`elapsedRealtime` ms, 0 = not yet), on the camera thread only. A camera
   * that fails after the session was configured but before [STABLE_PREVIEW_MS]
   * of preview, with no recording, failed with this configuration (the vendor
   * HAL rejected it, as Samsung's does with some ranges): the error is a
   * `configure_failed`, so the screen tries the next candidate.
   */
  private var configuredAtMs = 0L
  private var firstPreviewAtMs = 0L
  private val previewCounter = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(s: CameraCaptureSession, r: CaptureRequest, t: TotalCaptureResult) {
      // A late result of a session already closed does not count for the new one.
      if (s === session && firstPreviewAtMs == 0L) firstPreviewAtMs = SystemClock.elapsedRealtime()
    }
  }

  init {
    surfaceView.holder.addCallback(this)
    addView(surfaceView)
    synchronized(live) { live.add(this) }
  }

  // region Main thread

  fun applyProps() {
    if (destroyed) return
    val current = props
    val size = current.width to current.height
    if (current.width > 0 && current.height > 0 && size != appliedSize) {
      appliedSize = size
      surfaceReady = false
      surfaceView.holder.setFixedSize(current.width, current.height)
    }
    if (current.cameraId.isNotEmpty() && current.cameraId != sensorCameraId) {
      sensorCameraId = current.cameraId
      sensorOrientation = try {
        cameraManager().getCameraCharacteristics(current.cameraId)
          .get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
      } catch (e: Exception) {
        90
      }
    }
    layoutPreview()
    reconcile()
  }

  fun setHostPaused(paused: Boolean) {
    if (hostPaused == paused) return
    hostPaused = paused
    reconcile()
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    synchronized(live) { live.remove(this) }
    orientationListener.disable()
    reconcile()
    cameraHandler.post {
      releaseRecorderSurface()
      cameraThread.quitSafely()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    if (orientationListener.canDetectOrientation()) orientationListener.enable()
    reconcile()
  }

  override fun onDetachedFromWindow() {
    attached = false
    orientationListener.disable()
    reconcile()
    super.onDetachedFromWindow()
  }

  override fun surfaceCreated(holder: SurfaceHolder) = Unit

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    // The session needs both surfaces at the high-speed size exactly.
    surfaceReady = width == props.width && height == props.height
    reconcile()
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    surfaceReady = false
    // The camera must let go of the surface before this returns.
    val done = CountDownLatch(1)
    val desired = desired()
    val posted = cameraThread.isAlive && cameraHandler.post {
      reconcileOnCameraThread(desired)
      done.countDown()
    }
    if (posted) done.await(2, TimeUnit.SECONDS)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    layoutPreview(r - l, b - t)
  }

  private fun layoutPreview(viewWidth: Int = width, viewHeight: Int = height) {
    if (viewWidth <= 0 || viewHeight <= 0) return
    val bufferWidth = props.width
    val bufferHeight = props.height
    var left = 0
    var top = 0
    var childWidth = viewWidth
    var childHeight = viewHeight
    if (bufferWidth > 0 && bufferHeight > 0) {
      // As shown on screen: the sensor is rotated against the display.
      val rotation = (sensorOrientation - displayDegrees() + 360) % 360
      val (shownWidth, shownHeight) =
        if (rotation == 90 || rotation == 270) bufferHeight to bufferWidth else bufferWidth to bufferHeight
      // The whole frame in view (the lines and the feet must be seen), centered.
      val scale = min(viewWidth.toFloat() / shownWidth, viewHeight.toFloat() / shownHeight)
      childWidth = (shownWidth * scale).roundToInt()
      childHeight = (shownHeight * scale).roundToInt()
      left = (viewWidth - childWidth) / 2
      top = (viewHeight - childHeight) / 2
    }
    surfaceView.measure(
      MeasureSpec.makeMeasureSpec(childWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(childHeight, MeasureSpec.EXACTLY)
    )
    surfaceView.layout(left, top, left + childWidth, top + childHeight)
  }

  @Suppress("DEPRECATION")
  private fun displayDegrees(): Int = when (display?.rotation ?: Surface.ROTATION_0) {
    Surface.ROTATION_90 -> 90
    Surface.ROTATION_180 -> 180
    Surface.ROTATION_270 -> 270
    else -> 0
  }

  /**
   * Rotation written to the MP4 (`setOrientationHint`) for a back camera:
   * the sensor's plus the phone's (`followDevice`) or the interface's.
   */
  private fun orientationHint(): Int {
    // Display rotation as the orientation of the phone that produces it.
    val interfaceDegrees = (360 - displayDegrees()) % 360
    val degrees = if (props.followDevice) deviceDegrees else interfaceDegrees
    return (sensorOrientation + degrees) % 360
  }

  private fun desired(): Desired {
    val current = props
    val run = !destroyed && attached && !hostPaused && current.active && current.valid && surfaceReady
    return Desired(
      props = current,
      run = run,
      surface = if (run) surfaceView.holder.surface else null,
      orientationHint = orientationHint()
    )
  }

  private fun reconcile() {
    val desired = desired()
    if (!cameraThread.isAlive) return
    cameraHandler.post { reconcileOnCameraThread(desired) }
  }

  private fun emit(block: () -> Unit) {
    mainHandler.post {
      if (!destroyed) block()
    }
  }

  // endregion

  // region Camera thread

  private fun reconcileOnCameraThread(desired: Desired) {
    latest = desired
    if (!desired.props.recording) recordedForRequest = false
    val key = openKey
    if (key != null && (!desired.run || key != desired.props.sessionKey || openSurface !== desired.surface)) {
      closeCamera(interrupted = true)
    }
    if (!desired.run) return
    if (openKey == null) {
      openCamera(desired)
    } else if (session != null) {
      syncRecording(desired)
    }
  }

  private fun syncRecording(desired: Desired) {
    if (desired.props.recording && recorder == null && !recordedForRequest) {
      startRecording(desired)
    } else if (!desired.props.recording && recorder != null) {
      stopRecording()
    }
  }

  @SuppressLint("MissingPermission")
  private fun openCamera(desired: Desired) {
    val surface = desired.surface ?: return
    if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      emitError("permission", "Camera permission not granted")
      return
    }
    val opened = ++generation
    configuredAtMs = 0L
    firstPreviewAtMs = 0L
    openKey = desired.props.sessionKey
    openSurface = surface
    try {
      cameraManager().openCamera(
        desired.props.cameraId,
        object : CameraDevice.StateCallback() {
          override fun onOpened(camera: CameraDevice) {
            if (opened != generation) {
              camera.close()
              return
            }
            device = camera
            createSession(camera, surface, desired.props, opened)
          }

          override fun onDisconnected(camera: CameraDevice) {
            camera.close()
            if (opened == generation) {
              // A disconnect before the session exists is another app taking the camera.
              val unstable = startingUp()
              closeCamera(interrupted = true)
              if (unstable) emitError("configure_failed", "The camera dropped right after starting")
              else emitError("disconnected", "The camera was taken by another app")
            }
          }

          override fun onError(camera: CameraDevice, error: Int) {
            camera.close()
            if (opened == generation) {
              // Only a device or service failure can be the configuration; a camera in use
              // or disabled keeps its own code (the next candidate would fail the same way).
              val unstable = startingUp() &&
                (error == CameraDevice.StateCallback.ERROR_CAMERA_DEVICE || error == CameraDevice.StateCallback.ERROR_CAMERA_SERVICE)
              closeCamera(interrupted = true)
              when {
                unstable -> emitError("configure_failed", "Camera error $error right after starting")
                error == CameraDevice.StateCallback.ERROR_CAMERA_IN_USE || error == CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE ->
                  emitError("camera_in_use", "Camera error $error")
                else -> emitError("camera_error", "Camera error $error")
              }
            }
          }
        },
        cameraHandler
      )
    } catch (e: Exception) {
      closeCamera(interrupted = false)
      emitError(if (e is CameraAccessException) "camera_in_use" else "camera_error", e.message)
    }
  }

  @Suppress("DEPRECATION")
  private fun createSession(camera: CameraDevice, preview: Surface, props: HighSpeedProps, opened: Int) {
    try {
      val input = MediaCodec.createPersistentInputSurface()
      // Owned from here on: `closeCamera` releases it even if what follows throws.
      recorderSurface = input
      // A recorder prepared once sets the buffers of the surface (size, rate) before the session.
      val probe = File(outputDirectory(), "probe-${UUID.randomUUID()}.mp4")
      var probeRecorder: MediaRecorder? = null
      try {
        probeRecorder = newRecorder(input, probe, props, orientationHint = 0, limits = false)
        probeRecorder.prepare()
      } finally {
        probeRecorder?.release()
        probe.delete()
      }
      val surfaces = listOf(preview, input)
      val callback = object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(configured: CameraCaptureSession) {
          if (opened != generation) {
            configured.close()
            return
          }
          try {
            val highSpeed = configured as CameraConstrainedHighSpeedCaptureSession
            session = highSpeed
            // The preview at a variable range ending at `fps` (a fixed one aborts Samsung's
            // HAL); the recording at the fixed `[fps, fps]` the high-speed session requires.
            previewRequests = requests(
              highSpeed,
              CameraDevice.TEMPLATE_PREVIEW,
              listOf(preview),
              previewRange(camera.id, props)
            )
            recordRequests = requests(
              highSpeed,
              CameraDevice.TEMPLATE_RECORD,
              listOf(preview, input),
              Range(props.fps, props.fps)
            )
            configuredAtMs = SystemClock.elapsedRealtime()
            firstPreviewAtMs = 0L
            highSpeed.setRepeatingBurst(previewRequests!!, previewCounter, cameraHandler)
            emit {
              onReady(mapOf("fps" to props.fps, "width" to props.width, "height" to props.height))
            }
            latest?.let { syncRecording(it) }
          } catch (e: Exception) {
            closeCamera(interrupted = false)
            emitError("configure_failed", e.message)
          }
        }

        override fun onConfigureFailed(configured: CameraCaptureSession) {
          configured.close()
          if (opened == generation) {
            closeCamera(interrupted = false)
            emitError("configure_failed", "The high-speed session was not configured")
          }
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val configuration = SessionConfiguration(
          SessionConfiguration.SESSION_HIGH_SPEED,
          surfaces.map { OutputConfiguration(it) },
          cameraExecutor,
          callback
        )
        // The recording request as session parameters: a hint for the sensor mode at
        // session creation. The preview's variable range may still make the HAL switch
        // modes when recording starts (a few frames lost, see ADR 0102).
        val parameters = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
        surfaces.forEach { parameters.addTarget(it) }
        parameters.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(props.fps, props.fps))
        configuration.sessionParameters = parameters.build()
        camera.createCaptureSession(configuration)
      } else {
        camera.createConstrainedHighSpeedCaptureSession(surfaces, callback, cameraHandler)
      }
    } catch (e: Exception) {
      closeCamera(interrupted = false)
      emitError("configure_failed", e.message)
    }
  }

  /**
   * The session was configured, nothing is recording, and the preview has not
   * run [STABLE_PREVIEW_MS] since its first frame: too soon to call the
   * configuration stable.
   */
  private fun startingUp(): Boolean {
    if (recorder != null || configuredAtMs == 0L) return false
    val first = firstPreviewAtMs
    return first == 0L || SystemClock.elapsedRealtime() - first < STABLE_PREVIEW_MS
  }

  /**
   * The preview's range: the widest one the camera lists for this size that
   * ends at the recording rate (`[30, 240]` on the S24 Ultra), never the fixed
   * `[fps, fps]`. Samsung's camera HAL aborts (its whole service restarts)
   * with a preview-only burst at a fixed high-speed range, while a variable
   * preview and then the fixed range for the recording record at the full rate.
   */
  private fun previewRange(cameraId: String, props: HighSpeedProps): Range<Int> {
    val map = cameraManager().getCameraCharacteristics(cameraId)
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    val ranges = try {
      map?.getHighSpeedVideoFpsRangesFor(android.util.Size(props.width, props.height))
    } catch (e: IllegalArgumentException) {
      null
    }
    val variable = ranges?.filter { it.upper == props.fps && it.lower < it.upper }?.minByOrNull { it.lower }
    return variable ?: Range(props.fps, props.fps)
  }

  private fun requests(
    highSpeed: CameraConstrainedHighSpeedCaptureSession,
    template: Int,
    targets: List<Surface>,
    range: Range<Int>
  ): List<CaptureRequest> {
    val builder = highSpeed.device.createCaptureRequest(template)
    targets.forEach { builder.addTarget(it) }
    builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
    return highSpeed.createHighSpeedRequestList(builder.build())
  }

  private fun startRecording(desired: Desired) {
    val highSpeed = session ?: return
    val input = recorderSurface ?: return
    val burst = recordRequests ?: return
    recordedForRequest = true
    val file = File(outputDirectory(), "${UUID.randomUUID()}.mp4")
    var created: MediaRecorder? = null
    try {
      val started = newRecorder(input, file, desired.props, desired.orientationHint, limits = true)
      created = started
      started.setOnInfoListener { _, what, _ ->
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED ||
          what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED
        ) {
          cameraHandler.post { if (recorder === started) stopRecording() }
        }
      }
      started.setOnErrorListener { _, what, _ ->
        cameraHandler.post {
          if (recorder === started) {
            abortRecording()
            emitError("recorder_failed", "Recorder error $what")
          }
        }
      }
      started.prepare()
      highSpeed.setRepeatingBurst(burst, null, cameraHandler)
      started.start()
      recorder = started
      recordingFile = file
      recordingFps = desired.props.fps
    } catch (e: Exception) {
      created?.release()
      file.delete()
      recorder = null
      recordingFile = null
      backToPreview()
      emitError("recorder_failed", e.message)
    }
  }

  /** Stops the recording and hands the file to React. */
  private fun stopRecording() {
    val stopping = recorder ?: return
    recorder = null
    val file = recordingFile
    recordingFile = null
    try {
      stopping.stop()
    } catch (e: RuntimeException) {
      // Stopped already (maximum reached) or no frame: the file says which below.
    }
    stopping.release()
    backToPreview()
    if (file == null) return
    val summary = if (file.exists() && file.length() > 0) summarize(file) else null
    if (summary == null) {
      file.delete()
      emitError("no_frames", "The recording holds no frames")
      return
    }
    val fps = recordingFps
    emit {
      onRecorded(
        mapOf(
          "path" to file.absolutePath,
          "durationMs" to summary.durationMs,
          "frameRateFps" to fps,
          "measuredFps" to (summary.measuredFps ?: 0.0)
        )
      )
    }
  }

  /** Ends the recording without a file (the app left, the camera was lost). */
  private fun abortRecording() {
    val stopping = recorder ?: return
    recorder = null
    try {
      stopping.stop()
    } catch (e: RuntimeException) {
      // Nothing recorded yet.
    }
    stopping.release()
    recordingFile?.delete()
    recordingFile = null
  }

  private fun backToPreview() {
    val burst = previewRequests ?: return
    try {
      session?.setRepeatingBurst(burst, previewCounter, cameraHandler)
    } catch (e: Exception) {
      // The session closed meanwhile: nothing left to show.
    }
  }

  private fun closeCamera(interrupted: Boolean) {
    generation++
    if (recorder != null) {
      abortRecording()
      if (interrupted) emitError("interrupted", "The recording was interrupted")
    }
    try {
      session?.close()
    } catch (e: Exception) {
      // Closed already.
    }
    session = null
    try {
      device?.close()
    } catch (e: Exception) {
      // Closed already.
    }
    device = null
    previewRequests = null
    recordRequests = null
    openKey = null
    openSurface = null
    releaseRecorderSurface()
  }

  private fun releaseRecorderSurface() {
    recorderSurface?.release()
    recorderSurface = null
  }

  @Suppress("DEPRECATION")
  private fun newRecorder(
    input: Surface,
    file: File,
    props: HighSpeedProps,
    orientationHint: Int,
    limits: Boolean
  ): MediaRecorder {
    val created = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else MediaRecorder()
    created.setVideoSource(MediaRecorder.VideoSource.SURFACE)
    created.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    created.setOutputFile(file.absolutePath)
    created.setVideoEncodingBitRate(bitRate(props))
    // The file plays at the capture rate: its timeline is capture time.
    created.setVideoFrameRate(props.fps)
    created.setVideoSize(props.width, props.height)
    created.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
    created.setInputSurface(input)
    created.setOrientationHint(orientationHint)
    if (limits) {
      if (props.maxDurationMs > 0) created.setMaxDuration(props.maxDurationMs)
      if (props.maxFileSizeBytes > 0) created.setMaxFileSize(props.maxFileSizeBytes)
    }
    return created
  }

  /** About 0,08 bits per pixel per frame: 18 Mb/s at 720p240, 40 Mb/s at 1080p240. */
  private fun bitRate(props: HighSpeedProps): Int {
    val bits = props.width.toDouble() * props.height * props.fps * 0.08
    return bits.coerceIn(8_000_000.0, 80_000_000.0).toInt()
  }

  private class Summary(val durationMs: Double, val measuredFps: Double?)

  /** Duration and frames per second of the file's own timeline (what the marking counts). */
  private fun summarize(file: File): Summary? {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.absolutePath)
      val track = (0 until extractor.trackCount).firstOrNull { index ->
        extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
      } ?: return null
      extractor.selectTrack(track)
      var count = 0
      var first = Long.MAX_VALUE
      var last = Long.MIN_VALUE
      while (true) {
        val time = extractor.sampleTime
        if (time < 0) break
        count++
        if (time < first) first = time
        if (time > last) last = time
        if (!extractor.advance()) break
      }
      if (count == 0) return null
      val measured = if (count > 1 && last > first) (count - 1) * 1_000_000.0 / (last - first) else null
      val metadataMs = metadataDurationMs(file)
      val durationMs = metadataMs
        ?: if (measured != null) count * 1000.0 / measured else 1000.0 / recordingFps.coerceAtLeast(1)
      return Summary(durationMs, measured)
    } catch (e: Exception) {
      return null
    } finally {
      extractor.release()
    }
  }

  private fun metadataDurationMs(file: File): Double? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()
        ?.takeIf { it > 0 }
    } catch (e: Exception) {
      null
    } finally {
      try {
        retriever.release()
      } catch (e: Exception) {
        // Released already.
      }
    }
  }

  // endregion

  private fun outputDirectory(): File = File(context.cacheDir, "HighSpeedCamera").apply { mkdirs() }

  private fun cameraManager(): CameraManager =
    context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  private fun emitError(code: String, message: String?) {
    emit { onError(mapOf("code" to code, "message" to (message ?: code))) }
  }

  companion object {
    /** Preview time, from its first result, after which the configuration counts as stable. */
    private const val STABLE_PREVIEW_MS = 1_000L

    private val live: MutableSet<HighSpeedCameraView> =
      Collections.newSetFromMap(WeakHashMap<HighSpeedCameraView, Boolean>())

    /** Runs `block` on the main thread for every view on screen (activity paused or resumed). */
    fun forEachLive(block: (HighSpeedCameraView) -> Unit) {
      val views = synchronized(live) { live.toList() }
      val main = Handler(Looper.getMainLooper())
      views.forEach { view -> main.post { block(view) } }
    }
  }
}
