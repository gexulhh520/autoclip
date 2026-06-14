"""
Step 4: 标题生成 - 为高质量内容生成标题；金句模板下生成叠加旁白
"""
import json
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from collections import defaultdict

# 导入依赖
from ..utils.llm_client import LLMClient
from ..utils.text_processor import TextProcessor
from ..core.shared_config import PROMPT_FILES, METADATA_DIR

logger = logging.getLogger(__name__)


def _is_overlay_copy_mode(settings: Optional[Dict[str, Any]]) -> bool:
    settings = settings or {}
    if str(settings.get("clip_goal") or "") == "golden_quote":
        return True
    rules = settings.get("template_rules") or {}
    if isinstance(rules, dict) and rules.get("subtitle_style") == "quote_cinema":
        return True
    return False


def _normalize_body_lines(body: Any, *, max_lines: int = 2) -> List[str]:
    if body is None:
        return []
    if isinstance(body, str):
        body = [body]
    if not isinstance(body, list):
        return []
    lines: List[str] = []
    for item in body:
        text = str(item).strip()
        if text:
            lines.append(text)
        if len(lines) >= max_lines:
            break
    return lines


class TitleGenerator:
    """标题生成器"""

    def __init__(
        self,
        metadata_dir: Optional[Path] = None,
        prompt_files: Dict = None,
        settings: Optional[Dict[str, Any]] = None,
    ):
        self.llm_client = LLMClient()
        self.text_processor = TextProcessor()
        self.settings = settings or {}
        self.overlay_copy_mode = _is_overlay_copy_mode(self.settings)

        prompt_files_to_use = prompt_files if prompt_files is not None else PROMPT_FILES
        with open(prompt_files_to_use["title"], "r", encoding="utf-8") as f:
            self.title_prompt = f.read()

        if metadata_dir is None:
            metadata_dir = METADATA_DIR
        self.metadata_dir = metadata_dir
        self.llm_raw_output_dir = self.metadata_dir / "step4_llm_raw_output"

    def _apply_title_to_clip(self, clip: Dict[str, Any], value: Any) -> None:
        clip_id = clip.get("id")

        if self.overlay_copy_mode and isinstance(value, dict):
            list_title = str(value.get("list_title") or value.get("title") or "").strip()
            headline = str(value.get("headline") or "").strip()
            body = _normalize_body_lines(value.get("body"))

            if not list_title and headline:
                list_title = headline
            if not list_title:
                outline = clip.get("outline", "")
                if isinstance(outline, dict):
                    list_title = str(outline.get("title") or outline.get("outline") or "")
                else:
                    list_title = str(outline or "")

            clip["generated_title"] = list_title or f"片段_{clip_id}"

            if headline:
                if "source_content" not in clip:
                    clip["source_content"] = clip.get("content")
                overlay_lines = [headline, *body]
                clip["content"] = overlay_lines
                clip["overlay_copy"] = True
                logger.info(
                    "  > 片段 %s 叠加旁白: headline=%r body=%s",
                    clip_id,
                    headline,
                    body,
                )
            else:
                logger.warning("  > 片段 %s 未返回 headline，保留原 content", clip_id)
            return

        if isinstance(value, str) and value.strip():
            clip["generated_title"] = value.strip()
            return

        outline = clip.get("outline", f"片段_{clip_id}")
        if isinstance(outline, dict):
            clip["generated_title"] = str(outline.get("title") or outline.get("outline") or f"片段_{clip_id}")
        else:
            clip["generated_title"] = str(outline or f"片段_{clip_id}")

    def generate_titles(self, high_score_clips: List[Dict]) -> List[Dict]:
        """
        为高分切片生成标题 (新版：按块批量处理，并增加缓存)
        金句模板：生成 list_title + headline/body 叠加旁白
        """
        if not high_score_clips:
            return []

        mode_label = "叠加旁白" if self.overlay_copy_mode else "标题"
        logger.info(f"开始为 {len(high_score_clips)} 个高分片段批量{mode_label}生成...")

        self.llm_raw_output_dir.mkdir(parents=True, exist_ok=True)

        clips_by_chunk = defaultdict(list)
        for clip in high_score_clips:
            clips_by_chunk[clip.get("chunk_index", 0)].append(clip)

        all_clips_with_titles = []
        for chunk_index, chunk_clips in clips_by_chunk.items():
            logger.info(f"处理块 {chunk_index}，其中包含 {len(chunk_clips)} 个片段...")

            try:
                logger.info("  > 开始调用 API 生成%s...", mode_label)
                input_for_llm = [
                    {
                        "id": clip.get("id"),
                        "title": clip.get("outline"),
                        "content": clip.get("content"),
                        "recommend_reason": clip.get("recommend_reason"),
                    }
                    for clip in chunk_clips
                ]

                raw_response = self.llm_client.call_with_retry(self.title_prompt, input_for_llm)

                if raw_response:
                    llm_cache_path = self.llm_raw_output_dir / f"chunk_{chunk_index}.txt"
                    with open(llm_cache_path, "w", encoding="utf-8") as f:
                        f.write(raw_response)
                    logger.info(f"  > LLM 原始响应已保存到 {llm_cache_path}")
                    titles_map = self.llm_client.parse_json_response(raw_response)
                else:
                    titles_map = {}

                if not isinstance(titles_map, dict):
                    logger.warning(f"  > LLM 返回的不是字典: {titles_map}，跳过该块。")
                    all_clips_with_titles.extend(chunk_clips)
                    continue

                for clip in chunk_clips:
                    clip_id = clip.get("id")
                    value = titles_map.get(clip_id)
                    if value is None and clip_id is not None:
                        value = titles_map.get(str(clip_id))
                    self._apply_title_to_clip(clip, value)
                    if not clip.get("generated_title"):
                        logger.warning("  > 未能为片段 %s 解析结果，使用 outline 回退", clip_id)

                all_clips_with_titles.extend(chunk_clips)

            except Exception as e:
                logger.error(f"  > 为块 {chunk_index} 生成时出错: {e}")
                all_clips_with_titles.extend(chunk_clips)
                continue

        logger.info("所有高分片段%s生成完成", mode_label)
        return all_clips_with_titles

    def save_clips_with_titles(self, clips_with_titles: List[Dict], output_path: Path):
        """保存带标题的片段数据"""
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(clips_with_titles, f, ensure_ascii=False, indent=2)
        logger.info(f"带标题的片段数据已保存到: {output_path}")


def run_step4_title(
    high_score_clips_path: Path,
    output_path: Optional[Path] = None,
    metadata_dir: Optional[str] = None,
    prompt_files: Dict = None,
    settings: Optional[Dict[str, Any]] = None,
) -> List[Dict]:
    """
    运行 Step 4: 标题生成 / 金句叠加旁白生成
    """
    with open(high_score_clips_path, "r", encoding="utf-8") as f:
        high_score_clips = json.load(f)

    if metadata_dir is None:
        metadata_dir = METADATA_DIR
    title_generator = TitleGenerator(
        metadata_dir=Path(metadata_dir),
        prompt_files=prompt_files,
        settings=settings,
    )

    clips_with_titles = title_generator.generate_titles(high_score_clips)

    if output_path is None:
        output_path = Path(metadata_dir) / "step4_titles.json"

    title_generator.save_clips_with_titles(clips_with_titles, output_path)
    return clips_with_titles
