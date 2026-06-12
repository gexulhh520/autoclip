import React, { useCallback, useEffect, useState } from 'react'

import { Button, Popconfirm, Tooltip, message } from 'antd'

import {

  CheckCircleOutlined,

  CloseCircleOutlined,

  DownOutlined,

  LoadingOutlined,

  MinusCircleOutlined,

  ReloadOutlined,

  RightOutlined,

} from '@ant-design/icons'

import {

  projectApi,

  PipelineStepsResponse,

  PipelineStepInfo,

  PipelineStepResultResponse,

} from '../services/api'

import PipelineStepResultView from './PipelineStepResultView'



interface PipelineStepsPanelProps {

  projectId: string

  sourceId?: string | null

  onPipelineFinished?: () => void

}



const statusLabel: Record<PipelineStepInfo['status'], string> = {

  pending: '待执行',

  running: '执行中',

  completed: '已完成',

  failed: '失败',

  skipped: '已跳过',

}



const expandableStatuses: PipelineStepInfo['status'][] = [

  'completed',

  'failed',

  'running',

]



const PipelineStepsPanel: React.FC<PipelineStepsPanelProps> = ({

  projectId,

  sourceId,

  onPipelineFinished,

}) => {

  const [data, setData] = useState<PipelineStepsResponse | null>(null)

  const [loading, setLoading] = useState(true)

  const [runningStepId, setRunningStepId] = useState<string | null>(null)

  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)

  const [stepResults, setStepResults] = useState<Record<string, PipelineStepResultResponse>>({})

  const [loadingResultId, setLoadingResultId] = useState<string | null>(null)
  const [resettingStuck, setResettingStuck] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await projectApi.getPipelineSteps(projectId, sourceId ?? undefined)
      setData(res)
      if (res.stale_recovered) {
        message.info('检测到流水线任务已中断，状态已自动恢复，可从此步继续')
      }
      return res

    } catch (e) {

      console.error('load pipeline steps failed', e)

      return null

    } finally {

      setLoading(false)

    }

  }, [projectId, sourceId])



  useEffect(() => {

    load()

  }, [load])



  useEffect(() => {
    const shouldPoll = data?.is_pipeline_running
    if (!shouldPoll) return



    const timer = window.setInterval(async () => {

      const res = await load()

      if (
        res &&
        !res.is_pipeline_running &&
        onPipelineFinished
      ) {
        const step6 = res.steps?.find((s) => s.id === 'step6_video')
        const step6Ready =
          step6?.status === 'completed' && (step6?.item_count ?? 0) > 0
        if (res.project_status === 'completed' || step6Ready) {
          onPipelineFinished()
        }
      }

    }, 3000)

    return () => window.clearInterval(timer)

  }, [data?.is_pipeline_running, data?.project_status, load, onPipelineFinished])



  const loadStepResult = useCallback(

    async (stepId: string, force = false) => {

      if (!force && stepResults[stepId]) return stepResults[stepId]

      setLoadingResultId(stepId)

      try {

        const result = await projectApi.getPipelineStepResult(projectId, stepId)

        setStepResults((prev) => ({ ...prev, [stepId]: result }))

        return result

      } catch (err: unknown) {

        const detail =

          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail

        message.error(detail || '加载步骤结果失败')

        return null

      } finally {

        setLoadingResultId(null)

      }

    },

    [projectId, stepResults]

  )



  const toggleStepExpand = async (step: PipelineStepInfo) => {

    if (!expandableStatuses.includes(step.status)) return



    if (expandedStepId === step.id) {

      setExpandedStepId(null)

      return

    }



    setExpandedStepId(step.id)

    if (!stepResults[step.id]) {

      await loadStepResult(step.id)

    }

  }



  const handleRunStep = async (step: PipelineStepInfo) => {
    if (!step.can_run) return

    setRunningStepId(step.id)

    const runOnce = async () => {
      await projectApi.runPipelineStep(projectId, step.id, true)
    }

    try {
      try {
        await runOnce()
      } catch (err: unknown) {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        if (detail && detail.includes('流水线正在执行中')) {
          await projectApi.resetStuckPipeline(projectId)
          await runOnce()
        } else {
          throw err
        }
      }

      message.success(`已从「${step.name}」开始执行`)

      setStepResults((prev) => {

        const next = { ...prev }

        delete next[step.id]

        return next

      })

      if (expandedStepId === step.id) {

        setExpandedStepId(null)

      }

      await load()

    } catch (err: unknown) {

      const detail =

        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail

      message.error(detail || '启动步骤失败')

    } finally {

      setRunningStepId(null)

    }

  }



  const handleResetStuck = async () => {
    setResettingStuck(true)
    try {
      const res = await projectApi.resetStuckPipeline(projectId)
      message.success(res.message || '已解除卡住状态')
      await load()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '解除卡住状态失败')
    } finally {
      setResettingStuck(false)
    }
  }

  const handleRefresh = async () => {

    const activeStepId = expandedStepId

    await load()

    if (activeStepId) {

      await loadStepResult(activeStepId, true)

    }

  }



  const renderIcon = (step: PipelineStepInfo) => {

    switch (step.status) {

      case 'completed':

        return <CheckCircleOutlined style={{ color: 'var(--ok)' }} />

      case 'running':

        return <LoadingOutlined style={{ color: 'var(--accent)' }} />

      case 'failed':

        return <CloseCircleOutlined style={{ color: 'var(--error)' }} />

      case 'skipped':

        return <MinusCircleOutlined style={{ color: 'var(--muted)' }} />

      default:

        return (

          <span

            style={{

              width: 14,

              height: 14,

              borderRadius: '50%',

              border: '1.5px solid var(--line)',

              display: 'inline-block',

            }}

          />

        )

    }

  }



  if (loading && !data) {

    return (

      <div

        style={{

          padding: '24px',

          borderRadius: 16,

          border: '1px solid var(--ac-line)',

          background: 'var(--ac-card)',

          color: 'var(--ac-muted)',

          fontSize: 13,

        }}

      >

        加载流水线步骤…

      </div>

    )

  }



  const steps = data?.steps ?? []
  const activeSteps = steps.filter((s) => s.status !== 'skipped')
  const overallPercent = data?.progress?.percent
  const isStuck =
    data?.project_status === 'processing' && !data?.is_pipeline_running

  return (

    <div

      style={{

        borderRadius: 16,

        border: '1px solid var(--ac-line)',

        background: 'var(--ac-card)',

        padding: '20px 22px',

        marginBottom: 24,

      }}

    >

      <div

        style={{

          display: 'flex',

          justifyContent: 'space-between',

          alignItems: 'flex-start',

          marginBottom: 16,

          gap: 12,

        }}

      >

        <div>

          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ac-ink)' }}>

            处理流水线

          </div>

          <div style={{ fontSize: 13, color: 'var(--ac-sub)', marginTop: 4 }}>
            {data?.template_name ? `${data.template_name} · ` : ''}
            {data?.source_filename ? `${data.source_filename} · ` : ''}
            从下载/上传到切片导出，共 {activeSteps.length} 个步骤
            {steps.length > activeSteps.length ? `（${steps.length - activeSteps.length} 步已跳过）` : ''}
            。任意步骤均可重新执行（会清除该步及之后输出）。
          </div>

          {data?.progress?.message && (

            <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 6 }}>

              {data.progress.message}

              {overallPercent != null ? ` · ${overallPercent}%` : ''}

            </div>

          )}

        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {isStuck ? (
            <Button
              size="small"
              loading={resettingStuck}
              onClick={() => handleResetStuck()}
              style={{ borderRadius: 6, fontSize: 12 }}
            >
              解除卡住
            </Button>
          ) : null}
          <Button

          type="text"

          size="small"

          icon={<ReloadOutlined />}

          onClick={() => handleRefresh()}

          style={{ color: 'var(--ac-sub)' }}

        >

          刷新
        </Button>
        </div>
      </div>



      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {steps.map((step, index) => {

          const canExpand = expandableStatuses.includes(step.status)

          const isExpanded = expandedStepId === step.id

          const result = stepResults[step.id]

          const isLoadingResult = loadingResultId === step.id
          const showRunAction = step.status !== 'running' && step.status !== 'skipped'
          const canExecute = step.can_run && !data?.is_pipeline_running
          const runLabel =
            step.status === 'completed' || step.status === 'failed' ? '重新执行' : '从此步继续'
          const runConfirmTitle =
            step.status === 'completed' || step.status === 'failed'
              ? `重新执行「${step.name}」？将清除该步骤及之后的输出。`
              : `从「${step.name}」开始执行？将清除该步骤及之后的输出。`

          return (

            <div

              key={step.id}

              style={{

                borderBottom:

                  index < steps.length - 1 ? '1px solid var(--ac-line)' : 'none',

              }}

            >

              <div

                role={canExpand ? 'button' : undefined}

                tabIndex={canExpand ? 0 : undefined}

                onClick={() => canExpand && toggleStepExpand(step)}

                onKeyDown={(e) => {

                  if (canExpand && (e.key === 'Enter' || e.key === ' ')) {

                    e.preventDefault()

                    toggleStepExpand(step)

                  }

                }}

                style={{

                  display: 'flex',

                  alignItems: 'flex-start',

                  gap: 12,

                  padding: '12px 0',

                  cursor: canExpand ? 'pointer' : 'default',

                  borderRadius: 8,

                }}

              >

                <div style={{ paddingTop: 2, flexShrink: 0 }}>{renderIcon(step)}</div>

                <div style={{ flex: 1, minWidth: 0 }}>

                  <div

                    style={{

                      display: 'flex',

                      alignItems: 'center',

                      gap: 8,

                      flexWrap: 'wrap',

                    }}

                  >

                    {canExpand ? (

                      <span style={{ color: 'var(--ac-muted)', fontSize: 10, display: 'inline-flex' }}>

                        {isExpanded ? <DownOutlined /> : <RightOutlined />}

                      </span>

                    ) : null}

                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ac-ink)' }}>

                      {index + 1}. {step.name}

                    </span>

                    <span

                      style={{

                        fontSize: 11,

                        color: 'var(--ac-muted)',

                        padding: '1px 6px',

                        borderRadius: 4,

                        background: 'var(--ac-line-2, var(--ac-line))',

                      }}

                    >

                      {statusLabel[step.status]}

                    </span>

                    {step.item_count != null && step.status === 'completed' && (

                      <span style={{ fontSize: 12, color: 'var(--ac-sub)' }}>

                        {step.item_count} 项

                      </span>

                    )}

                    {canExpand && !isExpanded ? (

                      <span style={{ fontSize: 12, color: 'var(--ac-muted)' }}>点击查看结果</span>

                    ) : null}

                  </div>

                  <div style={{ fontSize: 12, color: 'var(--ac-sub)', marginTop: 4 }}>

                    {step.description}

                  </div>

                  {step.message && (

                    <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 4 }}>

                      {step.message}

                    </div>

                  )}

                </div>

                <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  {showRunAction ? (
                    canExecute ? (
                      <Popconfirm
                        title={runConfirmTitle}
                        okText="执行"
                        cancelText="取消"
                        onConfirm={() => handleRunStep(step)}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <Button
                          size="small"
                          loading={runningStepId === step.id}
                          onClick={(e) => e.stopPropagation()}
                          style={{ borderRadius: 6, fontSize: 12 }}
                        >
                          {runLabel}
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Tooltip
                        title={
                          data?.is_pipeline_running
                            ? '流水线正在执行中'
                            : step.run_blocked_reason || '当前无法执行'
                        }
                      >
                        <Button
                          size="small"
                          disabled
                          style={{ borderRadius: 6, fontSize: 12 }}
                        >
                          {runLabel}
                        </Button>
                      </Tooltip>
                    )
                  ) : null}
                </div>

              </div>



              {isExpanded ? (

                <div

                  style={{

                    marginLeft: 26,

                    marginBottom: 12,

                    padding: '12px 14px',

                    borderRadius: 10,

                    border: '1px solid var(--ac-line)',

                    background: 'var(--ac-line-2, var(--ac-line))',

                  }}

                >

                  <div

                    style={{

                      fontSize: 12,

                      color: 'var(--ac-sub)',

                      fontWeight: 500,

                      marginBottom: 10,

                    }}

                  >

                    解析结果

                  </div>

                  {isLoadingResult ? (

                    <div style={{ fontSize: 12, color: 'var(--ac-muted)', padding: '4px 0' }}>

                      加载中…

                    </div>

                  ) : result ? (

                    <PipelineStepResultView result={result} />

                  ) : (

                    <div style={{ fontSize: 12, color: 'var(--ac-muted)', padding: '4px 0' }}>

                      暂无结果

                    </div>

                  )}

                </div>

              ) : null}

            </div>

          )

        })}

      </div>

    </div>

  )

}



export default PipelineStepsPanel

