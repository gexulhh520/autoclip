import { useMemo } from 'react'
import {
  isActiveJob,
  normalizeStatus,
  useHeadlessExportWorkerStore,
} from '../stores/useHeadlessExportWorkerStore'
import { revealExportDirectory } from '../utils/editorExportLocal'
import './HeadlessExportWorkerPanel.css'

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '导出中',
  completed: '已完成',
  failed: '失败',
}

function statusDotClass(status: string): string {
  const normalized = normalizeStatus(status)
  return `headless-worker-panel__status-dot is-${normalized}`
}

export default function HeadlessExportWorkerPanel() {
  const jobs = useHeadlessExportWorkerStore((state) => state.jobs)
  const dismissedJobIds = useHeadlessExportWorkerStore((state) => state.dismissedJobIds)
  const workerBusy = useHeadlessExportWorkerStore((state) => state.workerBusy)
  const panelExpanded = useHeadlessExportWorkerStore((state) => state.panelExpanded)
  const setPanelExpanded = useHeadlessExportWorkerStore((state) => state.setPanelExpanded)
  const dismissJob = useHeadlessExportWorkerStore((state) => state.dismissJob)
  const clearDismissed = useHeadlessExportWorkerStore((state) => state.clearDismissed)

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (dismissedJobIds.includes(job.job_id)) return false
      if (isActiveJob(job)) return true
      return true
    })
  }, [jobs, dismissedJobIds])

  const activeJobs = visibleJobs.filter(isActiveJob)
  const primaryJob = activeJobs[0] ?? visibleJobs[0]

  if (visibleJobs.length === 0) {
    return null
  }

  const collapsedLabel =
    activeJobs.length > 0
      ? workerBusy
        ? `后台导出中 · ${primaryJob?.filename ?? '任务'}`
        : `后台导出排队 · ${activeJobs.length} 个任务`
      : `后台导出 · ${visibleJobs.length} 条记录`

  const collapsedPercent = primaryJob?.progress ?? 0

  if (!panelExpanded) {
    return (
      <div className="headless-worker-panel">
        <button
          type="button"
          className="headless-worker-panel__pill"
          onClick={() => setPanelExpanded(true)}
          aria-expanded={false}
        >
          <span
            className={`headless-worker-panel__pill-dot ${activeJobs.length === 0 ? 'is-idle' : ''}`}
          />
          <span className="headless-worker-panel__pill-label">{collapsedLabel}</span>
          {activeJobs.length > 0 ? (
            <span className="headless-worker-panel__pill-meta">{Math.round(collapsedPercent)}%</span>
          ) : null}
        </button>
      </div>
    )
  }

  return (
    <div className="headless-worker-panel">
      <div className="headless-worker-panel__card">
        <div className="headless-worker-panel__header">
          <div>
            <h4 className="headless-worker-panel__title">后台导出</h4>
            <p className="headless-worker-panel__subtitle">
              {workerBusy ? 'Compositor 工作进程处理中' : '等待或处理 Headless 导出任务'}
            </p>
          </div>
          <div className="headless-worker-panel__header-actions">
            <button
              type="button"
              className="headless-worker-panel__icon-btn"
              onClick={() => clearDismissed()}
            >
              恢复
            </button>
            <button
              type="button"
              className="headless-worker-panel__icon-btn"
              onClick={() => setPanelExpanded(false)}
            >
              收起
            </button>
          </div>
        </div>

        <div className="headless-worker-panel__list">
          {visibleJobs.length === 0 ? (
            <div className="headless-worker-panel__empty">暂无后台导出任务</div>
          ) : (
            visibleJobs.map((job) => {
              const status = normalizeStatus(job.status)
              const progress = job.progress ?? (status === 'completed' ? 100 : 0)
              const isTerminal = status === 'completed' || status === 'failed'
              return (
                <div key={job.job_id} className="headless-worker-panel__item">
                  <div className="headless-worker-panel__item-top">
                    <span className="headless-worker-panel__item-name" title={job.filename}>
                      {job.filename}
                    </span>
                    <span className="headless-worker-panel__status">
                      <span className={statusDotClass(job.status)} />
                      {STATUS_LABEL[status] ?? job.status}
                    </span>
                  </div>

                  {!isTerminal || status === 'running' ? (
                    <div className="headless-worker-panel__progress">
                      <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                    </div>
                  ) : null}

                  <div
                    className={`headless-worker-panel__message ${status === 'failed' ? 'is-error' : ''}`}
                  >
                    {status === 'failed' ? job.error || job.message || '导出失败' : job.message}
                  </div>

                  {status === 'completed' && job.local_output_path ? (
                    <div className="headless-worker-panel__actions">
                      <button
                        type="button"
                        className="headless-worker-panel__action"
                        onClick={() => void revealExportDirectory(job.local_output_path!)}
                      >
                        打开文件夹
                      </button>
                      <button
                        type="button"
                        className="headless-worker-panel__action"
                        onClick={() => dismissJob(job.job_id)}
                      >
                        清除
                      </button>
                    </div>
                  ) : null}

                  {status === 'failed' ? (
                    <div className="headless-worker-panel__actions">
                      <button
                        type="button"
                        className="headless-worker-panel__action"
                        onClick={() => dismissJob(job.job_id)}
                      >
                        清除
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
