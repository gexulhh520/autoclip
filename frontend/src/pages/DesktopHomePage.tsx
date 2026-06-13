import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Modal, Spin, message } from 'antd'
import { PlusOutlined, ScissorOutlined, AppstoreOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import editApi from '../services/editApi'
import { useProjectsHomeData } from '../hooks/useProjectsHomeData'
import type { EditSession } from '../types/editSession'
import './DesktopHomePage.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface DraftItem {
  id: string
  title: string
  subtitle: string
  updatedAt: string
  sessionId: string
  projectId: string
  isWorkspace: boolean
}

function draftKey(draft: DraftItem): string {
  return `${draft.projectId}-${draft.sessionId}`
}

async function fetchAllDrafts(
  sessionProjects: Array<{ id: string; name: string }>
): Promise<DraftItem[]> {
  const items: DraftItem[] = []

  try {
    const workspaceSessions = await editApi.listEditorDrafts()
    for (const session of workspaceSessions) {
      items.push(mapWorkspaceSessionToDraft(session))
    }
  } catch {
    // skip
  }

  for (const project of sessionProjects) {
    try {
      const sessions = await editApi.listSessions(project.id)
      for (const session of sessions) {
        items.push(mapProjectSessionToDraft(session, project.name))
      }
    } catch {
      // skip
    }
  }

  return items.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

const DesktopHomePage: React.FC = () => {
  const navigate = useNavigate()
  const { projects, loading: projectsLoading } = useProjectsHomeData()
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [draftsLoading, setDraftsLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [deleting, setDeleting] = useState(false)

  const sessionProjects = useMemo(
    () =>
      projects.filter(
        (p) => p.status === 'completed' || (p.total_clips ?? 0) > 0 || (p.clips?.length ?? 0) > 0
      ),
    [projects]
  )

  const loadDrafts = useCallback(async () => {
    setDraftsLoading(true)
    try {
      const items = await fetchAllDrafts(sessionProjects)
      setDrafts(items)
    } catch {
      setDrafts([])
    } finally {
      setDraftsLoading(false)
    }
  }, [sessionProjects])

  const handleStartCreate = async () => {
    setStarting(true)
    try {
      const session = await editApi.createEditorDraft()
      navigate(`/editor/draft/${session.id}`)
    } finally {
      setStarting(false)
    }
  }

  const openDraft = (draft: DraftItem) => {
    if (draft.isWorkspace) {
      navigate(`/editor/draft/${draft.sessionId}`)
      return
    }
    navigate(`/project/${draft.projectId}/edit/${draft.sessionId}`)
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedKeys(new Set())
  }

  const toggleDraftSelection = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedKeys(new Set(drafts.map(draftKey)))
  }

  const handleBatchDelete = () => {
    const selected = drafts.filter((draft) => selectedKeys.has(draftKey(draft)))
    if (selected.length === 0) return

    Modal.confirm({
      title: `删除选中的 ${selected.length} 个剪辑工程？`,
      content: '工程文件将被删除，已导出的成片不受影响。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(true)
        try {
          const results = await Promise.allSettled(
            selected.map((draft) => editApi.deleteSession(draft.projectId, draft.sessionId))
          )
          const failed = results.filter((result) => result.status === 'rejected').length
          const succeeded = selected.length - failed

          if (succeeded > 0) {
            message.success(`已删除 ${succeeded} 个剪辑工程`)
          }
          if (failed > 0) {
            message.error(`${failed} 个剪辑工程删除失败`)
          }

          exitSelectMode()
          await loadDrafts()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '删除失败')
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  useEffect(() => {
    if (projectsLoading) return
    void loadDrafts()
  }, [projectsLoading, loadDrafts])

  useEffect(() => {
    if (drafts.length === 0 && selectMode) {
      setSelectMode(false)
      setSelectedKeys(new Set())
    }
  }, [drafts.length, selectMode])

  const listLoading = projectsLoading || draftsLoading
  const selectedCount = selectedKeys.size

  return (
    <div className="desktop-page">
      <section className="desktop-hero">
        <button
          type="button"
          className="desktop-hero__card"
          disabled={starting}
          onClick={() => void handleStartCreate()}
        >
          <span className="desktop-hero__icon">
            <PlusOutlined />
          </span>
          {starting ? '正在打开…' : '开始创作'}
        </button>
      </section>

      <section className="desktop-tools">
        <h2 className="desktop-tools__title">创作工具</h2>
        <div className="desktop-tools__grid">
          <button type="button" className="desktop-tool" onClick={() => navigate('/ai-slice')}>
            <span className="desktop-tool__icon">
              <AppstoreOutlined />
            </span>
            <span className="desktop-tool__label">AI 自动切片</span>
          </button>
        </div>
      </section>

      <section>
        <div className="desktop-section__header">
          <h2 className="desktop-section__title">本地草稿</h2>
          <div className="desktop-section__actions">
            <span className="desktop-section__meta">{drafts.length} 个剪辑工程</span>
            {!listLoading && drafts.length > 0 ? (
              selectMode ? (
                <>
                  <button
                    type="button"
                    className="desktop-section__btn"
                    disabled={deleting}
                    onClick={handleSelectAll}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="desktop-section__btn"
                    disabled={deleting}
                    onClick={exitSelectMode}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="desktop-section__btn desktop-section__btn--danger"
                    disabled={deleting || selectedCount === 0}
                    onClick={handleBatchDelete}
                  >
                    {deleting ? '删除中…' : `删除${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="desktop-section__btn"
                  onClick={() => setSelectMode(true)}
                >
                  管理
                </button>
              )
            ) : null}
          </div>
        </div>

        {listLoading ? (
          <div className="desktop-empty">
            <Spin />
          </div>
        ) : drafts.length === 0 ? (
          <div className="desktop-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无剪辑草稿，点击「开始创作」进入视频剪辑"
            />
          </div>
        ) : (
          <div className={`desktop-drafts-grid${selectMode ? ' is-select-mode' : ''}`}>
            {drafts.map((draft) => {
              const key = draftKey(draft)
              const selected = selectedKeys.has(key)
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  className={`desktop-draft-card${selected ? ' is-selected' : ''}${
                    selectMode ? ' is-selectable' : ''
                  }`}
                  onClick={() => {
                    if (selectMode) {
                      toggleDraftSelection(key)
                      return
                    }
                    openDraft(draft)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    if (selectMode) {
                      toggleDraftSelection(key)
                      return
                    }
                    openDraft(draft)
                  }}
                >
                  {selectMode ? (
                    <span
                      className={`desktop-draft-card__check${selected ? ' is-checked' : ''}`}
                      aria-hidden
                    />
                  ) : null}
                  <div className="desktop-draft-card__thumb">
                    <ScissorOutlined />
                  </div>
                  <div className="desktop-draft-card__body">
                    <div className="desktop-draft-card__title">{draft.title}</div>
                    <div className="desktop-draft-card__meta">
                      {draft.subtitle} · {dayjs(draft.updatedAt).fromNow()}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function mapWorkspaceSessionToDraft(session: EditSession): DraftItem {
  return {
    id: session.id,
    title: session.name,
    subtitle: `${session.sequence.length} 片段`,
    updatedAt: session.updated_at,
    sessionId: session.id,
    projectId: session.project_id,
    isWorkspace: true,
  }
}

function mapProjectSessionToDraft(session: EditSession, projectName: string): DraftItem {
  return {
    id: session.id,
    title: session.name,
    subtitle: `${session.sequence.length} 片段 · ${projectName}`,
    updatedAt: session.updated_at,
    sessionId: session.id,
    projectId: session.project_id,
    isWorkspace: false,
  }
}

export default DesktopHomePage
