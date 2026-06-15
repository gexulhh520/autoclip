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
export {
  compileTemplateCaptionToFreeTextLayers,
  layoutTemplateCaptionLinesToParams,
  buildTemplateCaptionsIndex,
  isTemplatePresetLayer,
} from './templateCaptionOpenCut'
export * from './compilePlan'
export * from './buildFrameDescriptor'
export { hitTestFrameDescriptor, canvasPointFromEvent } from './hitTest'
export type { HitTestTarget } from './hitTest'
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
export { exportTimelineViaCompositor, type ExportTimelineOptions } from './exportTimeline'
export { SceneExporter } from './sceneExporter'
export { CompositorCanvasRenderer } from './compositorCanvasRenderer'
export { WasmCompositorCanvasRenderer } from './wasmCompositorCanvasRenderer'
export {
  loadWasmCompositorModule,
  isWasmCompositorReady,
  type CompositorBackend,
} from './wasmCompositorClient'
export { assertWebCodecsExportSupported, isWebCodecsExportSupported } from './webcodecsExport'
export {
  buildCompositorRuntimeParams,
  runCompositorExportAndMux,
  type CompositorExportRuntimeParams,
  type CompositorMuxOptions,
} from './runCompositorExport'
