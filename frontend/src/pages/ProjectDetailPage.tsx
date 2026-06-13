import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  Layout, 
  Card, 
  Typography, 
  Button, 
  Space, 
  Alert, 
  Spin, 
  Empty,
  message,
  Radio,
  Checkbox,
  Modal
} from 'antd'
import { 
  ArrowLeftOutlined, 
  PlayCircleOutlined,
  PlusOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import { useProjectStore, Clip, Collection } from '../store/useProjectStore'
import { projectApi, ProjectSourcesResponse } from '../services/api'
import ClipCard from '../components/ClipCard'
import CollectionCard from '../components/CollectionCard'
import CollectionPreviewModal from '../components/CollectionPreviewModal'
import CreateCollectionModal from '../components/CreateCollectionModal'
import { useCollectionVideoDownload } from '../hooks/useCollectionVideoDownload'
import PipelineStepsPanel from '../components/PipelineStepsPanel'
import ProjectSourcesPanel from '../components/ProjectSourcesPanel'
import TemplateBadge from '../components/TemplateBadge'

const { Content } = Layout
const { Title, Text } = Typography

const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { 
    currentProject, 
    loading, 
    error,
    setCurrentProject,
    upsertProject,
    updateCollection,
    addCollection,
    deleteCollection,
    removeClipFromCollection,
    reorderCollectionClips,
    addClipToCollection
  } = useProjectStore()
  
  const [statusLoading, setStatusLoading] = useState(false)
  const [showCreateCollection, setShowCreateCollection] = useState(false)
  const [sortBy, setSortBy] = useState<'time' | 'score'>('score')
  const [showCollectionDetail, setShowCollectionDetail] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null)
  const [multiSource, setMultiSource] = useState<ProjectSourcesResponse['multi_source'] | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [retryingSourceId, setRetryingSourceId] = useState<string | null>(null)
  const [clipBatchMode, setClipBatchMode] = useState(false)
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const [deletingClips, setDeletingClips] = useState(false)
  const { generateAndDownloadCollectionVideo } = useCollectionVideoDownload()

  useEffect(() => {
    if (!id) return
    loadProject()
    loadProcessingStatus()
  }, [id])

  const loadProjectMedia = async (projectId: string, sourceId?: string | null) => {
    let [clips, collections] = await Promise.all([
      projectApi.getClips(projectId, sourceId ?? undefined),
      projectApi.getCollections(projectId),
    ])

    if (!clips || clips.length === 0) {
      try {
        await projectApi.syncProjectFromFilesystem(projectId)
        clips = await projectApi.getClips(projectId, sourceId ?? undefined)
      } catch (syncErr) {
        console.warn('Auto sync clips failed:', syncErr)
      }
    }

    return {
      clips: clips || [],
      collections: collections || [],
    }
  }

  const loadMultiSourceInfo = async (projectId: string) => {
    try {
      const res = await projectApi.getProjectSources(projectId)
      if (res.multi_source?.enabled) {
        setMultiSource(res.multi_source)
        return res.multi_source
      }
      setMultiSource(null)
      return null
    } catch {
      setMultiSource(null)
      return null
    }
  }

  const loadProject = async () => {
    if (!id) return
    try {
      const [project, pipeline, sourceInfo] = await Promise.all([
        projectApi.getProject(id),
        projectApi.getPipelineSteps(id, selectedSourceId ?? undefined).catch(() => null),
        loadMultiSourceInfo(id),
      ])

      const step6 = pipeline?.steps?.find((s) => s.id === 'step6_video')
      const step6Ready =
        step6?.status === 'completed' && (step6?.item_count ?? 0) > 0
      const shouldLoadMedia =
        project.status === 'completed' ||
        step6Ready ||
        project.status === 'failed' ||
        (sourceInfo?.completed_sources ?? 0) > 0

      if (shouldLoadMedia && project.status !== 'processing') {
        try {
          const { clips, collections } = await loadProjectMedia(id, selectedSourceId)

          const projectWithData = {
            ...project,
            status: step6Ready ? 'completed' : project.status,
            clips,
            collections,
          }

          setCurrentProject(projectWithData)
          upsertProject(projectWithData)
        } catch (error) {
          console.error('Failed to load clips/collections:', error)
          setCurrentProject(project)
        }
      } else {
        setCurrentProject(project)
      }
    } catch (error) {
      console.error('Failed to load project:', error)
      message.error('加载项目失败')
    }
  }

  const handleSelectSource = async (sourceId: string | null) => {
    if (!id) return
    setSelectedSourceId(sourceId)
    try {
      const { clips, collections } = await loadProjectMedia(id, sourceId)
      if (currentProject) {
        const updated = { ...currentProject, clips, collections }
        setCurrentProject(updated)
      }
    } catch (error) {
      console.error('Failed to load source clips:', error)
      message.error('加载源视频片段失败')
    }
  }

  const handleRetrySource = async (sourceId: string) => {
    if (!id) return
    setRetryingSourceId(sourceId)
    try {
      await projectApi.retryProjectSource(id, sourceId)
      message.success('已开始重试该源视频')
      await loadMultiSourceInfo(id)
      loadProject()
    } catch (error) {
      console.error('Retry source failed:', error)
      message.error('重试失败')
    } finally {
      setRetryingSourceId(null)
    }
  }

  const loadProcessingStatus = async () => {
    if (!id) return
    setStatusLoading(true)
    try {
      await projectApi.getProcessingStatus(id)
    } catch (error) {
      console.error('Failed to load processing status:', error)
    } finally {
      setStatusLoading(false)
    }
  }

  const handleStartProcessing = async () => {
    if (!id) return
    try {
      await projectApi.startProcessing(id)
      message.success('开始处理')
      loadProcessingStatus()
    } catch (error) {
      console.error('Failed to start processing:', error)
      message.error('启动处理失败')
    }
  }

  const handleCreateCollection = async (title: string, summary: string, clipIds: string[]) => {
    if (!id) return
    try {
      await addCollection(id, {
        id: `collection_${Date.now()}`,
        collection_title: title,
        collection_summary: summary,
        clip_ids: clipIds,
        collection_type: 'manual',
        created_at: new Date().toISOString()
      })
      setShowCreateCollection(false)
      message.success('合集创建成功')
    } catch (error) {
      console.error('Failed to create collection:', error)
      message.error('创建合集失败')
    }
  }

  const handleViewCollection = (collection: Collection) => {
    setSelectedCollection(collection)
    setShowCollectionDetail(true)
  }

  const handleRemoveClipFromCollection = async (collectionId: string, clipId: string): Promise<void> => {
    if (!id) return
    try {
      await removeClipFromCollection(id, collectionId, clipId)
      message.success('切片已从合集中移除')
    } catch (error) {
      console.error('Failed to remove clip from collection:', error)
      message.error('移除切片失败')
    }
  }

  const handleDeleteCollection = async (collectionId: string) => {
    if (!id) return
    try {
      await deleteCollection(id, collectionId)
      setShowCollectionDetail(false)
      setSelectedCollection(null)
      message.success('合集已删除')
    } catch (error) {
      console.error('Failed to delete collection:', error)
      message.error('删除合集失败')
    }
  }

  const handleReorderCollectionClips = async (collectionId: string, newClipIds: string[]): Promise<void> => {
    if (!id) return
    try {
      await reorderCollectionClips(id, collectionId, newClipIds)
      message.success('合集顺序已更新')
    } catch (error) {
      console.error('Failed to reorder collection clips:', error)
      message.error('更新合集顺序失败')
    }
  }

  const handleAddClipToCollection = async (collectionId: string, clipIds: string[]): Promise<void> => {
    if (!id) return
    try {
      await addClipToCollection(id, collectionId, clipIds)
      message.success('切片已添加到合集')
    } catch (error) {
      console.error('Failed to add clip to collection:', error)
      message.error('添加切片失败')
    }
  }

  const getSortedClips = () => {
    if (!currentProject?.clips) return []
    const clips = [...currentProject.clips]
    
    if (sortBy === 'score') {
      return clips.sort((a, b) => b.final_score - a.final_score)
    } else {
      // 按时间排序 - 将时间字符串转换为秒数进行比较
      return clips.sort((a, b) => {
        const getTimeInSeconds = (timeStr: string) => {
          const parts = timeStr.split(':')
          const hours = parseInt(parts[0])
          const minutes = parseInt(parts[1])
          const seconds = parseFloat(parts[2].replace(',', '.'))
          return hours * 3600 + minutes * 60 + seconds
        }
        
        const aTime = getTimeInSeconds(a.start_time)
        const bTime = getTimeInSeconds(b.start_time)
        return aTime - bTime
      })
    }
  }

  const sortedClips = getSortedClips()
  const allVisibleClipIds = sortedClips.map((clip) => clip.id)
  const allVisibleSelected =
    allVisibleClipIds.length > 0 &&
    allVisibleClipIds.every((clipId) => selectedClipIds.includes(clipId))
  const someVisibleSelected = selectedClipIds.length > 0 && !allVisibleSelected

  const exitClipBatchMode = () => {
    setClipBatchMode(false)
    setSelectedClipIds([])
  }

  const handleClipSelectChange = (clipId: string, selected: boolean) => {
    setSelectedClipIds((prev) =>
      selected ? Array.from(new Set([...prev, clipId])) : prev.filter((id) => id !== clipId)
    )
  }

  const handleToggleSelectAllClips = () => {
    if (allVisibleSelected) {
      setSelectedClipIds([])
      return
    }
    setSelectedClipIds(allVisibleClipIds)
  }

  const handleBatchDeleteClips = () => {
    if (!id || selectedClipIds.length === 0) return

    Modal.confirm({
      title: `删除 ${selectedClipIds.length} 个视频片段？`,
      content: '删除后无法恢复，合集中引用这些片段的记录也会一并移除。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeletingClips(true)
        try {
          const { deleted, failed } = await projectApi.deleteClips(selectedClipIds)
          if (deleted.length > 0 && currentProject) {
            const deletedSet = new Set(deleted)
            const remainingClips =
              currentProject.clips?.filter((clip) => !deletedSet.has(clip.id)) || []
            const remainingCollections =
              currentProject.collections?.map((collection) => ({
                ...collection,
                clip_ids: collection.clip_ids.filter((clipId) => !deletedSet.has(clipId)),
              })) || []
            const updatedProject = {
              ...currentProject,
              clips: remainingClips,
              collections: remainingCollections,
              total_clips: remainingClips.length,
            }
            setCurrentProject(updatedProject)
            upsertProject(updatedProject)
          }
          setSelectedClipIds((prev) => prev.filter((clipId) => !deleted.includes(clipId)))
          if (failed.length === 0) {
            message.success(`已删除 ${deleted.length} 个片段`)
            if (deleted.length === allVisibleClipIds.length) {
              exitClipBatchMode()
            }
          } else if (deleted.length > 0) {
            message.warning(`已删除 ${deleted.length} 个，${failed.length} 个删除失败`)
          } else {
            message.error('删除失败')
          }
        } catch (error) {
          console.error('Failed to batch delete clips:', error)
          message.error('删除片段失败')
        } finally {
          setDeletingClips(false)
        }
      },
    })
  }

  if (loading) {
    return (
      <Content style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" />
      </Content>
    )
  }

  if (error || !currentProject) {
    return (
      <Content style={{ padding: '24px' }}>
        <Alert
          message="加载失败"
          description={error || '项目不存在'}
          type="error"
          action={
            <Button size="small" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </Content>
    )
  }

  const clipCount = currentProject.clips?.length ?? 0
  const showClipWorkspace = currentProject.status === 'completed' || clipCount > 0

  return (
    <Content style={{ padding: '24px' }}>
      {/* 简化的项目头部 */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Button 
            type="link" 
            icon={<ArrowLeftOutlined />} 
            onClick={() => navigate('/')}
            style={{ padding: 0, marginBottom: '8px' }}
          >
            返回项目列表
          </Button>
          <Title level={2} style={{ margin: 0 }}>
            {currentProject.name}
          </Title>
          <div style={{ marginTop: '8px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <TemplateBadge project={currentProject} />
            {multiSource?.enabled ? (
              <Text style={{ fontSize: 13, color: 'var(--ac-sub)' }}>
                {multiSource.total_sources} 个源视频 · {multiSource.completed_sources}/{multiSource.total_sources} 已完成
              </Text>
            ) : null}
          </div>
        </div>
        
        <Space>
          {currentProject.status === 'pending' && (
            <Button 
              type="primary" 
              onClick={handleStartProcessing}
              loading={statusLoading}
            >
              开始处理
            </Button>
          )}
        </Space>
      </div>

      {multiSource?.enabled && multiSource.sources.length > 0 ? (
        <ProjectSourcesPanel
          sources={multiSource.sources}
          selectedSourceId={selectedSourceId}
          activeSourceId={multiSource.active_source_id}
          onSelect={handleSelectSource}
          onRetry={handleRetrySource}
          retryingSourceId={retryingSourceId}
        />
      ) : null}

      <PipelineStepsPanel
        projectId={currentProject.id}
        sourceId={selectedSourceId}
        onPipelineFinished={() => loadProject()}
      />

      {/* 主要内容：已完成或已有切片产物时展示片段区 */}
      {showClipWorkspace ? (
        <div>
          {/* AI合集横向滚动区域 */}
          {currentProject.collections && currentProject.collections.length > 0 && (
            <Card style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>AI推荐合集</Title>
                  <Text type="secondary">
                    AI 已为您推荐了 {currentProject.collections.length} 个主题合集
                  </Text>
                </div>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={() => setShowCreateCollection(true)}
                  style={{
                    borderRadius: '8px',
                    background: 'var(--ac-accent)',
                    border: 'none',
                    fontWeight: 500,
                    height: '40px',
                    padding: '0 20px',
                    fontSize: '14px'
                  }}
                >
                  创建合集
                </Button>
              </div>
              
              <div 
                className="collections-scroll-container"
                style={{ 
                  display: 'flex',
                  gap: '16px',
                  overflowX: 'auto',
                  paddingBottom: '8px'
                }}
              >
                {currentProject.collections
                  .sort((a, b) => {
                    // 按创建时间倒序排列，最新的在前面
                    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
                    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
                    return timeB - timeA
                  })
                  .map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    clips={currentProject.clips || []}
                    onView={handleViewCollection}
                    onUpdate={(collectionId, updates) => 
                      updateCollection(currentProject.id, collectionId, updates)
                    }
                    onGenerateVideo={async (collectionId) => {
                      const collection = currentProject.collections?.find(c => c.id === collectionId)
                      if (collection) {
                        await generateAndDownloadCollectionVideo(
                          currentProject.id, 
                          collectionId, 
                          collection.collection_title
                        )
                      }
                    }}
                    onDelete={handleDeleteCollection}
                  />
                ))}
              </div>
            </Card>
          )}
          
          {/* 视频片段区域 */}
          <Card 
            style={{
              borderRadius: '16px',
              border: '1px solid #303030',
              background: 'var(--ac-card)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <Title level={4} style={{ margin: 0, color: '#ffffff', fontWeight: 600 }}>视频片段</Title>
                <Text type="secondary" style={{ color: 'var(--ac-sub)', fontSize: '14px' }}>
                  AI 已为您生成了 {currentProject.clips?.length || 0} 个精彩片段
                </Text>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {/* 排序控件 - 暗黑主题优化 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Text style={{ fontSize: '13px', color: 'var(--ac-sub)', fontWeight: 500 }}>排序</Text>
                  <Radio.Group
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    size="small"
                    buttonStyle="solid"
                    style={{
                      ['--ant-radio-button-bg' as string]: 'transparent',
                      ['--ant-radio-button-checked-bg' as string]: '#1890ff',
                      ['--ant-radio-button-color' as string]: 'var(--ac-sub)',
                      ['--ant-radio-button-checked-color' as string]: '#ffffff'
                    }}
                  >
                    <Radio.Button 
                       value="time" 
                       style={{ 
                         fontSize: '13px',
                         height: '32px',
                         lineHeight: '30px',
                         padding: '0 16px',
                         background: sortBy === 'time' ? 'var(--ac-cta-bg)' : 'var(--ac-line)',
                         border: sortBy === 'time' ? '1px solid #1890ff' : '1px solid var(--ac-line)',
                         color: sortBy === 'time' ? '#ffffff' : 'var(--ac-sub)',
                         borderRadius: '6px 0 0 6px',
                         fontWeight: sortBy === 'time' ? 600 : 400,
                         boxShadow: sortBy === 'time' ? '0 2px 8px rgba(24, 144, 255, 0.3)' : 'none',
                         transition: 'all 0.2s ease'
                       }}
                     >
                       时间
                     </Radio.Button>
                     <Radio.Button 
                       value="score" 
                       style={{ 
                         fontSize: '13px',
                         height: '32px',
                         lineHeight: '30px',
                         padding: '0 16px',
                         background: sortBy === 'score' ? 'var(--ac-cta-bg)' : 'var(--ac-line)',
                         border: sortBy === 'score' ? '1px solid #1890ff' : '1px solid var(--ac-line)',
                         borderLeft: 'none',
                         color: sortBy === 'score' ? '#ffffff' : 'var(--ac-sub)',
                         borderRadius: '0 6px 6px 0',
                         fontWeight: sortBy === 'score' ? 600 : 400,
                         boxShadow: sortBy === 'score' ? '0 2px 8px rgba(24, 144, 255, 0.3)' : 'none',
                         transition: 'all 0.2s ease'
                       }}
                     >
                       评分
                     </Radio.Button>
                  </Radio.Group>
                </div>
                
                <Space>
                  {currentProject.clips && currentProject.clips.length > 0 ? (
                    clipBatchMode ? (
                      <>
                        <Checkbox
                          indeterminate={someVisibleSelected}
                          checked={allVisibleSelected}
                          onChange={handleToggleSelectAllClips}
                        >
                          全选
                        </Checkbox>
                        <Text style={{ fontSize: 13, color: 'var(--ac-sub)' }}>
                          已选 {selectedClipIds.length} 项
                        </Text>
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          loading={deletingClips}
                          disabled={selectedClipIds.length === 0}
                          onClick={handleBatchDeleteClips}
                        >
                          删除
                        </Button>
                        <Button onClick={exitClipBatchMode}>取消</Button>
                      </>
                    ) : (
                      <Button onClick={() => setClipBatchMode(true)}>批量管理</Button>
                    )
                  ) : null}
                  {(!currentProject.collections || currentProject.collections.length === 0) && !clipBatchMode ? (
                    <Button 
                      type="primary" 
                      icon={<PlusOutlined />}
                      onClick={() => setShowCreateCollection(true)}
                      style={{
                        borderRadius: '8px',
                        background: 'var(--ac-accent)',
                        border: 'none',
                        fontWeight: 500,
                        height: '40px',
                        padding: '0 20px',
                        fontSize: '14px'
                      }}
                    >
                      创建合集
                    </Button>
                  ) : null}
                </Space>
              </div>
            </div>
            
            {currentProject.clips && currentProject.clips.length > 0 ? (
              <div 
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: '20px',
                  padding: '8px 0'
                }}
              >
                {sortedClips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    projectId={currentProject.id}
                    videoUrl={projectApi.getClipVideoUrl(currentProject.id, clip.id, clip.title || clip.generated_title)}
                    onDownload={(clipId) => projectApi.downloadVideo(currentProject.id, clipId)}
                    selectable={clipBatchMode}
                    selected={selectedClipIds.includes(clip.id)}
                    onSelectChange={handleClipSelectChange}
                    onClipUpdate={(clipId: string, updates: Partial<Clip>) => {
                      // 更新本地状态
                      if (currentProject) {
                        const updatedProject = {
                          ...currentProject,
                          clips: currentProject.clips?.map((c: Clip) => 
                            c.id === clipId ? { ...c, ...updates } : c
                          ) || []
                        }
                        setCurrentProject(updatedProject)
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <div style={{ 
                padding: '60px 0',
                textAlign: 'center',
                background: 'var(--ac-line)',
                borderRadius: '12px',
                border: '1px dashed var(--ac-line)'
              }}>
                <Empty 
                  description={
                    <Text style={{ color: '#888', fontSize: '14px' }}>暂无视频片段</Text>
                  }
                  image={<PlayCircleOutlined style={{ fontSize: '48px', color: '#555' }} />}
                />
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Card
          style={{
            borderRadius: 16,
            border: '1px solid var(--ac-line)',
            background: 'var(--ac-card)',
          }}
        >
          <Empty
            image={<PlayCircleOutlined style={{ fontSize: 48, color: 'var(--ac-muted)' }} />}
            description={
              <div>
                <Text style={{ color: 'var(--ac-ink)' }}>片段尚未生成</Text>
                <br />
                <Text type="secondary" style={{ color: 'var(--ac-sub)' }}>
                  可在上方流水线面板查看各步骤状态，并从失败步骤「从此步继续」
                </Text>
              </div>
            }
          />
        </Card>
      )}

      {/* 创建合集模态框 */}
      <CreateCollectionModal
        visible={showCreateCollection}
        clips={currentProject.clips || []}
        onCancel={() => setShowCreateCollection(false)}
        onCreate={handleCreateCollection}
      />
      
      {/* 合集预览模态框 */}
      <CollectionPreviewModal
        visible={showCollectionDetail}
        collection={selectedCollection}
        clips={currentProject.clips || []}
        projectId={currentProject.id}
        onClose={() => {
          setShowCollectionDetail(false)
          setSelectedCollection(null)
        }}
        onUpdateCollection={(collectionId, updates) => 
          updateCollection(currentProject.id, collectionId, updates)
        }
        onRemoveClip={handleRemoveClipFromCollection}
        onReorderClips={handleReorderCollectionClips}
        onDelete={handleDeleteCollection}
        onAddClip={handleAddClipToCollection}
      />

    </Content>
  )
}

export default ProjectDetailPage