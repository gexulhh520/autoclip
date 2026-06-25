export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(
      (window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown })
        .__TAURI__ ||
        (window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown })
          .__TAURI_INTERNALS__
    )
  )
}

/** tauri:dev 从 Vite :3000 加载，API 走 /api 代理 */
export function isTauriViteDev(): boolean {
  if (!isTauriRuntime() || typeof window === 'undefined') return false
  const host = window.location.hostname
  const port = window.location.port
  return (host === '127.0.0.1' || host === 'localhost') && port === '3000'
}
