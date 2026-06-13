import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Empty, Modal, Select, Space, Typography, message } from 'antd'
import { ScissorOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import editApi from '../services/editApi'
import type { EditSession } from '../types/editSession'

const { Text, Title } = Typography

interface EditSessionsPanelProps {
  projectId: string
  selectedClipIds: string[]
  selectedSourceId?: string | null
  onClearSelection?: () => void
}

const formatUpdatedAt = (iso: string): string => {
  try {
    const date = new Date(iso)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const EditSessionsPanel: React.FC<EditSessionsPanelProps> = ({
  projectId,
  selectedClipIds,
  selectedSourceId,
  onClearSelection,
}) => {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<EditSession[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [appendingTo, setAppendingTo] = useState<string | null>(null)
  const [appendTarget, setAppendTarget] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const items = await editApi.listSessions(projectId)
      setSessions(
        [...items].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      )
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const handleCreate = async () => {
    if (selectedClipIds.length === 0) {
      message.warning('请先在下方勾选要剪辑的片段')
      return
    }
    setCreating(true)
    try {
      const session = await editApi.createSession(projectId, {
        clip_ids: selectedClipIds,
        source_id: selectedSourceId,
      })
      onClearSelection?.()
      navigate(`/project/${projectId}/edit/${session.id}`)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '创建剪辑工程失败')
    } finally {
      setCreating(false)
    }
  }

  const handleAppend = async (sessionId: string) => {
    if (selectedClipIds.length === 0) {
      message.warning('请先勾选要追加的片段')
      return
    }
    setAppendingTo(sessionId)
    try {
      const result = await editApi.appendClips(projectId, sessionId, {
        clip_ids: selectedClipIds,
        source_id: selectedSourceId,
      })
      if (result.added_count === 0) {
        message.info('所选片段已在工程中，未追加新内容')
      } else {
        message.success(`已追加 ${result.added_count} 个片段`)
        onClearSelection?.()
      }
      await loadSessions()
      setAppendTarget(null)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '追加片段失败')
    } finally {
      setAppendingTo(null)
    }
  }

  const handleDelete = (session: EditSession) => {
    Modal.confirm({
      title: `删除剪辑工程「${session.name}」？`,
      content: '工程文件将被删除，已导出的成片不受影响。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await editApi.deleteSession(projectId, session.id)
          message.success('已删除')
          await loadSessions()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '删除失败')
        }
      },
    })
  }

  return (
    <Card
      style={{
        marginBottom: 24,
        borderRadius: 16,
        border: '1px solid var(--ac-line)',
        background: 'var(--ac-card)',
      }}
      loading={loading}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0, color: '#fff' }}>
            剪辑工程
          </Title>
          <Text type="secondary" style={{ color: 'var(--ac-sub)', fontSize: 14 }}>
            继续编辑已有工程，或从所选片段新建
          </Text>
        </div>
        <Space wrap>
          {selectedClipIds.length > 0 ? (
            <>
              <Text style={{ fontSize: 13, color: 'var(--ac-sub)' }}>
                已选 {selectedClipIds.length} 个片段
              </Text>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={creating}
                onClick={() => void handleCreate()}
              >
                新建工程
              </Button>
              {sessions.length > 0 ? (
                <Select
                  placeholder="追加到已有工程"
                  style={{ minWidth: 200 }}
                  value={appendTarget}
                  onChange={setAppendTarget}
                  options={sessions.map((s) => ({
                    value: s.id,
                    label: `${s.name}（${s.sequence.length} 段）`,
                  }))}
                />
              ) : null}
              {appendTarget ? (
                <Button
                  icon={<ScissorOutlined />}
                  loading={appendingTo === appendTarget}
                  onClick={() => void handleAppend(appendTarget)}
                >
                  追加片段
                </Button>
              ) : null}
            </>
          ) : (
            <Text style={{ fontSize: 13, color: 'var(--ac-sub)' }}>
              勾选片段后可新建或追加到工程
            </Text>
          )}
        </Space>
      </div>

      {sessions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text style={{ color: 'var(--ac-sub)' }}>暂无剪辑工程，勾选片段后点击「新建工程」</Text>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map((session) => (
            <div
              key={session.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--ac-line)',
                background: 'var(--ac-line)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#fff', fontSize: 14 }}>{session.name}</div>
                <Text style={{ fontSize: 12, color: 'var(--ac-sub)' }}>
                  {session.sequence.length} 个片段 · 更新于 {formatUpdatedAt(session.updated_at)}
                </Text>
              </div>
              <Space>
                <Button
                  type="primary"
                  size="small"
                  icon={<ScissorOutlined />}
                  onClick={() => navigate(`/project/${projectId}/edit/${session.id}`)}
                >
                  继续编辑
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(session)}
                />
              </Space>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default EditSessionsPanel
