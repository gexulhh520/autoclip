import React, { useState, useEffect } from 'react'
import { Button, message, Space, Typography, Input, Progress } from 'antd'
import { InboxOutlined, VideoCameraOutlined, FileTextOutlined, SubnodeOutlined } from '@ant-design/icons'
import { useDropzone } from 'react-dropzone'
import { projectApi, VideoCategory, ClipDurationSelection, ClipGoalSelection, GeneTemplateSummary } from '../services/api'
import { useProjectStore } from '../store/useProjectStore'
import { validateApiConfigBeforeProjectCreation } from '../utils/apiConfigCheck'
import ClipDurationSelector from './ClipDurationSelector'
import ClipGoalSelector from './ClipGoalSelector'

const { Text } = Typography

interface FileUploadProps {
  onUploadSuccess?: (projectId: string) => void
  selectedTemplate?: GeneTemplateSummary | null
}

const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess, selectedTemplate }) => {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [projectName, setProjectName] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [clipDuration, setClipDuration] = useState<ClipDurationSelection>({
    clip_duration_preset: 'standard',
  })
  const [clipGoal, setClipGoal] = useState<ClipGoalSelection>({
    clip_goal: 'knowledge',
  })
  const [categories, setCategories] = useState<VideoCategory[]>([])
  const [, setLoadingCategories] = useState(false)
  const [files, setFiles] = useState<{
    videos: File[]
    srt?: File
  }>({ videos: [] })
  
  const { addProject } = useProjectStore()

  // 模板模式下同步 Pipeline 参数
  useEffect(() => {
    if (!selectedTemplate) return
    setSelectedCategory(selectedTemplate.pipeline.video_category)
    setClipGoal({ clip_goal: selectedTemplate.pipeline.clip_goal })
    if (selectedTemplate.pipeline.clip_duration_preset) {
      setClipDuration({ clip_duration_preset: selectedTemplate.pipeline.clip_duration_preset })
    }
  }, [selectedTemplate])

  // 加载视频分类配置
  useEffect(() => {
    const loadCategories = async () => {
      setLoadingCategories(true)
      try {
        const response = await projectApi.getVideoCategories()
        setCategories(response.categories)
        // 设置默认选中【默认】选项
        if (response.default_category) {
          setSelectedCategory(response.default_category)
        } else if (response.categories.length > 0) {
          setSelectedCategory(response.categories[0].value)
        }
      } catch (error) {
        console.error('Failed to load video categories:', error)
        message.error('加载视频分类失败')
      } finally {
        setLoadingCategories(false)
      }
    }

    loadCategories()
  }, [])

  const onDrop = (acceptedFiles: File[]) => {
    const newFiles = { ...files, videos: [...files.videos] }

    acceptedFiles.forEach(file => {
      const extension = file.name.split('.').pop()?.toLowerCase()

      if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(extension || '')) {
        if (!newFiles.videos.some(v => v.name === file.name && v.size === file.size)) {
          newFiles.videos.push(file)
        }
        if (newFiles.videos.length === 1) {
          setProjectName(file.name.replace(/\.[^/.]+$/, ''))
        }
      } else if (extension === 'srt') {
        newFiles.srt = file
      }
    })

    setFiles(newFiles)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.avi', '.mov', '.mkv', '.webm'],
      'application/x-subrip': ['.srt']
    },
    multiple: true
  })

  const handleUpload = async () => {
    if (files.videos.length === 0) {
      message.error('请选择视频文件')
      return
    }

    if (files.videos.length > 1 && files.srt) {
      message.warning('多视频上传暂不支持附带字幕文件，将使用 AI 自动生成字幕')
    }

    if (!projectName.trim()) {
      message.error('请输入项目名称')
      return
    }

    // 检查API配置
    const hasValidApiConfig = await validateApiConfigBeforeProjectCreation()
    if (!hasValidApiConfig) {
      return
    }

    setUploading(true)
    setUploadProgress(0)
    
    try {
      // 模拟上传进度，更真实的进度显示
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 85) {
            clearInterval(progressInterval)
            return prev
          }
          // 使用递减的增量，模拟真实上传进度
          const increment = Math.max(1, Math.floor((90 - prev) / 10))
          return prev + increment
        })
      }, 300)

      console.log('开始上传文件:', {
        video_count: files.videos.length,
        srt_file: files.srt?.name || '(将使用语音识别生成)',
        project_name: projectName.trim(),
        video_category: selectedCategory
      })

      const uploadPayload = {
        project_name: projectName.trim(),
        video_category: selectedCategory,
        ...clipDuration,
        ...clipGoal,
        ...(selectedTemplate ? { template_id: selectedTemplate.id } : {}),
      }

      const newProject = files.videos.length > 1
        ? await projectApi.uploadBatch({ ...uploadPayload, video_files: files.videos })
        : await projectApi.uploadFiles({
            ...uploadPayload,
            video_file: files.videos[0],
            srt_file: files.srt,
          })
      
      console.log('上传成功，项目信息:', newProject)
      
      clearInterval(progressInterval)
      setUploadProgress(100)
      
      addProject(newProject)
      message.success('项目创建成功！正在后台处理中，请稍候...')
      
      // 重置状态
      setFiles({ videos: [] })
      setProjectName('')
      setClipDuration({ clip_duration_preset: 'standard' })
      setClipGoal({ clip_goal: 'knowledge' })
      setUploadProgress(0)
      setUploading(false)
      // 重置为默认分类
      if (categories.length > 0) {
        setSelectedCategory(categories[0].value)
      }
      
      if (onUploadSuccess) {
        onUploadSuccess(newProject.id)
      }
      
    } catch (error: any) {
      console.error('上传失败，详细错误:', error)
      
      let errorMessage = '上传失败，请重试'
      let errorType = 'error'
      
      // 根据错误类型提供更友好的错误信息
      if (error.response?.status === 413) {
        errorMessage = '文件太大，请选择较小的视频文件'
        errorType = 'warning'
      } else if (error.response?.status === 415) {
        errorMessage = '不支持的文件格式，请选择MP4、AVI、MOV、MKV或WEBM格式的视频'
        errorType = 'warning'
      } else if (error.response?.status === 400) {
        if (error.response?.data?.detail) {
          errorMessage = error.response.data.detail
        } else {
          errorMessage = '文件格式或内容有问题，请检查后重试'
        }
      } else if (error.response?.status === 500) {
        errorMessage = '服务器处理文件时出错，请稍后重试'
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = '上传超时，请检查网络连接后重试'
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail
      } else if (error.userMessage) {
        errorMessage = error.userMessage
      } else if (error.message) {
        errorMessage = error.message
      }
      
      // 显示错误信息
      if (errorType === 'warning') {
        message.warning(errorMessage)
      } else {
        message.error(errorMessage)
      }
      
      // 如果是网络错误，提供重试建议
      if (error.code === 'ECONNABORTED' || error.response?.status >= 500) {
        message.info('如果问题持续存在，请检查网络连接或联系技术支持', 5)
      }
    } finally {
      setUploading(false)
    }
  }

  const removeFile = (type: 'video' | 'srt', videoIndex?: number) => {
    setFiles(prev => {
      if (type === 'srt') {
        const next = { ...prev }
        delete next.srt
        return next
      }
      if (videoIndex == null) return prev
      const videos = prev.videos.filter((_, i) => i !== videoIndex)
      return { ...prev, videos }
    })
  }

  const hasVideos = files.videos.length > 0

  return (
    <div style={{
      borderRadius: '16px',
      padding: '0',
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      margin: '0 auto'
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: '-50%',
        right: '-50%',
        width: '200%',
        height: '200%',
        background: 'radial-gradient(circle, rgba(79, 172, 254, 0.08) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />
      

      
      <div 
        {...getRootProps()} 
        className={`upload-area ${isDragActive ? 'dragover' : ''}`}
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          marginBottom: '16px',
          background: isDragActive ? 'rgba(79, 172, 254, 0.15)' : 'var(--ac-line-2)',
          border: `2px dashed ${isDragActive ? '#4facfe' : 'rgba(79, 172, 254, 0.3)'}`,
          borderRadius: '16px',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          position: 'relative',
          backdropFilter: 'blur(10px)'
        }}
      >
        <input {...getInputProps()} />
        <div style={{
          width: '48px',
          height: '48px',
          margin: '0 auto 12px',
          background: isDragActive ? 'rgba(79, 172, 254, 0.3)' : 'rgba(79, 172, 254, 0.1)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          border: '1px solid rgba(79, 172, 254, 0.2)'
        }}>
          <InboxOutlined style={{ 
            fontSize: '20px', 
            color: isDragActive ? '#4facfe' : '#4facfe'
          }} />
        </div>
        <div>
          <Text strong style={{ 
            color: '#ffffff',
            fontSize: '16px',
            display: 'block',
            marginBottom: '8px',
            fontWeight: 600
          }}>
            {isDragActive ? '松开鼠标导入文件' : '点击或拖拽文件到此区域'}
          </Text>
          <Text style={{ color: 'var(--ac-sub)', fontSize: '14px', lineHeight: '1.5' }}>
            支持 MP4、AVI、MOV、MKV、WebM 格式，<Text style={{ color: '#52c41a', fontWeight: 600 }}>可选择导入字幕文件(.srt)或使用AI自动生成</Text>
          </Text>
        </div>
      </div>

      {/* 项目名称输入 - 只有在选择文件后才显示 */}
      {hasVideos && (
        <div style={{ marginBottom: '16px' }}>
          <Text strong style={{ color: '#ffffff', fontSize: '14px', marginBottom: '8px', display: 'block' }}>
            项目名称
          </Text>
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="请输入项目名称，用于标识您的视频项目"
            style={{ 
              height: '40px',
              borderRadius: '12px',
              fontSize: '14px',
              background: 'var(--ac-line-2)',
              border: '1px solid rgba(79, 172, 254, 0.3)',
              color: '#ffffff'
            }}
          />
        </div>
      )}

      {/* 视频分类选择 - 只有在选择文件后才显示（模板模式隐藏） */}
      {!selectedTemplate && hasVideos && (
        <div style={{ marginBottom: '16px' }}>
          <Text strong style={{ color: '#ffffff', fontSize: '14px', marginBottom: '8px', display: 'block' }}>
            视频分类
          </Text>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {categories.map(category => {
              const isSelected = selectedCategory === category.value
              return (
                <div
                  key={category.value}
                  onClick={() => setSelectedCategory(category.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: isSelected 
                      ? `2px solid ${category.color}` 
                      : '2px solid var(--ac-line)',
                    background: isSelected 
                      ? `${category.color}25` 
                      : 'var(--ac-line)',
                    color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.8)',
                    boxShadow: isSelected 
                      ? `0 0 12px ${category.color}40` 
                      : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontSize: '13px',
                    fontWeight: isSelected ? 600 : 400,
                    userSelect: 'none'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--ac-line)'
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--ac-line)'
                      e.currentTarget.style.borderColor = 'var(--ac-line)'
                    }
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{category.icon}</span>
                  <span>{category.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!selectedTemplate && hasVideos && (
        <ClipGoalSelector value={clipGoal} onChange={setClipGoal} />
      )}

      {!selectedTemplate && hasVideos && (
        <ClipDurationSelector value={clipDuration} onChange={setClipDuration} />
      )}

      {/* 文件列表 */}
      {(hasVideos || files.srt) && (
        <div style={{ marginBottom: '16px' }}>
          <Text strong style={{ color: '#ffffff', fontSize: '14px', marginBottom: '12px', display: 'block' }}>
            已选择文件{files.videos.length > 1 ? `（${files.videos.length} 个视频，将创建同一项目）` : ''}
          </Text>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {files.videos.map((video, index) => (
              <div
                key={`${video.name}-${video.size}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  background: 'var(--ac-line-2)',
                  borderRadius: '12px',
                  border: '1px solid rgba(79, 172, 254, 0.2)',
                  backdropFilter: 'blur(10px)',
                }}
              >
                <Space size="middle">
                  <div style={{
                    width: '36px',
                    height: '36px',
                    background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(79, 172, 254, 0.3)',
                  }}>
                    <VideoCameraOutlined style={{ color: '#ffffff', fontSize: '16px' }} />
                  </div>
                  <div>
                    <Text style={{ color: '#ffffff', fontWeight: 600, display: 'block', fontSize: '14px' }}>
                      {index + 1}. {video.name}
                    </Text>
                    <Text style={{ color: 'var(--ac-sub)', fontSize: '13px' }}>
                      {(video.size / 1024 / 1024).toFixed(2)} MB
                    </Text>
                  </div>
                </Space>
                <Button
                  size="small"
                  type="text"
                  onClick={() => removeFile('video', index)}
                  style={{
                    color: '#ff6b6b',
                    borderRadius: '8px',
                    padding: '4px 12px',
                    fontSize: '12px',
                  }}
                >
                  移除
                </Button>
              </div>
            ))}
            {files.srt && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '16px',
                background: 'var(--ac-line-2)',
                borderRadius: '12px',
                border: '1px solid rgba(82, 196, 26, 0.3)',
                backdropFilter: 'blur(10px)'
              }}>
                <Space size="middle">
                  <div style={{
                    width: '36px',
                    height: '36px',
                    background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(82, 196, 26, 0.3)'
                  }}>
                    <FileTextOutlined style={{ color: '#ffffff', fontSize: '16px' }} />
                  </div>
                  <div>
                    <Text style={{ color: '#ffffff', fontWeight: 600, display: 'block', fontSize: '14px' }}>
                      {files.srt.name}
                    </Text>
                    <Text style={{ color: 'var(--ac-sub)', fontSize: '13px' }}>
                      字幕文件
                    </Text>
                  </div>
                </Space>
                <Button 
                  size="small" 
                  type="text" 
                  onClick={() => removeFile('srt')}
                  style={{ 
                    color: '#ff6b6b',
                    borderRadius: '8px',
                    padding: '4px 12px',
                    fontSize: '12px'
                  }}
                >
                  移除
                </Button>
              </div>
            )}
          </Space>
          
          {/* AI字幕生成提示 */}
          {hasVideos && !files.srt && files.videos.length === 1 && (
            <div style={{
              marginTop: '12px',
              padding: '12px 16px',
              background: 'rgba(82, 196, 26, 0.1)',
              border: '1px solid rgba(82, 196, 26, 0.3)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <SubnodeOutlined style={{ color: '#52c41a', fontSize: '16px' }} />
              <Text style={{ color: '#52c41a', fontSize: '14px', fontWeight: 500 }}>
                将使用AI语音识别自动生成字幕文件
              </Text>
            </div>
          )}
        </div>
      )}

      {/* 导入进度 */}
      {uploading && (
        <div style={{ 
          marginBottom: '16px',
          padding: '20px',
          background: 'var(--ac-line-2)',
          borderRadius: '16px',
          border: '1px solid rgba(79, 172, 254, 0.3)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <Text style={{ color: '#ffffff', fontWeight: 600, fontSize: '14px' }}>导入进度</Text>
            <Text style={{ color: '#4facfe', float: 'right', fontWeight: 600, fontSize: '14px' }}>
              {uploadProgress}%
            </Text>
          </div>
          <Progress 
            percent={uploadProgress} 
            status="active"
            strokeColor={{
              '0%': '#4facfe',
              '100%': '#00f2fe',
            }}
            trailColor="var(--ac-line)"
            strokeWidth={6}
            showInfo={false}
            style={{ marginBottom: '8px' }}
          />
          <Text style={{ color: 'var(--ac-sub)', fontSize: '13px', marginTop: '8px', display: 'block', textAlign: 'center' }}>
            正在导入文件，请稍候...
          </Text>
        </div>
      )}

      {/* 上传按钮 - 只有在选择文件后才显示 */}
      {hasVideos && (
        <div style={{ textAlign: 'center', marginTop: '8px' }}>
          <Button 
            type="primary" 
            size="large"
            loading={uploading}
            disabled={!hasVideos || !projectName.trim()}
            onClick={handleUpload}
            style={{
              height: '48px',
              padding: '0 32px',
              borderRadius: '24px',
              background: uploading ? '#666666' : 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
              border: 'none',
              fontSize: '16px',
              fontWeight: 600,
              boxShadow: uploading ? 'none' : '0 4px 20px rgba(79, 172, 254, 0.4)',
              transition: 'all 0.3s ease'
            }}
          >
            {uploading ? '导入中...' : files.videos.length > 1 ? `开始导入 ${files.videos.length} 个视频` : '开始导入并处理'}
          </Button>
        </div>
      )}
    </div>
  )
}

export default FileUpload
