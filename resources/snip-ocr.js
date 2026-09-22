// Read the text in a region of the screen, with the Vision framework.
//
//   osascript -l JavaScript snip-ocr.js <png-path> <width> <height> [language]
//
// The capture itself is done by /usr/sbin/screencapture before this runs, because
// grabbing the screen and recognising it are two different permissions and keeping
// them apart makes a refusal legible. This script only reads the file.
//
// Prints one line per recognised line of text:
//
//   x y w h<TAB>text
//
// in pixels relative to the top-left of the captured region, which is the same
// format resources/snip-ocr.ps1 prints on Windows so src/main/ocr.ts parses one
// thing. Vision reports normalised, bottom-left-origin boxes, so the conversion to
// region pixels happens here, where the region's size is known — that also makes the
// output independent of whether the capture came back at Retina scale.
//
// Errors go to stderr prefixed with ERROR:, and exit 1.

ObjC.import('Vision')
ObjC.import('Foundation')

/** Vision's accurate recogniser. Captions are small on screen and worth the ~200ms. */
var VN_ACCURATE = 0

function run(argv) {
  if (argv.length < 3) {
    return fail('usage: snip-ocr.js <png-path> <width> <height> [language]')
  }

  var path = argv[0]
  var width = parseFloat(argv[1])
  var height = parseFloat(argv[2])
  var language = argv[3] || 'en-US'

  if (!(width > 0) || !(height > 0)) return fail('the region has no size')

  var url = $.NSURL.fileURLWithPath(path)
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) {
    return fail('the screen capture produced no file')
  }

  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $())
  var request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = VN_ACCURATE
  request.usesLanguageCorrection = true
  try {
    request.recognitionLanguages = $([language])
  } catch (e) {
    // An unavailable language pack is not worth failing over — Vision falls back to
    // its default, which is English.
  }

  var ok = handler.performRequestsError($([request]), $())
  if (!ok) return fail('the text recogniser refused the image')

  var results = request.results
  if (!results || results.count === 0) return ''

  var lines = []
  for (var i = 0; i < results.count; i++) {
    var observation = results.objectAtIndex(i)
    var candidates = observation.topCandidates(1)
    if (!candidates || candidates.count === 0) continue
    var text = ObjC.unwrap(candidates.objectAtIndex(0).string)
    if (!text || !text.trim()) continue

    // Normalised, origin bottom-left. The caller thinks in pixels from the top-left.
    var box = observation.boundingBox
    var w = Math.round(box.size.width * width)
    var h = Math.round(box.size.height * height)
    var x = Math.round(box.origin.x * width)
    var y = Math.round((1 - box.origin.y - box.size.height) * height)
    lines.push([x, y, w, h].join(' ') + '\t' + text.replace(/[\r\n\t]+/g, ' ').trim())
  }
  return lines.join('\n')
}

function fail(message) {
  var stderr = $.NSFileHandle.fileHandleWithStandardError
  stderr.writeData($.NSString.alloc.initWithUTF8String('ERROR: ' + message + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
  $.exit(1)
}
