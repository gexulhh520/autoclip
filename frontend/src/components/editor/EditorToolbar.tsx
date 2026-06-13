import React, { useEffect, useState } from 'react'
import { message } from 'antd'
import { useEditSessionStore } from '../../stores/useEditSessionStore'

interface EditorToolbarProps {
  projectId: string
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({ projectId }) => {
  const undo = useEditSessionStore((state) => state.undo)
  const redo = useEditSessionStore((state) => state.redo)
  const historyPast = useEditSessionStore((state) => state.historyPast)
  const historyFuture = useEditSessionStore((state) => state.historyFuture)
  const deleteSelectedBlock = useEditSessionStore((state) => state.deleteSelectedBlock)
  const splitSelectedBlockAtPlayhead = useEditSessionStore(
    (state) => state.splitSelectedBlockAtPlayhead
  )
  const detectSilenceTrim = useEditSessionStore((state) => state.detectSilenceTrim)
  const splitAtInternalSilence = useEditSessionStore((state) => state.splitAtInternalSilence)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)
  const setSnapEnabled = useEditSessionStore((state) => state.setSnapEnabled)
  const rippleTrimEnabled = useEditSessionStore((state) => state.rippleTrimEnabled)
  const setRippleTrimEnabled = useEditSessionStore((state) => state.setRippleTrimEnabled)
  const copySelectedBlock = useEditSessionStore((state) => state.copySelectedBlock)
  const pasteBlock = useEditSessionStore((state) => state.pasteBlock)
  const clipboardHasBlock = useEditSessionStore((state) => state.clipboardHasBlock)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const isPlaying = useEditSessionStore((state) => state.isPlaying)
  const setPlaying = useEditSessionStore((state) => state.setPlaying)
  const saveSession = useEditSessionStore((state) => state.saveSession)
  const [trimmingSilence, setTrimmingSilence] = useState(false)
  const [splittingSilence, setSplittingSilence] = useState(false)
  const canUndo = historyPast.length > 0
  const canRedo = historyFuture.length > 0
  const hasClipboard = clipboardHasBlock()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }
      const mod = event.ctrlKey || event.metaKey
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying(!isPlaying)
        return
      }
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
        return
      }
      if ((mod && event.key.toLowerCase() === 'y') || (mod && event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault()
        redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copySelectedBlock()
        return
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteBlock()
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveSession(projectId)
        message.success('已保存')
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedBlockId) return
        event.preventDefault()
        deleteSelectedBlock()
        return
      }
      if (event.key.toLowerCase() === 'b' && !mod) {
        event.preventDefault()
        splitSelectedBlockAtPlayhead()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    copySelectedBlock,
    deleteSelectedBlock,
    isPlaying,
    pasteBlock,
    projectId,
    redo,
    saveSession,
    selectedBlockId,
    setPlaying,
    splitSelectedBlockAtPlayhead,
    undo,
  ])

  return (
    <div className="editor-toolbar">
      <button
        type="button"
        className={`editor-tool-btn ${snapEnabled ? 'is-active' : ''}`}
        title="磁吸：对齐句块边界与 0.1s 网格"
        onClick={() => setSnapEnabled(!snapEnabled)}
      >
        磁吸
      </button>
      <button
        type="button"
        className={`editor-tool-btn ${rippleTrimEnabled ? 'is-active' : ''}`}
        title="Ripple：裁短片段时同步收紧时间线"
        onClick={() => setRippleTrimEnabled(!rippleTrimEnabled)}
      >
        Ripple
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        title="在播放头位置分割 (B)"
        disabled={!selectedBlockId}
        onClick={splitSelectedBlockAtPlayhead}
      >
        分割
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!canUndo}
        onClick={undo}
        title="撤销 (Ctrl+Z)"
      >
        撤销
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!canRedo}
        onClick={redo}
        title="重做 (Ctrl+Y)"
      >
        重做
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!selectedBlockId}
        onClick={copySelectedBlock}
        title="复制 (Ctrl+C)"
      >
        复制
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!hasClipboard}
        onClick={pasteBlock}
        title="粘贴 (Ctrl+V)"
      >
        粘贴
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!selectedBlockId}
        onClick={deleteSelectedBlock}
        title="删除片段 (Del)"
      >
        删除
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!selectedBlockId || trimmingSilence}
        title="检测并裁掉首尾静音"
        onClick={async () => {
          if (!selectedBlockId) return
          setTrimmingSilence(true)
          try {
            const removed = await detectSilenceTrim(projectId, selectedBlockId)
            if (removed > 0.05) {
              message.success(`已裁掉约 ${removed.toFixed(1)}s 静音`)
            } else {
              message.info('未检测到可裁剪的首尾静音')
            }
          } catch (error: unknown) {
            message.error(error instanceof Error ? error.message : '删静音失败')
          } finally {
            setTrimmingSilence(false)
          }
        }}
      >
        {trimmingSilence ? '检测中…' : '删静音'}
      </button>
      <button
        type="button"
        className="editor-tool-btn"
        disabled={!selectedBlockId || splittingSilence}
        title="在内部静音处切分为多个片段"
        onClick={async () => {
          if (!selectedBlockId) return
          setSplittingSilence(true)
          try {
            const count = await splitAtInternalSilence(projectId, selectedBlockId)
            if (count > 0) {
              message.success(`已在 ${count} 处静音切分为 ${count + 1} 段`)
            } else {
              message.info('未检测到可切分的内部静音')
            }
          } catch (error: unknown) {
            message.error(error instanceof Error ? error.message : '静音切分失败')
          } finally {
            setSplittingSilence(false)
          }
        }}
      >
        {splittingSilence ? '切分中…' : '静音切分'}
      </button>
    </div>
  )
}

export default EditorToolbar
