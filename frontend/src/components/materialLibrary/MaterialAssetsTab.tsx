import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Modal, Pagination, message } from 'antd'
import {
  CheckSquareOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  TagOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import editApi from '../../services/editApi'
import libraryApi, { type LibraryAsset, type LibraryStorageStats } from '../../services/libraryApi'
import { isTauriApp } from '../../utils/desktopMode'
import { formatVideoImportSuccessMessage } from '../../utils/videoImportMessage'

const VIDEO_IMPORT_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi']

const formatDuration = (seconds?: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

const formatBytes = (bytes?: number | null): string => {
  const value = Number(bytes ?? 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const parseTagsInput = (raw: string): string[] => {
  return raw
    .split(/[,，\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

interface MaterialAssetsTabProps {
  projectId?: string | null
  sessionId?: string | null
}

const MaterialAssetsTab: React.FC<MaterialAssetsTabProps> = ({ projectId, sessionId }) => {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [importingLocal, setImportingLocal] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [stats, setStats] = useState<LibraryStorageStats | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [tagEditAsset, setTagEditAsset] = useState<LibraryAsset | null>(null)
  const [tagEditInput, setTagEditInput] = useState('')
  const [savingTags, setSavingTags] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 24

  const loadMeta = useCallback(async () => {
    try {
      const [tagItems, statsData] = await Promise.all([
        libraryApi.listTags(),
        libraryApi.getStats(),
      ])
      setAvailableTags(tagItems)
      setStats(statsData)
    } catch {
      setAvailableTags([])
      setStats(null)
    }
  }, [])

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const response = await libraryApi.listAssets({
        q: query || undefined,
        tags: activeTag || undefined,
        page,
        page_size: pageSize,
      })
      setAssets(response.items)
      setTotal(response.total)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '加载素材库失败')
      setAssets([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeTag, page, query])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [batchMode, page, query, activeTag])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMeta(), loadAssets()])
  }, [loadAssets, loadMeta])

  const handleDelete = (asset: LibraryAsset) => {
    Modal.confirm({
      title: '从素材库移除？',
      content:
        asset.origin === 'session_pool'
          ? '仅删除素材库中的副本，不影响已删除草稿的历史记录。'
          : '将删除本地文件与库内记录，不可恢复。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await libraryApi.deleteAsset(asset.id)
          message.success('已移除')
          void refreshAll()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '移除失败')
        }
      },
    })
  }

  const handleBatchDelete = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    Modal.confirm({
      title: `批量移除 ${ids.length} 个素材？`,
      content: '将删除本地文件与库内记录，不可恢复。',
      okText: '批量移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true)
        try {
          const result = await libraryApi.batchDeleteAssets(ids)
          if (result.errors.length > 0) {
            message.warning(`已移除 ${result.deleted.length} 个，${result.errors.length} 个失败`)
          } else {
            message.success(`已移除 ${result.deleted.length} 个素材`)
          }
          setBatchMode(false)
          void refreshAll()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '批量移除失败')
        } finally {
          setBatchDeleting(false)
        }
      },
    })
  }

  const handleImportToEditor = async (asset: LibraryAsset) => {
    if (!projectId || !sessionId) return
    setImportingId(asset.id)
    try {
      const result = await editApi.importLibraryAsset(projectId, sessionId, asset.id)
      message.success(formatVideoImportSuccessMessage(result.title || asset.title, result.import_method))
      navigate(`/project/${projectId}/edit/${sessionId}`)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '加入剪辑失败')
    } finally {
      setImportingId(null)
    }
  }

  const canImportToEditor = Boolean(projectId && sessionId)

  const handleImportLocalFile = async (file: File) => {
    setImportingLocal(true)
    try {
      await libraryApi.importLocalUpload(file)
      message.success('已导入到素材库')
      void refreshAll()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImportingLocal(false)
    }
  }

  const handlePickLocalImport = async () => {
    if (isTauriApp()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({
          multiple: false,
          filters: [{ name: 'Video', extensions: VIDEO_IMPORT_EXTENSIONS }],
        })
        if (!selected || Array.isArray(selected)) return
        setImportingLocal(true)
        try {
          await libraryApi.importLocalPath(selected)
          message.success('已导入到素材库')
          void refreshAll()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '导入失败')
        } finally {
          setImportingLocal(false)
        }
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : '无法打开文件选择器')
      }
      return
    }
    fileInputRef.current?.click()
  }

  const toggleSelected = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const openTagEditor = (asset: LibraryAsset) => {
    setTagEditAsset(asset)
    setTagEditInput((asset.tags ?? []).join(', '))
  }

  const saveTags = async () => {
    if (!tagEditAsset) return
    setSavingTags(true)
    try {
      await libraryApi.updateAssetTags(tagEditAsset.id, parseTagsInput(tagEditInput))
      message.success('标签已更新')
      setTagEditAsset(null)
      void refreshAll()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '更新标签失败')
    } finally {
      setSavingTags(false)
    }
  }

  return (
    <div className="material-library-tab">
      {canImportToEditor ? (
        <div className="material-library-return-banner">
          正在向当前剪辑草稿添加素材。
          <button
            type="button"
            className="material-library-link-btn"
            onClick={() => navigate(`/project/${projectId}/edit/${sessionId}`)}
          >
            返回编辑器
          </button>
        </div>
      ) : null}

      {stats ? (
        <div className="material-library-stats">
          <span>
            共 {stats.total_assets} 个素材 · 占用 {formatBytes(stats.disk_bytes)}
          </span>
          {stats.thumbnail_bytes > 0 ? (
            <span className="material-library-stats__sub">
              视频 {formatBytes(stats.video_bytes)} · 缩略图 {formatBytes(stats.thumbnail_bytes)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="material-library-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mp4,.mov,.mkv,.webm,.m4v,.avi"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void handleImportLocalFile(file)
          }}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索标题、标签或 UP 主"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onPressEnter={() => {
            setPage(1)
            setQuery(searchInput.trim())
          }}
          className="material-library-toolbar__search"
        />
        <button
          type="button"
          className="material-library-btn material-library-btn--primary"
          onClick={() => {
            setPage(1)
            setQuery(searchInput.trim())
          }}
        >
          搜索
        </button>
        <button
          type="button"
          className="material-library-btn"
          disabled={importingLocal}
          onClick={() => void handlePickLocalImport()}
        >
          <UploadOutlined /> {importingLocal ? '导入中…' : '导入本地视频'}
        </button>
        <button
          type="button"
          className={`material-library-btn${batchMode ? ' material-library-btn--primary' : ''}`}
          onClick={() => setBatchMode((value) => !value)}
        >
          <CheckSquareOutlined /> {batchMode ? '退出批量' : '批量管理'}
        </button>
        {batchMode && selectedIds.size > 0 ? (
          <button
            type="button"
            className="material-library-btn material-library-btn--danger"
            disabled={batchDeleting}
            onClick={() => handleBatchDelete()}
          >
            <DeleteOutlined /> 删除 ({selectedIds.size})
          </button>
        ) : null}
      </div>

      {availableTags.length > 0 ? (
        <div className="material-library-tag-row">
          <button
            type="button"
            className={`material-library-tag-chip${activeTag === null ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTag(null)
              setPage(1)
            }}
          >
            全部
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`material-library-tag-chip${activeTag === tag ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTag(tag)
                setPage(1)
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="desktop-empty">加载中…</div>
      ) : assets.length === 0 ? (
        <div className="desktop-empty">
          {query || activeTag
            ? '没有匹配的素材。'
            : '暂无素材。在「搜索」Tab 下载网络素材，或在剪辑编辑器 AI 素材上点击 ★ 收藏。'}
        </div>
      ) : (
        <>
          <div className="material-library-grid">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className={`material-library-card${batchMode && selectedIds.has(asset.id) ? ' is-selected' : ''}`}
              >
                {batchMode ? (
                  <button
                    type="button"
                    className="material-library-card__select"
                    aria-pressed={selectedIds.has(asset.id)}
                    onClick={() => toggleSelected(asset.id)}
                  >
                    <CheckSquareOutlined />
                  </button>
                ) : null}
                {asset.thumbnail_path ? (
                  <img
                    className="material-library-card__thumb"
                    src={libraryApi.getThumbnailUrl(asset.id)}
                    alt=""
                  />
                ) : null}
                <video
                  className="material-library-card__video"
                  src={libraryApi.getVideoUrl(asset.id)}
                  controls
                  playsInline
                  preload="metadata"
                  poster={asset.thumbnail_path ? libraryApi.getThumbnailUrl(asset.id) : undefined}
                />
                <div className="material-library-card__meta">
                  <div className="material-library-card__title">{asset.title || asset.id}</div>
                  <div className="material-library-card__sub">
                    {asset.platform ? `${asset.platform} · ` : ''}
                    {formatDuration(asset.duration_sec)}
                    {asset.file_size_bytes ? ` · ${formatBytes(asset.file_size_bytes)}` : ''}
                    {asset.promoted_at || asset.created_at
                      ? ` · ${new Date(asset.promoted_at || asset.created_at || '').toLocaleString()}`
                      : ''}
                  </div>
                  {asset.tags && asset.tags.length > 0 ? (
                    <div className="material-library-card__tags">
                      {asset.tags.map((tag) => (
                        <span key={tag} className="material-library-card__tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {canImportToEditor ? (
                  <button
                    type="button"
                    className="material-library-card__import"
                    disabled={importingId === asset.id}
                    onClick={() => void handleImportToEditor(asset)}
                  >
                    <PlusOutlined /> {importingId === asset.id ? '加入中…' : '加入剪辑'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="material-library-card__tag-btn"
                  title="编辑标签"
                  onClick={() => openTagEditor(asset)}
                >
                  <TagOutlined />
                </button>
                <button
                  type="button"
                  className="material-library-card__delete"
                  title="从素材库移除"
                  onClick={() => handleDelete(asset)}
                >
                  <DeleteOutlined />
                </button>
              </div>
            ))}
          </div>
          {total > pageSize ? (
            <div className="material-library-pagination">
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                showSizeChanger={false}
                onChange={(next) => setPage(next)}
              />
            </div>
          ) : null}
        </>
      )}

      <Modal
        title="编辑标签"
        open={Boolean(tagEditAsset)}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingTags}
        onOk={() => void saveTags()}
        onCancel={() => setTagEditAsset(null)}
      >
        <p className="material-library-tag-modal__hint">多个标签用逗号分隔，例如：片头, b-roll</p>
        <Input
          value={tagEditInput}
          onChange={(event) => setTagEditInput(event.target.value)}
          placeholder="输入标签"
        />
      </Modal>
    </div>
  )
}

export default MaterialAssetsTab
