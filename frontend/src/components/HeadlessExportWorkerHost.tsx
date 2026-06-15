import { useEffect } from 'react'
import { startHeadlessExportWorker } from '../editor/compositor/headlessExportWorker'
import { isTauriApp } from '../utils/desktopMode'

/** Tauri 启动时注册 Headless Compositor 后台 worker */
export default function HeadlessExportWorkerHost() {
  useEffect(() => {
    if (!isTauriApp()) return undefined
    return startHeadlessExportWorker()
  }, [])

  return null
}
