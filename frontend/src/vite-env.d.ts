/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key（公开 key，可打包进前端）。未配置则禁用埋点。 */
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  /** PostHog 实例地址，US: https://us.i.posthog.com，EU: https://eu.i.posthog.com */
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.svg?react' {
  import React from 'react'
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>
  export default ReactComponent
}

declare module '@/wasm/compositor/pkg/autoclip_compositor_wasm.js' {
  export function compositeVideoFrameBinary(
    descriptor_json: string,
    layers_meta_json: string,
    rgba_blob: Uint8Array
  ): Uint8Array
  export function isWasmCompositorAvailable(): boolean
  export default function initWasm(
    module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module
  ): Promise<void>
}

declare module '@/wasm/compositor/pkg/autoclip_compositor_wasm_bg.wasm?url' {
  const url: string
  export default url
}