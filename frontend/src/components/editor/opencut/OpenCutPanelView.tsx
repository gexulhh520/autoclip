import React from 'react'

interface OpenCutPanelViewProps {
  title?: string
  actions?: React.ReactNode
  children: React.ReactNode
  hideHeader?: boolean
  className?: string
  contentClassName?: string
}

/** OpenCut assets/views/base-panel.tsx 对齐 */
const OpenCutPanelView: React.FC<OpenCutPanelViewProps> = ({
  title,
  actions,
  children,
  hideHeader = false,
  className = '',
  contentClassName = '',
}) => (
  <div className={`oc-asset-view ${className}`.trim()}>
    {!hideHeader && (
      <div className="oc-asset-view__header">
        {title ? <span className="oc-asset-view__title">{title}</span> : <span />}
        {actions ? <div className="oc-asset-view__actions">{actions}</div> : null}
      </div>
    )}
    <div className={`oc-asset-view__scroll${hideHeader ? ' is-no-header' : ''}`}>
      <div className={`oc-asset-view__body ${contentClassName}`.trim()}>{children}</div>
    </div>
  </div>
)

export default OpenCutPanelView
