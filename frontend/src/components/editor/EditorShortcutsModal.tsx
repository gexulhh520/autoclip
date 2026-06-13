import React from 'react'

interface EditorShortcutsModalProps {
  open: boolean
  onClose: () => void
}

const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string; action: string }> }> =
  [
    {
      title: '播放',
      items: [
        { keys: 'Space / K', action: '播放 / 暂停' },
        { keys: 'J / L', action: '后退 / 前进 1 秒' },
        { keys: '← / →', action: '逐帧' },
      ],
    },
    {
      title: '编辑',
      items: [
        { keys: 'T', action: '在播放头添加自由文本层' },
        { keys: 'S', action: '在播放头分割' },
        { keys: 'Q / W', action: '删左 / 删右' },
        { keys: 'Delete', action: '删除选中片段' },
        { keys: 'N', action: '切换磁吸' },
        { keys: 'M', action: '添加 / 移除书签' },
      ],
    },
    {
      title: '剪贴板',
      items: [
        { keys: 'Ctrl+C / V / D', action: '复制 / 粘贴 / 复制片段' },
        { keys: 'Ctrl+A', action: '全选片段' },
      ],
    },
    {
      title: '历史',
      items: [
        { keys: 'Ctrl+Z', action: '撤销' },
        { keys: 'Ctrl+Shift+Z / Ctrl+Y', action: '重做' },
        { keys: 'Ctrl+S', action: '保存工程' },
      ],
    },
    {
      title: '其他',
      items: [{ keys: '?', action: '打开快捷键帮助' }],
    },
  ]

const EditorShortcutsModal: React.FC<EditorShortcutsModalProps> = ({ open, onClose }) => {
  if (!open) return null

  return (
    <div className="editor-shortcuts-backdrop" onClick={onClose} role="presentation">
      <div
        className="editor-shortcuts-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
      >
        <header className="editor-shortcuts-modal__header">
          <h2>快捷键</h2>
          <button type="button" className="editor-tool-btn" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="editor-shortcuts-modal__body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="editor-shortcuts-group">
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.keys}>
                    <kbd>{item.keys}</kbd>
                    <span>{item.action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export default EditorShortcutsModal
