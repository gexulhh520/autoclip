import { isTauriApp } from './desktopMode'

const DESKTOP_EXPORT_MESSAGE =
  '成片导出请使用 AutoClip 桌面客户端（OpenCut · WebCodecs 导出）。'

/** 桌面端唯一导出路径门禁 */
export function assertDesktopExportAvailable(): void {
  if (!isTauriApp()) {
    throw new Error(DESKTOP_EXPORT_MESSAGE)
  }
}

export function canDesktopExport(): boolean {
  return isTauriApp()
}
