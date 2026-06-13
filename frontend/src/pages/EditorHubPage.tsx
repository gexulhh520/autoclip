import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Empty, Spin } from 'antd'
import { PlusOutlined, ScissorOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import editApi from '../services/editApi'
import { useProjectsHomeData } from '../hooks/useProjectsHomeData'
import type { EditSession } from '../types/editSession'
import './DesktopHomePage.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface SessionRow {
  session: EditSession
  projectName: string
}

const EditorHubPage: React.FC = () => {
  const navigate = useNavigate()
  const { projects, loading } = useProjectsHomeData()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [starting, setStarting] = useState(false)

  const handleStartCreate = async () => {
    setStarting(true)
    try {
      const session = await editApi.createEditorDraft()
      navigate(`/editor/draft/${session.id}`)
    } finally {
      setStarting(false)
    }
  }

  const clipReadyProjects = useMemo(
    () =>
      projects.filter(
        (p) => p.status === 'completed' || (p.total_clips ?? 0) > 0 || (p.clips?.length ?? 0) > 0
      ),
    [projects]
  )

  useEffect(() => {
    if (clipReadyProjects.length === 0) {
      setSessions([])
      return
    }
    let cancelled = false
    setSessionsLoading(true)
    void (async () => {
      const rows: SessionRow[] = []
      for (const project of clipReadyProjects.slice(0, 20)) {
        try {
          const items = await editApi.listSessions(project.id)
          for (const session of items) {
            rows.push({ session, projectName: project.name })
          }
        } catch {
          // skip
        }
      }
      if (!cancelled) {
        setSessions(
          rows.sort(
            (a, b) =>
              new Date(b.session.updated_at).getTime() - new Date(a.session.updated_at).getTime()
          )
        )
        setSessionsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clipReadyProjects])

  return (
    <div className="desktop-page">
      <div className="ai-slice-page__intro" style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ac-ink)' }}>视频剪辑</h1>
        <p style={{ margin: 0, color: 'var(--ac-sub)', fontSize: 14 }}>
          独立视频剪辑草稿，或从已切片项目中继续编辑
        </p>
      </div>

        <section className="desktop-hero" style={{ marginBottom: 32 }}>
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

      <section>
        <div className="desktop-section__header">
          <h2 className="desktop-section__title">剪辑工程</h2>
          <span className="desktop-section__meta">{sessions.length} 个</span>
        </div>

        {loading || sessionsLoading ? (
          <div className="desktop-empty">
            <Spin />
          </div>
        ) : sessions.length === 0 ? (
          <div className="desktop-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无剪辑工程。进入切片项目，勾选片段后创建剪辑。"
            />
            <Button type="primary" style={{ marginTop: 16 }} onClick={() => navigate('/ai-slice')}>
              前往 AI 自动切片
            </Button>
          </div>
        ) : (
          <div className="desktop-drafts-grid">
            {sessions.map(({ session, projectName }) => (
              <button
                key={session.id}
                type="button"
                className="desktop-draft-card"
                onClick={() => navigate(`/project/${session.project_id}/edit/${session.id}`)}
              >
                <div className="desktop-draft-card__thumb">
                  <ScissorOutlined />
                </div>
                <div className="desktop-draft-card__body">
                  <div className="desktop-draft-card__title">{session.name}</div>
                  <div className="desktop-draft-card__meta">
                    {session.sequence.length} 片段 · {projectName} ·{' '}
                    {dayjs(session.updated_at).fromNow()}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default EditorHubPage
