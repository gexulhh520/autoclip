import { ExportOutlined } from '@ant-design/icons'

import { isActiveJob, useHeadlessExportWorkerStore } from '../stores/useHeadlessExportWorkerStore'
import { isTauriApp } from '../utils/desktopMode'

/** 侧边栏后台导出入口（仅 Tauri） */
export default function DesktopSidebarHeadlessExport() {
  const activeCount = useHeadlessExportWorkerStore((state) =>
    state.jobs.filter(isActiveJob).length
  )
  const openPanel = useHeadlessExportWorkerStore((state) => state.openPanel)
  const refreshJobs = useHeadlessExportWorkerStore((state) => state.refreshJobs)

  if (!isTauriApp()) {
    return null
  }

  const handleOpen = () => {
    void refreshJobs()
    openPanel()
  }

  return (
    <button
      type="button"
      className="desktop-nav-item desktop-nav-item--headless-export"
      onClick={handleOpen}
      title="查看后台 Compositor 导出任务"
    >
      <span className="desktop-nav-item__icon">
        <ExportOutlined />
      </span>
      <span>后台导出</span>
      {activeCount > 0 ? (
        <span className="desktop-nav-item__badge" aria-label={`${activeCount} 个进行中的任务`}>
          {activeCount}
        </span>
      ) : null}
    </button>
  )
}
