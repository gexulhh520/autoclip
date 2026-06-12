# 基因模板系统 MVP — 任务拆解与进度

> 更新：2026-06-12 · 对应 skill：`.cursor/skills/plan/SKILL.md`  
> 目标：2~4 周内跑通「选模板 → 上传视频 → 按模板风格生成短视频」

---

## 一、背景与策略

### 当前状态

- 项目是 zhouxiaoka/autoclip 的 fork，已有完整前后端 + Pipeline（ASR + LLM 多步分析 + FFmpeg 切片）
- 底层已有 `clip_goal` / `prompt_pack` / `video_category` 机制，基因模板是在其上的**用户可见风格包**
- 短期不做 MCP / AI Agent 集成

### 实现策略

- **JSON 配置 + 动态加载**，前期不改数据库
- `template_id` 写入 `Project.processing_config`，Pipeline 启动时解析
- 前端新增模板广场，用户先选模板再导入视频

### 架构关系

```
用户选择模板 (template_id)
    ↓
backend/templates/*.json
    ↓
TemplateEngine.resolve_processing_settings()
    ↓
processing_config (clip_goal, video_category, clip_duration_preset, ...)
    ↓
现有 Pipeline (Orchestrator step1–6)
```

---

## 二、阶段划分与任务清单

### 阶段一：基础准备（3~5 天）— ✅ 已完成

| ID | 任务 | 状态 | 交付物 |
|----|------|------|--------|
| 1.1 | 设计模板 JSON Schema | ✅ | `backend/templates/schema.json` |
| 1.2 | 创建首个模板配置 | ✅ | `backend/templates/golden_quote_cinema.json` |
| 1.3 | 创建第二个模板（MVP 验收） | ✅ | `backend/templates/knowledge_digest.json` |
| 1.4 | 实现 TemplateEngine | ✅ | `backend/pipeline/template_engine.py` |
| 1.5 | Pydantic 模型 | ✅ | `backend/schemas/template.py` |
| 1.6 | 模板列表/详情 API | ✅ | `GET /api/v1/templates`, `GET /api/v1/templates/{id}` |
| 1.7 | 单元测试 | ✅ | `backend/tests/test_template_engine.py` |

**API 示例**

- `GET /api/v1/templates` — 模板广场列表
- `GET /api/v1/templates/golden_quote_cinema` — 详情 + `resolved_settings`

---

### 阶段二：前端模板选择（5~7 天）— ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|----|------|------|------|
| 2.1 | `templatesApi` 封装 | ✅ | `frontend/src/services/api.ts` |
| 2.2 | `TemplateCard` 组件 | ✅ | 名称、描述、标签、参考视频占位 |
| 2.3 | `TemplatesPage` 页面 | ✅ | 卡片网格，遵循 `DESIGN.md` |
| 2.4 | 注册路由 `/templates` | ✅ | `App.tsx` |
| 2.5 | Header / 首页入口 | ✅ | 首页「选择基因模板」链接 |
| 2.6 | 模板选择状态传递 | ✅ | 选模板 → 跳转首页，`location.state` |
| 2.7 | 首页已选模板展示 | ✅ | 横幅 +「更换模板」 |
| 2.8 | 上传组件携带 `template_id` | ✅ | `FileUpload` / `BilibiliDownload` |

---

### 阶段三：Pipeline 动态化（7~10 天）— ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|----|------|------|------|
| 3.1 | upload 接口接受 `template_id` | ✅ | `POST /api/v1/projects/upload` |
| 3.2 | B站/YouTube 下载接受 `template_id` | ✅ | `bilibili.py` / `youtube.py` |
| 3.3 | `merge_template_settings()` | ✅ | 创建项目时合并模板配置 |
| 3.4 | Adapter 启动时解析模板 | ✅ | `SimplePipelineAdapter._load_project_settings` |
| 3.5 | prompt_loader 增加 template pack 优先级 | ✅ | `prompt/templates/{id}` + `prompt_overrides` |
| 3.6 | 消费 `template_rules` | ✅ | `enable_clustering` 控制 step5；`subtitle_style` 写入 metadata |
| 3.7 | 第一个模板端到端跑通 | ✅ | 冒烟脚本 + E2E 单测（真实 LLM 视频需本地手动跑） |

---

### 阶段四：验证与优化（3~5 天）— ✅ 基本完成

| ID | 任务 | 状态 | 说明 |
|----|------|------|------|
| 4.1 | 真实视频测试 | ⬜ | 需本地 LLM + ffmpeg；运行 `scripts/verify_template_mvp.py` 可验证配置链 |
| 4.2 | 错误处理与空状态 | ✅ | 无效 `template_id` 返回 400；首页模板校验 |
| 4.3 | 参考视频资源 | ✅ | SVG 封面 + MP4 循环预览 + `GET /api/v1/templates/assets/{name}` |
| 4.4 | 第二个模板微调 | ✅ | `knowledge_digest` Prompt + 描述 + 封面 |
| 4.5 | 回归测试现有 Pipeline | ✅ | 单测 + 冒烟脚本 |

### 体验优化（可选 polish）— ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|----|------|------|------|
| P.1 | 项目列表/详情展示模板 | ✅ | `TemplateBadge` + `ProjectCard` / `ProjectDetailPage` |
| P.2 | 模板选择 sessionStorage 持久化 | ✅ | 刷新首页仍保留已选模板 |
| P.3 | 流水线步骤 UI 对齐模板规则 | ✅ | 跳过 step5 等；面板显示模板名与有效步骤数 |
| P.4 | 模板卡片循环预览视频 | ✅ | `*_preview.mp4` + `TemplateCard` autoplay |

---

## 四、Prompt 解析优先级

`prompt_loader.py` 按以下顺序加载（高 → 低）：

1. `processing_config.prompt_overrides`（模板 JSON `prompts.overrides`）
2. `backend/prompt/templates/{template_id}/`
3. `backend/prompt/goals/{prompt_pack}/`
4. `backend/prompt/{video_category}/`
5. `backend/prompt/` 默认

Moment 流水线额外支持 `scan_moments.txt` / `bound.txt` 别名。

## 五、模板规则（template_rules）

| 字段 | 作用 | 状态 |
|------|------|------|
| `enable_clustering` | 控制是否执行 step5 主题聚类 | ✅ 已实现 |
| `subtitle_style` | 字幕/叠加样式 | `default` 无叠加；`quote_highlight` 在 step6 烧录金句标题 |

## 六、模块改动评估

| 模块 | 改动量 | 风险 | 主要文件 |
|------|--------|------|----------|
| 前端 | 大 | 中 | `TemplatesPage.tsx`, `HomePage.tsx`, `FileUpload.tsx` |
| Pipeline | 大 | 高 | `template_engine.py`, `simple_pipeline_adapter.py`, `prompt_loader.py` |
| 后端 API | 中 | 低 | `templates.py`, `projects.py`, `bilibili.py` |
| 数据结构 | 小 | 低 | `backend/templates/*.json` |

---

## 附录：模板 JSON 结构（摘要）

```json
{
  "id": "golden_quote_cinema",
  "name": "经典影视金句",
  "description": "...",
  "enabled": true,
  "tags": ["金句", "影视"],
  "preview": { "video_url": "", "thumbnail_url": "" },
  "pipeline": {
    "clip_goal": "golden_quote",
    "video_category": "entertainment",
    "clip_duration_preset": "short"
  },
  "prompts": { "pack": "golden_quote" },
  "rules": { "enable_clustering": false, "subtitle_style": "default" }
}
```

完整 Schema：`backend/templates/schema.json`

---

## 七、推荐执行顺序

1. ✅ 阶段一：Schema + Engine + API
2. ✅ 阶段二：前端模板广场 + 状态传递
3. ✅ 阶段三.1–3.6：upload/下载接入 + Adapter + Prompt + 规则
4. ⬜ 本地真实视频 + LLM 全链路验证（Ollama 或云端 LLM + ffmpeg）
5. ✅ 冒烟：`python scripts/verify_template_mvp.py`

---

## 八、风险与注意事项

- Pipeline 改动需保证**无 `template_id` 时行为与现网一致**
- 模板 JSON 结构预留 `rules` / `prompts.overrides` 扩展位
- 参考视频 MVP 可先空 URL，后续补资源
- UI 遵循 `DESIGN.md`（Calm Premium，克制单色 + 蓝强调）

---

## 九、预期成果（MVP 完成）

- [x] 用户可见至少 2 个基因模板（API + 前端页面）
- [x] 选模板 → 上传/链接导入 → 按模板风格生成（配置链 + 冒烟已验证；LLM 出片需本地 Ollama 或云端 Key）
- [x] 新模板仅需添加 JSON 文件
- [x] 代码结构支持后续扩展更多模板
