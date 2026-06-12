# 多源视频 · 单项目分析 MVP

> 更新：2026-06-12 · 依赖：基因模板 MVP（`docs/GENE_TEMPLATE_MVP.md`）  
> 目标：一个项目上传多个视频，**按上传顺序串行**跑流水线，**所有切片汇总在同一项目**；详情页可按源视频查看进度与产出。

---

## 一、问题与目标

### 业务场景（已确认）

金句 / 混剪类创作常见：**一次选题任务对应多条源素材**（多部电影片段、多条解说），希望：

1. 用户**只建一个项目**，一次选模板、一次配置；
2. 上传 **N 个视频**，系统**按上传顺序**逐个分析（不是合成一条再分析）；
3. 产出的**全部切片**都在**同一个项目**里；
4. 项目详情可切换视图：
   - **全部片段**（项目级）
   - **按源视频**（看该条的流水线进度 + 该条产出的片段）

### 明确不在 MVP 范围

- **一条成片跨多个源视频拼接**（多源 concat 成一条输出）→ 后续「编排层」
- **多源并行**跑 LLM（MVP 串行，降低资源争抢与调试复杂度）
- **跨项目**汇总片段

### 与现状关系

| 现状 | MVP 后 |
|------|--------|
| 1 项目 = 1 × `raw/input.mp4` | 1 项目 = N × `raw/sources/{source_id}/input.mp4` |
| Pipeline 跑一次 | 对每个 `source` 顺序跑一轮 |
| Clip 仅 `project_id` | Clip 增加 `source_id`（metadata） |
| 进度仅项目级 step1–6 | 项目级队列进度 + **每源** step 状态 |

**兼容**：无 `sources` 字段的旧项目仍按单源 `input.mp4` 处理，行为不变。

---

## 二、概念模型

```
Project（分析任务）
├── template_id / processing_config（项目级，所有源共享）
├── sources[]（有序列表）
│   ├── Source #0  video_a.mp4  → status → pipeline_run → clips[]
│   ├── Source #1  video_b.mp4  → status → pipeline_run → clips[]
│   └── Source #2  video_c.mp4  → pending ...
└── clips[]（项目级聚合，每条 clip.source_id 指向来源）

执行顺序：Source #0 全流程完成（或失败可重试）→ Source #1 → …
项目状态：由 sources 聚合（任一 processing → 项目 processing；全部 completed → completed）
```

### Source 状态机

```
pending → processing → completed
                    ↘ failed（可 retry 单源）
```

---

## 三、存储设计（MVP：JSON + 文件系统优先）

与基因模板一致，**先不改 DB 表结构**（或仅做可选 migration），核心状态放 `processing_config` + 项目目录。

### 3.1 `processing_config` 扩展

```json
{
  "template_id": "golden_quote_cinema",
  "clip_goal": "golden_quote",
  "multi_source": {
    "enabled": true,
    "current_source_index": 1,
    "sources": [
      {
        "id": "src_01HXYZ",
        "index": 0,
        "original_filename": "movie_a.mp4",
        "status": "completed",
        "video_path": "raw/sources/src_01HXYZ/input.mp4",
        "subtitle_path": "raw/sources/src_01HXYZ/input.srt",
        "thumbnail": "<base64 optional>",
        "duration_seconds": 842,
        "clips_count": 5,
        "error_message": null,
        "started_at": "2026-06-12T10:00:00Z",
        "completed_at": "2026-06-12T10:12:00Z"
      },
      {
        "id": "src_01HABC",
        "index": 1,
        "original_filename": "movie_b.mp4",
        "status": "processing",
        "current_step": "step2_timeline"
      }
    ]
  }
}
```

单源旧项目：无 `multi_source` 或 `enabled: false`，继续用 `raw/input.mp4`。

### 3.2 目录结构

```
data/projects/{project_id}/
├── raw/
│   ├── input.mp4              # 兼容：首源或旧项目
│   ├── input.srt
│   └── sources/
│       ├── src_01HXYZ/
│       │   ├── input.mp4
│       │   └── input.srt
│       └── src_01HABC/
│           ├── input.mp4
│           └── input.srt
├── metadata/
│   ├── sources/
│   │   ├── src_01HXYZ/
│   │   │   ├── step1_outline.json
│   │   │   └── …
│   │   └── src_01HABC/
│   │       └── …
│   └── step1_outline.json     # 兼容：单源仍写此处
├── output/
│   ├── clips/
│   │   ├── src_01HXYZ_clip_001_….mp4
│   │   └── src_01HABC_clip_003_….mp4
│   └── sources/
│       └── src_01HXYZ/
│           └── step6_video_output.json
└── project_manifest.json        # 可选：源列表 + 聚合索引
```

### 3.3 Clip 归属

MVP 在 `clips.clip_metadata`（及文件系统 metadata）增加：

```json
{
  "source_id": "src_01HXYZ",
  "source_index": 0,
  "source_filename": "movie_a.mp4"
}
```

DB 可选后续：`clips.source_id` 列 + 索引（查询按源过滤时更快）。

---

## 四、流水线改造

### 4.1 调度：SourceQueueRunner

新增薄调度层（建议 `backend/pipeline/source_queue_runner.py`）：

```
on_project_start(project_id):
  sources = get_pending_sources_ordered()
  for source in sources:
    mark_source_processing(source)
    run_pipeline_for_source(project_id, source_id)  # 复用现有 Orchestrator
    on success: mark_source_completed; merge clips into project
    on failure: mark_source_failed; continue or stop (配置项，MVP 默认 stop)
  update_project_status_aggregate()
```

**关键**：`SimplePipelineAdapter` / `PipelineOrchestrator` 增加 `source_id` 上下文：

- 读写的 metadata 路径 → `metadata/sources/{source_id}/`
- 输入视频 → `raw/sources/{source_id}/input.mp4`
- 输出 clip 文件名前缀 → `{source_id}_`

现有单源路径作为 `source_id=None` 的默认分支，避免破坏回归。

### 4.2 步骤与进度 API

`pipeline_steps_service.get_pipeline_steps` 扩展：

| 字段 | 说明 |
|------|------|
| `multi_source.enabled` | 是否多源项目 |
| `sources[]` | 每源摘要：status、current_step、clips_count |
| `active_source_id` | 当前正在跑的源 |
| `steps` | **默认**返回 `active_source` 的步骤；或 query `?source_id=` |

项目级进度文案示例：

> 经典影视金句 · 源 2/5 处理中 · 当前：movie_b.mp4 · step2 时间线定位

### 4.3 导入阶段

**创建项目 + 批量上传**（MVP 流程）：

1. `POST /api/v1/projects/upload-batch`  
   - `project_name`, `template_id`, `files[]`（有序 multipart）  
   - 创建 1 个项目，写入 N 个 source，`index` = 上传顺序  
2. 或：先 `POST /projects/upload` 创建空壳，再 `POST /projects/{id}/sources` 追加（支持后续加源，可 phase 2）

导入任务 `process_import_task` 按源生成字幕；全部就绪后触发 `SourceQueueRunner`。

B 站 / YouTube：MVP 可仍单链单源；多链作为 phase 2（多次调用 append source API）。

---

## 五、API 设计（草案）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects/upload-batch` | 创建项目 + N 个视频（有序） |
| POST | `/api/v1/projects/{id}/sources` | 向已有项目追加源（phase 2） |
| GET | `/api/v1/projects/{id}/sources` | 源列表 + 状态 |
| GET | `/api/v1/projects/{id}/sources/{source_id}` | 单源详情 |
| GET | `/api/v1/projects/{id}/pipeline-steps?source_id=` | 该源的 step 面板 |
| GET | `/api/v1/projects/{id}/clips?source_id=` | 过滤切片；无参数=全部 |
| POST | `/api/v1/projects/{id}/sources/{source_id}/retry` | 重跑失败源 |

响应中 `ProjectResponse` 增加：

```typescript
multi_source?: {
  enabled: boolean
  total_sources: number
  completed_sources: number
  active_source_id?: string | null
  sources: ProjectSourceSummary[]
}
```

---

## 六、前端信息架构

### 6.1 上传（HomePage / FileUpload）

- Dropzone **允许多视频**；列表展示顺序，支持拖拽排序（MVP 可仅按选择顺序）
- 一次提交 → `upload-batch`；项目名一份、模板一份
- 上传进度：整体 + 每个文件

### 6.2 项目详情（ProjectDetailPage）

```
┌─────────────────────────────────────────┐
│ ← 项目名    [模板 · 经典影视金句]          │
├─────────────────────────────────────────┤
│ [全部片段] [源视频]                       │  ← Tab
├─────────────────────────────────────────┤
│ 源视频 Tab：                              │
│  ┌─ movie_a.mp4  ✅ 5 片段  [查看]       │
│  ┌─ movie_b.mp4  ⏳ step2   [查看]  ← 当前 │
│  └─ movie_c.mp4  ⏸ 待处理               │
├─────────────────────────────────────────┤
│ 选中某源时：PipelineStepsPanel(source_id) │
│ 片段列表过滤为该源；「全部」Tab 显示所有   │
└─────────────────────────────────────────┘
```

UI 遵循 `DESIGN.md`：单色、留白、状态用克制文字 + 细线，不用彩色 chip 堆叠。

### 6.3 项目卡片（ProjectCard）

- 副标题：`3 个源视频 · 12 个片段` 或 `源 2/3 处理中`

---

## 七、阶段划分

### 阶段 A：数据与路径（2~3 天）— ✅ 已完成

| ID | 任务 | 交付 |
|----|------|------|
| A.1 | `ProjectSource` schema（Pydantic） | `backend/schemas/project_source.py` |
| A.2 | 源目录 / metadata 路径工具 | `path_utils` 扩展 |
| A.3 | `processing_config.multi_source` 读写 helper | `backend/services/project_source_service.py` |
| A.4 | 单测：路径、状态聚合 | `test_project_source_service.py` |

### 阶段 B：上传与调度（3~4 天）— 🟡 进行中（后端 MVP 已接入）

| ID | 任务 | 交付 |
|----|------|------|
| B.1 | `upload-batch` API | `projects.py` |
| B.2 | 按源 import（ASR） | `import_processing` 改造 |
| B.3 | `SourceQueueRunner` 串行调度 | `source_queue_runner.py` |
| B.4 | Orchestrator / Adapter 支持 `source_id` | 现有 pipeline 最小侵入 |
| B.5 | Clip 写入 `source_id` | step6 + data_sync |

### 阶段 C：进度与查询 API（2 天）— ✅ 已完成

| ID | 任务 | 交付 |
|----|------|------|
| C.1 | `GET /sources`、`pipeline-steps?source_id=` | ✅ |
| C.2 | `GET /clips?source_id=` | ✅ |
| C.3 | 项目状态聚合逻辑 | ✅（队列 runner） |
| C.4 | `POST /sources/{id}/retry` | ✅ |

### 阶段 D：前端（3~4 天）— ✅ 已完成（MVP）

| ID | 任务 | 交付 |
|----|------|------|
| D.1 | FileUpload 多文件 + batch API | ✅ |
| D.2 | ProjectDetail 源视频列表 | ✅ `ProjectSourcesPanel` |
| D.3 | PipelineStepsPanel 按源展示 | ✅ |
| D.4 | Clip 列表按源过滤 | ✅ |
| D.5 | ProjectCard 多源摘要 | ⬜ 可选 |

### 阶段 E：验证（1~2 天）

| ID | 任务 | 说明 |
|----|------|------|
| E.1 | 单源回归 | 旧项目不受影响 |
| E.2 | 3 源串行 E2E | 金句模板 + Ollama |
| E.3 | 失败重试单源 | |
| E.4 | 冒烟脚本扩展 | `verify_multi_source_mvp.py` |

**预估**：约 2 周（与基因模板并行迭代时可复用模板配置链）。

---

## 八、风险与决策

| 风险 | 缓解 |
|------|------|
| Pipeline 路径硬编码 `metadata/step*.json` | 统一经 `SourceContext` 解析路径 |
| 长队列总耗时 | UI 明确「源 x/y」；允许取消未开始的源（phase 2） |
| 磁盘占用 N 倍 | 源级删除 / 仅保留片段（后期） |
| Celery 任务超时 | 每源独立 task，项目级 chain |

**默认策略（MVP）**：

- 某源失败 → **暂停队列**，项目 `failed`，用户可 retry 该源后继续后续源
- 模板 / clip_goal **项目级统一**，不在源级 override

---

## 九、验收标准

- [ ] 一次上传 ≥2 个视频，只创建 **1 个项目**
- [ ] 按**上传顺序**串行分析，可在详情看到 **源 1/2/3** 进度
- [ ] 所有源的切片出现在**同一项目**「全部片段」
- [ ] 切换到某一源，仅显示该源片段 + 该源 pipeline steps
- [ ] 旧单视频项目行为不变
- [ ] `golden_quote_cinema` 模板下 2 源实测出片

---

## 十、后续扩展（非 MVP）

1. **追加源**：项目完成后继续上传
2. **B 站多链**：解析队列写入 sources
3. **并行度**：可配置 2 路并行（CPU/GPU 允许时）
4. **跨源合集**：在 step5 或新 step 做「主题混剪」输出一条成片
5. **DB 正式表** `project_sources` migration

---

## 十一、推荐实施顺序

1. A（路径 + schema）→ B.4（Orchestrator 上下文）→ B.1/B.3（上传 + 调度）
2. C（API）与 D（前端）可并行
3. 最后用金句模板做 E2E

与基因模板关系：**多源是项目/调度层能力**，模板仍通过项目级 `template_id` 生效，无需改模板 JSON 结构。
