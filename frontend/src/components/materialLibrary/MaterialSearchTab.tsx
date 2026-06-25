import React, { useState } from 'react'
import { Input, Select, message } from 'antd'
import { LinkOutlined, SearchOutlined } from '@ant-design/icons'
import libraryApi, { type MaterialSearchResult } from '../../services/libraryApi'
import { openExternalLink } from '../../utils/externalLinks'

interface MaterialSearchTabProps {
  onDownloadStarted: () => void
}

const formatDuration = (seconds?: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

const MaterialSearchTab: React.FC<MaterialSearchTabProps> = ({ onDownloadStarted }) => {
  const [platform, setPlatform] = useState('youtube')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [results, setResults] = useState<MaterialSearchResult[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [searchedQuery, setSearchedQuery] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [urlDownloading, setUrlDownloading] = useState(false)

  const resultKey = (item: MaterialSearchResult) => `${item.platform}:${item.url}`

  const handleDownloadUrl = async () => {
    const trimmed = urlInput.trim()
    if (!trimmed) {
      message.warning('请粘贴视频链接')
      return
    }
    setUrlDownloading(true)
    try {
      const tasks = await libraryApi.downloadFromUrl(trimmed)
      message.success(`已加入下载队列（${tasks.length} 条）`)
      setUrlInput('')
      onDownloadStarted()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '下载任务创建失败')
    } finally {
      setUrlDownloading(false)
    }
  }

  const handleSearch = async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      message.warning('请输入搜索关键词')
      return
    }
    setLoading(true)
    setSelectedKeys(new Set())
    try {
      const items = await libraryApi.search({ platform, query: trimmed, limit: 20 })
      setResults(items)
      setSearchedQuery(trimmed)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '搜索失败')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (item: MaterialSearchResult) => {
    if (item.in_library) return
    const key = resultKey(item)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      message.success('链接已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const openUrl = (url: string) => {
    void openExternalLink(url)
  }

  const handleDownloadSelected = async () => {
    const selected = results.filter((item) => selectedKeys.has(resultKey(item)))
    if (selected.length === 0) {
      message.warning('请先选择要下载的素材')
      return
    }
    setDownloading(true)
    try {
      await libraryApi.createDownloads({
        items: selected.map((item) => ({
          platform: item.platform,
          url: item.url,
          title: item.title,
          external_id: item.external_id,
          thumbnail: item.thumbnail,
          duration_sec: item.duration_sec,
          uploader: item.uploader,
        })),
        search_query: searchedQuery || query.trim(),
      })
      message.success(`已加入下载队列（${selected.length} 条）`)
      setSelectedKeys(new Set())
      onDownloadStarted()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '创建下载任务失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="material-library-tab">
      <div className="material-library-url-box">
        <div className="material-library-url-box__title">粘贴链接下载</div>
        <div className="material-library-toolbar material-library-toolbar--search">
          <Input
            placeholder="粘贴 YouTube 或 Bilibili 视频链接"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onPressEnter={() => void handleDownloadUrl()}
            className="material-library-toolbar__search"
          />
          <button
            type="button"
            className="material-library-btn material-library-btn--primary"
            disabled={urlDownloading}
            onClick={() => void handleDownloadUrl()}
          >
            {urlDownloading ? '提交中…' : '下载到素材库'}
          </button>
        </div>
      </div>

      <div className="material-library-section-label">关键词搜索</div>
      <div className="material-library-toolbar material-library-toolbar--search">
        <Select
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'youtube', label: 'YouTube' },
            { value: 'bilibili', label: 'Bilibili' },
          ]}
          className="material-library-toolbar__platform"
        />
        <Input
          prefix={<SearchOutlined />}
          placeholder="输入关键词搜索视频素材"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={() => void handleSearch()}
          className="material-library-toolbar__search"
        />
        <button
          type="button"
          className="material-library-btn material-library-btn--primary"
          disabled={loading}
          onClick={() => void handleSearch()}
        >
          {loading ? '搜索中…' : '搜索'}
        </button>
      </div>

      {results.length > 0 ? (
        <div className="material-library-search-actions">
          <span className="material-library-search-actions__hint">
            共 {results.length} 条结果
            {selectedKeys.size > 0 ? `，已选 ${selectedKeys.size} 条` : ''}
          </span>
          <button
            type="button"
            className="material-library-btn material-library-btn--primary"
            disabled={downloading || selectedKeys.size === 0}
            onClick={() => void handleDownloadSelected()}
          >
            {downloading ? '提交中…' : `下载选中 (${selectedKeys.size})`}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="desktop-empty">搜索中…</div>
      ) : results.length === 0 ? (
        <div className="desktop-empty">
          {searchedQuery ? '未找到相关素材，请换关键词或平台试试。' : '输入关键词开始搜索网络素材。'}
        </div>
      ) : (
        <div className="material-library-search-list">
          {results.map((item) => {
            const key = resultKey(item)
            const selected = selectedKeys.has(key)
            return (
              <div
                key={key}
                className={`material-library-search-item ${selected ? 'is-selected' : ''} ${
                  item.in_library ? 'is-in-library' : ''
                }`}
              >
                <label className="material-library-search-item__check">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={item.in_library}
                    onChange={() => toggleSelect(item)}
                  />
                </label>
                {item.thumbnail ? (
                  <img className="material-library-search-item__thumb" src={item.thumbnail} alt="" />
                ) : (
                  <div className="material-library-search-item__thumb material-library-search-item__thumb--empty" />
                )}
                <div className="material-library-search-item__body">
                  <div className="material-library-search-item__title">{item.title}</div>
                  <div className="material-library-search-item__meta">
                    {item.platform} · {formatDuration(item.duration_sec)}
                    {item.uploader ? ` · ${item.uploader}` : ''}
                    {item.in_library ? ' · 已在素材库' : ''}
                  </div>
                  <div className="material-library-search-item__actions">
                    <button type="button" className="material-library-link-btn" onClick={() => void copyUrl(item.url)}>
                      <LinkOutlined /> 复制链接
                    </button>
                    <button type="button" className="material-library-link-btn" onClick={() => openUrl(item.url)}>
                      在浏览器打开
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MaterialSearchTab
