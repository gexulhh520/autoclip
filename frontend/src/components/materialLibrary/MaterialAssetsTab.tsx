import React, { useCallback, useEffect, useState } from 'react'
import { Input, Modal, Pagination, message } from 'antd'
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import libraryApi, { type LibraryAsset } from '../../services/libraryApi'

const formatDuration = (seconds?: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

const MaterialAssetsTab: React.FC = () => {
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)
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

  return (
    <div className="material-library-tab">
      <div className="material-library-toolbar">
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
