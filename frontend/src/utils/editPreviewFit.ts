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
  if (mode === 'cover') return 'is-cover'
  return 'is-contain'
}

export function shouldShowBlurBackground(
  fitMode: EditExportSettings['fit_mode'] | undefined,
  canvasAspect: CanvasAspectRatio
): boolean {
  return !canvasAspect.isOriginal && fitMode === 'contain_blur'
}
