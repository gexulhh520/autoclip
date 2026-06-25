import React, { useEffect, useMemo, useState } from 'react'
import {
  BGM_LINK_PLATFORM_OPTIONS,
  type BgmLinkPlatform,
  bgmLinkPlaceholder,
  detectBgmLinkPlatform,
  resolveBgmLinkPlatform,
} from '../../utils/linkPlatform'

interface EditorImportBgmUrlModalProps {
  open: boolean
  saving: boolean
  onClose: () => void
  onSubmit: (url: string, platform?: string) => Promise<void>
}

const EditorImportBgmUrlModal: React.FC<EditorImportBgmUrlModalProps> = ({
  open,
  saving,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState('')
  const [platform, setPlatform] = useState<BgmLinkPlatform>('auto')

  useEffect(() => {
    if (!open) {
      setUrl('')
      setPlatform('auto')
    }
  }, [open])

  const detectedPlatform = useMemo(() => detectBgmLinkPlatform(url), [url])

  useEffect(() => {
    if (platform !== 'auto' || !detectedPlatform) return
    // 自动识别模式下随链接更新提示，但不强制改动手选平台
  }, [detectedPlatform, platform])

  if (!open) return null

  const resolved = resolveBgmLinkPlatform(url, platform)
  const canSubmit = Boolean(url.trim()) && (platform !== 'auto' || Boolean(detectedPlatform))

  const handleSubmit = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const finalPlatform = resolveBgmLinkPlatform(trimmed, platform)
    if (!finalPlatform) return
    await onSubmit(trimmed, platform === 'auto' ? undefined : finalPlatform)
    setUrl('')
    setPlatform('auto')
  }

  return (
    <div className="editor-modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="editor-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="editor-modal__title">从链接导入音频</h3>
        <p className="editor-modal__desc">
          将下载视频并提取音频到 BGM 库，原视频文件会自动删除。支持抖音、Bilibili、YouTube。
        </p>
        <label className="editor-modal__field">
          <span>平台</span>
          <select
            className="editor-select"
            value={platform}
            disabled={saving}
            onChange={(event) => setPlatform(event.target.value as BgmLinkPlatform)}
          >
            {BGM_LINK_PLATFORM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {platform === 'auto' && detectedPlatform ? (
          <div className="editor-inspector-muted" style={{ marginTop: -4, marginBottom: 8 }}>
            已识别：
            {BGM_LINK_PLATFORM_OPTIONS.find((item) => item.value === detectedPlatform)?.label ??
              detectedPlatform}
          </div>
        ) : null}
        <label className="editor-modal__field">
          <span>链接</span>
          <input
            type="url"
            value={url}
            placeholder={bgmLinkPlaceholder(platform)}
            disabled={saving}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !saving && canSubmit) {
                void handleSubmit()
              }
            }}
          />
        </label>
        {platform === 'auto' && url.trim() && !resolved ? (
          <div className="editor-inspector-muted" style={{ marginTop: -4 }}>
            无法识别链接，请选择平台或检查链接格式
          </div>
        ) : null}
        <div className="editor-modal__actions">
          <button type="button" className="editor-header__back" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="editor-header__export"
            disabled={saving || !canSubmit}
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
