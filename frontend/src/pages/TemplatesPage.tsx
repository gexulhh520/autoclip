import React, { useEffect, useState } from 'react'
import { Layout, Typography, Spin, Empty, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import TemplateCard from '../components/TemplateCard'
import { GeneTemplateSummary, templatesApi } from '../services/api'
import { persistSelectedTemplate } from '../utils/geneTemplate'

const { Content } = Layout
const { Title, Text } = Typography

const TemplatesPage: React.FC = () => {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<GeneTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTemplates = async () => {
      setLoading(true)
      try {
        const response = await templatesApi.list()
        setTemplates(response.templates)
      } catch (error) {
        console.error('Failed to load templates:', error)
        message.error('加载模板列表失败')
        setTemplates([])
      } finally {
        setLoading(false)
      }
    }
    loadTemplates()
  }, [])

  const handleSelectTemplate = (template: GeneTemplateSummary) => {
    persistSelectedTemplate(template)
    navigate('/', { state: { selectedTemplate: template } })
  }

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--ac-bg)' }}>
      <Content style={{ padding: '40px 56px 56px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ marginBottom: '32px' }}>
            <Title level={2} style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px', color: 'var(--ac-ink)' }}>
              基因模板
            </Title>
            <Text style={{ color: 'var(--ac-sub)', fontSize: '14px' }}>
              先选择生成风格，再导入视频。每个模板有独立的剪辑逻辑与 Prompt。
            </Text>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <Spin size="large" />
            </div>
          ) : templates.length === 0 ? (
            <Empty description="暂无可用模板" />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '24px',
                justifyContent: 'start',
              }}
            >
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={handleSelectTemplate}
                />
              ))}
            </div>
          )}
        </div>
      </Content>
    </Layout>
  )
}

export default TemplatesPage
