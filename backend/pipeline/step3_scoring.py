"""
Step 3: 内容评分 - 对每个话题进行质量评分，筛选出高质量内容
"""
import json
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from collections import defaultdict

from ..utils.llm_client import LLMClient
from ..utils.text_processor import TextProcessor
from ..core.shared_config import PROMPT_FILES, METADATA_DIR, MIN_SCORE_THRESHOLD

logger = logging.getLogger(__name__)

# 单次 LLM 请求最多评几条（过大时 gemma 等模型易截断或返回数量不匹配）
SCORING_BATCH_SIZE = 8


class ClipScorer:
    """内容评分器"""

    def __init__(self, prompt_files: Dict = None, metadata_dir: Optional[Path] = None):
        self.llm_client = LLMClient()
        self.text_processor = TextProcessor()
        self.metadata_dir = metadata_dir
        self._raw_output_dir = (
            metadata_dir / "step3_llm_raw_output" if metadata_dir else None
        )

        prompt_files_to_use = prompt_files if prompt_files is not None else PROMPT_FILES
        with open(prompt_files_to_use["recommendation"], "r", encoding="utf-8") as f:
            self.recommendation_prompt = f.read()

    def score_clips(self, timeline_data: List[Dict]) -> List[Dict]:
        """为切片评分：按 SRT 块分组，再分小批调用 LLM。"""
        if not timeline_data:
            logger.warning("时间线数据为空，无法评分")
            return []

        logger.info("开始为 %d 个切片进行评分（每批最多 %d 条）...", len(timeline_data), SCORING_BATCH_SIZE)

        timeline_by_chunk: Dict[Any, List[Dict]] = defaultdict(list)
        for item in timeline_data:
            chunk_index = item.get("chunk_index")
            if chunk_index is not None:
                timeline_by_chunk[chunk_index].append(item)
            else:
                logger.warning("  > 话题 '%s' 缺少 chunk_index，将被跳过。", item.get("outline", "未知"))

        all_scored_clips: List[Dict] = []
        for chunk_index, chunk_items in timeline_by_chunk.items():
            logger.info("处理块 %s，其中包含 %d 个话题...", chunk_index, len(chunk_items))
            try:
                scored_chunk_items = self._get_llm_evaluation(chunk_items, chunk_index)
                if scored_chunk_items:
                    all_scored_clips.extend(scored_chunk_items)
                else:
                    logger.warning("块 %s 的 LLM 评估返回为空。", chunk_index)
            except Exception as exc:
                logger.error("处理块 %s 进行评分时出错: %s", chunk_index, exc)

        if all_scored_clips:
            all_scored_clips.sort(key=lambda x: x.get("final_score", 0), reverse=True)
            logger.info("按评分排序完成，保持原有固定 ID 不变")
            all_scored_clips.sort(key=lambda x: int(x.get("id", 0)))
            logger.info("按 ID 排序完成，保持时间顺序")

        logger.info("所有切片评分完成，共 %d 条", len(all_scored_clips))
        return all_scored_clips

    def _get_llm_evaluation(self, clips: List[Dict], chunk_index: Any) -> List[Dict]:
        """分小批评估；单批失败时降级为逐条评估。"""
        if not clips:
            return []

        if len(clips) <= SCORING_BATCH_SIZE:
            return self._evaluate_batch(clips, chunk_index, batch_label="0")

        results: List[Dict] = []
        for batch_idx, start in enumerate(range(0, len(clips), SCORING_BATCH_SIZE)):
            batch = clips[start : start + SCORING_BATCH_SIZE]
            results.extend(
                self._evaluate_batch(batch, chunk_index, batch_label=str(batch_idx))
            )
        return results

    def _evaluate_batch(
        self,
        clips: List[Dict],
        chunk_index: Any,
        batch_label: str,
    ) -> List[Dict]:
        try:
            input_for_llm = [
                {
                    "outline": clip.get("outline"),
                    "content": clip.get("content"),
                    "start_time": clip.get("start_time"),
                    "end_time": clip.get("end_time"),
                }
                for clip in clips
            ]

            response = self.llm_client.call_with_retry(
                self.recommendation_prompt, input_for_llm
            )
            self._save_raw_response(chunk_index, batch_label, response)

            parsed_list = self.llm_client.parse_json_response(response)
            if not isinstance(parsed_list, list):
                logger.error(
                    "块 %s 批次 %s：LLM 返回非数组，输入 %d 条",
                    chunk_index,
                    batch_label,
                    len(clips),
                )
                if len(clips) == 1:
                    return self._mark_clips_failed(clips, "评分解析失败")
                return self._evaluate_one_by_one(clips, chunk_index)

            if len(parsed_list) != len(clips):
                logger.warning(
                    "块 %s 批次 %s：评分数目不匹配 input=%d output=%d",
                    chunk_index,
                    batch_label,
                    len(clips),
                    len(parsed_list),
                )
                if len(clips) == 1:
                    return self._mark_clips_failed(clips, "评分解析失败")
                return self._evaluate_one_by_one(clips, chunk_index)

            return self._merge_scores(clips, parsed_list)

        except Exception as exc:
            logger.error(
                "块 %s 批次 %s 批量评分失败: %s",
                chunk_index,
                batch_label,
                exc,
            )
            if len(clips) == 1:
                return self._mark_clips_failed(clips, "批量评估失败")
            return self._evaluate_one_by_one(clips, chunk_index)

    def _evaluate_one_by_one(self, clips: List[Dict], chunk_index: Any) -> List[Dict]:
        logger.info("块 %s：降级为逐条评分（共 %d 条）", chunk_index, len(clips))
        results: List[Dict] = []
        for idx, clip in enumerate(clips):
            results.extend(
                self._evaluate_batch([clip], chunk_index, batch_label=f"single_{idx}")
            )
        return results

    def _merge_scores(self, clips: List[Dict], parsed_list: List[Dict]) -> List[Dict]:
        for original_clip, llm_result in zip(clips, parsed_list):
            score = llm_result.get("final_score")
            reason = llm_result.get("recommend_reason")

            if score is None or reason is None:
                logger.warning("LLM 返回的某个结果缺少 score 或 reason: %s", llm_result)
                original_clip["final_score"] = 0.0
                original_clip["recommend_reason"] = "评估失败"
            else:
                original_clip["final_score"] = round(float(score), 2)
                original_clip["recommend_reason"] = reason
                outline = original_clip.get("outline", {})
                title = outline.get("title", "未知标题") if isinstance(outline, dict) else str(outline)
                logger.info("  > 评分成功: %s... [分数: %s]", str(title)[:20], score)

        return clips

    def _mark_clips_failed(self, clips: List[Dict], reason: str) -> List[Dict]:
        for clip in clips:
            clip["final_score"] = 0.0
            clip["recommend_reason"] = reason
        return clips

    def _save_raw_response(self, chunk_index: Any, batch_label: str, response: str) -> None:
        if not self._raw_output_dir:
            return
        try:
            self._raw_output_dir.mkdir(parents=True, exist_ok=True)
            path = self._raw_output_dir / f"chunk_{chunk_index}_batch_{batch_label}.txt"
            path.write_text(response or "", encoding="utf-8")
        except Exception as exc:
            logger.warning("保存 step3 原始 LLM 响应失败: %s", exc)

    def save_scores(self, scored_clips: List[Dict], output_path: Path):
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(scored_clips, f, ensure_ascii=False, indent=2)
        logger.info("评分结果已保存到: %s", output_path)


def run_step3_scoring(
    timeline_path: Path,
    metadata_dir: Path = None,
    output_path: Optional[Path] = None,
    prompt_files: Dict = None,
) -> List[Dict]:
    with open(timeline_path, "r", encoding="utf-8") as f:
        timeline_data = json.load(f)

    if metadata_dir is None:
        metadata_dir = METADATA_DIR

    scorer = ClipScorer(prompt_files, metadata_dir=metadata_dir)
    scored_clips = scorer.score_clips(timeline_data)
    high_score_clips = [clip for clip in scored_clips if clip["final_score"] >= MIN_SCORE_THRESHOLD]

    all_scored_path = metadata_dir / "step3_all_scored.json"
    scorer.save_scores(scored_clips, all_scored_path)

    if output_path is None:
        output_path = metadata_dir / "step3_high_score_clips.json"
    scorer.save_scores(high_score_clips, output_path)

    logger.info(
        "Step3 筛选完成: 共评分 %d 条，高分(>=%s) %d 条",
        len(scored_clips),
        MIN_SCORE_THRESHOLD,
        len(high_score_clips),
    )
    return high_score_clips
