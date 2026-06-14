import * as ResizablePrimitive from 'react-resizable-panels'

type PanelGroupProps = ResizablePrimitive.PanelGroupProps
type PanelProps = ResizablePrimitive.PanelProps
type HandleProps = ResizablePrimitive.PanelResizeHandleProps & { withHandle?: boolean }

export const ResizablePanelGroup = ({ className = '', ...props }: PanelGroupProps) => (
  <ResizablePrimitive.PanelGroup className={`editor-resizable-group ${className}`.trim()} {...props} />
)

export const ResizablePanel = ({ className = '', ...props }: PanelProps) => (
  <ResizablePrimitive.Panel className={`editor-resizable-panel ${className}`.trim()} {...props} />
)

export const ResizableHandle = ({ className = '', withHandle, ...props }: HandleProps) => (
  <ResizablePrimitive.PanelResizeHandle
    className={`editor-resizable-handle${withHandle ? ' has-handle' : ''} ${className}`.trim()}
    {...props}
  />
)
