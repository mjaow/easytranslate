import { clockTime, type VideoAnalysis, type VideoTranscript } from './video.js'

/** Older saved answers can contain placeholders instead of a useful detail. */
export function hasDetail(value: string): boolean {
  const text = value.trim()
  return !!text && !/^(?:not (?:provided|explained|given)(?: in (?:this|the) (?:section|transcript)| here)?|none|n\/a)\.?$/i.test(text)
}

/** Export the data, including collapsed themes; never depend on visible DOM text. */
export function analysisText(analysis: VideoAnalysis, transcript: VideoTranscript): string {
  const url = `https://www.youtube.com/watch?v=${transcript.videoId}`
  const sources = (ids: number[]): string => [...new Set(ids)].flatMap(id => {
    const segment = transcript.segments[id - 1]
    return segment ? [`[${clockTime(segment.start)}](${url}&t=${Math.floor(segment.start)}s)`] : []
  }).join(' · ')
  const lines = [`# ${transcript.title.replace(/\s+/g, ' ').trim()}`, '', `Video: ${url}`,
    `Analysis model: ${analysis.model}${analysis.translationModel ? ` · Translation model: ${analysis.translationModel}` : ''}`,
    `Source: ${transcript.language} ${transcript.automatic ? 'automatic captions' : 'captions'} · ${clockTime(transcript.duration)}`, '',
    '## Summary', '', analysis.overview, '', '## Key takeaways', '']
  for (const takeaway of analysis.takeaways ?? []) lines.push(`- ${takeaway.text}`, `  Sources: ${sources(takeaway.sources)}`, '')
  if (hasDetail(analysis.connections)) lines.push('## How the ideas connect', '', analysis.connections, '')
  lines.push('## Breakdown', '')
  for (const idea of analysis.ideas) {
    lines.push(`### ${idea.title}`, '', idea.claim, '')
    for (const [label, value] of [['Explanation', idea.reasoning], ['Example', idea.example], ['Caveat', idea.caveat]]) {
      if (hasDetail(value)) lines.push(`**${label}:** ${value}`, '')
    }
    lines.push(`Sources: ${sources(idea.sources)}`, '')
  }
  if (analysis.evaluation?.length) {
    lines.push('## Critical assessment', '', 'Model assessment of the transcript\'s evidence and reasoning. External facts have not been checked.', '')
    for (const item of analysis.evaluation) {
      lines.push(`### ${item.claim}`, '')
      for (const [label, value] of [['Support offered', item.support], ['Assumptions and limits', item.limits], ['Evidence to check', item.test]]) {
        if (hasDetail(value)) lines.push(`**${label}:** ${value}`, '')
      }
      lines.push(`Relevant captions: ${sources(item.sources)}`, '')
    }
  }
  if (analysis.unanswered.length) lines.push('## Left unresolved', '', ...analysis.unanswered.map(q => `- ${q}`), '')
  return lines.join('\n').trim()
}
