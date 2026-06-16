import React, { useEffect, useState } from 'react'

interface EditorImportBgmUrlModalProps {
  open: boolean
  saving: boolean
  onClose: () => void
  onSubmit: (url: string) => Promise<void>
}

const EditorImportBgmUrlModal: React.FC<EditorImportBgmUrlModalProps> = ({
  open,
  saving,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!open) setUrl('')
  }, [open])

  if (!open) return null

  const handleSubmit = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    await onSubmit(trimmed)
    setUrl('')
  }

  return (
    <div className="editor-modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="editor-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="editor-modal__title">从链接导入音频</h3>
        <p className="editor-modal__desc">
          将下载视频并提取音频到音频库，原视频文件会自动删除。当前支持抖音分享链接。
        </p>
        <label className="editor-modal__field">
          <span>链接</span>
          <input
            type="url"
            value={url}
            placeholder="https://v.douyin.com/..."
            disabled={saving}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !saving) {
                void handleSubmit()
              }
            }}
          />
        </label>
        <div className="editor-modal__actions">
          <button type="button" className="editor-header__back" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="editor-header__export"
            disabled={saving || !url.trim()}
            onClick={() => void handleSubmit()}
          >
            {saving ? '下载中…' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditorImportBgmUrlModal
