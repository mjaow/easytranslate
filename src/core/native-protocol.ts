/** Chromium native messaging uses UTF-8 JSON preceded by a four-byte LE length. */
export function encodeNative(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  if (body.length > 1000000) throw new Error('Native response is too large.')
  const head = Buffer.alloc(4); head.writeUInt32LE(body.length)
  return Buffer.concat([head, body])
}
export class NativeDecoder {
  private buffer = Buffer.alloc(0)
  feed(data: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, data])
    const result: unknown[] = []
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0)
      if (size < 2 || size > 8000000) throw new Error('Invalid native request size.')
      if (this.buffer.length < size + 4) break
      result.push(JSON.parse(this.buffer.subarray(4, size + 4).toString('utf8')))
      this.buffer = this.buffer.subarray(size + 4)
    }
    return result
  }
}
