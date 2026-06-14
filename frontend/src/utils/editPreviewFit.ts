import type { EditExportSettings } from '../types/editSession'
import type { CanvasAspectRatio } from './editAspectRatios'

export function resolvePreviewVideoFitClass(
  fitMode: EditExportSettings['fit_mode'] | undefined,
  canvasAspect: CanvasAspectRatio
): string {
  if (canvasAspect.isOriginal) {
    return 'is-contain'
  }
  const mode = fitMode ?? 'contain'
  // 导出将 cover 规范为 contain，预览与之对齐以免字幕位置偏差
  if (mode === 'cover' || mode === 'contain') return 'is-contain'
  if (mode === 'contain_blur') return 'is-contain-blur'
  return 'is-contain'
}

export function shouldShowBlurBackground(
  fitMode: EditExportSettings['fit_mode'] | undefined,
  canvasAspect: CanvasAspectRatio
): boolean {
  return !canvasAspect.isOriginal && fitMode === 'contain_blur'
}
