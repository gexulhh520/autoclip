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
            "name": "add_text_overlay",
            "description": "添加文本层。content 必须来自 snapshot.draft_texts，禁止抄参考图。",
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
            "name": "capture_preview_frame",
            "description": "只读：在指定时间截取预览帧，用于检查构图/字幕安全区",
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
]

EDITOR_AGENT_TOOL_NAMES = {
    item["function"]["name"] for item in EDITOR_AGENT_TOOL_DEFINITIONS
}

READ_ONLY_AGENT_TOOLS = {
    "list_assets",
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
        if name not in EDITOR_AGENT_TOOL_NAMES:
            raise ValueError(f"工具不在白名单: {name}")
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
