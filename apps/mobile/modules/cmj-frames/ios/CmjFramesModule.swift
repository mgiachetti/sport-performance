import ExpoModulesCore
import AVFoundation
import UIKit

internal final class CmjFrameException: GenericException<String> {
  override var reason: String {
    "CMJ frame: \(param)"
  }
}

/**
 Exact frames and duration of a CMJ recording (B-604, ADR 0085).

 `AVAssetImageGenerator` with both time tolerances at zero decodes the frame at the
 asked time, never the nearest key frame. The generator of the last recording is
 kept between calls, so stepping frame by frame does not reopen the file.
 */
public class CmjFramesModule: Module {
  // Frame times `inspect` hands back at most (83 s at 240 fps); the samples are all counted.
  static let maxFrameTimes = 20_000
  private let queue = DispatchQueue(label: "expo.modules.cmjframes")
  private var openUrl: URL?
  private var asset: AVURLAsset?
  private var generator: AVAssetImageGenerator?

  public func definition() -> ModuleDefinition {
    Name("CmjFrames")

    // Duration of the recording from the file's metadata, in ms.
    AsyncFunction("durationMs") { (uri: URL) throws -> Double in
      try self.queue.sync {
        let duration = try self.open(uri).asset.duration
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
          throw CmjFrameException("the video has no duration")
        }
        return seconds * 1000
      }
    }

    // JPEG of the frame shown at `timeMs`, in the cache; returns its `file://` URI.
    AsyncFunction("frameAt") { (uri: URL, timeMs: Double, quality: Double) throws -> String in
      try self.queue.sync {
        let opened = try self.open(uri)
        let time = CMTime(seconds: timeMs / 1000, preferredTimescale: 600_000)
        let image = try opened.generator.copyCGImage(at: time, actualTime: nil)
        guard let data = UIImage(cgImage: image).jpegData(compressionQuality: CGFloat(quality)) else {
          throw CmjFrameException("cannot encode the frame")
        }
        guard let cache = self.appContext?.config.cacheDirectory else {
          throw CmjFrameException("no cache directory")
        }
        let directory = cache.appendingPathComponent("CmjFrames")
        FileSystemUtilities.ensureDirExists(at: directory)
        let fileUrl = directory.appendingPathComponent(UUID().uuidString.appending(".jpg"))
        do {
          try data.write(to: fileUrl, options: .atomic)
        } catch let error {
          throw CmjFrameException(error.localizedDescription)
        }
        return fileUrl.absoluteString
      }
    }

    // Timing of a video taken from the gallery (ADR 0102): the presentation time of
    // its first video samples (in decode order), how many samples the track has, its
    // duration, the rate the track declares and a capture rate in the metadata, if
    // the camera wrote one. Reads the samples without decoding them.
    AsyncFunction("inspect") { (uri: URL) throws -> [String: Any] in
      try self.queue.sync {
        try self.inspect(uri)
      }
    }

    // Closes the open recording (the marking ended).
    AsyncFunction("release") {
      self.queue.sync {
        self.close()
      }
    }
  }

  private func open(_ url: URL) throws -> (asset: AVURLAsset, generator: AVAssetImageGenerator) {
    if let asset, let generator, openUrl == url {
      return (asset, generator)
    }
    guard url.isFileURL else {
      throw CmjFrameException("only local video files are supported")
    }
    let created = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let createdGenerator = AVAssetImageGenerator(asset: created)
    createdGenerator.appliesPreferredTrackTransform = true
    createdGenerator.requestedTimeToleranceBefore = .zero
    createdGenerator.requestedTimeToleranceAfter = .zero
    asset = created
    generator = createdGenerator
    openUrl = url
    return (created, createdGenerator)
  }

  private func inspect(_ url: URL) throws -> [String: Any] {
    guard url.isFileURL else {
      throw CmjFrameException("only local video files are supported")
    }
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw CmjFrameException("the file has no video track")
    }
    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch let error {
      throw CmjFrameException(error.localizedDescription)
    }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw CmjFrameException("cannot read the video track")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw CmjFrameException(reader.error?.localizedDescription ?? "cannot read the video")
    }
    var times: [Double] = []
    var count = 0
    while let sample = output.copyNextSampleBuffer() {
      guard CMSampleBufferGetNumSamples(sample) > 0 else { continue }
      count += 1
      let time = CMSampleBufferGetPresentationTimeStamp(sample)
      if times.count < CmjFramesModule.maxFrameTimes && time.isNumeric {
        times.append(CMTimeGetSeconds(time) * 1_000_000)
      }
    }
    reader.cancelReading()
    var result: [String: Any] = [
      "frameTimesUs": times,
      "sampleCount": count,
      "durationMs": CMTimeGetSeconds(track.timeRange.duration) * 1000,
      "nominalFps": Double(track.nominalFrameRate)
    ]
    if let capture = captureFrameRate(asset) {
      result["captureFps"] = capture
    }
    if let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber {
      result["sizeBytes"] = size.doubleValue
    }
    return result
  }

  // A capture rate in the metadata (`com.android.capture.fps` in files from Android).
  private func captureFrameRate(_ asset: AVURLAsset) -> Double? {
    for item in asset.metadata {
      let key = (item.key as? String) ?? item.identifier?.rawValue ?? ""
      guard key.contains("capture.fps") else { continue }
      if let number = item.numberValue, number.doubleValue > 0 {
        return number.doubleValue
      }
      if let text = item.stringValue, let value = Double(text), value > 0 {
        return value
      }
    }
    return nil
  }

  private func close() {
    asset = nil
    generator = nil
    openUrl = nil
  }
}
