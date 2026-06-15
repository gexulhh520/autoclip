import { create } from 'zustand'
import headlessExportApi from '../services/headlessExportApi'
import type { HeadlessExportJobItem } from '../types/editSession'

export type HeadlessJobStatus = 'pending' | 'running' | 'completed' | 'failed'

function normalizeStatus(status: string): HeadlessJobStatus {
  if (status === 'running' || status === 'completed' || status === 'failed') {
    return status
  }
  return 'pending'
}

function isActiveJob(job: HeadlessExportJobItem): boolean {
  const status = normalizeStatus(job.status)
  return status === 'pending' || status === 'running'
}

interface HeadlessExportWorkerState {
  jobs: HeadlessExportJobItem[]
  workerBusy: boolean
  panelExpanded: boolean
  dismissedJobIds: string[]
  notifiedTerminalKeys: string[]
  lastFetchedAt: number | null
  setWorkerBusy: (busy: boolean) => void
  setPanelExpanded: (expanded: boolean) => void
  upsertJob: (job: HeadlessExportJobItem) => void
  refreshJobs: () => Promise<void>
  dismissJob: (jobId: string) => void
  clearDismissed: () => void
  markTerminalNotified: (key: string) => void
  openPanel: () => void
  visibleJobs: () => HeadlessExportJobItem[]
  activeJobCount: () => number
}

export const useHeadlessExportWorkerStore = create<HeadlessExportWorkerState>((set, get) => ({
  jobs: [],
  workerBusy: false,
  panelExpanded: false,
  dismissedJobIds: [],
  notifiedTerminalKeys: [],
  lastFetchedAt: null,

  setWorkerBusy: (busy) => set({ workerBusy: busy }),

  setPanelExpanded: (expanded) => set({ panelExpanded: expanded }),

  upsertJob: (job) => {
    set((state) => {
      const index = state.jobs.findIndex((item) => item.job_id === job.job_id)
      const jobs =
        index >= 0
          ? state.jobs.map((item, i) => (i === index ? { ...item, ...job } : item))
          : [job, ...state.jobs]
      return { jobs }
    })
  },

  refreshJobs: async () => {
    const jobs = await headlessExportApi.listJobs({ limit: 20, activeOnly: false })
    set({ jobs, lastFetchedAt: Date.now() })
  },

  dismissJob: (jobId) => {
    set((state) => ({
      dismissedJobIds: state.dismissedJobIds.includes(jobId)
        ? state.dismissedJobIds
        : [...state.dismissedJobIds, jobId],
    }))
  },

  clearDismissed: () => set({ dismissedJobIds: [] }),

  markTerminalNotified: (key) => {
    set((state) => ({
      notifiedTerminalKeys: state.notifiedTerminalKeys.includes(key)
        ? state.notifiedTerminalKeys
        : [...state.notifiedTerminalKeys, key],
    }))
  },

  openPanel: () => set({ panelExpanded: true }),

  visibleJobs: () => {
    const { jobs, dismissedJobIds } = get()
    return jobs.filter((job) => {
      if (dismissedJobIds.includes(job.job_id)) return false
      if (isActiveJob(job)) return true
      return true
    })
  },

  activeJobCount: () => get().jobs.filter(isActiveJob).length,
}))

export { isActiveJob, normalizeStatus }
