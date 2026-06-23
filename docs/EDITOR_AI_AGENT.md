# 剪辑模块 · AI 剪辑 Agent 规划

> **状态**：规划文档 · 供 `feature/ai-editor` 分支排期与 PR 拆分  
> **更新**：2026-06-15（§5.1 补充 gemma4 工具调用）· **口播生产线**见 [VOICEOVER_PIPELINE.md](VOICEOVER_PIPELINE.md)  
> **默认模型**：Ollama 本地 · `gemma4:12b`（多模态，支持参考图 + 文字）  
> **北极星**：剪辑工作台内的 **全能 AI 助手**——用户用自然语言（可选参考图）描述需求 → Agent 按需读取草稿 → 通过原子工具操作时间线/文本/视频/播放头等区域

---

## 0. 产品意图（必读）

浮窗 **不是** 仅用于「上传参考图排版」。它是剪辑区内的统一入口：

| 能力 | 说明 |
|------|------|
| **助手对话（默认）** | 加字、改样式、移视频、裁片段、问当前工程结构等 |
| **参考图排版（专项）** | 分析附图样式 → 套用到草稿文案（A1：不抄图上的字） |
| **按需读草稿** | `get_timeline_summary` / `get_block_detail` 等，不全量塞 JSON |
| **写操作确认** | 改时间线前展示操作清单（B1），一轮 undo |
| **口播生产线（规划）** | 分段脚本 → TTS → 对齐字幕 → 搜素材 → 智能选段；**三里程碑完整交付**，见 [VOICEOVER_PIPELINE.md](VOICEOVER_PIPELINE.md) |

典型流程：

```text
① 用户描述需求（文字 ± 参考图）
      ↓  buildEditorSnapshot + 可选 layout_reference
② LLM 按需只读工具了解现状
      ↓
③ LLM 输出 tool_calls 或纯文本回答
      ↓  写操作：用户确认
④ executeToolCall → 预览更新；可撤销；可继续对话
```

**参考图排版**仍是重要子流程（两阶段：分析 → 应用），但不是浮窗唯一用途：

```text
参考图 → analyze-layout → LayoutAnalysis → 分析并应用 → tool_calls
```

**为何写操作仍分两阶段（排版场景）**

- 分析错可在执行前纠正，避免误改时间线  
- 执行阶段不必重复传大图，token 更省、更稳  
- 与本地 Ollama 隐私策略一致（参考图不出本机）

**默认推理栈**

| 用途 | 模型 | 说明 |
|------|------|------|
| 排版分析（附图） | `gemma4:12b` | 用户当前配置；`think=false` 输出 JSON |
| 工具执行（文本） | `gemma4:12b` | 同一模型即可；后续可拆「执行专用」小模型 |
| 备选视觉模型 | `qwen2.5vl:7b` | 项目内已有推荐项，分析不稳时可 A/B |

> **工程缺口（当前）**：`OllamaProvider` 已支持 `images` 与多轮 `messages`（Phase A）；**尚未接 `tools` / `tool_calls`**（Phase B，见 §5.1）。

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
  "layout_intent": "左侧多行文本 + 右侧人物构图",
  "canvas_hint": { "aspect": "9:16", "notes": "可选" },
  "elements": [
    {
      "role": "text",
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
| `elements[].role` | 固定 `"text"`（不按标题/副标题分层；层次靠样式与位置） |
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

### 4.2 Phase C — 扩展（§12 含 schema 草案）

| 工具 | store / API | 说明 |
|------|-------------|------|
| `list_assets` | 读 snapshot 扩展 | clip / bgm / sfx 素材池 |
| `add_clips_to_timeline` | `appendClips` | 从素材池加片段 |
| `reorder_main_track` | `reorderBlocks` | 主轨排序 |
| `set_transition` | `updateBlockTransition` | 转场 |
| `add_audio_clip` | `addAudioClipToTimeline` | BGM/SFX |
| `update_block_audio` | `updateBlockAudio` | 音量/淡化 |
| `detect_silence_trim` | `detectSilenceTrim` / API | 静音检测裁切 |
| `set_text_animation` | `applyBatchTextAnimation` | 单/多层动画 |
| `batch_apply_text_style` | `updateOverlaysParams` | 批量字样式 |
| `capture_preview_frame` | compositor 截帧 | 只读，base64 |
| `split_block_at_playhead` | `splitSelectionAtPlayhead` | 切分 |
| `remove_block` | 待接 store | 删镜头（需 B1 确认） |
| `undo` / `redo` | `undo` / `redo` | 显式历史 |

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

**gemma4 注意**：结构化任务必须 `think=false`，否则易出现空 `content`（见 `OllamaProvider._extract_message_text`）。工具调用阶段的 `think` 策略见 **§5.1**。

---

## 5.1 Gemma4:12b 工具调用约定（Ollama native tools）

### 能力结论

| 能力 | `gemma4:12b` + Ollama | AutoClip 现状 |
|------|------------------------|---------------|
| 多模态（`images`） | ✅ `/api/chat` | ✅ Phase A |
| 原生工具调用（`tools` → `tool_calls`） | ✅ `/api/chat` | ❌ 待 Phase B |
| 12B 档 Agent 可靠性 | ✅ 推荐（优于 e2b/e4b） | — |

**结论**：同一模型 `gemma4:12b` 可覆盖「看图分析」与「调剪辑工具」；不必为工具单独换云模型。

参考：[Ollama tool calling 文档](https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx)

### 两阶段是否都要 tools？

| 阶段 | 是否用 Ollama `tools` | 原因 |
|------|----------------------|------|
| **Phase A · 分析排版** | **否** | 输出固定 `LayoutAnalysis` JSON 即可；附图 + `think=false` + Pydantic 校验 |
| **Phase B · 执行剪辑** | **是（推荐）** | 模型返回 `tool_calls`，后端校验后交前端 `executeToolCall` |
| **降级方案** | 可选 | 若 `tool_calls` 为空或畸形，解析 `content` 内 `{ "actions": [...] }` 再执行 |

### `think` 参数（gemma4 专用）

| 场景 | `think` | 说明 |
|------|---------|------|
| `analyze-layout` | `false` | 避免 token 进 reasoning，`content` 为空或 JSON 被截断 |
| `chat` 纯问答 | `false` | 默认 |
| `chat` 选工具（可选实验） | `true` | 部分场景 tool 选择更准；**不要把 `thinking` 写入持久对话历史** |
| 工具结果回传后的终稿 | `false` | 合成自然语言回复给用户 |

与现有代码一致：`OllamaProvider.call(..., think=False)` 为结构化任务默认值。

### 请求格式（Phase B）

使用 Ollama **原生** `/api/chat`（非 OpenAI 兼容 `/v1/chat/completions`），以便 `think` / `images` / `tools` 行为一致：

```json
{
  "model": "gemma4:12b",
  "stream": false,
  "think": false,
  "messages": [
    {
      "role": "system",
      "content": "你是剪辑助手。只能通过 tools 修改时间线，禁止臆造 block_id。"
    },
    {
      "role": "user",
      "content": "按已保存的排版，在播放头位置加主标题「新品发布」"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "add_text_overlay",
        "description": "在指定时间添加文本层",
        "parameters": {
          "type": "object",
          "properties": {
            "start_sec": { "type": "number" },
            "content": { "type": "string" },
            "fontSize": { "type": "number" },
            "positionX": { "type": "number" },
            "positionY": { "type": "number" }
          },
          "required": ["start_sec", "content"]
        }
      }
    }
  ]
}
```

**实现约定**

- `tools` 列表由 `toolRegistry` 导出 OpenAI 兼容 schema，后端原样转发给 Ollama  
- 单次请求工具数量：Phase B 首批 ≤8 个，避免 schema 过长占满上下文  
- 采样建议：`temperature=0.2~0.6`（执行偏确定），`num_predict≥2048`

### 响应格式（解析 `tool_calls`）

Ollama 在 `message` 中返回：

```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "add_text_overlay",
          "arguments": {
            "start_sec": 3.0,
            "content": "新品发布",
            "fontSize": 48,
            "positionX": 0,
            "positionY": -320
          }
        }
      }
    ]
  },
  "done_reason": "stop"
}
```

**解析规则**

1. `tool_calls` 非空 → 进入执行分支（即使 `content` 为空也正常）  
2. `arguments` 可能是 **对象或 JSON 字符串**，需 `json.loads` 兜底  
3. 支持**并行**多个 `tool_calls`；前端同一轮只 `pushHistory` 一次  
4. `tool_calls` 为空且 `content` 非空 → 视为纯文本回复，不改时间线  
5. 流式（Phase C）：先聚合全部 chunk 的 `tool_calls` 再执行，勿边收边执行  

### Agent 循环（Phase B 标准流程）

```text
1. 前端：buildEditorSnapshot() + 用户消息 + layout_reference
2. POST /agent/chat → Ollama（带 tools）
3. 若 response.tool_calls：
     a. 后端校验 name ∈ 白名单、参数 Pydantic
     b. 返回给前端 { tool_calls, assistant_message? }
     c. 前端 executeToolCall（单次 history）
     d. 将每条结果 append 为 role=tool 消息（见下）
     e. 再次 POST /agent/chat（同一 thread，think=false）
4. 若无 tool_calls → 展示 assistant content，结束
5. 限制 max_rounds=5，防止工具死循环
```

**`role: tool` 回传格式**（Ollama 多轮）

```json
{
  "role": "tool",
  "content": "{\"ok\":true,\"overlay_id\":\"txt-abc\"}",
  "tool_name": "add_text_overlay"
}
```

`content` 必须是**字符串**（JSON 序列化后的执行结果或错误信息），供模型下一轮推理。

### `OllamaProvider` 扩展清单（Phase A + B）

| 任务 | 方法 / 字段 | 阶段 |
|------|-------------|------|
| 多轮消息 | `chat(messages: list)` 替代单条 `prompt` | A |
| 附图 | `messages[].images: list[str]` base64 | A |
| 工具定义 | `tools: list[dict]` | B |
| 解析工具调用 | `message.tool_calls` → `ToolCall[]` | B |
| 返回结构 | 扩展 `LLMResponse`：`tool_calls`, `raw_message` | B |
| 流式 | `stream=True` + chunk 聚合 | C |

建议新增 `OllamaProvider.chat_completion(...)`，保留现有 `call()` 给流水线兼容。

### Phase B 实现要点（工程 checklist）

**后端**

- [ ] `backend/schemas/editor_agent.py`：`ToolCall`, `ToolResult`, `AgentChatRequest/Response`  
- [ ] `editor_agent_service.run_agent_turn()`：组 messages、挂 tools、解析 `tool_calls`  
- [ ] 工具名白名单 + Pydantic 参数校验（校验失败生成 `role: tool` 错误回灌）  
- [ ] `max_tool_rounds=5`、超时 300s（与现有 Ollama 一致）  
- [ ] 单测：mock Ollama 返回 `tool_calls` JSON 字符串 / 对象两种形态  

**前端**

- [ ] `toolRegistry.ts`：name → schema + `executeToolCall` 映射  
- [ ] `useEditorAgent.ts`：循环「chat → 执行 → 回传 tool results → 再 chat」  
- [ ] UI：有 `tool_calls` 时先展示**操作清单**，用户确认后执行（MVP 可配置自动执行）  
- [ ] 一轮写操作只 `pushHistory()` 一次  

**System prompt（执行阶段）要点**

- 已确认的 `LayoutAnalysis` 在上下文中；优先用其 `transform` / `fontSize` 填工具参数  
- 只能使用 snapshot 里存在的 `block_id` / `overlay_id`  
- 先 `get_timeline_summary` 再改（若模型犹豫）  
- 一次用户意图尽量批量 `tool_calls`，减少往返  

### 降级：结构化 `actions` JSON

当 `tool_calls` 连续失败或模型版本不支持时，system prompt 允许仅输出：

```json
{
  "actions": [
    { "tool": "add_text_overlay", "args": { "start_sec": 3, "content": "标题" } }
  ],
  "summary": "将在 3 秒处添加标题"
}
```

后端/前端统一走同一 `executeToolCall` 入口，不维护两套执行逻辑。

### 风险（工具专用）

| 风险 | 缓解 |
|------|------|
| 幻觉 `block_id` | 执行前校验 id ∈ snapshot；失败回灌 tool 错误 |
| 工具死循环 | `max_tool_rounds` + 相同参数去重 |
| `arguments` 类型错误 | Pydantic + 友好错误回模型 |
| 上下文爆炸 | 工具 schema 精简；快照摘要；layout 不重复传图 |

---

## 6. 前端 UI（聊天浮窗）

符合 `DESIGN.md`：克制、固定宽度、不挡时间线标尺。

| 项 | 说明 |
|----|------|
| 入口 | 预览区或编辑器边栏「AI 剪辑」 |
| 布局 | ~360px 浮窗，可拖拽、可最小化 |
| 输入 | 多行文字 + 参考图（粘贴/拖拽，1–3 张） |
| 模式 | **助手**（默认）/ **参考图排版**（专项） |
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

- [x] `OllamaProvider` 支持 `images` + 多轮 `messages`
- [x] `POST .../agent/analyze-layout`
- [x] Pydantic 校验 `LayoutAnalysis`
- [x] 浮窗 MVP：附图 + 展示分析结果 + 复制/编辑 JSON
- [x] 会话内暂存 `layout_reference`（localStorage 或 session 字段）
- [ ] 设置项：剪辑 AI 默认模型 `gemma4:12b`

**出口标准**：上传一张参考图，能稳定得到可映射到 text params 的 JSON；用户确认前不写 store。

---

### Phase B — 工具执行闭环

**目标**：确认分析后，一句话驱动时间线变更（Ollama `tools` + `tool_calls`，见 §5.1）。

- [x] `OllamaProvider.chat_completion`：`tools`、`tool_calls` 解析
- [x] `buildEditorSnapshot`
- [x] 首批工具（§4.1）+ `executeToolCall` + `toolRegistry`
- [x] `POST .../agent/chat` + Agent 多轮循环（`role: tool` 回传）
- [x] 工具参数 Pydantic 校验 + 白名单
- [x] `actions` JSON 降级路径（§5.1）
- [x] 执行前展示操作清单；写操作单次 undo
- [ ] 执行后 `markDirty`，可选 `flushSaveSession`

**出口标准**：「按上次分析在第 3 秒加文本」触发 `add_text_overlay` 的 `tool_calls`，预览可见；失败时错误可回灌模型重试。

---

### Phase C — 顶级剪辑师工具集（10 项必做 + 体验）

> 详细 tool schema 与 PR 顺序见 **§12**。Phase C 目标：从「能改字和构图」升级到「能叙事、能听、能看见、能验收」。

**10 项必做工具**

| # | 工具 | 域 | 优先级 |
|---|------|-----|--------|
| 1 | `list_assets` | 读 | P0 |
| 2 | `add_clips_to_timeline` | 叙事 | P0 |
| 3 | `reorder_main_track` | 叙事 | P0 |
| 4 | `set_transition` | 节奏 | P0 |
| 5 | `add_audio_clip` | 声音 | P0 |
| 6 | `update_block_audio` | 声音 | P0 |
| 7 | `detect_silence_trim` | 节奏 | P1 |
| 8 | `set_text_animation` | 包装 | P1 |
| 9 | `capture_preview_frame` | 感知 | P1 |
| 10 | `split_block_at_playhead` + `remove_block` | 精修 | P1 |
| + | `batch_apply_text_style` | 包装 | P1 |
| + | `undo` / `redo` | 协作 | P1 |

**体验项（与工具并行）**

- [ ] SSE 流式回复
- [ ] 对话线程服务端持久化（前端 localStorage 已有 MVP）
- [ ] 执行后 `markDirty` + 可选 `flushSaveSession`
- [ ] 失败重试、错误回灌 LLM
- [ ] token 用量展示（credits 预留）

**出口标准**：用户说「用素材池 3 个 clip 剪 60 秒口播，加 BGM、去气口、统一字幕 fade」→ Agent 能 `list_assets` → 加片/排序/转场/音频/静音检测 → 截帧自检 → 一次确认执行完成。

---

### Phase D — 进阶 AI 剪辑

- [ ] 多步 `EditPlan`（Brief → 分步 tool）  
- [ ] 执行后验收循环（`capture_preview_frame` + 规则微调）  
- [ ] `BrandStyle` / 风格记忆（扩展 layout_reference）  
- [ ] `auto_reframe_subject`、BGM duck、SFX 对齐切点  
- [ ] 回归测试集（工具参数 + 快照不变量）  
- [ ] LiteLLM 代理对接（可选，见 ROADMAP）

**出口标准**：复杂多轨指令可完成；有自动化回归与验收。

---

## 8. 已拍板决策

### 8.1 基础架构

| 问题 | 决定 |
|------|------|
| 模型 | 默认 Ollama `gemma4:12b`；不依赖云多模态 |
| 工具调用 | Ollama native `tools` / `tool_calls`（Phase B）；分析阶段不用 tools |
| 附图含义 | 排版参考输入，不是装饰能力 |
| 工具执行位置 | 前端 Zustand |
| 撤销 | 每轮 Agent 写操作一次 history |
| 与 compositor 重构 | 独立功能；共用 `EditSession` 与 text params |
| 文本层命名 | 统一 `role: "text"`；素材面板仅「文本」入口 |
| 默认字号 | 新建文本层 `fontSize: 6` |

### 8.2 产品行为（2026-06-15 确认：`A1+B1+C2+D3+E1+F1+G1`）

| ID | 问题 | 决定 | 实现要点 |
|----|------|------|----------|
| **A1** | 文案从哪来 | **只用草稿文案**；参考图只学版式 | `content` 来自 snapshot / `get_block_detail`；禁止照抄参考图文字 |
| **B1** | 执行前确认 | **先展示操作清单**，用户点执行再写 store | 浮窗列出 tool_calls 摘要；未确认不改时间线 |
| **C2** | 动画默认 | 轻量：**入场 `fade` 0.3s**，出场 `none` | `add_text_overlay` 未指定动画时写入 `animation.in.type=fade`、`duration=0.3` |
| **D3** | 分析 vs 执行 | **两种模式并存**：「仅分析」/「分析并应用」 | Phase A 路径保留；应用模式走 agent/chat + 工具链 |
| **E1** | 读草稿策略 | 每轮带**轻量快照** + 按需只读工具 | `buildEditorSnapshot`；不够再 `get_block_detail` / `get_overlay_detail` |
| **F1** | 视频构图 | 分析出 `video_framing` 后**自动** `set_video_transform` | 主轨视频应用 `suggested_position_x/y`、scale |
| **G1** | 字体映射 | **固定映射表**，不在表内 → 思源黑体 | 见 §8.3 |

### 8.3 字体映射表（G1）

| LLM / 分析输出 | 编辑器 `fontFamily` |
|----------------|---------------------|
| `serif`、`Noto Serif`、宋体语义 | `Noto Serif SC` |
| `sans-serif`、`sans`、黑体语义 | `Noto Sans SC` |
| `cursive`、书法、楷体语义 | `Ma Shan Zheng` |
| `pingfang`、苹方 | `PingFang SC` |
| 其他 / 未知 | `Noto Sans SC`（默认） |

执行层（`executeToolCall` / `add_text_overlay`）在写入 params 前统一过此表；分析 prompt 可继续输出泛称，由执行器归一化。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| gemma4 JSON 不稳定 | `think=false`、短 prompt、Pydantic 重试 |
| `tool_calls` 格式不稳 | 解析 arguments 字符串/对象；降级 `actions` JSON（§5.1） |
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

**已完成（Phase A/B）**

1. `feat(agent): ollama vision messages`  
2. `feat(agent): analyze-layout API`  
3. `feat(agent): editor agent panel phase A`  
4. `feat(agent): ollama tools and tool_calls parser`  
5. `feat(agent): tool registry and executor` — Phase B  
6. `feat(agent): universal assistant panel + runAgentChat`  

**Phase C 建议顺序（§12）**

7. `feat(agent): list_assets read tool` — 素材池可读  
8. `feat(agent): narrative tools` — add_clips + reorder + set_transition  
9. `feat(agent): audio tools` — add_audio_clip + update_block_audio  
10. `feat(agent): pacing tools` — detect_silence_trim + split/remove  
11. `feat(agent): packaging tools` — set_text_animation + batch_apply_text_style  
12. `feat(agent): capture_preview_frame` — 感知 + 验收基础  
13. `feat(agent): undo redo tools + chat streaming` — 体验  

---

## 12. Phase C · 工具 schema 草案

> OpenAI/Ollama 兼容 `function.parameters`。实现时同步维护：`toolRegistry.ts`、`editor_agent_tools.py`、`executeToolCall.ts`。

### 12.1 只读 · 感知

#### `list_assets`

```json
{
  "name": "list_assets",
  "description": "列出当前工程可用素材：视频 clip、BGM、SFX",
  "parameters": {
    "type": "object",
    "properties": {
      "category": { "type": "string", "enum": ["clip", "bgm", "sfx", "all"], "description": "默认 all" }
    }
  }
}
```

**返回（tool role）**：`{ clips: [{id, title, duration_sec}], audio: [{id, name, category}] }`  
**实现**：扩展 `buildEditorSnapshot` 或独立读工具；clip 来自 project 素材 API。

#### `capture_preview_frame`

```json
{
  "name": "capture_preview_frame",
  "description": "在指定时间截取预览帧（只读），用于检查构图/字幕安全区",
  "parameters": {
    "type": "object",
    "properties": {
      "time_sec": { "type": "number" },
      "max_width": { "type": "number", "description": "缩略图最大宽，默认 720" }
    },
    "required": ["time_sec"]
  }
}
```

**返回**：`{ time_sec, width, height, image_base64 }`（JPEG data URL）  
**实现**：复用 compositor 离屏渲染；Phase D 用于验收循环。

---

### 12.2 叙事 · 时间线

#### `add_clips_to_timeline`

```json
{
  "name": "add_clips_to_timeline",
  "description": "从素材池追加 clip 到主轨末尾",
  "parameters": {
    "type": "object",
    "properties": {
      "clip_ids": { "type": "array", "items": { "type": "string" } },
      "source_id": { "type": "string", "description": "可选，多源项目" },
      "insert_index": { "type": "number", "description": "插入主轨下标，缺省追加" }
    },
    "required": ["clip_ids"]
  }
}
```

**store**：`appendClips(projectId, clip_ids, source_id)`

#### `reorder_main_track`

```json
{
  "name": "reorder_main_track",
  "description": "调整主轨片段顺序",
  "parameters": {
    "type": "object",
    "properties": {
      "block_id": { "type": "string" },
      "to_index": { "type": "number", "description": "目标下标 0-based" }
    },
    "required": ["block_id", "to_index"]
  }
}
```

**store**：`reorderBlocks(fromIndex, toIndex)`

#### `set_transition`

```json
{
  "name": "set_transition",
  "description": "设置片段出点转场（作用于 outgoing 片段）",
  "parameters": {
    "type": "object",
    "properties": {
      "block_id": { "type": "string" },
      "transition": {
        "type": "string",
        "enum": ["cut", "dissolve", "fade_black", "wipe_left", "wipe_right", "slide_left", "slide_right", "zoom"]
      }
    },
    "required": ["block_id", "transition"]
  }
}
```

**store**：`updateBlockTransition(blockId, transition)`

#### `split_block_at_playhead`

```json
{
  "name": "split_block_at_playhead",
  "description": "在播放头位置切分当前选中的视频/文本/音频",
  "parameters": { "type": "object", "properties": {} }
}
```

**store**：`splitSelectionAtPlayhead()`（需先 `seek_playhead` 或选中目标）

#### `remove_block`

```json
{
  "name": "remove_block",
  "description": "删除主轨或 overlay 视频片段（危险操作，清单中须醒目标注）",
  "parameters": {
    "type": "object",
    "properties": { "block_id": { "type": "string" } },
    "required": ["block_id"]
  }
}
```

**store**：待封装；B1 确认清单中对 `remove_*` 高亮。

---

### 12.3 声音

#### `add_audio_clip`

```json
{
  "name": "add_audio_clip",
  "description": "将 BGM 或 SFX 加到时间线",
  "parameters": {
    "type": "object",
    "properties": {
      "asset_id": { "type": "string" },
      "start_sec": { "type": "number" },
      "duration_sec": { "type": "number" },
      "track_id": { "type": "string" },
      "volume": { "type": "number" },
      "fade_in_sec": { "type": "number" },
      "fade_out_sec": { "type": "number" },
      "block_id": { "type": "string", "description": "可选，联动到视频块" }
    },
    "required": ["asset_id", "start_sec"]
  }
}
```

**store**：`addAudioClipToTimeline(assetId, options)`

#### `update_block_audio`

```json
{
  "name": "update_block_audio",
  "description": "调整片段音量与淡化",
  "parameters": {
    "type": "object",
    "properties": {
      "block_id": { "type": "string" },
      "volume": { "type": "number" },
      "fade_in_sec": { "type": "number" },
      "fade_out_sec": { "type": "number" }
    },
    "required": ["block_id"]
  }
}
```

**store**：`updateBlockAudio(blockId, patch)`

---

### 12.4 节奏 · 口播

#### `detect_silence_trim`

```json
{
  "name": "detect_silence_trim",
  "description": "检测片段内静音并建议/应用 trim（收紧口播节奏）",
  "parameters": {
    "type": "object",
    "properties": {
      "block_id": { "type": "string" },
      "apply": { "type": "boolean", "description": "true 直接裁切，false 仅返回建议" },
      "noise_db": { "type": "number" },
      "min_silence_sec": { "type": "number" }
    },
    "required": ["block_id"]
  }
}
```

**store/API**：`detectSilenceTrim` → `editApi.detectSilence`；`apply=true` 时接 `updateBlockTrim`。

---

### 12.5 包装 · 文本

#### `set_text_animation`

```json
{
  "name": "set_text_animation",
  "description": "设置文本层入场/出场/循环动画",
  "parameters": {
    "type": "object",
    "properties": {
      "overlay_id": { "type": "string" },
      "in_type": { "type": "string", "enum": ["none", "fade", "slide_up", "slide_down", "scale", "pop"] },
      "in_duration_sec": { "type": "number" },
      "out_type": { "type": "string", "enum": ["none", "fade", "slide_up", "slide_down", "scale", "pop"] },
      "out_duration_sec": { "type": "number" }
    },
    "required": ["overlay_id"]
  }
}
```

**store**：`updateOverlayParams` 写 `animation.in/out.*` 或 `applyBatchTextAnimation`  
**默认**：未指定 in_type 时沿用 C2（fade 0.3s）。

#### `batch_apply_text_style`

```json
{
  "name": "batch_apply_text_style",
  "description": "批量统一文本层样式（不含改 content）",
  "parameters": {
    "type": "object",
    "properties": {
      "overlay_ids": { "type": "array", "items": { "type": "string" }, "description": "缺省=全部文本层" },
      "fontSize": { "type": "number" },
      "fontFamily": { "type": "string" },
      "color": { "type": "string" },
      "fontWeight": { "type": "string" },
      "textAlign": { "type": "string" }
    }
  }
}
```

**store**：`updateOverlaysParams(ids, patch)`；`fontFamily` 过 G1 映射。

---

### 12.6 协作

#### `undo` / `redo`

```json
{
  "name": "undo",
  "description": "撤销上一步编辑（含 Agent 批量操作）",
  "parameters": { "type": "object", "properties": {} }
}
```

**注意**：Agent 一轮写操作已 `pushHistory` 一次；`undo` 用于用户口头「不对，退回」。

---

### 12.7 实现约束（Phase C 统一）

| 约束 | 说明 |
|------|------|
| 白名单 | 新工具先进 `editor_agent_tools.py` + `toolRegistry` |
| id 校验 | `block_id` / `overlay_id` / `asset_id` 必须 ∈ snapshot 或读工具结果 |
| 危险操作 | `remove_block`、批量 delete 在 B1 清单加 ⚠ |
| 异步 | `appendClips`、`detect_silence_trim` 需 `executeToolCall` 支持 async 或拆为 plan→confirm→poll |
| token | 单次 chat tools ≤12；`capture_preview_frame` 结果不写入持久对话，仅 tool 回传缩略图 |

---

*分支：`feature/ai-editor` · 文档随实现进度更新 checkbox。*
