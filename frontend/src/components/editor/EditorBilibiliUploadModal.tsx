import React, { useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import editApi from '../../services/editApi'
import { BILIBILI_PARTITIONS, uploadApi } from '../../services/uploadApi'

interface EditorBilibiliUploadModalProps {
  open: boolean
  projectId: string
  sessionId: string
  exportFilename: string
  defaultTitle: string
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  uploading: '上传中',
  processing: '处理中',
  completed: '已完成',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const EditorBilibiliUploadModal: React.FC<EditorBilibiliUploadModalProps> = ({
  open,
  projectId,
  sessionId,
  exportFilename,
  defaultTitle,
  onClose,
}) => {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [partitionId, setPartitionId] = useState(36)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [accounts, setAccounts] = useState<Array<{ id: number; nickname?: string; username: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [recordId, setRecordId] = useState<number | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!open) {
      setRecordId(null)
      setUploadStatus(null)
      setUploadProgress(null)
      setUploadMessage(null)
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    setTitle(defaultTitle)
    void uploadApi
      .getBilibiliAccounts()
      .then((items) => {
        setAccounts(items as Array<{ id: number; nickname?: string; username: string }>)
        if (items.length > 0) {
          setAccountId(Number(items[0].id))
        }
      })
      .catch(() => setAccounts([]))
  }, [open, defaultTitle])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const startPolling = (id: number) => {
    if (pollRef.current) clearInterval(pollRef.current)
    const poll = async () => {
      try {
        const status = await uploadApi.getUploadRecord(String(id))
        setUploadStatus(status.status)
        setUploadProgress('progress' in status ? Number((status as { progress?: number }).progress) : null)
        setUploadMessage(
          (status as { error_message?: string }).error_message ||
            (status as { message?: string }).message ||
            null
        )
        if (['completed', 'success', 'failed', 'cancelled'].includes(status.status)) {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      } catch {
        // keep polling
      }
    }
    void poll()
    pollRef.current = setInterval(() => void poll(), 2000)
  }

  if (!open) return null

  const handleSubmit = async () => {
    if (!accountId) {
      message.warning('请先绑定 B 站账号（设置 → 投稿管理）')
      return
    }
    setSubmitting(true)
    try {
      const result = await editApi.bilibiliUpload(projectId, sessionId, {
        export_filename: exportFilename,
        account_id: accountId,
        title: title.trim() || defaultTitle,
        description,
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        partition_id: partitionId,
      })
      message.success(result.message)
      if (result.record_id) {
        setRecordId(result.record_id)
        setUploadStatus('pending')
        startPolling(result.record_id)
      }
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '创建投稿任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="editor-modal-backdrop" onClick={onClose}>
      <div className="editor-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="editor-modal__title">上传 B 站</h3>
        <p className="editor-modal__desc">将刚导出的成片提交至投稿队列，进度将在此实时更新。</p>

        {recordId ? (
          <div className="editor-upload-progress">
            <div className="editor-export-progress__bar">
              <span style={{ width: `${uploadProgress ?? 10}%` }} />
            </div>
            <div className="editor-export-progress__text">
              {STATUS_LABEL[uploadStatus ?? 'pending'] ?? uploadStatus}
              {uploadProgress != null ? ` (${uploadProgress}%)` : ''}
            </div>
            {uploadMessage ? (
              <p className="editor-inspector-muted" style={{ marginTop: 8 }}>
                {uploadMessage}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <label className="editor-modal__field">
              <span>标题</span>
              <input className="editor-select" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="editor-modal__field">
              <span>简介</span>
              <textarea
                className="editor-textarea"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="editor-modal__field">
              <span>标签（逗号分隔）</span>
              <input className="editor-select" value={tags} onChange={(event) => setTags(event.target.value)} />
            </label>
            <label className="editor-modal__field">
              <span>分区</span>
              <select
                className="editor-select"
                value={partitionId}
                onChange={(event) => setPartitionId(Number(event.target.value))}
              >
                {BILIBILI_PARTITIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="editor-modal__field">
              <span>账号</span>
              <select
                className="editor-select"
                value={accountId ?? ''}
                onChange={(event) => setAccountId(Number(event.target.value))}
              >
                {accounts.length === 0 ? (
                  <option value="">暂无账号</option>
                ) : (
                  accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.nickname || account.username}
                    </option>
                  ))
                )}
              </select>
            </label>
          </>
        )}

        <div className="editor-modal__actions">
          <button type="button" className="editor-header__back" onClick={onClose}>
            {recordId ? '关闭' : '取消'}
          </button>
          {!recordId ? (
            <button
              type="button"
              className="editor-header__export"
              disabled={submitting || !accountId}
              onClick={() => void handleSubmit()}
            >
              {submitting ? '提交中…' : '创建投稿任务'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default EditorBilibiliUploadModal
