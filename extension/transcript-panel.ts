import { MODERN_TRANSCRIPT_PANEL, parseTranscriptData, textOf, type ParsedTranscript } from './captions.js'

interface RendererState { data?: unknown; isLoadingTranscripts?: boolean; isError?: boolean }
interface DataElement extends HTMLElement, RendererState { polymerController?: RendererState }
export const isVisible = (element: Element): boolean => !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0

export function transcriptPanel(): HTMLElement | undefined {
  const legacy = Array.from(document.querySelectorAll<HTMLElement>('ytd-transcript-renderer')).find(isVisible)
  if (legacy) return legacy
  return Array.from(document.querySelectorAll<DataElement>('ytd-engagement-panel-section-list-renderer')).find(panel => {
    if (!isVisible(panel)) return false
    const data = (panel.data ?? panel.polymerController?.data) as { content?: { sectionListRenderer?: { targetId?: string } } } | undefined
    return data?.content?.sectionListRenderer?.targetId === MODERN_TRANSCRIPT_PANEL
  })
}

/** Prefer the current list, but do not let an empty element.data mask the body. */
export function readTranscriptPanel(panel: HTMLElement, videoId?: string): ParsedTranscript & { loading: boolean; failed: boolean; language: string; list: HTMLElement | null } {
  const list = panel.querySelector<DataElement>('ytd-transcript-segment-list-renderer, ytd-section-list-renderer')
  const search = panel.querySelector<DataElement>('ytd-transcript-search-panel-renderer')
  const elements = [list, search, panel as DataElement].filter((el): el is DataElement => !!el)
  const states = elements.flatMap(el => [el, el.polymerController]).filter((s): s is RendererState => !!s)
  const candidates = states.map(s => parseTranscriptData(s.data, videoId))
  // An authoritative current search result must never fall back to an old full body.
  const parsed = candidates.find(c => c.filtered || c.hasSegmentList && (c.segments.length || c.continuation || c.invalidSegments)) ?? parseTranscriptData(undefined)
  if (parsed.modern && Array.from(panel.querySelectorAll<HTMLInputElement>('input')).some(input => input.value.trim())) parsed.filtered = true
  const loading = states.some(s => s.isLoadingTranscripts === true) || Array.from(panel.querySelectorAll('tp-yt-paper-spinner[active], yt-spinner[active], [aria-busy="true"]')).some(isVisible)
  const failed = states.some(s => s.isError === true)
  const footer = panel.querySelector<DataElement>('ytd-transcript-footer-renderer')
  const footerData = (footer?.data ?? footer?.polymerController?.data) as { languageMenu?: { sortFilterSubMenuRenderer?: { subMenuItems?: { selected?: boolean; title?: unknown }[] } } } | undefined
  const selected = footerData?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems?.find(item => item.selected)
  const language = textOf(selected?.title) || panel.querySelector<HTMLElement>('ytd-transcript-footer-renderer #label, ytd-transcript-footer-renderer button')?.textContent?.trim() || ''
  return { ...parsed, loading, failed, language, list }
}

/** The scroll viewport can be the list or an ancestor, not segments-container. */
export function advanceTranscript(panel: HTMLElement, list: HTMLElement | null): void {
  let element = list?.querySelector<HTMLElement>('#segments-container') ?? list
  const boundary = panel.closest('ytd-engagement-panel-section-list-renderer') ?? panel
  while (element && boundary.contains(element)) {
    if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
      return
    }
    if (element === boundary) break
    element = element.parentElement
  }
  // Some layouts use an intersection observer rather than a scroll listener.
  panel.querySelector<HTMLElement>('ytd-continuation-item-renderer')?.scrollIntoView?.({ block: 'end' })
}
