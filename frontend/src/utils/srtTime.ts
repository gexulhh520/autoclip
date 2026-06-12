/** SRT 时间戳 HH:MM:SS,mmm ↔ 秒 */

export function srtTimeToSeconds(time: string): number {
  if (!time) return 0
  const normalized = time.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length !== 3) return 0
  const hours = parseInt(parts[0], 10) || 0
  const minutes = parseInt(parts[1], 10) || 0
  const seconds = parseFloat(parts[2]) || 0
  return hours * 3600 + minutes * 60 + seconds
}

export function secondsToSrtTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`
}

export function formatSrtTimeDisplay(time?: unknown): string {
  if (!time) return '—'
  return String(time).replace(',', '.').substring(0, 12)
}

export function isValidSrtTime(time: string): boolean {
  return /^\d{2}:\d{2}:\d{2},\d{3}$/.test(time.trim())
}

export function adjustSrtTime(time: string, deltaSeconds: number): string {
  return secondsToSrtTime(srtTimeToSeconds(time) + deltaSeconds)
}
