import type { EditSession } from '../../types/editSession'

export interface CapturePreviewFrameInput {
  projectId: string
  session: EditSession
  timeSec: number
  maxWidth?: number
}

export interface CapturePreviewFrameResult {
  time_sec: number
  width: number
  height: number
  image_base64: string
  video_decoded: boolean
}
