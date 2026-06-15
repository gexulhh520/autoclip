import { canEncodeVideo, getFirstEncodableVideoCodec } from 'mediabunny'

/** OpenCut 导出依赖 WebCodecs（Tauri WebView2 / Chromium） */
export async function assertWebCodecsExportSupported(): Promise<void> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    throw new Error(
      '当前环境不支持 WebCodecs 导出。请更新 Windows WebView2 运行时，或使用最新版 AutoClip 桌面客户端。'
    )
  }

  const codec = await getFirstEncodableVideoCodec('avc')
  if (!codec) {
    throw new Error('当前设备不支持 H.264 硬件/软件编码，无法使用 OpenCut 式导出。')
  }

  const canEncode = await canEncodeVideo('avc', { width: 640, height: 360 })
  if (!canEncode) {
    throw new Error('WebCodecs H.264 编码不可用，请更新显卡驱动或 WebView2 运行时。')
  }
}

export async function isWebCodecsExportSupported(): Promise<boolean> {
  try {
    await assertWebCodecsExportSupported()
    return true
  } catch {
    return false
  }
}
