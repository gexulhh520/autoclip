export interface LayoutTransform {
  positionX: number
  positionY: number
  scaleX: number
  scaleY: number
  rotate: number
}

export interface LayoutBackground {
  enabled: boolean
  color: string
  paddingX: number
  paddingY: number
  cornerRadius: number
}

export interface LayoutElement {
  role: string
  content_hint: string
  transform: LayoutTransform
  fontSize?: number
  fontFamily?: string
  color?: string
  fontWeight?: string
  textAlign?: string
  lineHeight?: number
  background?: LayoutBackground
}

export interface CanvasHint {
  aspect?: string
  notes?: string
}

export interface VideoFraming {
  notes?: string
  suggested_position_x: number
  suggested_position_y: number
  suggested_scale_x: number
  suggested_scale_y: number
}

export interface LayoutAnalysis {
  layout_intent: string
  canvas_hint?: CanvasHint
  elements: LayoutElement[]
  video_framing?: VideoFraming
}

export interface AnalyzeLayoutRequest {
  image_base64: string
  image_mime?: string
  prompt?: string
}

export interface AnalyzeLayoutResponse {
  layout: LayoutAnalysis
  summary: string
  raw_content?: string
  model?: string
  usage?: Record<string, number>
}

export interface LayoutReference {
  imageDataUrl: string
  prompt: string
  analysis: LayoutAnalysis
  summary: string
  analyzedAt: string
}

export const layoutReferenceStorageKey = (sessionId: string) =>
  `autoclip:layout-reference:${sessionId}`
