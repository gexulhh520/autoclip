import { isTauriApp } from './desktopMode'

const DESKTOP_EXPORT_MESSAGE =
  '成片导出请使用 AutoClip 桌面客户端，以确保预览与导出效果一致。'

/** 桌面导出门禁 */
export function assertCompositorExportAvailable(useCompositorExport: boolean): void {
  if (!isTauriApp()) {
    throw new Error(DESKTOP_EXPORT_MESSAGE)
  }
  void useCompositorExport
}

export function canCompositorExport(useCompositorExport: boolean): boolean {
  return isTauriApp() && useCompositorExport
}

export function canStableBackendExport(): boolean {
  return isTauriApp()
}
