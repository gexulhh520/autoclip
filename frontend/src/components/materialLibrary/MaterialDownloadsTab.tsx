import React, { useCallback, useEffect, useState } from 'react'
import { Progress, message, Modal } from 'antd'
import {
  DeleteOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import libraryApi, { type MaterialDownloadTask } from '../../services/libraryApi'

const statusLabel: Record<string, string> = {
  pending: '排队中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface MaterialDownloadsTabProps {
  refreshNonce: number
}

const MaterialDownloadsTab: React.FC<MaterialDownloadsTabProps> = ({ refreshNonce }) => {
  const [tasks, setTasks] = useState<MaterialDownloadTask[]>([])
  const [loading, setLoading] = useState(true)

  const loadTasks = useCallback(async () => {
    try {
      const response = await libraryApi.listDownloads()
      setTasks(response.items)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '加载下载任务失败')
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks, refreshNonce])

  useEffect(() => {
    const hasActive = tasks.some(
      (task) => task.status === 'pending' || task.status === 'downloading'
    )
    if (!hasActive) return undefined
    const timer = window.setInterval(() => {
      void loadTasks()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [tasks, loadTasks])

  const handleRetry = async (task: MaterialDownloadTask) => {
    try {
      await libraryApi.retryDownload(task.id)
      message.success('已重新加入队列')
      void loadTasks()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '重试失败')
    }
  }

  const handleCancel = async (task: MaterialDownloadTask) => {
    try {
      await libraryApi.cancelDownload(task.id)
      message.success('已取消')
      void loadTasks()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '取消失败')
    }
  }

  const handleRemove = (task: MaterialDownloadTask) => {
    Modal.confirm({
      title: '清除下载任务？',
      content: '仅从下载列表移除记录，不影响已入库的素材。',
      okText: '清除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await libraryApi.deleteDownload(task.id)
          message.success('已清除')
          void loadTasks()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '清除失败')
        }
      },
    })
  }

  if (loading) {
    return <div className="desktop-empty">加载中…</div>
  }

  if (tasks.length === 0) {
    return <div className="desktop-empty">暂无下载任务。在「搜索」Tab 选择素材并下载。</div>
  }

  return (
    <div className="material-library-tab">
      <div className="material-library-download-list">
        {tasks.map((task) => (
          <div key={task.id} className={`material-library-download-item is-${task.status}`}>
            <div className="material-library-download-item__main">
              <div className="material-library-download-item__title">{task.title}</div>
              <div className="material-library-download-item__meta">
                {task.platform} · {statusLabel[task.status] || task.status}
                {task.uploader ? ` · ${task.uploader}` : ''}
              </div>
              {task.status === 'downloading' || task.status === 'pending' ? (
                <Progress
                  percent={Math.round(task.progress || 0)}
                  size="small"
                  status={task.status === 'pending' ? 'normal' : 'active'}
                  className="material-library-download-item__progress"
                />
              ) : null}
              {task.error_message ? (
                <div className="material-library-download-item__error">{task.error_message}</div>
              ) : null}
            </div>
            <div className="material-library-download-item__actions">
              {task.status === 'failed' || task.status === 'cancelled' ? (
                <button
                  type="button"
                  className="material-library-icon-btn"
                  title="重试"
                  onClick={() => void handleRetry(task)}
                >
                  <ReloadOutlined />
                </button>
              ) : null}
              {task.status === 'pending' || task.status === 'downloading' ? (
                <button
                  type="button"
                  className="material-library-icon-btn"
                  title="取消"
                  onClick={() => void handleCancel(task)}
                >
                  <StopOutlined />
                </button>
              ) : null}
              {task.status !== 'downloading' ? (
                <button
                  type="button"
                  className="material-library-icon-btn"
                  title="清除"
                  onClick={() => handleRemove(task)}
                >
                  <DeleteOutlined />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default MaterialDownloadsTab
