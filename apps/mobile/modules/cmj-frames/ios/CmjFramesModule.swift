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

  private func close() {
    asset = nil
    generator = nil
    openUrl = nil
  }
}
