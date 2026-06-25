export type BgmLinkPlatform = 'auto' | 'douyin' | 'bilibili' | 'youtube'

export type ResolvedBgmLinkPlatform = 'douyin' | 'bilibili' | 'youtube'

export const BGM_LINK_PLATFORM_OPTIONS: Array<{ value: BgmLinkPlatform; label: string }> = [
  { value: 'auto', label: '自动识别' },
  { value: 'douyin', label: '抖音' },
  { value: 'bilibili', label: 'Bilibili' },
  { value: 'youtube', label: 'YouTube' },
]

const DOUYIN = /^https?:\/\/(www\.)?(douyin\.com|iesdouyin\.com)|^https?:\/\/v\.douyin\.com\//i
const BILIBILI =
  /^https?:\/\/(www\.)?bilibili\.com\/video\/(BV[\w]+|av\d+)|^https?:\/\/b23\.tv\//i
const YOUTUBE =
  /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)/i

export function detectBgmLinkPlatform(url: string): ResolvedBgmLinkPlatform | null {
  const text = url.trim()
  if (!text) return null
  if (DOUYIN.test(text)) return 'douyin'
  if (BILIBILI.test(text)) return 'bilibili'
  if (YOUTUBE.test(text)) return 'youtube'
  return null
}

export function resolveBgmLinkPlatform(
  url: string,
  platform: BgmLinkPlatform
): ResolvedBgmLinkPlatform | null {
  if (platform !== 'auto') return platform
  return detectBgmLinkPlatform(url)
}

export function bgmLinkPlaceholder(platform: BgmLinkPlatform): string {
  switch (platform) {
    case 'douyin':
      return 'https://v.douyin.com/...'
    case 'bilibili':
      return 'https://www.bilibili.com/video/BV...'
    case 'youtube':
      return 'https://www.youtube.com/watch?v=...'
    default:
      return '粘贴抖音 / Bilibili / YouTube 链接'
  }
}
