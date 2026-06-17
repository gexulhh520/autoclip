import { canEncodeVideo, getFirstEncodableVideoCodec } from 'mediabunny'

/** OpenCut 导出依赖 WebCodecs（Tauri WebView2 / Chromium） */
export async function assertWebCodecsExportSupported(): Promise<void> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    throw new Error(
      '当前环境不支持 WebCodecs 导出。请更新 Windows WebView2 运行时，或使用最新版 AutoClip 桌面客户端。'
    )
  }

  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9'])
  if (!codec) {
    throw new Error(
      '当前 WebView 无法使用 WebCodecs 进行 H.264 编码。请更新 [Microsoft Edge WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/) 后重启 AutoClip。'
    )
  }

  const canEncode = await canEncodeVideo(codec, { width: 640, height: 360 })
  if (!canEncode) {
    throw new Error('WebCodecs 视频编码不可用，请更新 WebView2 运行时或显卡驱动后重启应用。')
  }
}

/** 预览转场按 composition 时间取帧（仅需解码） */
export function isWebCodecsDecodeSupported(): boolean {
  return typeof VideoDecoder !== 'undefined'
}

export async function isWebCodecsExportSupported(): Promise<boolean> {
  try {
    await assertWebCodecsExportSupported()
    return true
  } catch {
    return false
  }
}
