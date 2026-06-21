"""剪辑 Agent 工具 schema 与校验（Phase B）。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError

EDITOR_AGENT_TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "seek_playhead",
            "description": "将播放头移动到指定时间（秒）",
            "parameters": {
                "type": "object",
                "properties": {"time_sec": {"type": "number"}},
                "required": ["time_sec"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_caption_template",
            "description": "批量添加/替换字幕。改横竖排时 replace_existing=true；禁止坐标字号。",
            "parameters": {
                "type": "object",
                "properties": {
                    "layout": {
                        "type": "string",
                        "enum": ["horizontal", "vertical"],
                    },
                    "position": {
                        "type": "string",
                        "enum": [
                            "top_left",
                            "top_center",
                            "top_right",
                            "center_left",
                            "center",
                            "center_right",
                            "bottom_left",
                            "bottom_center",
                            "bottom_right",
                        ],
                    },
                    "template": {
                        "type": "string",
                        "enum": [
                            "vertical_stagger",
                            "horizontal_center",
                            "bottom_safe",
                            "top_safe",
                        ],
                    },
                    "entries": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "block_id": {"type": "string"},
                                "text": {"type": "string"},
                            },
                            "required": ["block_id"],
                        },
                    },
                    "replace_existing": {"type": "boolean"},
                    "style": {
                        "type": "object",
                        "properties": {
                            "fontFamily": {"type": "string"},
                            "color": {"type": "string"},
                            "fontWeight": {"type": "string"},
                        },
                    },
                    "animation": {
                        "type": "object",
                        "properties": {
                            "in_type": {
                                "type": "string",
                                "enum": [
                                    "none",
                                    "fade",
                                    "slide_up",
                                    "slide_down",
                                    "scale",
                                    "pop",
                                ],
                            },
                            "in_duration_sec": {"type": "number"},
                            "stagger_sec": {"type": "number"},
                        },
                    },
                    "skip_existing": {"type": "boolean"},
                },
                "required": ["entries"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_block_captions",
            "description": "删除指定片段字幕（含竖排单字层），清空 draft。block_ids 来自 known_blocks。",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["block_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_all_captions",
            "description": "删除主轨全部字幕层，不添加新字幕。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_text_overlay",
            "description": "【不推荐】单条文本层；批量字幕请用 apply_caption_template。",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_sec": {"type": "number"},
                    "duration_sec": {"type": "number"},
                    "content": {"type": "string"},
                    "fontSize": {"type": "number"},
                    "fontFamily": {"type": "string"},
                    "color": {"type": "string"},
                    "fontWeight": {"type": "string"},
                    "textAlign": {"type": "string"},
                    "lineHeight": {"type": "number"},
                    "positionX": {"type": "number"},
                    "positionY": {"type": "number"},
                    "scaleX": {"type": "number"},
                    "scaleY": {"type": "number"},
                    "rotate": {"type": "number"},
                    "animation_in_type": {"type": "string"},
                    "animation_in_duration": {"type": "number"},
                },
                "required": ["start_sec", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_overlay_params",
            "description": "更新已有文本层",
            "parameters": {
                "type": "object",
                "properties": {
                    "overlay_id": {"type": "string"},
                    "content": {"type": "string"},
                    "fontSize": {"type": "number"},
                    "fontFamily": {"type": "string"},
                    "color": {"type": "string"},
                    "fontWeight": {"type": "string"},
                    "textAlign": {"type": "string"},
                    "lineHeight": {"type": "number"},
                    "positionX": {"type": "number"},
                    "positionY": {"type": "number"},
                    "scaleX": {"type": "number"},
                    "scaleY": {"type": "number"},
                    "rotate": {"type": "number"},
                },
                "required": ["overlay_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_video_transform",
            "description": "设置视频片段画面缩放与位移",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "position_x": {"type": "number"},
                    "position_y": {"type": "number"},
                    "scale_x": {"type": "number"},
                    "scale_y": {"type": "number"},
                },
                "required": ["block_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_visual_filter",
            "description": "设置整片视觉滤镜（全局）。高对比=mono_contrast。勿用 set_video_transform。",
            "parameters": {
                "type": "object",
                "properties": {
                    "visual_filter": {
                        "type": "string",
                        "enum": [
                            "none",
                            "mono_soft",
                            "mono_contrast",
                            "mono_cool",
                            "mono_warm",
                        ],
                    },
                },
                "required": ["visual_filter"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_block_trim",
            "description": "更新片段裁切入出点",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "in_sec": {"type": "number"},
                    "out_sec": {"type": "number"},
                },
                "required": ["block_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_block_to_video_track",
            "description": "移动视频片段到指定视频轨",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "video_track_id": {"type": "string"},
                },
                "required": ["block_id", "video_track_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_clips_to_timeline",
            "description": "从素材池追加 clip 到主轨（缺省主轨末尾）",
            "parameters": {
                "type": "object",
                "properties": {
                    "clip_ids": {"type": "array", "items": {"type": "string"}},
                    "source_id": {"type": "string"},
                    "insert_index": {"type": "number"},
                },
                "required": ["clip_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_main_track",
            "description": "调整主轨片段顺序",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "to_index": {"type": "number"},
                },
                "required": ["block_id", "to_index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_transition",
            "description": "设置片段出点转场",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "transition": {
                        "type": "string",
                        "enum": [
                            "cut",
                            "dissolve",
                            "fade_black",
                            "wipe_left",
                            "wipe_right",
                            "slide_left",
                            "slide_right",
                            "zoom",
                        ],
                    },
                },
                "required": ["block_id", "transition"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_audio_clip",
            "description": "将 BGM 或 SFX 加到时间线",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string"},
                    "start_sec": {"type": "number"},
                    "duration_sec": {"type": "number"},
                    "track_id": {"type": "string"},
                    "volume": {"type": "number"},
                    "fade_in_sec": {"type": "number"},
                    "fade_out_sec": {"type": "number"},
                    "block_id": {"type": "string"},
                },
                "required": ["asset_id", "start_sec"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_block_audio",
            "description": "调整视频片段原声音量与淡化",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "volume": {"type": "number"},
                    "fade_in_sec": {"type": "number"},
                    "fade_out_sec": {"type": "number"},
                },
                "required": ["block_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "detect_silence_trim",
            "description": "检测片段内静音并建议或应用 trim",
            "parameters": {
                "type": "object",
                "properties": {
                    "block_id": {"type": "string"},
                    "apply": {"type": "boolean"},
                    "noise_db": {"type": "number"},
                    "min_silence_sec": {"type": "number"},
                },
                "required": ["block_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "split_block_at_playhead",
            "description": "在播放头位置切分选中目标",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_block",
            "description": "删除视频片段（危险操作）",
            "parameters": {
                "type": "object",
                "properties": {"block_id": {"type": "string"}},
                "required": ["block_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_text_animation",
            "description": "设置文本层入场/出场动画",
            "parameters": {
                "type": "object",
                "properties": {
                    "overlay_id": {"type": "string"},
                    "in_type": {
                        "type": "string",
                        "enum": ["none", "fade", "slide_up", "slide_down", "scale", "pop"],
                    },
                    "in_duration_sec": {"type": "number"},
                    "out_type": {
                        "type": "string",
                        "enum": ["none", "fade", "slide_up", "slide_down", "scale", "pop"],
                    },
                    "out_duration_sec": {"type": "number"},
                },
                "required": ["overlay_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "split_text_overlay_by_char",
            "description": "将单个文本层按字拆成多层并带入场动画。layout=vertical 竖排竖版；layout=horizontal 横排逐字出现。会删除原层。",
            "parameters": {
                "type": "object",
                "properties": {
                    "overlay_id": {"type": "string"},
                    "layout": {
                        "type": "string",
                        "enum": ["horizontal", "vertical"],
                    },
                    "stagger_sec": {"type": "number"},
                    "char_duration_sec": {"type": "number"},
                    "in_type": {
                        "type": "string",
                        "enum": ["none", "fade", "slide_up", "slide_down", "scale", "pop"],
                    },
                    "in_duration_sec": {"type": "number"},
                    "center_x": {"type": "number"},
                    "center_y": {"type": "number"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "split_text_overlays_by_char",
            "description": "批量按字拆分多个文本层。overlay_ids 须来自 snapshot/known_overlays；缺省=所有可拆分文本层。",
            "parameters": {
                "type": "object",
                "properties": {
                    "overlay_ids": {"type": "array", "items": {"type": "string"}},
                    "layout": {
                        "type": "string",
                        "enum": ["horizontal", "vertical"],
                    },
                    "stagger_sec": {"type": "number"},
                    "char_duration_sec": {"type": "number"},
                    "in_type": {
                        "type": "string",
                        "enum": ["none", "fade", "slide_up", "slide_down", "scale", "pop"],
                    },
                    "in_duration_sec": {"type": "number"},
                    "center_x": {"type": "number"},
                    "center_y": {"type": "number"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "batch_apply_text_style",
            "description": "批量统一文本层样式（不含 content）",
            "parameters": {
                "type": "object",
                "properties": {
                    "overlay_ids": {"type": "array", "items": {"type": "string"}},
                    "fontSize": {"type": "number"},
                    "fontFamily": {"type": "string"},
                    "color": {"type": "string"},
                    "fontWeight": {"type": "string"},
                    "textAlign": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_assets",
            "description": "只读：列出当前工程可用素材（视频 clip 池、BGM、SFX）",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["clip", "bgm", "sfx", "all"],
                        "description": "默认 all",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_subtitle_in_frame",
            "description": "只读：截字幕时刻预览帧并由画面分析子 Agent 返回简短 JSON（是否超出画面），不含 JPEG",
            "parameters": {
                "type": "object",
                "properties": {
                    "overlay_id": {"type": "string"},
                    "time_sec": {"type": "number"},
                    "max_width": {"type": "number"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "capture_preview_frame",
            "description": "只读：截帧调试；优先 verify_subtitle_in_frame",
            "parameters": {
                "type": "object",
                "properties": {
                    "time_sec": {"type": "number"},
                    "max_width": {"type": "number"},
                },
                "required": ["time_sec"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_timeline_summary",
            "description": "只读：时间线摘要",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_block_detail",
            "description": "只读：单个片段详情",
            "parameters": {
                "type": "object",
                "properties": {"block_id": {"type": "string"}},
                "required": ["block_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_overlay_detail",
            "description": "只读：单个文本层详情",
            "parameters": {
                "type": "object",
                "properties": {"overlay_id": {"type": "string"}},
                "required": ["overlay_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_task_plan",
            "description": "提交多步骤任务计划（不修改时间线）。用户需求含≥2个独立步骤时必须先调用；tasks 按执行顺序排列。",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string"},
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "hint": {"type": "string"},
                            },
                            "required": ["id", "title"],
                        },
                    },
                },
                "required": ["goal", "tasks"],
            },
        },
    },
]

EDITOR_AGENT_TOOL_NAMES = {
    item["function"]["name"] for item in EDITOR_AGENT_TOOL_DEFINITIONS
} | {"add_captions_for_blocks"}

META_AGENT_TOOLS = {
    "submit_task_plan",
}

READ_ONLY_AGENT_TOOLS = {
    "list_assets",
    "verify_subtitle_in_frame",
    "capture_preview_frame",
    "get_timeline_summary",
    "get_block_detail",
    "get_overlay_detail",
}


class AgentToolCallOut(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    id: Optional[str] = None


def validate_tool_calls(raw_calls: List[Any]) -> List[AgentToolCallOut]:
    validated: List[AgentToolCallOut] = []
    for idx, raw in enumerate(raw_calls):
        if isinstance(raw, dict):
            name = raw.get("name") or (raw.get("function") or {}).get("name") or ""
            args = raw.get("arguments") or (raw.get("function") or {}).get("arguments") or {}
        else:
            continue
        name = str(name).strip()
        if name.startswith("functions."):
            name = name.split(".", 1)[-1].strip()
        if name not in EDITOR_AGENT_TOOL_NAMES:
            raise ValueError(
                f"工具不在白名单: {name}（后端共 {len(EDITOR_AGENT_TOOL_NAMES)} 个工具；"
                f"若刚更新代码请重启后端服务）"
            )
        if isinstance(args, str):
            import json

            try:
                args = json.loads(args)
            except json.JSONDecodeError as exc:
                raise ValueError(f"工具 {name} 参数 JSON 无效") from exc
        if not isinstance(args, dict):
            args = {}
        try:
            validated.append(
                AgentToolCallOut(
                    name=name,
                    arguments=args,
                    id=raw.get("id") if isinstance(raw, dict) else f"call_{idx}",
                )
            )
        except ValidationError as exc:
            raise ValueError(f"工具 {name} 参数校验失败: {exc}") from exc
    return validated
