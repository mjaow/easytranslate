import type { VideoEvent } from './video.js'

interface VideoPacket { type: 'packet'; id: string; index: number; total: number; data: string }
const PART_CHARS = 120000 // Even escaped Unicode stays below Chromium's 1 MiB limit.
const MAX_CHARS = 16000000

/** Large analyses travel in bounded messages, including when reopened from cache. */
export function videoPackets(event: VideoEvent): (VideoEvent | VideoPacket)[] {
  const json = JSON.stringify(event)
  if (json.length > MAX_CHARS) throw new Error('The analysis exceeds the supported output size.')
  if (json.length <= PART_CHARS) return [event]
  const total = Math.ceil(json.length / PART_CHARS)
  return Array.from({ length: total }, (_, index) => ({
    type: 'packet', id: event.id, index, total, data: json.slice(index * PART_CHARS, (index + 1) * PART_CHARS)
  }))
}

export class VideoEventReader {
  private parts: string[] = []
  private total = 0
  constructor(private readonly id: string) {}
  read(value: VideoEvent | VideoPacket): VideoEvent | null {
    if (value.id !== this.id) return null
    if (value.type !== 'packet') {
      if (this.parts.length) throw new Error('Incomplete analysis transfer. Please retry.')
      return value
    }
    if (!Number.isInteger(value.total) || value.total < 1 || value.total > Math.ceil(MAX_CHARS / PART_CHARS) ||
        value.index !== this.parts.length || (this.total && value.total !== this.total) ||
        typeof value.data !== 'string' || value.data.length > PART_CHARS) {
      throw new Error('Invalid analysis transfer. Please retry.')
    }
    this.total = value.total
    this.parts.push(value.data)
    if (this.parts.length !== this.total) return null
    const event = JSON.parse(this.parts.join('')) as VideoEvent
    this.parts = []; this.total = 0
    if (event.id !== this.id || event.type === ('packet' as string)) throw new Error('Invalid analysis transfer.')
    return event
  }
}
