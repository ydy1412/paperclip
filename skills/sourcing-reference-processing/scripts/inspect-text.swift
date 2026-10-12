import Foundation
import Vision
import ImageIO

struct TextRegion: Codable {
    let text: String
    let confidence: Float
    let x: Int, y: Int, width: Int, height: Int
}
struct TextInspection: Codable {
    let width: Int, height: Int
    let regions: [TextRegion]
}
guard CommandLine.arguments.count == 2 else { exit(2) }
do {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width * image.height <= 16_000_000 else { exit(3) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let available = Set(try request.supportedRecognitionLanguages())
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ko-KR"].filter { available.contains($0) }
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    var regions: [TextRegion] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first,
              !candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
        let box = observation.boundingBox
        let x = max(0, Int(floor(box.minX * Double(image.width))))
        let y = max(0, Int(floor((1 - box.maxY) * Double(image.height))))
        let right = min(image.width, Int(ceil(box.maxX * Double(image.width))))
        let bottom = min(image.height, Int(ceil((1 - box.minY) * Double(image.height))))
        regions.append(TextRegion(text: candidate.string, confidence: candidate.confidence,
                                  x: x, y: y, width: max(1, right-x), height: max(1, bottom-y)))
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(TextInspection(
        width: image.width, height: image.height, regions: regions)))
} catch {
    FileHandle.standardError.write(Data("image_text_inspection_failed".utf8))
    exit(4)
}
