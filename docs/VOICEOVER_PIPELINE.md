# 口播生产线 · 里程碑规划

> **状态**：规划文档 · 供 `feature/ai-editor` 及后续 PR 拆分  
> **更新**：2026-06-24  
> **关联**：[剪辑 AI Agent 规划](EDITOR_AI_AGENT.md) · [产品路线图](../ROADMAP.md)  
> **原则**：**不做简化版缺口**——每个里程碑交付的能力必须完整可用；未纳入该里程碑的能力明确标注「不做」，而不是用降级实现占坑。

---

## 0. 产品意图

用户在 **剪辑模块 AI 助手** 中进入 **口播模式**，输入口播意图或原始文案；系统生成 **分段口播脚本**（每段：要说的文字 + 所需画面描述），经用户 **逐段确认或修改** 后，按段自动完成：

1. TTS 合成并插入 **音频轨**  
2. **字幕与音频时间轴对齐**（非整段糊弄一句）  
3. 按段 **搜索 → 确认 → 下载** 网络素材  
4. 将长素材 **按口播语义智能选 in/out**，裁到与音频等长，插入 **视频轨**  

段与段 **顺序执行**，每段有明确状态，可回看、可重跑单段。

**北极星**：从「口播意图」到「声画字幕对齐的可编辑时间线」，中间脚本可审、素材可选、执行可追踪——**不是** Chat 里即兴拼多个 Agent 工具的 demo。

---

## 1. 设计原则（必读）

| 原则 | 含义 |
|------|------|
| **无简化缺口** | 不允许「Phase 1 整段一句字幕」「机械取前 N 秒」「聊天里凑合确认」等半成品冒充完整能力 |
| **里程碑 = 完整切片** | 每个里程碑交付 **可独立验收** 的完整子系统，而不是同一能力的阉割版 |
| **确认先于写时间线** | 脚本、素材候选均须用户确认（或明确修改）后再执行写操作 |
| **段为最小编排单元** | 状态机、重试、进度 UI 均以 **段（segment）** 为粒度 |
| **Agent 是暴露层** | 专用 orchestrator + API 承载业务；Agent tools 调用 orchestrator，而非让 LLM 逐步拼 raw tools |

---

## 2. 分段数据模型（全里程碑共用）

口播工程在剪辑 session 上挂载 **`voiceover_plan`**（名称可调整，语义固定）：

```json
{
  "id": "vo-plan-uuid",
  "status": "draft | confirmed | executing | completed | failed",
  "voice_id": "zh-CN-XiaoxiaoNeural",
  "speech_rate": "+0%",
  "segments": [
    {
      "id": "seg-1",
      "index": 1,
      "narration_text": "本段口播全文",
      "visual_brief": "画面描述：景别、主体、情绪、运动",
      "search_queries": ["关键词1", "关键词2"],
      "status": "draft | script_confirmed | tts_done | broll_done | failed",
      "tts": {
        "asset_id": null,
        "duration_sec": null,
        "timeline_start_sec": null,
        "word_timings": []
      },
      "subtitles": {
        "overlay_ids": [],
        "alignment": "sentence | word"
      },
      "broll": {
        "search_results": [],
        "selected": null,
        "library_asset_id": null,
        "block_id": null,
        "source_in_sec": null,
        "source_out_sec": null,
        "selection_reason": ""
      },
      "error": null
    }
  ]
}
```

**字段说明**

- `visual_brief`：供 LLM 生成检索意图与后续 **语义选段**，不是装饰文案。  
- `word_timings`：里程碑 B 必填（见 §4）；用于句/词级字幕。  
- `alignment`：里程碑 B 至少 **句级**；若 TTS 提供商支持稳定词边界，升级为 **词级**。  
- 每段 `timeline_start_sec` 由 orchestrator 根据前段累计时长计算，保证 **音频、字幕、视频 block 同起止**。

---

## 3. 里程碑总览

```text
里程碑 A ──脚本闭环──► 里程碑 B ──声画字幕──► 里程碑 C ──素材智能
  （不上时间线）           （TTS+对齐字幕）        （搜下裁+替换画面）
```

| 里程碑 | 名称 | 交付物 | 明确不做 |
|--------|------|--------|----------|
| **A** | 脚本闭环 | 口播模式 + schema + 分段编辑器 + 确认 | TTS、字幕、素材、时间线写入 |
| **B** | 声画字幕 | TTS 上轨 + 句/词级字幕对齐 + 段状态机 + 占位/自选画面 | 网络搜素材、语义 B-roll 选段 |
| **C** | 素材智能 | 搜 → 确认 → 下载 → 语义 in/out → 替换画面 | —（口播链闭环） |

**依赖**：B 依赖 A（已确认脚本）；C 依赖 B（音频时长与字幕已稳定）。

---

## 4. 里程碑 A · 脚本闭环

### 4.1 目标

用户能在 AI 助手 **口播模式** 下完成：**输入 → LLM 分段脚本 → 逐段编辑 → 整案确认**，且数据持久化在 session，**不写入时间线**。

### 4.2 范围（必须全部交付）

| # | 能力 | 验收标准 |
|---|------|----------|
| A1 | 口播模式入口 | 剪辑 Agent 面板有明确「口播」模式；与普通助手对话区分（不同 system prompt / 流程） |
| A2 | 脚本生成 | LLM 按 §2 schema 输出 `segments[]`；含 `narration_text`、`visual_brief`、`search_queries` |
| A3 | 分段脚本编辑器 | **专用 UI**（表格或卡片）：增删段、改序、编辑各字段；非仅聊天 Markdown |
| A4 | 确认门禁 | 「确认脚本」后 `voiceover_plan.status = confirmed`；未确认禁止进入 B |
| A5 | 持久化 | 脚本存 session（或 sidecar JSON）；刷新/重开工程可恢复 |
| A6 | 重新生成 | 支持整案或单段「让 LLM 重写」；重写后回到 draft，须再次确认 |

### 4.3 出口标准

- [ ] 用户输入 300 字口播意图，得到 ≥3 段可编辑脚本  
- [ ] 用户改第 2 段文案、删 1 段、加 1 段，确认后状态为 `confirmed`  
- [ ] 关闭重开工程，脚本仍在，且未确认前不会触发 TTS  

### 4.4 本里程碑不做

- TTS、音频轨、字幕 overlay、素材搜索、任何 `update_block_trim` / `add_clips_to_timeline` 写操作  

---

## 5. 里程碑 B · 声画字幕

### 5.1 目标

在 **已确认脚本** 基础上，按段执行：**TTS → 插入音频轨 → 句/词级字幕与音频对齐**；视频轨可用 **用户指定占位素材** 或 **工程内已有 clip**（时长与音频对齐），为 C 预留 `block_id` 与 trim 字段。

### 5.2 范围（必须全部交付）

| # | 能力 | 验收标准 |
|---|------|----------|
| B1 | 段级 orchestrator | 后端 `VoiceoverOrchestrator`（名可调整）：按段顺序执行，失败可重试单段，不 silently skip |
| B2 | TTS 接入 | 复用 Edge TTS（`edit_sessions` `/tts`）；每段写入 `audio_assets` + `audio_elements`，`duration_sec` 真实 |
| B3 | 时间轴布局 | 段 N 的 `timeline_start_sec = sum(前段 tts.duration)`；音频 clip 与（占位）视频 block **同起止** |
| B4 | 词/句时间戳 | TTS 输出 **句级** 时间轴（最低）；若 provider 支持则 **词级** 写入 `word_timings` |
| B5 | 字幕对齐 | 根据 `word_timings` 生成 overlay（句级多条或词级拆分）；**禁止** 整段单条字幕糊弄 |
| B6 | 段状态机 | `script_confirmed → tts_done`；UI 展示每段进度（等待/进行中/完成/失败） |
| B7 | Agent / API 暴露 | `POST .../voiceover/execute`（或等价）触发 B 阶段；Agent 仅调 orchestrator，不逐步拼 tool |
| B8 | 占位画面 | 用户可为全局或每段指定占位 video（工程内 block 或素材库）；trim 到 **音频等长**（机械 trim 仅用于占位，不称为智能选段） |

### 5.3 出口标准

- [ ] 5 段脚本确认后一键执行，音频轨连续无重叠，总时长 = 各段 TTS 之和  
- [ ] 每段字幕起止与口播朗读一致（句级误差 ≤ 200ms；词级若启用则逐字可见）  
- [ ] 占位视频 block 与对应段音频 **等长对齐**  
- [ ] 第 3 段 TTS 失败时，前 2 段保留，可单独重跑第 3 段  

### 5.4 本里程碑不做

- YouTube/Bilibili `search_materials`  
- `download_material_to_library` 自动下载  
- 按 `visual_brief` **语义选段**（属里程碑 C）  

---

## 6. 里程碑 C · 素材智能

### 6.1 目标

对 **已完成 TTS 的每一段**，按 `visual_brief` + `search_queries`：**搜索 → 用户确认候选 → 下载入库 → 语义选 in/out → 替换占位画面**，裁到与音频等长。

### 6.2 范围（必须全部交付）

| # | 能力 | 验收标准 |
|---|------|----------|
| C1 | 段级素材搜索 | 调用 `search_materials`；每段展示 Top-N 候选（标题、缩略、时长、平台、是否已在库） |
| C2 | 用户确认候选 | **必须** 用户选定一条（或从素材库手动指定）；禁止 LLM 静默下载 |
| C3 | 下载与入库 | `download_material_to_library` → `import_from_library` / 更新 block 源 |
| C4 | 语义选段 | 对下载长素材：结合 `visual_brief` + 口播文本，用 **视觉分析 / 片内检索**（可复用 `find_block_moments` / `analyze_block_content` 能力）选出 `source_in_sec`–`source_out_sec` |
| C5 | 时长对齐 | 选中片段时长 = 该段 `tts.duration_sec`（误差 ≤ 100ms）；写入 `update_block_trim` |
| C6 | 选段可解释 | UI 展示 `selection_reason`；用户可 **手动微调** in/out 后确认 |
| C7 | 段状态闭环 | `tts_done → broll_done`；全段 `broll_done` 后 plan `status = completed` |
| C8 | 失败与重跑 | 下载失败、选段失败可单段重搜/重下/重选，不影响已完成段 |

### 6.3 语义选段（C4）最低算法要求

**不允许** 仅「取素材前 N 秒」作为最终实现。最低方案需满足：

1. 对素材做一次 **稀疏画面理解**（抽帧 + LLM 或现有 clip 检索 pipeline）  
2. 在素材时间轴上产出 **≥1 个候选区间**，得分与 `visual_brief` 关联  
3. 默认选最高分区间；时长不足则 **扩展 in/out**（不超出素材边界），过长则 **裁到音频等长**  
4. 记录 `selection_reason` 供 UI 展示  

后续可增强：多候选让用户选、转场、运动优先等——但不降低 C4 最低要求。

### 6.4 出口标准

- [ ] 5 段口播：每段用户从搜索结果中选 1 条，下载并替换占位画面  
- [ ] 每段画面内容与 `visual_brief`  visibly 相关（人工抽检或通过选段 reason）  
- [ ] 每段视频 trim 长度 = 该段音频长度  
- [ ] 单段重搜素材并重跑 C，其他段不变  

### 6.5 本里程碑不做（口播链外）

- 平台版权合规自动化、付费素材库  
- 平台下载成功率与稳定性（网络、限流、链接失效；**默认不依赖 Cookie**，可选 `browser` 参数仅作增强）  
- 自动选「唯一最佳」素材而 **零用户确认**  

---

## 7. 与现有代码的映射

| 已有能力 | 路径 / 工具 | 里程碑 |
|----------|-------------|--------|
| Edge TTS | `backend/utils/edge_tts_service.py`、`POST .../tts` | B |
| 音频轨 | `add_audio_clip`、`session.audio_elements` | B |
| 字幕模板 | `apply_caption_template`（需扩展 **音频时间轴驱动**） | B |
| 素材搜索 | Agent `search_materials` | C |
| 下载入库 | `download_material_to_library`、`import_from_library` | C |
| 视频 trim | `update_block_trim` | B 占位 / C 最终 |
| 片内视觉检索 | `find_block_moments`、`clip_event_detector` | C4 |
| 任务确认 | `submit_task_plan`、Agent 操作清单 | A/C UI 可参考，但口播用专用编辑器 |
| Agent 对话 | `EditorAgentService.chat` | A 生成脚本；B/C 调 orchestrator |

**需新建（预估）**

- `VoiceoverPlan` schema + session 持久化  
- 前端 `VoiceoverPlanEditor`（里程碑 A）  
- 后端 `VoiceoverOrchestrator` + 段状态机（B/C）  
- TTS **句/词时间戳** 解析（B）  
- 字幕生成器：时间戳 → overlays（B）  
- B-roll 语义选段 service（C）  
- API：`/voiceover/plan`、`/voiceover/confirm`、`/voiceover/execute-segment` 等  

---

## 8. PR 拆分建议

| PR | 里程碑 | 说明 |
|----|--------|------|
| PR-VO-A1 | A | schema + 持久化 + API |
| PR-VO-A2 | A | 口播模式 + LLM 生成脚本 |
| PR-VO-A3 | A | 分段脚本编辑器 UI + 确认 |
| PR-VO-B1 | B | TTS 时间戳 + orchestrator 骨架 |
| PR-VO-B2 | B | 音频轨 + 句/词字幕 + 段进度 UI |
| PR-VO-B3 | B | 占位视频对齐 + 单段重试 |
| PR-VO-C1 | C | 段级搜索 + 候选确认 UI |
| PR-VO-C2 | C | 下载入库 + block 替换 |
| PR-VO-C3 | C | 语义选段 service + 微调 UI |

每个 PR 须满足对应里程碑 **该 PR 范围内** 的验收项，不合并「简化版」。

---

## 9. 非目标（全文适用）

- 用 Chat 多轮 `add_audio_clip` + `search_materials` + `update_block_trim` **代替** orchestrator  
- 整段单条字幕代替时间轴对齐  
- 无用户确认的自动下载与自动选素材  
- 将口播流水线塞入 ROADMAP Phase 0–3 的 **商业化/credits** 范围（口播属剪辑能力，可独立交付；计费策略另文档）  

---

## 10. 待产品拍板（实现前锁定）

| 项 | 选项 | 影响 |
|----|------|------|
| 字幕粒度 | 句级（最低）/ 词级（优先） | B4/B5 工作量、TTS 方案 |
| 素材确认 | 每段必选 / 允许「沿用占位」跳过 C | C 流程 |
| 默认 TTS 音色 | Edge 14 中文音色之一 | B2 |
| 段数上限 | 建议 1–24 段 | orchestrator 与 UI |

---

## 11. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-24 | 初版：三里程碑完整切片规划；明确「无简化缺口」原则 |
| 2026-06-24 | **里程碑 A 已完成**：schema、`voiceover_plan` 持久化、API、Agent「口播」面板与分段编辑器 |
| 2026-06-24 | **里程碑 B 已完成**：TTS 上轨、句级字幕、占位视频、段级 orchestrator |
| 2026-06-24 | **里程碑 C 已完成**：段级素材搜索/确认、下载入库、语义选段、替换占位画面 |
| 2026-06-24 | 新增 **§15 端到端验收清单**（A/B/C 人工 + API + CI 参考） |

## 12. 里程碑 A 实现清单（代码）

| 项 | 路径 |
|----|------|
| 数据模型 | `backend/schemas/voiceover_plan.py` |
| Session 字段 | `EditSession.voiceover_plan` |
| LLM 脚本生成 | `backend/services/voiceover_script_generator.py` |
| 业务逻辑 | `backend/services/voiceover_plan_service.py` |
| REST API | `POST/GET/PUT/DELETE .../voiceover/*` in `backend/api/v1/edit_sessions.py` |
| 前端类型 | `frontend/src/types/voiceoverPlan.ts` |
| API 客户端 | `frontend/src/services/voiceoverApi.ts` |
| UI | `frontend/src/components/editor/agent/VoiceoverPlanPanel.tsx`（Agent 面板「口播」Tab） |
| 测试 | `backend/tests/test_voiceover_plan.py` |

## 13. 里程碑 B 实现清单（代码）

| 项 | 路径 |
|----|------|
| TTS + 时间戳 | `backend/utils/edge_tts_service.py` → `synthesize_with_timings` |
| 字幕 overlay 构建 | `backend/services/voiceover_subtitle_builder.py` |
| 段级 orchestrator | `backend/services/voiceover_orchestrator.py` |
| 执行 API | `POST .../voiceover/execute`、`POST .../voiceover/execute-segment/{id}` |
| Plan 字段 | `placeholder_library_asset_id`、`tts.audio_clip_id` |
| 前端执行 UI | `VoiceoverPlanPanel` 占位素材选择 + 一键执行 + 分段状态/重试 |
| 测试 | `backend/tests/test_voiceover_execute.py` |

## 14. 里程碑 C 实现清单（代码）

| 项 | 路径 |
|----|------|
| 语义选段算法 | `backend/services/voiceover_broll_selection.py` |
| B-roll orchestrator | `backend/services/voiceover_broll_service.py` |
| 搜索 API | `POST .../voiceover/segments/{id}/search-materials` |
| 确认候选 API | `POST .../voiceover/segments/{id}/select-material` |
| 应用 B-roll API | `POST .../voiceover/segments/{id}/apply-broll` |
| 语义检索 | 复用 `clip_event_detector.search_clip_events`（visual_primary） |
| 前端 UI | `VoiceoverPlanPanel` 段内搜索/确认/应用 + 手动 in/out |
| 测试 | `backend/tests/test_voiceover_broll.py` |

---

## 15. 端到端验收清单

> **用途**：在真实剪辑工程中走通 A→B→C 全链；人工勾选即可判定是否达到各里程碑出口标准。  
> **建议工程**：新建空白剪辑 session，3–5 段口播脚本，总 TTS 时长 30s–3min。  
> **入口**：剪辑模块 → AI 助手面板 → **口播** Tab。

### 15.1 环境与前置

| # | 项 | 通过 |
|---|----|:----:|
| E0.1 | 后端 `/health` 正常；Edge TTS 可用（`edge-tts` 已安装） | ☐ |
| E0.2 | LLM 已配置（脚本生成、语义选段依赖） | ☐ |
| E0.3 | 素材库中至少有 **1 条占位视频**，单段时长 ≥ 最长口播段 TTS（建议 ≥ 60s） | ☐ |
| E0.4 | （C 阶段）YouTube 或 Bilibili 搜索/下载可用；或素材库中已有可用手动指定视频 | ☐ |
| E0.5 | 关闭并重开工程后，`voiceover_plan` 仍可恢复（持久化 smoke） | ☐ |

### 15.2 里程碑 A · 脚本闭环

| # | 操作 | 预期 | 通过 |
|---|------|------|:----:|
| A1 | 输入 ≥300 字口播意图，点击「生成分段脚本」 | 得到 ≥3 段，含口播文案、画面描述、搜索词 | ☐ |
| A2 | 编辑第 2 段文案、删除 1 段、后插 1 段，保存 | 变更持久化；段序 index 连续 | ☐ |
| A3 | 点击「确认脚本」 | plan 状态 **已确认**；各段 **脚本已确认** | ☐ |
| A4 | 确认后刷新/重开工程 | 脚本仍在；**时间线无变化**（无 audio/block/overlay 写入） | ☐ |
| A5 | 「改回草稿」后可再编辑；「LLM 重写本段」可用 | 回到 draft，重写后须再次确认 | ☐ |

### 15.3 里程碑 B · 声画字幕

| # | 操作 | 预期 | 通过 |
|---|------|------|:----:|
| B1 | 素材库选占位视频 →「执行 TTS + 字幕（全部待处理段）」 | 各段进入执行；完成后段状态 **TTS 完成** | ☐ |
| B2 | 检查时间线 **音频轨** | 各段 clip 首尾相接、无重叠；总时长 ≈ 各段 TTS 之和 | ☐ |
| B3 | 检查 **字幕 overlay** | 每段 **多条**句级字幕（非整段一条）；起止与朗读大致一致（句级误差体感 ≤200ms） | ☐ |
| B4 | 检查 **视频轨占位 block** | 每段 block 与对应音频 **等长**（可视宽度/时长一致） | ☐ |
| B5 | 故意让第 3 段失败（如断网后重试 TTS）或单段重跑 | 前段保留；可 **重试本段 / 重新生成本段 TTS** 而不影响已完成段 | ☐ |
| B6 | plan 状态 | 全部 TTS 完成后 plan 为 **已完成** 或 **执行中**（允许尚未做 C） | ☐ |

### 15.4 里程碑 C · 素材智能（逐段）

对 **每一段** 重复以下步骤（至少验收 2 段，建议全段走一遍）：

| # | 操作 | 预期 | 通过 |
|---|------|------|:----:|
| C1 | 选择平台 →「搜索素材」 | 展示 Top-N：标题、平台、时长、是否已在库 | ☐ |
| C2 | 单选一条候选（或素材库下拉）→「确认候选」 | 显示「已选：xxx」；**未**自动下载 | ☐ |
| C3 | 「下载并应用 B-roll」 | 下载完成后占位 block **替换**为真实素材；段状态 **素材完成** | ☐ |
| C4 | 查看 **选段说明**（`selection_reason`） | 含语义命中区间或扩展说明，非空且可读 | ☐ |
| C5 | 检查 block **trim 时长** | 与段 TTS 时长一致（误差 ≤100ms，预览体感对齐即可） | ☐ |
| C6 | 画面与 `visual_brief` | 人工抽检：内容与画面描述 ** visibly 相关** | ☐ |
| C7 | 手动改 in/out →「应用手动 trim」 | trim 更新；时长仍与 TTS 对齐；说明文案更新 | ☐ |
| C8 | 单段 **重搜 + 重选 + 重应用** | 其他已完成段 **不变** | ☐ |

全段 `broll_done` 后：

| # | 预期 | 通过 |
|---|------|:----:|
| C9 | plan 状态 **已完成** | ☐ |
| C10 | 预览播放：声画字幕 **同步**，段间 **无黑场错位**（允许占位转场设置影响） | ☐ |

### 15.5 失败与边界（建议至少抽测 2 项）

| # | 场景 | 预期 | 通过 |
|---|------|------|:----:|
| F1 | 占位视频 **短于** 口播 TTS | B 阶段报错，提示更换更长占位素材 | ☐ |
| F2 | 未「确认候选」直接「应用 B-roll」 | 前端按钮禁用或 API 400 | ☐ |
| F3 | 语义选段 **无匹配**（素材与 brief 完全无关） | 报错提示换素材/手动 in/out；**不**静默取前 N 秒 | ☐ |
| F4 | 下载超时或失败 | 段状态失败 + 错误信息；可重试，不影响其他段 | ☐ |
| F5 | 脚本 **draft** 时尝试执行 B | 不可执行或明确提示须先确认脚本 | ☐ |

### 15.6 API 冒烟（可选，供调试）

替换 `{project_id}`、`{session_id}`、`{segment_id}`：

```http
# A
POST /api/v1/projects/{project_id}/edit-sessions/{session_id}/voiceover/generate
POST /api/v1/projects/{project_id}/edit-sessions/{session_id}/voiceover/confirm

# B
POST /api/v1/projects/{project_id}/edit-sessions/{session_id}/voiceover/execute
Body: { "placeholder_library_asset_id": "lib-..." }

# C
POST .../voiceover/segments/{segment_id}/search-materials
Body: { "platform": "youtube", "limit": 10 }
POST .../voiceover/segments/{segment_id}/select-material
Body: { "search_result_index": 0 }
POST .../voiceover/segments/{segment_id}/apply-broll
Body: { "wait_download_timeout_sec": 300 }
```

### 15.7 自动化测试（CI 参考）

```bash
python -m pytest backend/tests/test_voiceover_plan.py \
  backend/tests/test_voiceover_execute.py \
  backend/tests/test_voiceover_broll.py -q
```

### 15.8 已知限制（验收时不算缺陷）

- 句级字幕为主；词级为句内字符权重估算，非 TTS 原生 WordBoundary。
- B/C 依赖素材库与 yt-dlp 下载公开链接；**无需配置 Cookie**。失败常见原因为网络、平台限流或链接失效，可改用手动入库 + 素材库指定。
- 语义选段耗时与 LLM/抽帧有关，长素材单段可能需 1–3 分钟。
- Agent 对话 **尚未** 默认挂载口播 orchestrator tools；当前以 **口播 Tab 专用 UI** 为验收入口。

### 15.9 签收标准（全链）

以下 **全部勾选** 视为口播生产线 v1 可交付：

- [ ] §15.2 里程碑 A 全部通过  
- [ ] §15.3 里程碑 B 全部通过  
- [ ] §15.4 里程碑 C 至少 2 段完整通过 + C9/C10  
- [ ] §15.5 至少 2 项边界通过  
- [ ] §15.7 自动化测试 green  
