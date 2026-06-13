import React, { useEffect, useRef, useState } from 'react'
import { Spin, Alert } from 'antd'
import { useMatch, useNavigate, useParams } from 'react-router-dom'
import EditorLayout from '../components/editor/EditorLayout'
import editApi from '../services/editApi'
import { useEditSessionStore } from '../stores/useEditSessionStore'

const EditSessionPage: React.FC = () => {
  const { id: routeProjectId, sessionId } = useParams<{ id?: string; sessionId?: string }>()
  const isDraftRoute = Boolean(useMatch('/editor/draft/:sessionId'))
  const navigate = useNavigate()
  const loadSession = useEditSessionStore((state) => state.loadSession)
  const saveSession = useEditSessionStore((state) => state.saveSession)
  const reset = useEditSessionStore((state) => state.reset)
  const loading = useEditSessionStore((state) => state.loading)
  const error = useEditSessionStore((state) => state.error)
  const session = useEditSessionStore((state) => state.session)
  const dirty = useEditSessionStore((state) => state.dirty)
  const saving = useEditSessionStore((state) => state.saving)
  const saveTimerRef = useRef<number | null>(null)
  const [projectId, setProjectId] = useState<string | null>(routeProjectId ?? null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(isDraftRoute && !routeProjectId)

  useEffect(() => {
    if (routeProjectId) {
      setProjectId(routeProjectId)
      setResolveError(null)
      setResolving(false)
      return
    }
    if (!isDraftRoute || !sessionId) {
      setProjectId(null)
      return
    }

    let cancelled = false
    setResolving(true)
    setResolveError(null)
    void editApi
      .getEditorDraft(sessionId)
      .then((draft) => {
        if (!cancelled) {
          setProjectId(draft.project_id)
          setResolving(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResolveError(err instanceof Error ? err.message : '无法加载剪辑草稿')
          setResolving(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [routeProjectId, isDraftRoute, sessionId])

  useEffect(() => {
    if (!projectId || !sessionId) return
    void loadSession(projectId, sessionId)
    return () => reset()
  }, [projectId, sessionId, loadSession, reset])

  useEffect(() => {
    if (!projectId || !dirty || saving) return
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveSession(projectId)
    }, 1500)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [projectId, dirty, saving, saveSession])

  if (!sessionId) {
    return <Alert type="error" message="无效的剪辑工程地址" />
  }

  if (resolving || (loading && !session && !resolveError)) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#141414',
        }}
      >
        <Spin size="large" />
      </div>
    )
  }

  const displayError = resolveError || (error && !session ? error : null)
  if (displayError || !projectId) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="error"
          message={displayError || '无法打开剪辑工程'}
          action={
            <button
              type="button"
              onClick={() => navigate(isDraftRoute ? '/' : `/project/${routeProjectId}`)}
            >
              {isDraftRoute ? '返回桌面' : '返回项目'}
            </button>
          }
        />
      </div>
    )
  }

  return <EditorLayout projectId={projectId} sessionId={sessionId} />
}

export default EditSessionPage
