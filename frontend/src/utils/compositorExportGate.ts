import { isTauriApp } from './desktopMode'

const DESKTOP_EXPORT_MESSAGE =
  '成片导出请使用 AutoClip 桌面客户端，以确保预览与导出效果一致。'

const COMPOSITOR_REQUIRED_MESSAGE =
  '请开启「Compositor 导出」。传统 FFmpeg 布局导出已停用，避免与预览不一致。'

/** 桌面 Compositor 导出门禁 — 消除 silent legacy fallback */
export function assertCompositorExportAvailable(useCompositorExport: boolean): void {
  if (!isTauriApp()) {
    throw new Error(DESKTOP_EXPORT_MESSAGE)
  }
  if (!useCompositorExport) {
    throw new Error(COMPOSITOR_REQUIRED_MESSAGE)
  }
}

export function canCompositorExport(useCompositorExport: boolean): boolean {
  return isTauriApp() && useCompositorExport
}
