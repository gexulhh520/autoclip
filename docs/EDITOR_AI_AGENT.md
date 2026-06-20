# 剪辑模块 · AI 剪辑 Agent 规划

> **状态**：规划文档 · 供 `feature/ai-editor` 分支排期与 PR 拆分  
> **更新**：2026-06-15  
> **默认模型**：Ollama 本地 · `gemma4:12b`（多模态，支持参考图 + 文字）  
> **北极星**：用户上传参考图并描述意图 → LLM 分析排版 → 用户确认 → LLM 通过原子工具操作时间线

---

## 0. 产品意图（必读）

用户的核心流程不是「让 AI 一次性看完图剪完片」，而是 **两阶段**：

```text
① 参考图 + 文字说明
      ↓  LLM 多模态分析（不修改时间线）
② 结构化排版结论（LayoutAnalysis JSON + 人话摘要）
      ↓  用户可编辑、确认
③ 「按这个排版去剪辑」+ 当前工程上下文
      ↓  LLM 输出 tool_calls
④ 前端执行器调用 useEditSessionStore 原子操作
⑤ 预览更新；可撤销；可继续对话微调
```

**为何分两阶段**

- 分析错可在执行前纠正，避免误改时间线  
- 执行阶段不必重复传大图，token 更省、更稳  
- 与本地 Ollama 隐私策略一致（参考图不出本机）

**默认推理栈**

| 用途 | 模型 | 说明 |
|------|------|------|
| 排版分析（附图） | `gemma4:12b` | 用户当前配置；`think=false` 输出 JSON |
| 工具执行（文本） | `gemma4:12b` | 同一模型即可；后续可拆「执行专用」小模型 |
| 备选视觉模型 | `qwen2.5vl:7b` | 项目内已有推荐项，分析不稳时可 A/B |

> **工程缺口（当前）**：`OllamaProvider` 已接 `/api/chat`，但 **尚未传 `images`**；剪辑 Agent 首要是补齐多模态消息。

---

## 1. 架构总览

```text
┌─────────────────────────────────────────────────────────────┐
│  EditorLayout                                                │
│  ┌──────────────┐  ┌─────────────────────────────────────┐ │
│  │ 时间线/预览   │  │ EditorAgentPanel（聊天浮窗）         │ │
│  └──────────────┘  │  · 文字 + 参考图                      │ │
│                     │  · 分析结果 / 执行步骤 / 确认         │ │
│                     └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │ buildEditorSnapshot()              ▲
         ▼                                    │ tool results / session refresh
┌─────────────────┐     SSE/JSON     ┌────────────────────────┐
│ executeToolCall │ ◄─────────────── │ backend/editor_agent   │
│ (Zustand store) │                  │  · analyze-layout      │
└─────────────────┘                  │  · chat (+ tools)      │
                                     │  · OllamaProvider      │
                                     └────────────────────────┘
```

**分工原则**

| 层 | 职责 |
|----|------|
| **后端** | LLM 调用、多模态消息、tool schema 校验、token 计量（未来 credits） |
| **前端** | 状态快照、**工具执行**（改时间线）、撤销、保存、浮窗 UI |
| **不在 MVP** | 后端直接改 `EditSession` 文件（延迟高、难预览） |

**与自动切片流水线的边界**

- 编辑器 Agent 只读写 **`EditSession`**（`useEditSessionStore`）  
- 不接入 Celery Step3/6 流水线  
- 可复用 `detectSilenceTrim` 等已有能力，作为后续阶段工具

---

## 2. LayoutAnalysis（分析阶段输出）

分析 API 要求模型 **只输出 JSON**（`think=false`），schema 与编辑器参数对齐。

```json
{
  "layout_intent": "顶部居中主标题 + 底部说明条",
  "canvas_hint": { "aspect": "9:16", "notes": "可选" },
  "elements": [
    {
      "role": "headline",
      "content_hint": "图上文字或用户将填入的文案",
      "transform": {
        "positionX": 0,
        "positionY": -320,
        "scaleX": 1,
        "scaleY": 1,
        "rotate": 0
      },
      "fontSize": 48,
      "fontFamily": "Noto Sans SC",
      "color": "#FFFFFF",
      "fontWeight": "bold",
      "textAlign": "center",
      "lineHeight": 1.2,
      "background": {
        "enabled": true,
        "color": "#00000080",
        "paddingX": 24,
        "paddingY": 12,
        "cornerRadius": 8
      }
    }
  ],
  "video_framing": {
    "notes": "人物偏左、右侧留白等构图说明",
    "suggested_position_x": 0,
    "suggested_position_y": 0,
    "suggested_scale_x": 1,
    "suggested_scale_y": 1
  }
}
```

**字段映射**

| LayoutAnalysis | 编辑器 |
|----------------|--------|
| `elements[].transform.*` | `overlay_elements[].params['transform.*']` |
| `elements[].fontSize` 等 | OpenCut text params |
| `video_framing.suggested_*` | `block.video_transform.position_x/y, scale_x/y` |

会话内可保存最近一次分析：`session.agent_context.layout_reference`（字段名实现时定稿）。

---

## 3. 编辑器状态快照（给 LLM 的上下文）

**禁止**每次传完整 `sequence` JSON。采用 **摘要 + 按需查询**：

### 3.1 每次对话附带（EditorSnapshot）

- 会话名、总时长、画幅、fps、播放头位置  
- 视频轨列表 + 各轨片段（id、title、起止、track_id）  
- 主轨转场摘要  
- 文本/贴纸层摘要（id、轨道、起止、内容前 40 字）  
- 音频轨摘要  
- **当前选中**：片段 / 文本 / 音频  
- **已确认的 LayoutAnalysis**（若有）

### 3.2 按需查询工具（省 token）

| 工具 | 说明 |
|------|------|
| `get_block_detail` | 单片段 trim、文案、轨位 |
| `get_overlay_detail` | 单文本层完整 params |
| `list_assets` | 素材池 clip / bgm / sfx |

实现位置（规划）：`frontend/src/editor/agent/buildEditorSnapshot.ts`

---

## 4. 原子工具目录（分阶段开放）

所有写操作必须走 `useEditSessionStore`，且 **一轮 Agent 操作 = 一次 `pushHistory`**（可撤销）。

### 4.1 Phase B — 首批（MVP 执行）

| 工具 | 说明 |
|------|------|
| `seek_playhead` | 定位预览 |
| `add_text_overlay` | 按 LayoutAnalysis 加字 |
| `update_overlay_params` | 改字体/位置/样式 |
| `set_video_transform` | 缩放/位移 |
| `update_block_trim` | 裁切入出点 |
| `move_block_to_video_track` | 主轨 / 画中画 |
| `get_timeline_summary` | 只读 |

### 4.2 Phase C — 扩展

| 工具 | 说明 |
|------|------|
| `add_clips_to_timeline` | `appendClips` |
| `reorder_main_track` | 主轨排序 |
| `set_transition` | 转场 |
| `add_audio_clip` | BGM/SFX |
| `update_block_audio` | 音量/淡化 |
| `detect_silence_trim` | 接已有静音检测 |
| `undo` / `redo` | 显式历史 |

### 4.3 Phase D — 进阶

- 多步计划（「剪成 60 秒」分解为多个 tool）  
- 预览截帧作为新参考图  
- 模板基因 / 字幕批量套用  

工具注册（规划）：`frontend/src/editor/agent/toolRegistry.ts`  
执行器：`frontend/src/editor/agent/executeToolCall.ts`

---

## 5. 后端 API（规划）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/projects/{pid}/sessions/{sid}/agent/analyze-layout` | 附图 + 提示 → `LayoutAnalysis` |
| `POST` | `/api/v1/projects/{pid}/sessions/{sid}/agent/chat` | 多轮对话 + tools；SSE 流式 |
| `GET` | `/api/v1/projects/{pid}/sessions/{sid}/agent/thread` | 可选：恢复对话历史 |

**Ollama 多模态请求（待实现）**

```json
{
  "model": "gemma4:12b",
  "think": false,
  "messages": [{
    "role": "user",
    "content": "分析图中文字排版…",
    "images": ["<base64>"]
  }]
}
```

模块规划：

- `backend/schemas/editor_agent.py`  
- `backend/services/editor_agent_service.py`  
- `backend/api/v1/editor_agent.py`  
- 扩展 `backend/core/llm_providers.py`：`messages[]`、`images[]`、`tools[]`

**gemma4 注意**：结构化任务必须 `think=false`，否则易出现空 `content`（见 `OllamaProvider._extract_message_text`）。

---

## 6. 前端 UI（聊天浮窗）

符合 `DESIGN.md`：克制、固定宽度、不挡时间线标尺。

| 项 | 说明 |
|----|------|
| 入口 | 预览区或编辑器边栏「AI 剪辑」 |
| 布局 | ~360px 浮窗，可拖拽、可最小化 |
| 输入 | 多行文字 + 参考图（粘贴/拖拽，1–3 张） |
| 模式 | **仅分析** / **分析并应用** |
| 展示 | 分析 JSON 折叠 + 人话摘要；执行前操作清单 |
| 安全 | 删除轨、清空等需二次确认 |

组件规划：

```
frontend/src/components/editor/agent/
  EditorAgentPanel.tsx
  EditorAgentMessage.tsx
  EditorAgentInput.tsx
frontend/src/editor/agent/
  useEditorAgent.ts
  buildEditorSnapshot.ts
  toolRegistry.ts
  executeToolCall.ts
  types.ts
frontend/src/services/editorAgentApi.ts
```

挂载点：`EditorLayout.tsx`（`position: fixed`，z-index 低于 Modal）。

---

## 7. 分阶段实施清单

### Phase 0 — 分支与契约（本分支已完成文档）

- [x] 创建分支 `feature/ai-editor`
- [x] 本文档 `docs/EDITOR_AI_AGENT.md`
- [ ] 10 条评测用例（参考图 + 期望 LayoutAnalysis 字段）
- [ ] System prompt 初稿（`analyze` / `execute` 分离）

**出口标准**：团队对两阶段流程与 schema 无歧义。

---

### Phase A — 参考图排版分析（不改时间线）

**目标**：验证 `gemma4:12b` 看图分析是否可用。

- [ ] `OllamaProvider` 支持 `images` + 多轮 `messages`
- [ ] `POST .../agent/analyze-layout`
- [ ] Pydantic 校验 `LayoutAnalysis`
- [ ] 浮窗 MVP：附图 + 展示分析结果 + 复制/编辑 JSON
- [ ] 会话内暂存 `layout_reference`（localStorage 或 session 字段）
- [ ] 设置项：剪辑 AI 默认模型 `gemma4:12b`

**出口标准**：上传一张参考图，能稳定得到可映射到 text params 的 JSON；用户确认前不写 store。

---

### Phase B — 工具执行闭环

**目标**：确认分析后，一句话驱动时间线变更。

- [ ] `buildEditorSnapshot`
- [ ] 首批工具（§4.1）+ `executeToolCall`
- [ ] `POST .../agent/chat`（tools / function calling）
- [ ] 执行前展示操作清单；写操作单次 undo
- [ ] 执行后 `markDirty`，可选 `flushSaveSession`

**出口标准**：「按上次分析在第 3 秒加标题」可自动 `add_text_overlay` 并在预览可见。

---

### Phase C — 体验与多模态打磨

- [ ] SSE 流式回复
- [ ] 对话线程持久化
- [ ] 预览截帧作为参考图
- [ ] 分析/执行模型可分别配置
- [ ] 失败重试、错误信息回灌 LLM
- [ ] token 用量展示（为 credits 预留）

**出口标准**：完整对话体验可日常使用；排版分析准确率可接受。

---

### Phase D — 进阶 AI 剪辑

- [ ] 多步计划与批处理
- [ ] 结合静音检测 / 自动拆条
- [ ] 画中画位置参考 `video_framing`
- [ ] 回归测试集（工具参数校验 + 快照不变量）
- [ ] 与 ROADMAP Phase 2 LiteLLM 代理对接（可选）

**出口标准**：复杂指令（多片段、多轨）可完成；有自动化回归。

---

## 8. 已拍板决策

| 问题 | 决定 |
|------|------|
| 模型 | 默认 Ollama `gemma4:12b`；不依赖云多模态 |
| 附图含义 | 排版参考输入，不是装饰能力 |
| 流程 | 先分析 → 确认 → 再工具执行 |
| 工具执行位置 | 前端 Zustand |
| 撤销 | 每轮 Agent 写操作一次 history |
| 与 compositor 重构 | 独立功能；共用 `EditSession` 与 text params |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| gemma4 JSON 不稳定 | `think=false`、短 prompt、Pydantic 重试 |
| 误删时间线 | 工具白名单 + 危险操作确认 + undo |
| 上下文过长 | 摘要快照 + 按需 query |
| 分析与执行不一致 | 执行只读已保存 LayoutAnalysis，不重复传图 |
| 保存竞态 | 批量 tool 结束后统一 flush |

---

## 10. 相关文件（现有）

| 文件 | 用途 |
|------|------|
| `backend/core/llm_providers.py` | Ollama / 多模型 |
| `frontend/src/stores/useEditSessionStore.ts` | 剪辑状态与原子操作 |
| `frontend/src/editor/opencut-text/params.ts` | 文本层参数键 |
| `frontend/src/utils/blockVideoTransform.ts` | 画面 transform |
| `ROADMAP.md` | 长期 LLM 代理与 credits |
| `DESIGN.md` | 浮窗视觉规范 |

---

## 11. PR 拆分建议

1. `feat(agent): ollama vision messages` — Provider + 单测  
2. `feat(agent): analyze-layout API` — 无 UI  
3. `feat(agent): editor agent panel phase A` — 浮窗 + 分析  
4. `feat(agent): tool registry and executor` — Phase B 核心  
5. `feat(agent): chat streaming and thread` — Phase C  

---

*分支：`feature/ai-editor` · 文档随实现进度更新 checkbox。*
