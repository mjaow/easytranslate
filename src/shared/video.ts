export interface CaptionSegment { start: number; duration: number; text: string }
export interface VideoTranscript {
  videoId: string
  title: string
  language: string
  automatic: boolean
  duration: number
  source: 'caption-track' | 'transcript-panel'
  complete: true
  segments: CaptionSegment[]
}
export interface VideoIdea {
  title: string
  claim: string
  reasoning: string
  example: string
  caveat: string
  /** One-based indices into the original transcript. */
  sources: number[]
}
export interface VideoTakeaway {
  text: string
  sources: number[]
}
/** Model assessment of the supplied argument, separate from the speaker's views. */
export interface VideoEvaluation {
  claim: string
  support: string
  limits: string
  test: string
  /** Captions being assessed, not independent verification of their claims. */
  sources: number[]
}
export interface VideoAnalysis {
  overview: string
  takeaways: VideoTakeaway[]
  connections: string
  ideas: VideoIdea[]
  evaluation: VideoEvaluation[]
  unanswered: string[]
  model: string
  translationModel?: string
  sections: number
}
export interface VideoAnswer { answer: string; sources: number[] }
export interface VideoCacheClearResult { cleared: number; failed: number }
export type VideoRequest =
  | { id: string; action: 'ping' }
  | { id: string; action: 'cancel' }
  | { id: string; action: 'clear-cache' }
  | { id: string; action: 'analyze'; transcript: VideoTranscript; fresh?: boolean }
  | { id: string; action: 'translate'; transcript: VideoTranscript }
  | { id: string; action: 'question'; transcript: VideoTranscript; question: string; history?: string }
export interface VideoEvent {
  id: string
  type: 'status' | 'idea' | 'result' | 'error'
  message?: string
  idea?: VideoIdea
  result?: VideoAnalysis | VideoAnswer | VideoCacheClearResult | { model: string }
  cached?: boolean
  /** Current request only; never reuse generation time from a cached summary. */
  timing?: { modelMs: number }
}
export function clockTime(seconds: number): string {
  const s = Math.floor(seconds)
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
