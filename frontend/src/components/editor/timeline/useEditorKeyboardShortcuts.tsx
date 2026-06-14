import { useEffect, useState } from 'react'
import { message } from 'antd'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'
import EditorShortcutsModal from '../EditorShortcutsModal'

export function useEditorKeyboardShortcuts(projectId: string) {
  const undo = useEditSessionStore((state) => state.undo)
  const redo = useEditSessionStore((state) => state.redo)
  const deleteSelectedBlock = useEditSessionStore((state) => state.deleteSelectedBlock)
  const splitSelectedBlockAtPlayhead = useEditSessionStore(
    (state) => state.splitSelectedBlockAtPlayhead
  )
  const copySelectedBlock = useEditSessionStore((state) => state.copySelectedBlock)
  const pasteBlock = useEditSessionStore((state) => state.pasteBlock)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedOverlayId = useEditSessionStore((state) => state.selectedOverlayId)
  const isPlaying = useEditSessionStore((state) => state.isPlaying)
  const setPlaying = useEditSessionStore((state) => state.setPlaying)
  const saveSession = useEditSessionStore((state) => state.saveSession)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)
  const removeOverlayElement = useEditSessionStore((state) => state.removeOverlayElement)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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
      if (
        (mod && event.key.toLowerCase() === 'y') ||
        (mod && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
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
        if (!selectedBlockId && !selectedOverlayId) return
        event.preventDefault()
        if (selectedOverlayId) removeOverlayElement(selectedOverlayId)
        else deleteSelectedBlock()
        return
      }
      if (event.key.toLowerCase() === 'b' && !mod) {
        event.preventDefault()
        splitSelectedBlockAtPlayhead()
        return
      }
      if (event.key.toLowerCase() === 't' && !mod) {
        event.preventDefault()
        addOverlayElement({ start_sec: sequencePlayheadSec } as never)
        setInspectorTab('text')
        return
      }
      if (event.key === '?' && !mod) {
        event.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    addOverlayElement,
    copySelectedBlock,
    deleteSelectedBlock,
    isPlaying,
    pasteBlock,
    projectId,
    redo,
    removeOverlayElement,
    saveSession,
    selectedBlockId,
    selectedOverlayId,
    sequencePlayheadSec,
    setInspectorTab,
    setPlaying,
    splitSelectedBlockAtPlayhead,
    undo,
  ])

  return { shortcutsOpen, setShortcutsOpen }
}

export function EditorShortcutsHost({ projectId }: { projectId: string }) {
  const { shortcutsOpen, setShortcutsOpen } = useEditorKeyboardShortcuts(projectId)
  return (
    <EditorShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
  )
}
