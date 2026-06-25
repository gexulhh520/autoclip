import { extractWaveformPeaks } from './audioWaveform'

const peakCache = new Map<string, number[]>()

export function buildWaveformCacheKey(blockId: string, mediaUrl: string, durationSec: number): string {
  return `${blockId}:${mediaUrl}:${durationSec.toFixed(3)}`
}

export async function getOrExtractWaveformPeaks(
  cacheKey: string,
  mediaUrl: string,
  sampleCount: number,
  options: { durationSec?: number } = {}
): Promise<number[]> {
  const cached = peakCache.get(cacheKey)
  if (cached) return cached

  const peaks = await extractWaveformPeaks(mediaUrl, sampleCount, options)
  peakCache.set(cacheKey, peaks)
  return peaks
}

export function clearWaveformPeakCache(): void {
  peakCache.clear()
}
