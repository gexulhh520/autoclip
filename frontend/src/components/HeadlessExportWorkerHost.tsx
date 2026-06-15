import { useEffect } from 'react'
import HeadlessExportWorkerPanel from './HeadlessExportWorkerPanel'
import { startHeadlessExportWorker } from '../editor/compositor/headlessExportWorker'
import { useHeadlessExportWorkerStore } from '../stores/useHeadlessExportWorkerStore'
import { isTauriApp } from '../utils/desktopMode'

const UI_POLL_MS = 3000

/** Tauri 启动时注册 Headless Compositor 后台 worker，并轮询任务状态供 UI 展示 */
export default function HeadlessExportWorkerHost() {
  const refreshJobs = useHeadlessExportWorkerStore((state) => state.refreshJobs)
  const setPanelExpanded = useHeadlessExportWorkerStore((state) => state.setPanelExpanded)

  useEffect(() => {
    if (!isTauriApp()) return undefined
    const stopWorker = startHeadlessExportWorker()

    void refreshJobs()
    const pollTimer = window.setInterval(() => {
      void refreshJobs()
    }, UI_POLL_MS)

    return () => {
      stopWorker()
      window.clearInterval(pollTimer)
    }
  }, [refreshJobs])

  useEffect(() => {
    const unsubscribe = useHeadlessExportWorkerStore.subscribe((state, prev) => {
      const prevActive = prev.jobs.some(
        (job) => job.status === 'pending' || job.status === 'running'
      )
      const nextActive = state.jobs.some(
        (job) => job.status === 'pending' || job.status === 'running'
      )
      if (!prevActive && nextActive) {
        setPanelExpanded(true)
      }
    })
    return unsubscribe
  }, [setPanelExpanded])

  if (!isTauriApp()) return null

  return <HeadlessExportWorkerPanel />
}
