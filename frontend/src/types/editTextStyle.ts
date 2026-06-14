/** OpenCut Classic 对齐的文本样式字段 */

export type TextAlign = 'left' | 'center' | 'right'
export type TextDecoration = 'none' | 'underline' | 'line-through'
export type TextAnimation = 'none' | 'fadeIn' | 'bounceIn' | 'typewriter'

export interface EditTextBackground {
  enabled: boolean
  color: string
  corner_radius: number
  padding_x: number
  padding_y: number
}

export interface EditTextStyleFields {
  font_size: number
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  text_align: TextAlign
  text_decoration: TextDecoration
  letter_spacing: number
  line_height: number
  opacity: number
  background: EditTextBackground
  animation: TextAnimation
}
