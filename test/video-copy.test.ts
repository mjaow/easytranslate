import { describe, expect, it } from 'vitest'
import { analysisText } from '../src/shared/video-export.js'
import type { VideoAnalysis, VideoTranscript } from '../src/shared/video.js'

const transcript: VideoTranscript = { videoId: 'B7yl7fEHeKM', title: 'Interview', language: 'English', automatic: true,
  duration: 4000, source: 'caption-track', complete: true, segments: [{ start: 327.5, duration: 5, text: 'Caption.' }] }
const analysis: VideoAnalysis = { overview: 'Central argument.', takeaways: [{ text: 'A concrete lesson.', sources: [1] }], connections: '',
  ideas: [{ title: 'A collapsed theme', claim: 'The position.', reasoning: 'Its explanation.', example: '', caveat: 'Not provided in this section', sources: [1, 1] },
    { title: 'Another theme', claim: 'A second position.', reasoning: '', example: 'A useful case.', caveat: 'Only true under these conditions.', sources: [1] }],
  evaluation: [{ claim: 'A claim to examine.', support: 'An illustrative case.', limits: 'This does not isolate the cause.', test: 'Compare similar cases.', sources: [1] }],
  unanswered: ['An actual open question.'], model: 'gpt-6-luna', sections: 1 }

describe('complete summary export', () => {
  it('includes every theme, takeaway, useful detail and timestamp independently of UI expansion', () => {
    const text = analysisText(analysis, transcript)
    for (const value of ['Central argument.', 'A concrete lesson.', 'A collapsed theme', 'Another theme', 'Its explanation.',
      'A useful case.', 'Only true under these conditions.', 'An actual open question.', 'gpt-6-luna', '[5:27](https://www.youtube.com/watch?v=B7yl7fEHeKM&t=327s)']) expect(text).toContain(value)
    expect(text).not.toContain('Not provided')
    expect(text).not.toContain('How the ideas connect')
    expect(text).toContain('## Critical assessment')
    expect(text).toContain('External facts have not been checked.')
    for (const value of ['A claim to examine.', 'An illustrative case.', 'This does not isolate the cause.', 'Compare similar cases.']) expect(text).toContain(value)
    expect(text.indexOf('## Critical assessment')).toBeGreaterThan(text.indexOf('## Breakdown'))
  })
  it('exports the supplied translation rather than falling back to English', () => {
    const translated = { ...analysis, overview: '核心论点。', takeaways: [{ text: '主要观点。', sources: [1] }],
      evaluation: [{ claim: '待检验的观点。', support: '一个例子。', limits: '', test: '', sources: [1] }], translationModel: 'qwen-flash' }
    const text = analysisText(translated, transcript)
    expect(text).toContain('核心论点。')
    expect(text).toContain('主要观点。')
    expect(text).toContain('Translation model: qwen-flash')
    expect(text).not.toContain('Central argument.')
    expect(text).toContain('待检验的观点。')
    expect(text).not.toContain('A claim to examine.')
    expect(text).not.toContain('**Assumptions and limits:**')
  })
})
