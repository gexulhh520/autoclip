import { useEffect } from 'react'

import {
  normalizeStatus,
  useHeadlessExportWorkerStore,
} from '../stores/useHeadlessExportWorkerStore'
import {
  notifyHeadlessExportComplete,
  notifyHeadlessExportFailed,
} from '../utils/headlessExportNotifications'
import { isTauriApp } from '../utils/desktopMode'

function terminalKey(jobId: string, status: string): string {
  return `${jobId}:${status}`
}

/** 监听 Headless 任务终态，触发应用内 toast 与系统通知（各任务仅通知一次） */
export function useHeadlessExportNotifications(): void {
  useEffect(() => {
    if (!isTauriApp()) return undefined

    return useHeadlessExportWorkerStore.subscribe((state, prev) => {
      const { notifiedTerminalKeys, markTerminalNotified } =
        useHeadlessExportWorkerStore.getState()

      for (const job of state.jobs) {
        const status = normalizeStatus(job.status)
        if (status !== 'completed' && status !== 'failed') {
          continue
        }

        const key = terminalKey(job.job_id, status)
        if (notifiedTerminalKeys.includes(key)) {
          continue
        }

        const prevJob = prev.jobs.find((item) => item.job_id === job.job_id)
        const prevStatus = prevJob ? normalizeStatus(prevJob.status) : null
        if (prevStatus !== 'pending' && prevStatus !== 'running') {
          continue
        }

        markTerminalNotified(key)
        if (status === 'completed') {
          void notifyHeadlessExportComplete(job.filename, job.local_output_path)
        } else {
          void notifyHeadlessExportFailed(job.filename, job.error || job.message)
        }
      }
    })
  }, [])
}
