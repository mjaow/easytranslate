import { clockTime, type VideoAnalysis, type VideoAnswer, type VideoCacheClearResult, type VideoEvent, type VideoIdea, type VideoRequest, type VideoTranscript } from '../src/shared/video.js'
import type { PanelTarget } from './background.js'
import { VideoNativeClient } from './native-client.js'
import { SummaryTiming } from './summary-timing.js'
import { analysisText, hasDetail } from '../src/shared/video-export.js'
import { WatchPlanPanel } from './watch-plan-panel.js'

const get = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
let target: PanelTarget | null = null
let transcript: VideoTranscript | null = null
let english: VideoAnalysis | null = null
let chinese: VideoAnalysis | null = null
let displayedAnalysis: VideoAnalysis | null = null
const nativeClient = new VideoNativeClient()
let generation = 0
let busy = false
let refreshNext = false
let lastStartToken = ''
const timing = new SummaryTiming()
const history: { question: string; answer: string }[] = []
let watchPanel: WatchPlanPanel

function status(message: string): void { get('status').textContent = message }
function error(message: string): void { get('error').textContent = message; get('error').hidden = false }
function renderVideoTitle(): void {
  // Captured player metadata belongs to the checked video ID; tab titles can lag.
  const title = transcript?.videoId === target?.videoId && transcript?.title.trim() ? transcript.title : target?.title ?? ''
  get('video-title').textContent = target?.videoId ? title.replace(/ - YouTube$/, '') : 'Open a YouTube video to get started.'
}
function setBusy(value: boolean): void {
  busy = value
  for (const id of ['chinese', 'ask', 'clear-cache']) get<HTMLButtonElement>(id).disabled = value
  get<HTMLButtonElement>('understand').disabled = value || !target?.videoId
  get('understand').textContent = refreshNext ? 'Summarize again' : 'Understand video'
  get('understand').title = refreshNext ? 'Make a fresh model request to compare speed.' : 'Summarize the complete transcript.'
  get('cancel').hidden = !value
  get<HTMLButtonElement>('copy-summary').disabled = value || !displayedAnalysis
  watchPanel?.setBusy(value)
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.textContent = text; e.className = className; return e
}
function stop(releaseHelper = true): void {
  generation++
  timing.stop('Cancelled')
  if (releaseHelper) nativeClient.disconnect()
  else nativeClient.cancelPending()
  setBusy(false)
}
function sourceButtons(ids: number[], initial = 3): HTMLElement {
  const box = element('div', '', 'sources')
  if (!transcript || !target) return box
  const snapshot = transcript
  const tabId = target.tabId
  const unique = [...new Set(ids)]
  const addSource = (id: number): void => {
    const s = snapshot.segments[id - 1]
    if (!s) return
    const b = element('button', clockTime(s.start), 'timestamp')
    b.title = s.text
    b.addEventListener('click', () => {
      void chrome.scripting.executeScript({ target: { tabId }, func: (videoId: string, seconds: number) => {
        if (new URL(location.href).searchParams.get('v') !== videoId) return false
        const video = document.querySelector('video')
        if (!video) return false
        video.currentTime = seconds
        return true
      }, args: [snapshot.videoId, s.start] }).then(r => { if (!r[0]?.result) error('Open the original video before jumping to its timestamps.') }).catch(e => error(String(e)))
    })
    box.append(b)
  }
  unique.slice(0, initial).forEach(addSource)
  if (unique.length > initial) {
    const more = element('button', `+${unique.length - initial} sources`, 'timestamp')
    more.addEventListener('click', () => { more.remove(); unique.slice(initial).forEach(addSource) }, { once: true })
    box.append(more)
  }
  return box
}
function renderIdea(idea: VideoIdea): void {
  const card = element('details', '', 'idea')
  card.append(element('summary', idea.title), element('p', idea.claim, 'claim'))
  for (const [label, value] of [['Explanation', idea.reasoning], ['Example', idea.example], ['Caveat', idea.caveat]]) {
    if (!hasDetail(value)) continue
    const paragraph = element('p', '', 'detail-text')
    paragraph.append(element('strong', `${label}: `), document.createTextNode(value))
    card.append(paragraph)
  }
  const evidence = element('details', '', 'evidence')
  const count = new Set(idea.sources).size
  evidence.append(element('summary', `Sources · ${count} caption ${count === 1 ? 'reference' : 'references'}`), sourceButtons(idea.sources))
  for (const id of idea.sources.slice(0, 3)) {
    const s = transcript?.segments[id - 1]
    if (s) evidence.append(element('p', `“${s.text}”`, 'excerpt'))
  }
  card.append(evidence)
  get('ideas').append(card)
  get('ideas-section').hidden = false
}
function renderAnalysis(analysis: VideoAnalysis, language: 'en' | 'zh'): void {
  displayedAnalysis = analysis
  get('copy-status').textContent = ''
  get('overview-card').hidden = false
  get('overview').textContent = analysis.overview
  get('takeaways').replaceChildren(...(analysis.takeaways ?? []).map(takeaway => {
    const item = element('li')
    item.append(element('p', takeaway.text), sourceButtons(takeaway.sources, 2))
    return item
  }))
  get('takeaways-section').hidden = !analysis.takeaways?.length
  get('connections').textContent = analysis.connections
  get('connections-details').hidden = !hasDetail(analysis.connections)
  get('ideas').replaceChildren()
  analysis.ideas.forEach(renderIdea)
  get('ideas-section').hidden = !analysis.ideas.length
  get('idea-count').textContent = `· ${analysis.ideas.length} key themes`
  const evaluations = analysis.evaluation ?? []
  get('evaluation').replaceChildren(...evaluations.map(item => {
    const card = element('article', '', 'assessment')
    card.append(element('h3', item.claim))
    for (const [label, value] of [['Support offered', item.support], ['Assumptions and limits', item.limits], ['Evidence to check', item.test]]) {
      if (!hasDetail(value)) continue
      const paragraph = element('p', '', 'detail-text')
      paragraph.append(element('strong', `${label}: `), document.createTextNode(value))
      card.append(paragraph)
    }
    card.append(sourceButtons(item.sources, 2))
    return card
  }))
  get('evaluation-section').hidden = !evaluations.length
  get('evaluation-count').textContent = `· ${evaluations.length} ${evaluations.length === 1 ? 'point' : 'points'}`
  get('unanswered').replaceChildren(...analysis.unanswered.map(x => element('li', x)))
  get('unanswered-section').hidden = !analysis.unanswered.length
  get('languages').hidden = false
  get('questions-section').hidden = false
  get('english').setAttribute('aria-pressed', String(language === 'en'))
  get('chinese').setAttribute('aria-pressed', String(language === 'zh'))
  get('chinese').textContent = chinese ? '中文' : 'Translate to Chinese'
  get('source-meta').textContent = `${transcript?.language} · ${transcript?.automatic ? 'Automatic captions' : 'YouTube captions'} · ${transcript?.segments.length} segments · ${clockTime(transcript?.duration ?? 0)} video · ${analysis.model}${analysis.translationModel ? ` · Translated by ${analysis.translationModel}` : ''}`
}
async function copyAnalysis(): Promise<void> {
  if (!displayedAnalysis || !transcript || busy) return
  const revision = generation
  const analysis = displayedAnalysis
  try {
    await navigator.clipboard.writeText(analysisText(analysis, transcript))
    if (revision === generation && analysis === displayedAnalysis) get('copy-status').textContent = 'Copied summary, breakdowns, critical assessment and timestamp links.'
  } catch {
    if (revision === generation && analysis === displayedAnalysis) get('copy-status').textContent = 'Could not copy. Keep this panel focused and try again.'
  }
}
function renderTranscript(): void {
  if (!transcript) return
  renderVideoTitle()
  // Count the captured caption text only, using Unicode word boundaries rather
  // than spaces so unspaced languages also get a meaningful word count.
  const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
  const encoder = new TextEncoder()
  let words = 0, bytes = 0
  for (const caption of transcript.segments) {
    const text = caption.text.trim()
    for (const part of segmenter.segment(text)) if (part.isWordLike) words++
    bytes += encoder.encode(text).length
  }
  // A local size heuristic, not a model-specific tokenizer or billed usage.
  // Include separators between captions, but exclude IDs and prompt metadata.
  const estimatedTokens = Math.ceil((bytes + Math.max(0, transcript.segments.length - 1)) / 4)
  get('transcript-size').textContent = `Captured ${words.toLocaleString('en-US')} words · ≈${estimatedTokens.toLocaleString('en-US')} tokens (estimated)`
  get('transcript-size').title = 'Caption text only, including caption annotations. Excludes title, timestamps, citation IDs, and instructions. Tokens are a rough estimate (UTF-8 bytes ÷ 4); actual counts vary by model and language. This is not billed usage.'
  get('transcript-size').hidden = false
  get('transcript-section').hidden = false
  get('transcript').replaceChildren()
  // Render on demand to keep long videos responsive.
  get<HTMLDetailsElement>('transcript-section').ontoggle = () => {
    if (!get<HTMLDetailsElement>('transcript-section').open || get('transcript').childElementCount) return
    const fragment = document.createDocumentFragment()
    transcript!.segments.forEach((s, i) => {
      const row = element('div', '', 'caption-row')
      row.append(sourceButtons([i + 1]), element('span', s.text)); fragment.append(row)
    })
    get('transcript').append(fragment)
  }
}
function native(request: VideoRequest, revision: number, report = status): Promise<VideoEvent> {
  return nativeClient.request(request, message => { if (revision === generation) report(message) })
}
/** Let the rendered summary reach a paint before freezing the end-to-end clock. */
function afterDisplay(): Promise<void> {
  if (document.hidden) return Promise.resolve()
  return new Promise(resolve => {
    let frame = 0
    const finish = (): void => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      resolve()
    }
    const onVisibility = (): void => { if (document.hidden) finish() }
    document.addEventListener('visibilitychange', onVisibility)
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish) })
  })
}
async function analyze(clickedAt?: number): Promise<void> {
  if (!target?.videoId || busy) return
  const revision = ++generation; const capturedTarget = target
  timing.start(clickedAt)
  get('error').hidden = true; setBusy(true)
  english = null; chinese = null; displayedAnalysis = null
  get('copy-status').textContent = ''
  transcript = null
  watchPanel.setContext(null)
  get('transcript-section').hidden = true; get('transcript-size').hidden = true
  get('source-meta').replaceChildren(); get('transcript-size').replaceChildren()
  history.length = 0; get('conversation').replaceChildren()
  get('ideas').replaceChildren(); get('overview-card').hidden = true; get('languages').hidden = true
  get('ideas-section').hidden = true; get<HTMLDetailsElement>('ideas-section').open = false
  get<HTMLDetailsElement>('connections-details').open = false
  get('evaluation-section').hidden = true; get<HTMLDetailsElement>('evaluation-section').open = false
  get('evaluation').replaceChildren()
  get('questions-section').hidden = true; get('unanswered-section').hidden = true
  let failed = false
  try {
    status('Loading captions and connecting to EasyUnderstand… YouTube may open its transcript panel.')
    let selectedModel = ''
    timing.loadingTranscript()
    // Both prerequisites can run together. Always observe both promises, and
    // discard late capture/model-check results after failure, cancellation or navigation.
    const connection = native({ id: crypto.randomUUID(), action: 'ping' }, revision).then(event => {
      if (failed || revision !== generation) return
      selectedModel = (event.result as { model: string }).model
      timing.model(selectedModel)
    })
    const capture = (async () => {
      const result = await chrome.scripting.executeScript({ target: { tabId: capturedTarget.tabId }, world: 'MAIN', files: ['collector.js'] })
      if (failed || revision !== generation) return
      const captured = result[0]?.result as { transcript?: VideoTranscript; error?: string } | undefined
      if (!captured?.transcript) throw new Error(captured?.error ?? 'YouTube did not return a readable transcript.')
      if (captured.transcript.videoId !== capturedTarget.videoId) throw new Error('The video changed during capture. Try again.')
      transcript = captured.transcript
      watchPanel.setContext(transcript, capturedTarget.tabId)
      renderTranscript()
      timing.loadedTranscript()
      if (!selectedModel) status('Captions ready. Waiting for EasyUnderstand to connect…')
      return captured.transcript
    })()
    const [, capturedTranscript] = await Promise.all([connection, capture])
    if (revision !== generation || !capturedTranscript) return
    get('source-meta').textContent = `${capturedTranscript.language} · ${capturedTranscript.segments.length} caption segments · ${clockTime(capturedTranscript.duration)} video · ${selectedModel}`
    timing.requestingModel()
    const event = await native({ id: crypto.randomUUID(), action: 'analyze', transcript: capturedTranscript, fresh: refreshNext }, revision)
    if (revision !== generation) return
    timing.receivedResult()
    english = event.result as VideoAnalysis; renderAnalysis(english, 'en')
    timing.model(english.model)
    await afterDisplay()
    if (revision !== generation) return
    timing.finish(event)
    refreshNext = true
    status(`${event.cached ? 'Saved summary' : 'Summary ready'} · Based on the whole caption transcript. Open the breakdown to explore further.`)
  } catch (e) { failed = true; if (revision === generation) { nativeClient.disconnect(); timing.stop('Failed'); error(e instanceof Error ? e.message : String(e)); status('Analysis did not finish. You can retry.'); get('ideas').replaceChildren(); get('ideas-section').hidden = true } }
  finally { if (revision === generation) setBusy(false) }
}
async function translate(): Promise<void> {
  if (!transcript || !english || busy) return
  if (chinese) { renderAnalysis(chinese, 'zh'); return }
  const revision = generation; setBusy(true); get('error').hidden = true
  try {
    const event = await native({ id: crypto.randomUUID(), action: 'translate', transcript }, revision)
    if (revision !== generation) return
    chinese = event.result as VideoAnalysis; renderAnalysis(chinese, 'zh'); status('Chinese translation ready. English is preserved.')
  } catch (e) { if (revision === generation) error(e instanceof Error ? e.message : String(e)) }
  finally { if (revision === generation) setBusy(false) }
}
async function clearCache(): Promise<void> {
  if (busy) return
  const revision = generation; setBusy(true); get('error').hidden = true
  get('cancel').hidden = true // A completed local deletion cannot be cancelled.
  status('Clearing saved video summaries and watch plans…')
  try {
    const event = await native({ id: crypto.randomUUID(), action: 'clear-cache' }, revision)
    if (revision !== generation) return
    const result = event.result as VideoCacheClearResult
    if (!Number.isInteger(result?.cleared) || !Number.isInteger(result?.failed)) throw new Error('The helper did not confirm whether the video cache was cleared.')
    english = null; chinese = null; displayedAnalysis = null; transcript = null; history.length = 0
    watchPanel.setContext(null)
    timing.reset(); refreshNext = false
    for (const id of ['overview-card', 'ideas-section', 'evaluation-section', 'unanswered-section', 'transcript-section', 'transcript-size', 'questions-section', 'languages']) get(id).hidden = true
    for (const id of ['overview', 'takeaways', 'copy-status', 'connections', 'ideas', 'evaluation', 'unanswered', 'transcript', 'transcript-size', 'conversation', 'source-meta']) get(id).replaceChildren()
    status(result.failed
      ? `Cleared ${result.cleared} saved entries. Some entries could not be removed.`
      : result.cleared ? `Cache cleared · ${result.cleared} saved ${result.cleared === 1 ? 'entry' : 'entries'} removed. The next summary will use your model.`
      : 'Video cache is already empty. The next summary will use your model.')
    if (result.failed) error(`${result.failed} saved ${result.failed === 1 ? 'entry could' : 'entries could'} not be removed. Close other EasyUnderstand video panels and retry.`)
  } catch (e) {
    if (revision === generation) { error(e instanceof Error ? e.message : String(e)); status('Could not confirm that the video cache was cleared. You can retry.') }
  } finally { if (revision === generation) setBusy(false) }
}
async function ask(event: Event): Promise<void> {
  event.preventDefault()
  const question = get<HTMLTextAreaElement>('question').value.trim()
  if (!question || !transcript || !english || busy) return
  const revision = generation; setBusy(true); get('error').hidden = true
  try {
    const response = await native({ id: crypto.randomUUID(), action: 'question', transcript, question,
      history: history.slice(-4).map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n').slice(-16000) }, revision)
    if (revision !== generation) return
    const answer = response.result as VideoAnswer
    history.push({ question, answer: answer.answer })
    const box = element('div', answer.answer, 'answer'); box.append(sourceButtons(answer.sources))
    get('conversation').append(element('p', question, 'question'), box)
    get<HTMLTextAreaElement>('question').value = ''; status('Answered from the caption transcript.')
  } catch (e) { if (revision === generation) error(e instanceof Error ? e.message : String(e)) }
  finally { if (revision === generation) setBusy(false) }
}
function startTarget(next: PanelTarget): void {
  if (!next.start || !next.videoId || busy || english || next.token === lastStartToken) return
  lastStartToken = next.token
  // Do not reuse an old button-click timestamp when the panel is reopened.
  void chrome.storage.session.set({ [startedKey]: lastStartToken })
  void analyze(next.clickedAt)
}
function setTarget(next: PanelTarget): void {
  if (target?.videoId === next.videoId && target?.tabId === next.tabId) {
    target = next
    renderVideoTitle()
    startTarget(next)
    return
  }
  stop(!next.videoId); target = next; transcript = null; english = null; chinese = null; displayedAnalysis = null; history.length = 0
  watchPanel.setContext(null)
  timing.reset(); refreshNext = false; setBusy(false)
  for (const id of ['overview-card', 'ideas-section', 'evaluation-section', 'unanswered-section', 'transcript-section', 'transcript-size', 'questions-section', 'languages', 'error']) get(id).hidden = true
  for (const id of ['ideas', 'evaluation', 'takeaways', 'copy-status', 'conversation', 'source-meta']) get(id).replaceChildren()
  renderVideoTitle()
  get<HTMLButtonElement>('understand').disabled = !next.videoId
  get<HTMLDetailsElement>('ideas-section').open = false
  get<HTMLDetailsElement>('evaluation-section').open = false
  status('One complete transcript. A thorough summary, with the breakdown below.')
  if (next.videoId) nativeClient.warmup()
  startTarget(next)
}
get('understand').addEventListener('click', () => void analyze())
window.addEventListener('pagehide', () => nativeClient.disconnect())
get('clear-cache').addEventListener('click', () => void clearCache())
get('cancel').addEventListener('click', () => { stop(); status(english ? 'Stopped. Your summary is still available.' : 'Cancelled. Click Understand video to try again.') })
get('english').addEventListener('click', () => { if (english) renderAnalysis(english, 'en') })
get('chinese').addEventListener('click', () => void translate())
get('copy-summary').addEventListener('click', () => void copyAnalysis())
get('question-form').addEventListener('submit', e => void ask(e))
watchPanel = new WatchPlanPanel({ request: (request, revision) => native(request, revision, message => { get('watch-status').textContent = message }),
  generation: () => generation, setBusy, isBusy: () => busy,
  error: message => error(message) })

const currentWindow = await chrome.windows.getCurrent()
const key = `target:${currentWindow.id}`
const startedKey = `started:${currentWindow.id}`
let initializing = true
let pendingTarget: PanelTarget | undefined
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[key]?.newValue) {
    if (initializing) pendingTarget = changes[key].newValue as PanelTarget
    else setTarget(changes[key].newValue as PanelTarget)
  }
})
const stored = await chrome.storage.session.get([key, startedKey])
lastStartToken = typeof stored[startedKey] === 'string' ? stored[startedKey] : ''
initializing = false
if (pendingTarget ?? stored[key]) setTarget((pendingTarget ?? stored[key]) as PanelTarget)
else {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let videoId: string | null = null
  try { const u = new URL(tab.url ?? ''); if (u.origin === 'https://www.youtube.com' && u.pathname === '/watch') videoId = u.searchParams.get('v') } catch { /* no video */ }
  setTarget({ tabId: tab.id!, windowId: tab.windowId, videoId, title: tab.title ?? '', start: false, token: '' })
}
