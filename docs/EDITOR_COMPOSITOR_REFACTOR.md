# 剪辑模块 Compositor 重构任务清单

> **状态**：规划文档 · 供开发排期与 PR 拆分使用  
> **更新**：2026-06-14  
> **目标**：单一合成内核（Rust/wgpu）+ Composition IR；预览与导出同源；FFmpeg 仅作解码/编码兜底  
> **参考**：OpenCut 重写路线（FrameDescriptor + Compositor + WebCodecs/硬编）

---

## 0. 北极星与原则

### 0.1 北极星

**用户拖动的位置 = 预览像素 = 导出像素**（允许预览降分辨率/跳帧，不允许几何/时间/层级不一致）。

### 0.2 架构铁律

| # | 原则 |
|---|------|
| P1 | **Compositor 负责像素，Encoder 负责码流** — 禁止用 FFmpeg `filter_complex` / ASS / `drawtext` 做布局与合成 |
| P2 | **FrameDescriptor 是预览与导出的唯一绘制输入** |
| P3 | **CompositionPlan 是时间线真相** — Session/UI 编辑意图编译为 Plan，不反向从 DOM/CSS 读坐标 |
| P4 | **新效果只走 Effect Registry** — 禁止在 `EditorPreview` / `edit_renderer` 新增 if-else 特效分支 |
| P5 | **Python 保留 AI 与素材管道** — 剪辑成片渲染迁出 `edit_renderer` 合成路径 |
| P6 | **Golden Frame 测试守住 parity** — 每个 Phase 必须有固定 fixture 的像素/坐标回归 |

### 0.3 FFmpeg 的合理归宿

| 保留 | 迁出 / 废弃 |
|------|-------------|
| AI 切片 `extract_clip`、Whisper、下载转码 | `edit_renderer` 内 ASS/drawtext 布局 |
| Demux / Decode（过渡期） | `overlay_pipeline` 预览专用 compose API 依赖 |
| Encode / Mux 软编兜底（可选 libav/CLI） | `filter_complex` 合成时间线 |

### 0.4 明确不做（本阶段）

- 不做「先修 FFmpeg 对齐再重构」作为长期方案
- 不在 DOM（`QuoteOverlayPreview`）里继续堆字幕定位逻辑
- 不新增 `preview-overlay` 按 block 轮询接口作为终局方案
- 不并行维护第三套时间线数学（`editTimeline.buildTimelineSegments` 无叠化版应退役）

---

## 1. 目标架构（终局）

```
EditProject (文档)
    ↓ compileCompositionPlan()
CompositionPlan (时间线 + 层级 + 音频 + 转场)
    ↓ buildFrameDescriptor(plan, t)
FrameDescriptor (单帧绘制列表)
    ↓ Compositor::render_frame()
RGBA 帧 (+ 可选深度/遮罩)
    ↓ Encoder
MP4 / 预览 Canvas
```

### 1.1 目录规划（目标 monorepo）

```
rust/
  compositor/          # wgpu 合成：layers、effects、text layout
  compositor-wasm/     # 可选：预览用 WASM 绑定（与 OpenCut 协议对齐）
  encoder/             # WebCodecs 桥接 / 硬编 / libav 软编
  document/            # CompositionPlan / FrameDescriptor schema (serde)

frontend/src/editor/
  document/            # EditProject v3、compile、validate
  compositor/          # TS 侧 compile FrameDescriptor、预览桥接
  effects/             # Effect Registry 定义与 schema
  preview/             # CompositorPreview 单画布组件
  timeline/            # 现有 OpenCut 时间线，改读 document

backend/
  pipeline/
    edit_renderer.py   # 逐步瘦身为「仅 AI 相关」或废弃合成导出
  api/v1/
    edit_sessions.py   # export 改为接收 CompositionPlan 或触发 Tauri 导出

src-tauri/
  src/
    compositor.rs      # Tauri commands: render_frame, export_timeline
```

---

## 2. 现状盘点（重构前）

### 2.1 预览路径

```
EditSession → sceneBuilder.resolveSceneAt → RenderScene
  → HTML <video> + TemplateCaptionLayer/QuoteOverlayPreview (DOM)
  → OpenCutTextCanvas (Canvas2D)
  → CSS fit / visual filter
```

### 2.2 导出路径（与预览未共用 IR）

```
EditSession → edit_renderer.export_edit_session
  → render_block_segment (ASS/drawtext)
  → concat (xfade)
  → apply_final_video_pass
  → apply_free_text_overlays (drawtext)
  → mix_bgm
```

### 2.3 已存在可复用资产

| 资产 | 路径 |
|------|------|
| `RenderScene` / `ExportScenePlan` | `frontend/src/editor/scene/types.ts` |
| `resolveSceneAt` / `compileExportPlan` | `frontend/src/editor/scene/sceneBuilder.ts` |
| Python 镜像 | `backend/pipeline/scene_builder.py` |
| 画布几何（OpenCut 对齐） | `backend/pipeline/composition.py`、`frontend/src/services/composition/` |
| 模板字幕 compose | `backend/pipeline/overlay_pipeline.py` |
| 自由文本 measure/render | `frontend/src/editor/opencut-text/` |
| v3 轨道模型草案 | `frontend/src/editor/migration/v2ToV3.ts` |
| 时间线 UI | `frontend/src/components/editor/timeline/` |

### 2.4 待删除/退役（完成迁移后）

| 路径 | 原因 |
|------|------|
| `frontend/src/components/QuoteOverlayPreview.tsx` 定位逻辑 | 迁 Compositor 文本节点 |
| `frontend/src/components/editor/TemplateCaptionLayer.tsx` DOM transform | 迁 Compositor |
| `edit_renderer` 内 `_build_cinema_subtitles_filter` 布局路径 | 迁 Compositor |
| `edit_renderer._build_free_overlay_drawtext` | 迁 Compositor 文本 |
| `POST preview-overlay` 按 block compose | Plan 内嵌 compose 结果 |
| `frontend/src/utils/editDissolvePreview.ts` | 并入 Plan 编译 |
| `frontend/src/utils/editTimeline.buildTimelineSegments`（无叠化） | 统一 `timelineLayout` |

---

## 3. 数据模型任务

### 3.1 Schema 定义（阻塞后续所有 Phase）

- [ ] **T-3.1.1** 定义 `CompositionPlan` JSON Schema（TypeScript + JSON Schema 文件）
  - 字段：`canvas`, `timeline`, `layers[]`, `audio`, `transitions`, `metadata`
  - 层类型：`video_clip` | `template_caption` | `free_text` | `audio_bgm` | `filter` | `transition`
- [ ] **T-3.1.2** 定义 `FrameDescriptor` JSON Schema（对齐 OpenCut `FrameItem` 概念）
  - 字段：`width`, `height`, `clear`, `items[]`
  - Item 类型：`layer` | `text` | `effect_group` | `scene_effect`
- [ ] **T-3.1.3** Rust `serde` 类型与 TS 类型同源（`rust/document/` 或 `packages/compositor-types/`）
- [ ] **T-3.1.4** 版本字段 `schema_version: "compositor-1"`，预留迁移

**验收**：TS ↔ Rust round-trip 序列化测试通过；Schema 在 CI 校验示例 fixture。

### 3.2 EditProject v3 文档模型

- [ ] **T-3.2.1** 扩展 `EditProjectV3` / `TrackElement`（`frontend/src/editor/migration/v2ToV3.ts`）
  - 关键帧：`transform`, `opacity`, `effect_stack`
  - 文本：`style_preset`, `opencut_text_params`
- [ ] **T-3.2.2** `EditSession` → `EditProjectV3` 迁移器（含叠化 overlap、`playback_rate`）
- [ ] **T-3.2.3** 反向 `EditProjectV3` → `EditSession`（API 兼容期）
- [ ] **T-3.2.4** Store 双写或切换开关 `useCompositorPreview` / `useCompositorExport`

**验收**：现有测试工程迁移后时间线时长、片段边界与 v2 一致。

### 3.3 编译器：`compileCompositionPlan`

- [ ] **T-3.3.1** `compileCompositionPlan(session | project, options)` — 合并现有：
  - `sceneBuilder.buildCompositionTimeline`
  - `resolveFreeTextLayers` 规则
  - `overlay_pipeline.compose_overlay_layers`（客户端或编译期调用）
- [ ] **T-3.3.2** 输出包含完整 `TemplateCaptionLayer` 数据（layers + layout config），**消除 N 次 preview-overlay API**
- [ ] **T-3.3.3** Python `compile_export_plan` 与 TS 输出字段级对齐（已有测试扩展）

**验收**：`sceneBuilder.test.ts` + `test_scene_builder.py` 扩展为 Plan 级 parity。

### 3.4 编译器：`buildFrameDescriptor(plan, t)`

- [ ] **T-3.4.1** 视频层：contain/cover/blur 几何 → `VisualTransform`（统一 `composition.py` 公式）
- [ ] **T-3.4.2** 模板字幕：compose layers → 文本 layout 节点 + 锚点
- [ ] **T-3.4.3** 自由文本：`opencut-text` measure → 像素 rect + transform
- [ ] **T-3.4.4** 叠化：双 video layer + opacity 插值
- [ ] **T-3.4.5** 全局滤镜：作为 `scene_effect` 或顶层 effect group

**验收**：Golden fixture 在 `t = 0, 1s, dissolve 中点, 末尾` 四处输出稳定 Descriptor JSON。

---

## 4. Rust Compositor 内核

### 4.1 工程搭建

- [ ] **T-4.1.1** 创建 `rust/compositor` crate（wgpu、bytemuck、serde）
- [ ] **T-4.1.2** 创建 `rust/document` crate（Plan / FrameDescriptor 类型）
- [ ] **T-4.1.3** CI：`cargo test` + `cargo clippy`；Windows/macOS 构建矩阵
- [ ] **T-4.1.4** 评估是否引用/对齐 `opencut-wasm` 的 FrameDescriptor 字段（减少未来迁移）

**验收**：空 Descriptor 渲一帧纯色；CI 绿。

### 4.2 解码与纹理

- [ ] **T-4.2.1** 视频解码抽象 `VideoDecoder`（首期：FFmpeg libav 或 `ffmpeg` CLI 抽帧到内存）
- [ ] **T-4.2.2** 纹理上传、YUV→RGBA（或直接用 RGB 帧）
- [ ] **T-4.2.3** 本地文件路径直通（Tauri 桌面无 CORS）
- [ ] **T-4.2.4** 帧缓存池（按 clipId + sourceTime）

**验收**：单 clip 按 `relativeSourceSec` 取帧并上传 GPU 纹理。

### 4.3 合成管线（最小可用）

- [ ] **T-4.3.1** `Compositor::render_frame(descriptor) -> RgbaImage`
- [ ] **T-4.3.2** Layer blend：opacity、blend mode（normal 先行）
- [ ] **T-4.3.3** Affine transform：平移、缩放、旋转
- [ ] **T-4.3.4** 画布 clear + letterbox 背景色

**验收**：Golden PNG 与 TS 侧 `drawCompositionFrame` 像素误差 < 阈值（或完全一致）。

### 4.4 文本渲染

- [ ] **T-4.4.1** 字体加载（Noto Sans SC + 系统 fallback；桌面 bundle 字体）
- [ ] **T-4.4.2** 文本 layout：行高、对齐、max width（对齐 `opencut-text` 规则）
- [ ] **T-4.4.3** 文本背景盒、圆角、padding
- [ ] **T-4.4.4** 与 TS `measureTextOverlay` 对齐测试（同参数同 bbox）

**验收**：模板 cinema 布局 + 自由文本 Golden 帧通过。

### 4.5 效果系统（Effect Registry 内核）

- [ ] **T-4.5.1** `EffectPass` 接口：uniforms + shader
- [ ] **T-4.5.2** 内置：`visual_filter.mono_soft` 等（迁移 `VISUAL_FILTER_PRESETS`）
- [ ] **T-4.5.3** 内置：`transition.dissolve`（双路 blend）
- [ ] **T-4.5.4** 文字 preset 槽位（花字 = text + effect stack）

**验收**：滤镜 + 叠化 Golden 视频 3 帧序列导出 PNG 通过。

### 4.6 WASM 绑定（可选，与 4.1 并行）

- [ ] **T-4.6.1** `compositor-wasm` + `wasm-bindgen`
- [ ] **T-4.6.2** 预览走 WASM compositor（WebView 内）；导出可走 Tauri 原生（更快）

**验收**：浏览器 dev 模式预览不依赖 Tauri 也能显示 compositor 输出。

---

## 5. 编码层（Export Encoder）

### 5.1 编码抽象

- [ ] **T-5.1.1** `Encoder` trait：`encode_frame(rgba, pts)` + `finalize() -> Path`
- [ ] **T-5.1.2** 实现 A：`WebCodecs`（WebView Worker，对齐 OpenCut video-export）
- [ ] **T-5.1.3** 实现 B：Tauri 原生硬编（macOS VideoToolbox / Windows MF）
- [ ] **T-5.1.4** 实现 C：软编兜底（libav 或 `ffmpeg`  stdin rawvideo → h264，**无 filtergraph**）

**验收**：10s 测试片导出 MP4，可播放，分辨率/帧率与 Plan 一致。

### 5.2 音频

- [ ] **T-5.2.1** 片段音轨拼接（音量、fade、变速 atempo）
- [ ] **T-5.2.2** BGM mix + ducking（迁移 `mix_bgm_track` 逻辑到 encoder 或独立 audio graph）
- [ ] **T-5.2.3** 音视频 mux

**验收**：导出片含 BGM ducking，与当前 FFmpeg 混音听感接近（波形 diff 可选）。

### 5.3 导出 orchestrator

- [ ] **T-5.3.1** `export_timeline(plan, options, progress_cb)`
  - `for t in timeline: descriptor = build(t); rgba = compositor.render(descriptor); encoder.encode(rgba, t)`
- [ ] **T-5.3.2** 进度回调、取消、错误恢复
- [ ] **T-5.3.3** 多线程：解码与渲染 pipeline 并行（Phase 后期）

**验收**：完整 EditSession fixture E2E 导出 < 现有 FFmpeg 路径时长 1.5x 内（或质量更好）。

---

## 6. Tauri 集成

- [ ] **T-6.1** `render_frame(descriptor_json) -> base64_png` Tauri command
- [ ] **T-6.2** `export_timeline(plan_json, output_path, options)` Tauri command（后台线程）
- [ ] **T-6.3** 事件：`export-progress`、`export-complete`、`export-error`
- [ ] **T-6.4** 前端 `compositorClient.ts` 封装 invoke + 进度订阅
- [ ] **T-6.5** 打包：Rust compositor 静态链接；评估是否缩小 bundled `ffmpeg` 为 decode-only

**验收**：桌面 App 内导出无需 Python `edit_renderer` 参与合成。

---

## 7. 前端预览重构

### 7.1 CompositorPreview 组件

- [ ] **T-7.1.1** 新建 `CompositorPreview.tsx` — 单画布显示 compositor 输出
- [ ] **T-7.1.2** 播放循环：`requestAnimationFrame` + `buildFrameDescriptor(plan, playhead)`
- [ ] **T-7.1.3** 视频：compositor 内解码纹理（或过渡期 video 元素仅作解码源）
- [ ] **T-7.1.4** 替换 `EditorPreview` 内 DOM 字幕 + 分散 Canvas 为统一入口

**验收**：仅 compositor 预览时，模板字幕 + 自由文本 + 视频同屏正确。

### 7.2 交互（选择、拖动、框选）

- [ ] **T-7.2.1** Hit test 基于 FrameDescriptor 内 text/video bounds（非 DOM）
- [ ] **T-7.2.2** 拖动更新 `TrackElement.transform` / overlay params → Plan 重编译
- [ ] **T-7.2.3** 框选、多选、成组拖动（迁移现有 box select 逻辑）
- [ ] **T-7.2.4** 播放头行为：选中不 seek（保持现有产品约定）

**验收**：拖动松手位置与预览一致；导出后位置一致（Golden）。

### 7.3 Inspector / 效果 UI

- [ ] **T-7.3.1** Effect Registry 驱动 Inspector 表单（Zod schema → 控件）
- [ ] **T-7.3.2** 模板字幕样式只读/可编字段与 Plan 同步
- [ ] **T-7.3.3** 花字 preset 选择器（写入 `style_preset`）

---

## 8. 时间线与 Store

- [ ] **T-8.1** `useEditSessionStore` 支持 `EditProjectV3` 或 Plan 缓存
- [ ] **T-8.2** 时间线 `adapter.ts` 从 Plan/Project 生成轨道，不再多处解析 Session
- [ ] **T-8.3** 撤销/重做：以 Project snapshot 或 Plan diff 为单元（对齐 `editorCore`）
- [ ] **T-8.4** 保存：Session API 兼容 + 可选 `project_v3` 字段落库

---

## 9. 后端 API 瘦身

- [ ] **T-9.1** 导出 API 改为：
  - 方案 A：前端 Tauri 本地导出，后端只记录状态；或
  - 方案 B：`POST export` 接收 `CompositionPlan` JSON，转交 Tauri/Rust（桌面）或未来 headless compositor
- [ ] **T-9.2** 废弃或降级 `POST preview-overlay`（返回 Plan 内嵌 compose 后不再需要）
- [ ] **T-9.3** `edit_renderer.export_edit_session` 标记 deprecated，feature flag 切换
- [ ] **T-9.4** 保留 `write_export_srt`（可从 Plan 生成，无像素依赖）

---

## 10. Effect Registry 首批清单（产品能力映射）

| ID | 类型 | 预览 | 导出 | 优先级 |
|----|------|------|------|--------|
| `canvas.contain` | 几何 | Compositor | Compositor | P0 |
| `canvas.contain_blur` | 几何+背景 | Compositor | Compositor | P1 |
| `transition.dissolve` | 转场 | Compositor blend | Compositor | P0 |
| `filter.none` / `filter.mono_soft` 等 | 滤镜 | shader/CSS 近似 | shader | P1 |
| `text.template.cinema` | 模板字幕 | text layout | text layout | P0 |
| `text.free.opencut` | 自由文本 | opencut measure | 同左 | P0 |
| `text.preset.*` | 花字 | preset stack | preset stack | P2 |
| `audio.bgm` | 音频 | WebAudio 近似 | Encoder mix | P1 |
| `audio.duck` | 音频 | 可选静默 | Encoder | P2 |

每个效果必须注册：

```typescript
{
  id, schema,
  compileToPlan(layer, ctx),
  resolveToFrameItems(layer, t, ctx),
  // 仅 compositor 实现，无 FFmpeg 字符串
}
```

---

## 11. 测试策略

### 11.1 Golden Fixtures

- [ ] **T-11.1** 建立 `fixtures/compositor/`：
  - `minimal_9x16_contain.json` — 单 clip + 模板字幕
  - `dissolve_two_clips.json`
  - `free_text_dragged.json` — 含 offset
  - `bgm_mix.json`
- [ ] **T-11.2** 每 fixture 存：`plan.json`、`descriptor_t*.json`、预期 `frame_t*.png`
- [ ] **T-11.3** CI：TS `buildFrameDescriptor` + Rust `render_frame` 对比 PNG（允许 AA 误差阈值）

### 11.2 回归

- [ ] **T-11.4** 保留并扩展现有 `sceneBuilder.test.ts`、`test_scene_builder.py`
- [ ] **T-11.5** E2E：桌面 App 打开 fixture → 预览截图 → 导出 → 抽帧对比
- [ ] **T-11.6** 性能基准：30s 1080p 9:16 导出耗时、峰值内存

### 11.3 禁止事项（CI lint / Code Review）

- [ ] **T-11.7** 禁止 `edit_renderer` 新增 `drawtext` / ASS 布局逻辑（grep hook）
- [ ] **T-11.8** 禁止 `QuoteOverlayPreview` 新增 `position_offset` CSS transform 定位

---

## 12. 分阶段里程碑（推荐排期）

### Phase 0 — 规格与单源几何（1–2 周）

| 任务块 | 编号 |
|--------|------|
| Schema + fixture | T-3.1.*, T-11.1 |
| 合并画布几何单模块 | T-3.4.1 + 删除 FE 重复实现 |
| `compileCompositionPlan` v1 | T-3.3.* |
| `buildFrameDescriptor` v1（无 Rust，TS 输出 JSON） | T-3.4.* |

**里程碑 M0**：同一 fixture 的 Descriptor JSON 在 TS 稳定；几何公式 FE/BE 单测对齐。

### Phase 1 — Rust Compositor MVP（3–5 周）

| 任务块 | 编号 |
|--------|------|
| Rust crate + render 纯色/视频/文本 | T-4.1.*–T-4.4.* |
| Tauri `render_frame` | T-6.1 |
| CompositorPreview 替换 DOM 字幕 | T-7.1.* |
| Golden PNG CI | T-11.2 |

**里程碑 M1**：桌面预览 100% 走 Compositor；模板+自由文本位置与 Descriptor 一致。

### Phase 2 — 导出切换（2–4 周）

| 任务块 | 编号 |
|--------|------|
| Encoder + `export_timeline` | T-5.*, T-6.2 |
| 音频 mix | T-5.2.* |
| 废弃 FFmpeg 合成路径 | T-9.* |
| E2E parity | T-11.5 |

**里程碑 M2**：默认导出走 Compositor+Encoder；FFmpeg 仅 decode/软编兜底。

### Phase 3 — 效果与 v3 文档（持续）

| 任务块 | 编号 |
|--------|------|
| Effect Registry 扩展 | T-4.5.*, §10 |
| EditProjectV3 主路径 | T-3.2.*, T-8.* |
| 花字 preset | P2 effects |

**里程碑 M3**：新滤镜/转场/花字只注册 effect，不改预览/导出两套代码。

### Phase 4 — 性能与插件（可选）

- [x] **P4.1** 导出 decode 预取：下一帧 video seek 与当前帧 render 并行
- [x] **P4.2** 硬件 H.264 默认开启（`preferHardware`，`AUTOCLIP_VIDEO_CODEC` 可覆盖）
- [x] **P4.3** Effect Plugin API：`registerEffectPlugin` + `window.__AUTOCLIP_EFFECT_PLUGINS__`
- [x] **P4.4** Headless HTTP：`GET .../export/compositor-plan` + `POST .../export/headless`
- [ ] 多线程 render pipeline（Rust wgpu / 并行帧渲染）
- [ ] 桌面 Headless worker 消费 queued job 并回调 mux

**里程碑 M4**：批量出片 API 可用；导出编码默认硬件；插件可扩展滤镜槽位。

---

## 13. PR 拆分建议（可直接开 issue）

| Issue | 标题 | Phase | 依赖 |
|-------|------|-------|------|
| #C1 | compositor-types: Plan + FrameDescriptor schema | 0 | — |
| #C2 | compileCompositionPlan + 去 preview-overlay | 0 | C1 |
| #C3 | 合并 canvas 几何单模块 | 0 | — |
| #C4 | rust/compositor scaffold + clear frame | 1 | C1 |
| #C5 | compositor video layer + decode | 1 | C4 |
| #C6 | compositor text layout + golden | 1 | C4, C2 |
| #C7 | Tauri render_frame command | 1 | C6 |
| #C8 | CompositorPreview 替换 EditorPreview 字幕层 | 1 | C7 |
| #C9 | compositor interaction hit-test + drag | 1 | C8 |
| #C10 | encoder MVP + export_timeline | 2 | C6 |
| #C11 | 音频 mix + ducking | 2 | C10 |
| #C12 | 导出 API 切换 + feature flag | 2 | C10 |
| #C13 | 下线 edit_renderer 合成 | 2 | C12 |
| #C14 | Effect registry + 滤镜/叠化 | 3 | C8 |
| #C15 | EditProjectV3 store 迁移 | 3 | C2 |

---

## 14. 风险与缓解

| 风险 | 缓解 |
|------|------|
| wgpu 老旧 GPU 不支持 | WebGL2 fallback 或软件 raster 文本；参考 OpenCut issue #768 |
| 导出性能不如 FFmpeg concat | 硬编 + 并行 pipeline；预览降分辨率 |
| 与 OpenCut 协议分叉 | FrameDescriptor 字段对齐 opencut-wasm；定期 sync |
| 桌面包体积增大（Rust + 字体） | 比全量 ffmpeg filtergraph 更可控；decode-only ffmpeg |
| 迁移期双路径维护 | Feature flag 单开关；Golden 测试强制 parity |

---

## 15. 完成定义（Definition of Done）

剪辑模块重构**整体完成**当且仅当：

1. 预览仅通过 Compositor 出像素（无 DOM 字幕定位、无独立 OpenCut Canvas 第二套坐标）
2. 默认导出仅通过 `export_timeline(CompositionPlan)`（无 ASS/drawtext 布局）
3. Golden fixtures 在 CI 必跑且绿
4. 新增滤镜/转场/花字通过 Effect Registry 添加，PR 模板要求注册表条目
5. `docs/EDITOR_COMPOSITOR_REFACTOR.md` 中 Phase 0–2 任务全部勾选
6. `HANDOFF.md` 更新剪辑架构说明，指向本文档

---

## 16. 参考链接

- [OpenCut Architecture — preview refactor](https://www.mintlify.com/OpenCut-app/OpenCut/development/architecture)
- [OpenCut v0.3 — Rust/wgpu compositor](https://github.com/OpenCut-app/OpenCut/releases/tag/v0.3.0)
- [OpenCut WebCodecs export PR #460](https://github.com/OpenCut-app/OpenCut/pull/460)
- [OpenCut frame-descriptor refactor commit](https://github.com/OpenCut-app/OpenCut/commit/cad88ee4d1c9e06e7529b88ef5e5d3fdf3f89149)
- 本项目现状：`frontend/src/editor/scene/`、`backend/pipeline/edit_renderer.py`

---

## 附录 A：当前关键文件索引

| 用途 | 路径 |
|------|------|
| 预览编排 | `frontend/src/components/editor/EditorPreview.tsx` |
| 场景 IR（现） | `frontend/src/editor/scene/sceneBuilder.ts` |
| 模板字幕 DOM | `frontend/src/components/editor/TemplateCaptionLayer.tsx` |
| 自由文本 Canvas | `frontend/src/components/editor/OpenCutTextCanvas.tsx` |
| 导出（待废弃合成） | `backend/pipeline/edit_renderer.py` |
| 模板 compose | `backend/pipeline/overlay_pipeline.py` |
| 画布几何 BE | `backend/pipeline/composition.py` |
| 画布几何 FE | `frontend/src/services/composition/index.ts` |
| v3 草案 | `frontend/src/editor/migration/v2ToV3.ts` |
| Tauri | `src-tauri/src/` |

---

## 附录 B：任务进度总表（复制到 Sprint）

```
Phase 0  [x] M0  Schema + Plan + Descriptor + 几何单源
Phase 1  [x] M1  Rust Compositor + CompositorPreview 单路径
Phase 2  [x] M2  Compositor 导出 + mux + E2E/perf 冒烟（无 UI driver）
Phase 3  [x] M3  Effect Registry + EditProjectV3 + 预览拖拽 + GPU EffectPass
Phase 4  [~] M4  硬件编码 + decode 预取 + Effect 插件 + Headless API（worker 待接）
```

**维护**：每完成一项在对应 `T-x.x.x` 打勾，并在 PR 描述中引用任务编号（如 `T-4.3.1`）。
