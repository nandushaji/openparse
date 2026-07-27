/** Encode a Buffer as a base64 data URL for use with vision LLM APIs. */
export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}
