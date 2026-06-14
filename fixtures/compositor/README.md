# Compositor Golden Fixtures

Phase 0–2 回归用固定输入/输出，供 TS 与 Rust Compositor 对齐测试。

## Session fixtures

| 文件 | 说明 |
|------|------|
| `session-minimal.json` | 单片段 9:16 测试工程 |
| `session-dissolve.json` | 双片段叠化测试工程 |
| `session-free-text.json` | 自由文本 overlay（拖动偏移） |

## Golden outputs (`golden/`)

| 文件 | 说明 |
|------|------|
| `minimal-plan.json` | minimal session → `CompositionPlan` |
| `minimal-descriptor-t0.json` | FrameDescriptor @ t=0 |
| `minimal-descriptor-t1.json` | FrameDescriptor @ t=1s |
| `minimal-descriptor-t-end.json` | FrameDescriptor @ 末尾 |
| `dissolve-plan.json` | dissolve session → `CompositionPlan` |
| `dissolve-descriptor-t0.json` | FrameDescriptor @ t=0 |
| `dissolve-descriptor-t-mid.json` | FrameDescriptor @ 叠化中点 (3.8s) |
| `dissolve-descriptor-t-end.json` | FrameDescriptor @ 末尾 |
| `free-text-descriptor-t1.5.json` | 自由文本激活时刻 |

`CompositionPlan.metadata.compiledAt` 在 golden 比较中固定为 `fixture-compiled-at`。

## 运行测试

```bash
cd frontend
npm install
npm test                                    # 全部 vitest（含 compositor + golden）
npx vitest run src/editor/compositor/compositorGolden.test.ts
```

更新 golden JSON（改 IR 后）：

```bash
cd frontend
# PowerShell
$env:UPDATE_GOLDEN=1; npx vitest run src/editor/compositor/compositorGolden.test.ts
```

后端 fixture parity：

```bash
pytest backend/tests/test_compositor_golden.py
```

## Phase 2 导出

桌面默认：`exportTimelineViaCompositor`（逐帧 Compositor + FFmpeg stdin 编码）→ `POST .../export/compositor-mux`（timeline 音频 + BGM，`-c:v copy`）。

导出弹窗可开关 **Compositor 导出**（仅 Tauri「合成一条」）；Legacy FFmpeg 布局导出需设置 `AUTOCLIP_EXPORT_LEGACY=1` 或关闭该开关。
