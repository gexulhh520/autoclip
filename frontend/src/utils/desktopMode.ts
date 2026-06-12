import { settingsApi } from '../services/api'

/** 是否运行在 Tauri 桌面壳内 */
export function isTauriApp(): boolean {
  return Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)
}

/**
 * 是否可使用桌面版设置 API（保存 settings.json 等）。
 * Tauri 客户端，或本地开发时后端开了 AUTOCLIP_DESKTOP_MODE。
 */
export async function isDesktopMode(): Promise<boolean> {
  if (isTauriApp()) {
    return true
  }
  try {
    const result = await settingsApi.checkDesktopMode()
    return Boolean(result.is_desktop_mode)
  } catch {
    return false
  }
}
