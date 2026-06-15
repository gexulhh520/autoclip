"""Windows / Tauri 管道安全的 UTF-8 标准输出与日志 Handler。"""
from __future__ import annotations

import io
import logging
import sys
from typing import TextIO


def configure_stdio_utf8() -> None:
    """避免 Windows 控制台默认 GBK 导致 emoji 日志 UnicodeEncodeError。"""
    if sys.platform != "win32":
        return
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass


class Utf8StreamHandler(logging.StreamHandler):
    """在 GBK 控制台或被 Tauri 管道重定向的 stderr 上安全写 UTF-8 日志。"""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record) + self.terminator
            stream = self.stream
            if stream is None:
                return
            buffer = getattr(stream, "buffer", None)
            if isinstance(buffer, io.BufferedIOBase):
                buffer.write(msg.encode("utf-8", errors="replace"))
                buffer.flush()
            else:
                try:
                    stream.write(msg)
                except UnicodeEncodeError:
                    encoding = getattr(stream, "encoding", None) or "utf-8"
                    safe = msg.encode(encoding, errors="replace").decode(encoding, errors="replace")
                    stream.write(safe)
                self.flush()
        except RecursionError:
            raise
        except Exception:
            self.handleError(record)


def stream_handler(stream: TextIO | None = None) -> logging.Handler:
    configure_stdio_utf8()
    return Utf8StreamHandler(stream or sys.stdout)
