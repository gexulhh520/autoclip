# Compositor Golden Fixtures

Phase 0 回归用固定输入/输出，供 TS 与 Rust Compositor 对齐测试。

| 文件 | 说明 |
|------|------|
| `session-minimal.json` | 单片段 9:16 测试工程 |
| `session-dissolve.json` | 双片段叠化测试工程 |

运行 `frontend/src/editor/compositor/compositor.test.ts` 可验证 `compileCompositionPlan` / `buildFrameDescriptor` 与 timeline parity。

FrameDescriptor 在 `t = 0`、叠化中点、末尾四处应保持稳定（见测试用例）。
