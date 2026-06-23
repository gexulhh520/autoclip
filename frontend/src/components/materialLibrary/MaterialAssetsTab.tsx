import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Modal, Pagination, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import editApi from '../../services/editApi'
import libraryApi, { type LibraryAsset } from '../../services/libraryApi'
import { isTauriApp } from '../../utils/desktopMode'
import { formatVideoImportSuccessMessage } from '../../utils/videoImportMessage'

const VIDEO_IMPORT_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi']

const formatDuration = (seconds?: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
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
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 24

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const response = await libraryApi.listAssets({
        q: query || undefined,
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
  }, [page, query])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

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
          void loadAssets()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '移除失败')
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
      void loadAssets()
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
          void loadAssets()
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
          placeholder="按标题或 UP 主搜索"
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
      </div>

      {loading ? (
        <div className="desktop-empty">加载中…</div>
      ) : assets.length === 0 ? (
        <div className="desktop-empty">
          {query
            ? '没有匹配的素材。'
            : '暂无素材。在「搜索」Tab 下载网络素材，或在剪辑编辑器 AI 素材上点击 ★ 收藏。'}
        </div>
      ) : (
        <>
          <div className="material-library-grid">
            {assets.map((asset) => (
              <div key={asset.id} className="material-library-card">
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
                    {asset.promoted_at || asset.created_at
                      ? ` · ${new Date(asset.promoted_at || asset.created_at || '').toLocaleString()}`
                      : ''}
                  </div>
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
    </div>
  )
}

export default MaterialAssetsTab
