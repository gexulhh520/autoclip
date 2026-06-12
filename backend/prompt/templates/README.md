# 基因模板 Prompt 目录

每个模板可在本目录下创建 `{template_id}/` 子目录，覆盖默认 Prompt。

## 优先级（见 `pipeline/prompt_loader.py`）

1. `processing_config.prompt_overrides`（来自模板 JSON 的 `prompts.overrides`）
2. `prompt/templates/{template_id}/`
3. `prompt/goals/{prompt_pack}/`
4. `prompt/{video_category}/`
5. `prompt/` 默认文件

## Moment 流水线别名

moment 类模板可使用专用文件名：

- `scan_moments.txt` → outline
- `bound.txt` → timeline

## 示例

```
templates/
  golden_quote_cinema/
    scan_moments.txt
    bound.txt
    推荐理由.txt
```

若目录不存在，将回退到 `prompt/goals/{prompt_pack}/`。
