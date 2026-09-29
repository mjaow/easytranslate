// Explicit opt-in: exercise the installed native host with the configured model.
// Defaults to a short excerpt; --transcript <file> uses a complete captured video.
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
if (!process.argv.includes('--live')) throw new Error('Pass --live to use the configured model API.')
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)))
let transcript = { videoId: 'testfixture', title: 'Verification fixture: excerpt of the supplied Thiel interview, 5:27–8:34 (not the full video)',
  language: 'en', automatic: true, duration: 187, source: 'caption-track', complete: true, segments: [
    { start: 0, duration: 12, text: "Let us for the sake of argument say that it is a real point. I think it's hard to argue that probabilities are 0% something." },
    { start: 12, duration: 45, text: "But it doesn't necessarily follow that you should always go slower and always go in the precautionary direction because if you do nothing, if there is no progress on any dimension, I don't think our societies work at all. The middle class in the US, Europe, they're the people who expect their children to do better than themselves. The intergenerational progressive compact in our society was that there was progress from one generation to the next." },
    { start: 59, duration: 30, text: "When that breaks down, I think the whole society starts to derange in very strange ways. There's a picture people implicitly have that the alternative to AI, a zero growth world where there's no progress at all, will somehow be this peaceful social democratic society. I don't think that's true. The alternative is also far from neutral." },
    { start: 98, duration: 16, text: "Interviewer: Slowing it down is just unrealistic or how could it work? If America is slowing down and China is accelerating, we are just strengthening China but it's not solving anything." },
    { start: 114, duration: 43, text: "Thiel: In theory you could slow it down if you had genuine deep cooperation across the whole world. But I think that would require a one world government with real teeth, real force. The classical liberal part of me thinks that's a frying pan into fire; it's a cure that's worse than the disease. You can have fake global governance with conferences and empty statements, and there's also a risk it ends up being slowed down in the West and not in China." },
    { start: 157, duration: 30, text: "Thiel: The Pope recently issued what I would characterize as an anti-AI encyclical. Maybe it was too harsh, but my rhetorical point is that the Communist Party of China is not going to listen to the Pope. There's a chance people in the US will. In effect, the encyclical was working for the Communist Party. I'm not saying he was an agent of the Communists, but he was acting as a useful idiot for the CCP." }
  ] }
if (process.argv.includes('--neutral')) transcript = {
  videoId: 'neutraltest', title: 'Synthetic fixture: bread fermentation (pipeline check, not a video benchmark)',
  language: 'en', automatic: false, duration: 120, source: 'caption-track', complete: true,
  segments: [
    { start: 0, duration: 20, text: 'Host: Is a warmer kitchen always better for making bread?' },
    { start: 20, duration: 20, text: 'Baker: Not always. Warmth speeds up fermentation, but speed is not my only goal. I prefer slower fermentation when I want more flavor.' },
    { start: 40, duration: 20, text: 'Baker: In my kitchen, a dough that takes two hours in summer may take four hours in winter. Those are examples from my kitchen, not a universal schedule.' },
    { start: 60, duration: 20, text: 'Host: So I should always wait four hours? Baker: No. Watch the dough instead of following a fixed clock. I look for expansion and bubbles, then test how it responds to a gentle touch.' },
    { start: 80, duration: 20, text: 'Baker: I have not compared different flour types in this experiment, so I cannot say whether the same timing applies to whole grain flour.' },
    { start: 100, duration: 20, text: 'Host: What should a beginner change first? Baker: Keep the recipe the same and record room temperature and rise time. Changing one variable at a time makes the result easier to interpret.' }
  ]
}
const transcriptOption = process.argv.indexOf('--transcript')
if (transcriptOption !== -1) {
  const file = process.argv[transcriptOption + 1]
  if (!file || file.startsWith('--')) throw new Error('--transcript needs a captured transcript JSON file.')
  if (process.argv.includes('--neutral')) throw new Error('Choose --transcript or --neutral, not both.')
  transcript = JSON.parse(readFileSync(file, 'utf8')) // Production validates completeness.
}
const planning = process.argv.includes('--watch-plan')
const preferences = { goal: 'understand', knownTopics: '', budgetMinutes: null }
const preferencesOption = process.argv.indexOf('--preferences')
if (preferencesOption !== -1) {
  if (!planning || !process.argv[preferencesOption + 1]) throw new Error('--preferences needs a JSON file and --watch-plan.')
  Object.assign(preferences, JSON.parse(readFileSync(process.argv[preferencesOption + 1], 'utf8')))
}
const child = spawn(process.execPath, ['out/native-host/bridge.cjs', `chrome-extension://${id}/`], { windowsHide: true })
let buffer = Buffer.alloc(0), done = false, lastStatus = ''
const started = performance.now()
// Allow worker startup in addition to the model's 3-minute overall deadline.
const timer = setTimeout(() => { child.kill(); console.error('Live model verification timed out.'); process.exitCode = 1 }, 205000)
child.stderr.on('data', b => process.stderr.write(b))
child.stdout.on('data', bytes => {
  buffer = Buffer.concat([buffer, bytes])
  while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
    const length = buffer.readUInt32LE(0)
    const event = JSON.parse(buffer.subarray(4, length + 4).toString()); buffer = buffer.subarray(length + 4)
    if (event.type === 'status' && event.message !== lastStatus) { lastStatus = event.message; console.log(event.message) }
    if (event.type === 'error') { console.error(event.message); console.log(JSON.stringify({ failedAfterMs: Math.round(performance.now() - started) })); process.exitCode = 1; clearTimeout(timer); child.stdin.end() }
    if (event.type === 'result') {
      mkdirSync('out/verification', { recursive: true })
      writeFileSync(`out/verification/live-${planning ? 'watch-plan' : transcriptOption !== -1 ? 'transcript' : process.argv.includes('--neutral') ? 'neutral' : 'video'}-analysis.json`, JSON.stringify(event.result, null, 2))
      console.log(JSON.stringify({ cached: event.cached === true, modelMs: event.timing?.modelMs, totalMs: Math.round(performance.now() - started) }))
      if (!process.argv.includes('--quiet')) console.log(JSON.stringify(event.result, null, 2))
      done = true; clearTimeout(timer); child.stdin.end()
    }
  }
})
child.on('exit', code => { clearTimeout(timer); if (!done || code) process.exitCode = 1 })
const body = Buffer.from(JSON.stringify({ id: 'live-excerpt', action: planning ? 'watch-plan' : 'analyze', transcript,
  ...(planning ? { preferences } : {}), fresh: process.argv.includes('--fresh') })), header = Buffer.alloc(4)
header.writeUInt32LE(body.length); child.stdin.write(Buffer.concat([header, body]))
