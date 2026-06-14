export * from './types'
export {
  buildCompositionSpec,
  buildVideoCompositionSpec,
  computeContainTransform,
  computeCoverTransform,
  getBlurBackdropTransform,
  getForegroundTransform,
  resolveBackground,
  resolveCanvasFilter,
  resolveCanvasSize,
  resolveOutputCanvas,
  resolveVideoLayerTransforms,
  type CompositionSpec,
} from './geometry'
export * from './templateCaption'
export * from './compilePlan'
export * from './buildFrameDescriptor'
export {
  isTauriRuntime,
  renderFrameNative,
  renderFramePngBase64,
  blitPngBase64ToCanvas,
  blitRgbaToCanvas,
} from './compositorClient'
export {
  renderFrameDescriptorToCanvas,
  renderFrameDescriptorToDataUrl,
  type SoftwareRendererOptions,
} from './softwareRenderer'
