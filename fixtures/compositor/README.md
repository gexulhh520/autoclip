# Compositor Golden Fixtures

Phase 0 回归用固定输入/输出，供 TS 与 Rust Compositor 对齐测试。

| 文件 | 说明 |
|------|------|
| `session-minimal.json` | 单片段 9:16 测试工程 |
| `session-dissolve.json` | 双片段叠化测试工程 |

运行 `frontend/src/editor/compositor/compositor.test.ts` 可验证 `compileCompositionPlan` / `buildFrameDescriptor` 与 timeline parity。

FrameDescriptor 在 `t = 0`、叠化中点、末尾四处应保持稳定（见测试用例）。

## Phase 2 导出

桌面默认：`exportTimelineViaCompositor`（逐帧 Compositor + FFmpeg stdin 编码）→ `POST .../export/compositor-mux`（timeline 音频 + BGM，`-c:v copy`）。

Legacy FFmpeg 布局导出需设置 `AUTOCLIP_EXPORT_LEGACY=1` 或关闭 Store 中 `useCompositorExport`。
