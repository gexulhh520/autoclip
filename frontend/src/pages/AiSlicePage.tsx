import React, { useState, useEffect } from 'react'
import {
  Typography,
  Select,
  Spin,
  Empty,
  message,
  Button,
} from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import ProjectCard from '../components/ProjectCard'
import FileUpload from '../components/FileUpload'
import BilibiliDownload from '../components/BilibiliDownload'
import { projectApi, GeneTemplateSummary, templatesApi } from '../services/api'
import {
  clearPersistedSelectedTemplate,
  loadPersistedSelectedTemplate,
  persistSelectedTemplate,
} from '../utils/geneTemplate'
import { Project, useProjectStore } from '../store/useProjectStore'
import { useProjectsHomeData } from '../hooks/useProjectsHomeData'
import './AiSlicePage.css'
import './DesktopHomePage.css'

const { Title, Text } = Typography
const { Option } = Select

const AiSlicePage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const locationTemplate = (location.state as { selectedTemplate?: GeneTemplateSummary } | null)
    ?.selectedTemplate ?? null
  const { projects, loading, loadProjects } = useProjectsHomeData()
  const { deleteProject } = useProjectStore()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<'upload' | 'bilibili'>('bilibili')
  const [activeTemplate, setActiveTemplate] = useState<GeneTemplateSummary | null>(() => {
    return locationTemplate || loadPersistedSelectedTemplate<GeneTemplateSummary>()
  })

  useEffect(() => {
    if (locationTemplate) {
      setActiveTemplate(locationTemplate)
      persistSelectedTemplate(locationTemplate)
    }
  }, [locationTemplate])

  useEffect(() => {
    const templateId = activeTemplate?.id
    if (!templateId) return
    let cancelled = false
    templatesApi.getDetail(templateId)
      .then((response) => {
        if (!cancelled) {
          const next = response.template as GeneTemplateSummary
          setActiveTemplate(next)
          persistSelectedTemplate(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          message.warning('所选模板不可用，请重新选择')
          clearPersistedSelectedTemplate()
          setActiveTemplate(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeTemplate?.id])

  const handleClearTemplate = () => {
    clearPersistedSelectedTemplate()
    setActiveTemplate(null)
    navigate('/ai-slice', { replace: true, state: {} })
  }

  const handleDeleteProject = async (id: string) => {
    try {
      await projectApi.deleteProject(id)
      deleteProject(id)
      message.success('项目删除成功')
    } catch (error) {
      message.error('删除项目失败')
      console.error('Delete project error:', error)
    }
  }

  const handleRetryProject = async () => {
    message.success('已开始重试处理项目')
    try {
      await loadProjects()
    } catch (error) {
      console.error('Refresh after retry error:', error)
    }
  }

  const handleProjectCardClick = (project: Project) => {
    if (project.status === 'pending') {
      message.warning('项目正在导入中，请稍后再查看详情')
      return
    }
    navigate(`/project/${project.id}`)
  }

  const filteredProjects = (projects || [])
    .filter((project) => statusFilter === 'all' || project.status === statusFilter)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div className="desktop-page ai-slice-page">
      <div className="ai-slice-page__intro">
        <Title level={2} style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ac-ink)' }}>
          AI 自动切片
        </Title>
        <Text style={{ color: 'var(--ac-sub)', fontSize: 14 }}>
          粘贴链接或导入文件，自动生成精彩片段与合集
        </Text>
      </div>

      <div className="ai-slice-import">
        <div className="ai-slice-import__header">
          <div style={{ fontSize: '13px', color: 'var(--ac-muted)' }}>
            {activeTemplate ? `已选模板：${activeTemplate.name}` : '粘贴链接，AI 自动切片'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Button
              type="link"
              size="small"
              onClick={() => navigate('/templates')}
              style={{ color: 'var(--ac-accent)', padding: 0, height: 'auto', fontSize: '13px' }}
            >
              {activeTemplate ? '更换模板' : '选择基因模板'}
            </Button>
            {activeTemplate ? (
              <Button
                type="link"
                size="small"
                onClick={handleClearTemplate}
                style={{ color: 'var(--ac-sub)', padding: 0, height: 'auto', fontSize: '13px' }}
              >
                不使用模板
              </Button>
            ) : null}
          </div>
        </div>

        <div className="ai-slice-import__card">
          <div className="ai-slice-import__tabs">
            <button
              type="button"
              className={`ai-slice-tab ${activeTab === 'bilibili' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('bilibili')}
            >
              链接导入
            </button>
            <button
              type="button"
              className={`ai-slice-tab ${activeTab === 'upload' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              文件导入
            </button>
          </div>

          {activeTab === 'bilibili' ? (
            <BilibiliDownload
              selectedTemplate={activeTemplate}
              onDownloadSuccess={async () => {
                await loadProjects()
              }}
            />
          ) : (
            <FileUpload
              selectedTemplate={activeTemplate}
              onUploadSuccess={async () => {
                await loadProjects()
                message.success('项目创建成功，正在处理中...')
              }}
            />
          )}
        </div>
      </div>

      <div className="ai-slice-projects">
        <div className="desktop-section__header">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Title level={2} className="desktop-section__title">
              切片项目
            </Title>
            <Text style={{ color: 'var(--ac-muted)', fontSize: 13 }}>{filteredProjects.length}</Text>
          </div>
          <Select
            placeholder="全部状态"
            value={statusFilter}
            onChange={setStatusFilter}
            variant="borderless"
            style={{ minWidth: 120, fontSize: 13 }}
            suffixIcon={<span style={{ color: 'var(--ac-muted)', fontSize: 10 }}>⌄</span>}
            allowClear
          >
            <Option value="all">全部状态</Option>
            <Option value="completed">已完成</Option>
            <Option value="processing">处理中</Option>
            <Option value="error">处理失败</Option>
          </Select>
        </div>

        {loading ? (
          <div className="desktop-empty">
            <Spin size="large" />
            <div style={{ marginTop: 16, color: 'var(--ac-muted)' }}>正在加载项目列表…</div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="desktop-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                projects.length === 0
                  ? '还没有项目，请使用上方导入区域创建第一个项目'
                  : '没有找到匹配的项目'
              }
            />
          </div>
        ) : (
          <div className="ai-slice-projects__grid">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onDelete={handleDeleteProject}
                onRetry={() => void handleRetryProject()}
                onClick={() => handleProjectCardClick(project)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AiSlicePage
