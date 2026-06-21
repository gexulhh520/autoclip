/** 从媒体 URL 提取简易波形峰值（Web Audio API） */

export const MAX_WAVEFORM_MEDIA_BYTES = 64 * 1024 * 1024
export const MAX_WAVEFORM_DURATION_SEC = 8 * 60

export interface ExtractWaveformPeaksOptions {
  /** 已知媒体时长（秒）；超长媒体跳过整文件解码 */
  durationSec?: number
  maxBytes?: number
  maxDurationSec?: number
}

export function shouldSkipWaveformExtraction(
  options: Pick<ExtractWaveformPeaksOptions, 'durationSec' | 'maxDurationSec'> & {
    contentLengthBytes?: number | null
    maxBytes?: number
  } = {}
): boolean {
  const maxDurationSec = options.maxDurationSec ?? MAX_WAVEFORM_DURATION_SEC
  const maxBytes = options.maxBytes ?? MAX_WAVEFORM_MEDIA_BYTES
  if (options.durationSec != null && options.durationSec > maxDurationSec) {
    return true
  }
  if (options.contentLengthBytes != null && options.contentLengthBytes > maxBytes) {
    return true
  }
  return false
}

async function probeMediaContentLength(mediaUrl: string): Promise<number | null> {
  try {
    const response = await fetch(mediaUrl, { method: 'HEAD' })
    if (!response.ok) return null
    const raw = response.headers.get('content-length')
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

async function fetchArrayBufferWithLimit(
  mediaUrl: string,
  maxBytes: number
): Promise<ArrayBuffer | null> {
  const response = await fetch(mediaUrl)
  if (!response.ok) {
    throw new Error(`无法读取媒体 (${response.status})`)
  }

  const headerLength = response.headers.get('content-length')
  if (headerLength) {
    const parsed = Number(headerLength)
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      return null
    }
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    return buffer.byteLength > maxBytes ? null : buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

function peaksFromAudioBuffer(audioBuffer: AudioBuffer, sampleCount: number): number[] {
  const channel = audioBuffer.getChannelData(0)
  const blockSize = Math.max(1, Math.floor(channel.length / sampleCount))
  const peaks: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const start = index * blockSize
    let peak = 0
    for (let offset = 0; offset < blockSize && start + offset < channel.length; offset += 1) {
      peak = Math.max(peak, Math.abs(channel[start + offset]))
    }
    peaks.push(peak)
  }
  const maxPeak = Math.max(...peaks, 0.001)
  return peaks.map((value) => value / maxPeak)
}

export async function extractWaveformPeaks(
  mediaUrl: string,
  sampleCount = 120,
  options: ExtractWaveformPeaksOptions = {}
): Promise<number[]> {
  const maxBytes = options.maxBytes ?? MAX_WAVEFORM_MEDIA_BYTES
  const maxDurationSec = options.maxDurationSec ?? MAX_WAVEFORM_DURATION_SEC

  if (shouldSkipWaveformExtraction({ durationSec: options.durationSec, maxDurationSec })) {
    return []
  }

  const contentLengthBytes = await probeMediaContentLength(mediaUrl)
  if (
    shouldSkipWaveformExtraction({
      contentLengthBytes,
      maxBytes,
      maxDurationSec,
    })
  ) {
    return []
  }

  const buffer = await fetchArrayBufferWithLimit(mediaUrl, maxBytes)
  if (!buffer) return []

  const audioContext = new AudioContext()
  try {
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0))
    return peaksFromAudioBuffer(audioBuffer, sampleCount)
  } finally {
    await audioContext.close()
  }
}
