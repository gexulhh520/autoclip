import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { message } from 'antd'
import { FolderOpenOutlined, PlusOutlined, ScissorOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import libraryApi, { type LibraryAsset } from '../../services/libraryApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import { formatVideoImportSuccessMessage } from '../../utils/videoImportMessage'
import LibraryAssetTrimModal from './library/LibraryAssetTrimModal'

interface GlobalLibraryAssetsSectionProps {
  projectId: string
}

const PAGE_SIZE = 20

const GlobalLibraryAssetsSection: React.FC<GlobalLibraryAssetsSectionProps> = ({ projectId }) => {
  const navigate = useNavigate()
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const loading = useEditSessionStore((state) => state.loading)
  const importLibraryAsset = useEditSessionStore((state) => state.importLibraryAsset)

  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [trimAsset, setTrimAsset] = useState<LibraryAsset | null>(null)
  const [trimConfirming, setTrimConfirming] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const loadTags = useCallback(async () => {
    try {
      const tags = await libraryApi.listTags()
      setAvailableTags(tags)
    } catch {
      setAvailableTags([])
    }
  }, [])

  const loadAssets = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoadingAssets(true)
      }
      try {
        const response = await libraryApi.listAssets({
          q: query || undefined,
          tags: activeTag || undefined,
          page: targetPage,
          page_size: PAGE_SIZE,
          sort: 'created_desc',
        })
        setTotal(response.total)
        setPage(response.page)
        setAssets((prev) => (append ? [...prev, ...response.items] : response.items))
      } catch {
        if (!append) setAssets([])
        setTotal(0)
      } finally {
        setLoadingAssets(false)
        setLoadingMore(false)
      }
    },
    [query, activeTag]
  )

  useEffect(() => {
    void loadTags()
  }, [loadTags])

  useEffect(() => {
    void loadAssets(1, false)
  }, [loadAssets])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery((prev) => {
        const next = searchInput.trim()
        return prev === next ? prev : next
      })
    }, 320)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const handleImport = async (
    asset: LibraryAsset,
    trim?: { inSec: number; outSec: number }
  ) => {
    if (!session) {
      message.error('剪辑工程尚未加载')
      return
    }
    setImportingId(asset.id)
    try {
      const result = await importLibraryAsset(projectId, asset.id, {
        trimInSec: trim?.inSec,
        trimOutSec: trim?.outSec,
      })
      message.success(formatVideoImportSuccessMessage(result.title || asset.title, result.import_method))
      setTrimAsset(null)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '导入素材失败')
    } finally {
      setImportingId(null)
      setTrimConfirming(false)
    }
  }

  const openLibrary = () => {
    if (!session) {
      navigate('/library?tab=search')
      return
    }
    navigate(
      `/library?tab=assets&projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(session.id)}`
    )
  }

  const handleTrimConfirm = async (trimInSec: number, trimOutSec: number) => {
    if (!trimAsset) return
    setTrimConfirming(true)
    await handleImport(trimAsset, { inSec: trimInSec, outSec: trimOutSec })
  }

  return (
    <>
      <div className="editor-global-library">
        <div className="editor-inspector-label editor-global-library__header">
          <span>全局素材库</span>
          <button type="button" className="editor-global-library__link" onClick={openLibrary}>
            <FolderOpenOutlined /> 打开素材库
          </button>
        </div>

        <div className="editor-global-library__toolbar">
          <div className="editor-global-library__search">
            <SearchOutlined aria-hidden />
            <input
              type="search"
              value={searchInput}
              placeholder="搜索标题、标签…"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>

        {availableTags.length > 0 ? (
          <div className="editor-global-library__tags" role="listbox" aria-label="标签筛选">
            <button
              type="button"
              className={`editor-global-library__tag${activeTag === null ? ' is-active' : ''}`}
              onClick={() => setActiveTag(null)}
            >
              全部
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`editor-global-library__tag${activeTag === tag ? ' is-active' : ''}`}
                onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        {loadingAssets ? (
          <div className="editor-asset-empty">加载中…</div>
        ) : assets.length === 0 ? (
          <div className="editor-asset-empty">
            {query || activeTag ? (
              '没有匹配的素材。'
            ) : (
              <>
                暂无素材。
                <button type="button" className="editor-global-library__inline-link" onClick={openLibrary}>
                  去搜索下载
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="editor-clip-list editor-global-library__list">
              {assets.map((asset) => (
                <div key={asset.id} className="editor-media-card">
                  <div className="editor-media-card__preview">
                    <video
                      className="editor-media-card__thumb"
                      src={libraryApi.getVideoUrl(asset.id)}
                      muted
                      playsInline
                      preload="metadata"
                      poster={
                        asset.thumbnail_path ? libraryApi.getThumbnailUrl(asset.id) : undefined
                      }
                    />
                    <div className="editor-media-card__title">{asset.title || asset.id}</div>
                    {asset.tags?.length ? (
                      <div className="editor-global-library__card-tags">
                        {asset.tags.slice(0, 2).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="editor-media-card__actions">
                    <button
                      type="button"
                      className="editor-media-card__add"
                      title="裁剪后添加"
                      disabled={!session || saving || loading || importingId === asset.id}
                      onClick={() => setTrimAsset(asset)}
                    >
                      <ScissorOutlined />
                    </button>
                    <button
                      type="button"
                      className="editor-media-card__add"
                      title="整段添加到时间线"
                      disabled={!session || saving || loading || importingId === asset.id}
                      onClick={() => void handleImport(asset)}
                    >
                      <PlusOutlined />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {page < totalPages ? (
              <button
                type="button"
                className="editor-global-library__load-more"
                disabled={loadingMore}
                onClick={() => void loadAssets(page + 1, true)}
              >
                {loadingMore ? '加载中…' : `加载更多 (${assets.length}/${total})`}
              </button>
            ) : total > 0 ? (
              <p className="editor-global-library__count">{assets.length} / {total} 个素材</p>
            ) : null}
          </>
        )}
      </div>

      <LibraryAssetTrimModal
        open={trimAsset != null}
        asset={trimAsset}
        videoUrl={trimAsset ? libraryApi.getVideoUrl(trimAsset.id) : ''}
        confirming={trimConfirming}
        onClose={() => {
          if (!trimConfirming) setTrimAsset(null)
        }}
        onConfirm={handleTrimConfirm}
      />
    </>
  )
}

export default GlobalLibraryAssetsSection
