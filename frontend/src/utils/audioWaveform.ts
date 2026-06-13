/** 从媒体 URL 提取简易波形峰值（Web Audio API） */

export async function extractWaveformPeaks(
  mediaUrl: string,
  sampleCount = 120
): Promise<number[]> {
  const response = await fetch(mediaUrl)
  const buffer = await response.arrayBuffer()
  const audioContext = new AudioContext()
  try {
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0))
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
  } finally {
    await audioContext.close()
  }
}
