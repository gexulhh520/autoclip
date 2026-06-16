import React, { useEffect, useState } from 'react'
import { message } from 'antd'
import { Film, Music2, Sparkles, Type, Workflow } from 'lucide-react'
import OpenCutPropertiesEmpty from './opencut/OpenCutPropertiesEmpty'
import { blockDuration, useEditSessionStore } from '../../stores/useEditSessionStore'
import { collectTrimSnapPoints, snapTime } from '../../utils/editTimeline'
import { srtTimeToSeconds, secondsToSrtTime } from '../../utils/srtTime'
import { projectApi } from '../../services/api'
import EditorInspectorSelectionBanner from './EditorInspectorSelectionBanner'
import OpenCutTextParamsPanel from './OpenCutTextParamsPanel'
import TransitionTypePicker from './TransitionTypePicker'
import TextPresetPicker from './TextPresetPicker'
import TextAnimationPanel from './TextAnimationPanel'
import { readTextPresetId } from '../../editor/effects'
import {
  blockHasMigratedTemplateOverlays,
  getTemplateBlockId,
  getTemplateOverlayIdsForBlock,
  getTemplateOverlaysForBlock,
} from '../../editor/migration/templateCaptionOverlays'
import { readStringParam } from '../../editor/opencut-text/params'
import type { EditOverlayElement } from '../../types/editSession'
import {
  patchBlockOverlayAnimation,
  readTextAnimationFromBlockOverlay,
  readTextAnimationFromParams,
  writeTextAnimationToParams,
} from '../../editor/textAnimation/params'
import { DEFAULT_TEXT_ANIMATION_CONFIG, type TextAnimationConfig } from '../../editor/textAnimation/types'

interface EditorInspectorProps {
  projectId: string
}

type InspectorTab = 'video' | 'audio' | 'text' | 'animation' | 'transition'

const INSPECTOR_TAB_META: Record<
  InspectorTab,
  { label: string; icon: React.ReactNode }
> = {
  video: { label: '画面', icon: <Film size={16} strokeWidth={1.75} /> },
  audio: { label: '音频', icon: <Music2 size={16} strokeWidth={1.75} /> },
  text: { label: '文本', icon: <Type size={16} strokeWidth={1.75} /> },
  animation: { label: '动画', icon: <Sparkles size={16} strokeWidth={1.75} /> },
  transition: { label: '转场', icon: <Workflow size={16} strokeWidth={1.75} /> },
}

const EditorInspector: React.FC<EditorInspectorProps> = ({ projectId }) => {
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedCaptionBlockId = useEditSessionStore((state) => state.selectedCaptionBlockId)
  const selectedOverlayId = useEditSessionStore((state) => state.selectedOverlayId)
  const selectedOverlayIds = useEditSessionStore((state) => state.selectedOverlayIds)
  const selectedCaptionBlockIds = useEditSessionStore((state) => state.selectedCaptionBlockIds)
  const inspectorTab = useEditSessionStore((state) => state.inspectorTab)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const updateBlockOverlay = useEditSessionStore((state) => state.updateBlockOverlay)
  const updateBlockTrim = useEditSessionStore((state) => state.updateBlockTrim)
  const updateBlockAudio = useEditSessionStore((state) => state.updateBlockAudio)
  const updateBlockPlaybackRate = useEditSessionStore((state) => state.updateBlockPlaybackRate)
  const updateBlockTransition = useEditSessionStore((state) => state.updateBlockTransition)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const regenerateBlockContent = useEditSessionStore((state) => state.regenerateBlockContent)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)
  const updateOverlayElement = useEditSessionStore((state) => state.updateOverlayElement)
  const updateOverlayParams = useEditSessionStore((state) => state.updateOverlayParams)
  const updateOverlaysParams = useEditSessionStore((state) => state.updateOverlaysParams)
  const updateOverlayElements = useEditSessionStore((state) => state.updateOverlayElements)
  const removeOverlayElement = useEditSessionStore((state) => state.removeOverlayElement)
  const deleteSelectedOverlays = useEditSessionStore((state) => state.deleteSelectedOverlays)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const applyTextPreset = useEditSessionStore((state) => state.applyTextPreset)
  const applyTextPresetToOverlays = useEditSessionStore((state) => state.applyTextPresetToOverlays)
  const applyBatchTextAnimation = useEditSessionStore((state) => state.applyBatchTextAnimation)

  const [regenerating, setRegenerating] = useState(false)
  const [srtBoundaries, setSrtBoundaries] = useState<number[]>([])

  const selectedBlock =
    session?.sequence.find((block) => block.id === selectedBlockId) ?? session?.sequence[0]
  const captionEditingBlock =
    session?.sequence.find((block) => block.id === selectedCaptionBlockId) ?? null
  const selectedOverlay =
    session?.overlay_elements?.find((item) => item.id === selectedOverlayId) ?? null

  useEffect(() => {
    if (!selectedBlock?.media.source_start_sec || !selectedBlock?.media.source_end_sec) {
      setSrtBoundaries([])
      return
    }
    const startTime = secondsToSrtTime(
      selectedBlock.media.source_start_sec + selectedBlock.trim.in_sec
    )
    const endTime = secondsToSrtTime(
      selectedBlock.media.source_start_sec + selectedBlock.trim.out_sec
    )
    let cancelled = false
    void projectApi
      .getTimelineSrtSegments(projectId, startTime, endTime, null, 2)
      .then((res) => {
        if (cancelled || !selectedBlock) return
        const sourceStart = selectedBlock.media.source_start_sec ?? 0
        const boundaries = res.segments.flatMap((seg) => [
          srtTimeToSeconds(seg.start_time) - sourceStart,
          srtTimeToSeconds(seg.end_time) - sourceStart,
        ])
        setSrtBoundaries(boundaries)
      })
      .catch(() => {
        if (!cancelled) setSrtBoundaries([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, selectedBlock?.id, selectedBlock?.trim.in_sec, selectedBlock?.trim.out_sec])

  if (!session) {
    return (
      <aside className="editor-inspector-panel oc-panel">
        <div className="oc-panel-empty">加载中…</div>
      </aside>
    )
  }

  const maxDur = selectedBlock
    ? selectedBlock.duration_sec > 0
      ? selectedBlock.duration_sec
      : Math.max(selectedBlock.trim.out_sec, blockDuration(selectedBlock))
    : 0
  const trimSnapPoints = selectedBlock ? collectTrimSnapPoints(maxDur, srtBoundaries) : []
  const overlay = captionEditingBlock?.overlay ?? selectedBlock?.overlay
  const totalTimelineSec = session.sequence.reduce(
    (sum, block) => sum + blockDuration(block),
    0
  )

  const resolveSelectedOverlays = (): EditOverlayElement[] => {
    const ids =
      selectedOverlayIds.length > 0
        ? selectedOverlayIds
        : selectedOverlayId
          ? [selectedOverlayId]
          : []
    return ids
      .map((id) => session?.overlay_elements?.find((item) => item.id === id))
      .filter((item): item is EditOverlayElement => Boolean(item))
  }

  const renderOverlayTextEditor = (overlayItems: EditOverlayElement[]) => {
    if (overlayItems.length === 0) return null
    const isBatch = overlayItems.length > 1
    const overlayIds = overlayItems.map((item) => item.id)
    const seed = overlayItems[0]!
    const presetIds = overlayItems.map((item) => readTextPresetId(item.params ?? {}))
    const activePresetId = presetIds.every((id) => id === presetIds[0]) ? presetIds[0] : null

    const applyParams = (patch: Record<string, string | number | boolean>) => {
      if (isBatch) updateOverlaysParams(overlayIds, patch)
      else updateOverlayParams(seed.id, patch)
    }
    const applyParamKey = (key: string, value: string | number | boolean) => {
      applyParams({ [key]: value })
    }

    const startMixed =
      isBatch && overlayItems.some((item) => item.start_sec !== seed.start_sec)
    const durationMixed =
      isBatch && overlayItems.some((item) => item.duration_sec !== seed.duration_sec)

    return (
      <React.Fragment key={isBatch ? 'batch' : seed.id}>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">花字预设</div>
          <TextPresetPicker
            activePresetId={activePresetId}
            onSelect={(presetId) => {
              if (isBatch) applyTextPresetToOverlays(overlayIds, presetId)
              else applyTextPreset(seed.id, presetId)
            }}
          />
        </div>
        <OpenCutTextParamsPanel
          elements={overlayItems}
          onChange={applyParamKey}
          onParamsChange={applyParams}
        />
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            起始 ({seed.start_sec.toFixed(1)}s{startMixed ? ' · 多种' : ''})
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={Math.max(totalTimelineSec - 0.5, 0.5)}
            step={0.1}
            value={seed.start_sec}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (isBatch) updateOverlayElements(overlayIds, { start_sec: value })
              else updateOverlayElement(seed.id, { start_sec: value })
            }}
          />
          <div className="editor-inspector-label" style={{ marginTop: 12 }}>
            时长 ({seed.duration_sec.toFixed(1)}s{durationMixed ? ' · 多种' : ''})
          </div>
          <input
            className="editor-range"
            type="range"
            min={0.5}
            max={Math.max(totalTimelineSec, 1)}
            step={0.1}
            value={seed.duration_sec}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (isBatch) updateOverlayElements(overlayIds, { duration_sec: value })
              else updateOverlayElement(seed.id, { duration_sec: value })
            }}
          />
        </div>
        <div className="editor-inspector-section">
          <button
            type="button"
            className="editor-header__back"
            onClick={() => {
              if (isBatch) deleteSelectedOverlays()
              else {
                removeOverlayElement(seed.id)
                if (selectedOverlayId === seed.id) {
                  setSelectedOverlayId(null)
                }
              }
            }}
          >
            {isBatch ? `删除 ${overlayItems.length} 个文本层` : '删除文本层'}
          </button>
        </div>
      </React.Fragment>
    )
  }

  const renderAiNarrationButton = (blockId: string) => (
    <div className="editor-inspector-section">
      <button
        type="button"
        className="editor-header__back"
        disabled={regenerating || saving}
        onClick={async () => {
          setRegenerating(true)
          try {
            await regenerateBlockContent(projectId, blockId, 'both')
            message.success('文案已重写')
          } catch (error: unknown) {
            message.error(error instanceof Error ? error.message : 'AI 重写失败')
          } finally {
            setRegenerating(false)
          }
        }}
      >
        {regenerating ? 'AI 生成中…' : 'AI 写旁白'}
      </button>
    </div>
  )


  const renderVideoTab = () => {
    if (!selectedBlock) {
      return <div className="editor-empty-hint">选中时间线片段后调节画面</div>
    }
    return (
      <>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">基础</div>
          <div className="editor-inspector-value">{selectedBlock.title}</div>
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            裁剪入点 ({selectedBlock.trim.in_sec.toFixed(1)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={Math.max(maxDur - 0.1, 0.1)}
            step={0.1}
            value={selectedBlock.trim.in_sec}
            onChange={(event) => {
              const raw = Number(event.target.value)
              const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
              updateBlockTrim(selectedBlock.id, {
                in_sec: Math.min(snapped, selectedBlock.trim.out_sec - 0.1),
              })
            }}
          />
          <div className="editor-inspector-label" style={{ marginTop: 12 }}>
            裁剪出点 ({selectedBlock.trim.out_sec.toFixed(1)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={selectedBlock.trim.in_sec + 0.1}
            max={maxDur}
            step={0.1}
            value={selectedBlock.trim.out_sec}
            onChange={(event) => {
              const raw = Number(event.target.value)
              const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
              updateBlockTrim(selectedBlock.id, {
                out_sec: Math.max(snapped, selectedBlock.trim.in_sec + 0.1),
              })
            }}
          />
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            播放倍速 ({(selectedBlock.playback_rate ?? 1).toFixed(2)}×)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={selectedBlock.playback_rate ?? 1}
            onChange={(event) =>
              updateBlockPlaybackRate(selectedBlock.id, Number(event.target.value))
            }
          />
          <div className="editor-inspector-muted" style={{ marginTop: 8 }}>
            2× 表示时间线时长减半，预览与导出一致
          </div>
        </div>
      </>
    )
  }

  const renderAudioTab = () => {
    if (!selectedBlock) {
      return <div className="editor-empty-hint">选中片段调节音量与淡入淡出</div>
    }
    const blockDurationSec = blockDuration(selectedBlock)
    const maxFade = Math.max(0, blockDurationSec / 2)
    return (
      <>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            片段音量 ({Math.round(selectedBlock.audio.volume * 100)}%)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={selectedBlock.audio.volume}
            onChange={(event) =>
              updateBlockAudio(selectedBlock.id, { volume: Number(event.target.value) })
            }
          />
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">BGM 设置</div>
          <label className="editor-modal__check">
            <input
              type="checkbox"
              checked={session.audio_settings.use_source_video}
              onChange={(event) =>
                updateAudioSettings({ use_source_video: event.target.checked })
              }
            />
            导出从原片重切
          </label>
          <label className="editor-modal__check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={session.audio_settings.bgm_duck_enabled ?? true}
              onChange={(event) =>
                updateAudioSettings({ bgm_duck_enabled: event.target.checked })
              }
            />
            人声 Ducking
          </label>
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            淡入 ({(selectedBlock.audio.fade_in_sec ?? 0).toFixed(1)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={maxFade}
            step={0.1}
            value={selectedBlock.audio.fade_in_sec ?? 0}
            onChange={(event) =>
              updateBlockAudio(selectedBlock.id, { fade_in_sec: Number(event.target.value) })
            }
          />
        </div>
      </>
    )
  }

  const renderTextTab = () => {
    const multiCaptionCount = selectedCaptionBlockIds.length
    const selectedOverlays = resolveSelectedOverlays()

    if (selectedOverlays.length > 0 && multiCaptionCount === 0) {
      const single = selectedOverlays.length === 1 ? selectedOverlays[0]! : null
      const roleLabel = single ? readStringParam(single.params, 'template.role', '') : ''
      const templateBlockId = single ? getTemplateBlockId(single) : null
      return (
        <>
          {roleLabel ? (
            <div className="editor-inspector-section">
              <div className="editor-inspector-label">模板旁白 · {roleLabel}</div>
            </div>
          ) : null}
          {renderOverlayTextEditor(selectedOverlays)}
          {templateBlockId ? renderAiNarrationButton(templateBlockId) : null}
        </>
      )
    }

    if (multiCaptionCount > 1) {
      return (
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">已选中 {multiCaptionCount} 条模板字幕</div>
          <div className="editor-inspector-muted">
            可在预览区框选或 Shift/Ctrl 多选，拖拽可成组调整位置；在「动画」Tab 批量设置动效
          </div>
        </div>
      )
    }

    const blockTemplateOverlays =
      selectedBlock && !captionEditingBlock
        ? getTemplateOverlaysForBlock(session, selectedBlock.id)
        : []

    if (blockTemplateOverlays.length > 0) {
      return (
        <>
          {blockTemplateOverlays.map((overlayItem) => (
            <React.Fragment key={overlayItem.id}>
              {blockTemplateOverlays.length > 1 ? (
                <div className="editor-inspector-section">
                  <div className="editor-inspector-label">
                    {readStringParam(overlayItem.params, 'template.role', '旁白')}
                  </div>
                </div>
              ) : null}
              {renderOverlayTextEditor([overlayItem])}
            </React.Fragment>
          ))}
          {renderAiNarrationButton(selectedBlock!.id)}
        </>
      )
    }

    if (!overlay || (!captionEditingBlock && !selectedBlock)) {
      return (
        <div className="editor-empty-hint">
          选中片段或自由文本层后编辑；按 T 在播放头添加文本
        </div>
      )
    }

    const captionBlock = captionEditingBlock ?? selectedBlock!
    const pendingOverlays = getTemplateOverlaysForBlock(session, captionBlock.id)
    if (pendingOverlays.length > 0) {
      return (
        <>
          {pendingOverlays.map((overlayItem) => renderOverlayTextEditor([overlayItem]))}
          {renderAiNarrationButton(captionBlock.id)}
        </>
      )
    }

    return (
      <div className="editor-empty-hint">
        该片段暂无旁白文本层，可在预览区按 T 添加自由文本
      </div>
    )
  }

  const renderTransitionTab = () => {
    if (!selectedBlock) {
      return <div className="editor-empty-hint">选中片段后设置至下一片段的转场</div>
    }
    const blockIndex = session.sequence.findIndex((item) => item.id === selectedBlock.id)
    const isLast = blockIndex < 0 || blockIndex >= session.sequence.length - 1
    if (isLast) {
      return <div className="editor-empty-hint">最后一个片段无需设置转场</div>
    }
    const transition = selectedBlock.transition_out ?? 'cut'
    return (
      <>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">转场类型（至下一片段）</div>
          <TransitionTypePicker
            value={transition}
            onChange={(value) => updateBlockTransition(selectedBlock.id, value)}
          />
          <p className="editor-inspector-muted" style={{ marginTop: 10 }}>
            也可点击时间线片段衔接处的标记快速切换
          </p>
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            转场时长 ({session.audio_settings.transition_duration_sec.toFixed(2)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0.1}
            max={1.5}
            step={0.05}
            value={session.audio_settings.transition_duration_sec}
            onChange={(event) =>
              updateAudioSettings({ transition_duration_sec: Number(event.target.value) })
            }
          />
        </div>
      </>
    )
  }


  const renderAnimationTab = () => {
    const blockTemplateOverlayIds = selectedBlock
      ? getTemplateOverlayIdsForBlock(session, selectedBlock.id)
      : []
    const overlayIds =
      selectedOverlayIds.length > 0
        ? selectedOverlayIds
        : selectedOverlay
          ? [selectedOverlay.id]
          : blockTemplateOverlayIds
    const captionIds =
      selectedCaptionBlockIds.length > 0
        ? selectedCaptionBlockIds.filter(
            (blockId) => !blockHasMigratedTemplateOverlays(session, blockId)
          )
        : captionEditingBlock &&
            !blockHasMigratedTemplateOverlays(session, captionEditingBlock.id)
          ? [captionEditingBlock.id]
          : []
    const totalSelected = overlayIds.length + captionIds.length

    if (totalSelected === 0) {
      return (
        <div className="editor-empty-hint">
          选中字幕或自由文本层后设置入场、出场或循环动画
        </div>
      )
    }

    const resolveSeedConfig = () => {
      if (overlayIds.length > 0) {
        const element = session.overlay_elements?.find((item) => item.id === overlayIds[0])
        if (element) return readTextAnimationFromParams(element.params ?? {})
      }
      if (captionIds.length > 0) {
        const block = session.sequence.find((item) => item.id === captionIds[0])
        if (block?.overlay) return readTextAnimationFromBlockOverlay(block.overlay)
      }
      return DEFAULT_TEXT_ANIMATION_CONFIG
    }

    const applyAnimation = (next: TextAnimationConfig) => {
      applyBatchTextAnimation({ overlayIds, captionBlockIds: captionIds }, next)
    }

    if (totalSelected > 1) {
      const summaryParts: string[] = []
      if (overlayIds.length > 0) summaryParts.push(`${overlayIds.length} 个文本层`)
      if (captionIds.length > 0) summaryParts.push(`${captionIds.length} 条字幕`)
      return (
        <>
          <div className="editor-inspector-section">
            <div className="editor-inspector-label">已选中 {summaryParts.join(' · ')}</div>
            <div className="editor-inspector-muted">以下动效将批量应用到全部选中项</div>
          </div>
          <TextAnimationPanel config={resolveSeedConfig()} onChange={applyAnimation} />
        </>
      )
    }

    if (overlayIds.length === 1) {
      const element = session.overlay_elements?.find((item) => item.id === overlayIds[0])
      if (element) {
        const config = readTextAnimationFromParams(element.params ?? {})
        return (
          <TextAnimationPanel
            config={config}
            onChange={(next) =>
              updateOverlayParams(
                element.id,
                writeTextAnimationToParams(element.params ?? {}, next)
              )
            }
          />
        )
      }
    }

    const captionBlock =
      session.sequence.find((block) => block.id === captionIds[0]) ?? captionEditingBlock ?? selectedBlock
    const migratedForCaption = captionBlock
      ? getTemplateOverlaysForBlock(session, captionBlock.id)
      : []
    if (migratedForCaption.length > 0) {
      const element = migratedForCaption[0]!
      const config = readTextAnimationFromParams(element.params ?? {})
      return (
        <TextAnimationPanel
          config={config}
          onChange={(next) =>
            updateOverlayParams(
              element.id,
              writeTextAnimationToParams(element.params ?? {}, next)
            )
          }
        />
      )
    }
    if (!captionBlock?.overlay) {
      return (
        <div className="editor-empty-hint">
          选中字幕或自由文本层后设置入场、出场或循环动画
        </div>
      )
    }

    const config = readTextAnimationFromBlockOverlay(captionBlock.overlay)
    return (
      <TextAnimationPanel
        config={config}
        onChange={(next) =>
          updateBlockOverlay(captionBlock.id, patchBlockOverlayAnimation(captionBlock.overlay, next))
        }
      />
    )
  }

  const visibleTabs: InspectorTab[] =
    selectedOverlay ||
    selectedOverlayIds.length > 0 ||
    selectedCaptionBlockIds.length > 0 ||
    Boolean(captionEditingBlock)
      ? ['text', 'animation']
      : selectedBlock
        ? ['video', 'audio', 'text', 'animation', 'transition']
        : []

  const activeInspectorTab: InspectorTab =
    visibleTabs.includes(inspectorTab as InspectorTab)
      ? (inspectorTab as InspectorTab)
      : visibleTabs[0] ?? 'video'

  const tabContent: Record<InspectorTab, React.ReactNode> = {
    video: renderVideoTab(),
    audio: renderAudioTab(),
    text: renderTextTab(),
    animation: renderAnimationTab(),
    transition: renderTransitionTab(),
  }

  const hasTextSelection =
    selectedOverlayIds.length > 0 ||
    selectedCaptionBlockIds.length > 0 ||
    Boolean(selectedOverlay) ||
    Boolean(captionEditingBlock) ||
    (selectedBlock ? getTemplateOverlaysForBlock(session, selectedBlock.id).length > 0 : false)

  if (!selectedBlock && !selectedOverlay && !hasTextSelection) {
    return (
      <aside className="editor-inspector-panel oc-panel">
        <OpenCutPropertiesEmpty />
      </aside>
    )
  }

  return (
    <aside className="editor-inspector-panel oc-panel">
      <div className="editor-inspector-body oc-panel__body">
        <nav className="editor-inspector-tabbar oc-panel-tabbar" aria-label="属性面板">
          {visibleTabs.map((key) => {
            const tab = INSPECTOR_TAB_META[key]
            return (
              <button
                key={key}
                type="button"
                className={`oc-panel-tab editor-inspector-tab-icon ${
                  activeInspectorTab === key ? 'is-active' : ''
                }`}
                onClick={() => setInspectorTab(key)}
                title={tab.label}
                aria-label={tab.label}
              >
                {tab.icon}
              </button>
            )
          })}
        </nav>
        <div className="oc-panel__content">
          {selectedOverlay ? (
            <EditorInspectorSelectionBanner
              label="自由文本层"
              subLabel={`${selectedOverlay.start_sec.toFixed(1)}s · ${selectedOverlay.duration_sec.toFixed(1)}s`}
            />
          ) : selectedBlock ? (
            <EditorInspectorSelectionBanner label="视频片段" subLabel={selectedBlock.title} />
          ) : null}
          <div className="oc-panel__scroll editor-inspector-content">
            {tabContent[activeInspectorTab]}
          </div>
        </div>
      </div>
    </aside>
  )
}

export default EditorInspector
