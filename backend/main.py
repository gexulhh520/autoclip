"""FastAPI应用入口点 - Web模式"""

from backend.core.env_loader import load_project_env

load_project_env()

import logging
from backend.app_factory import create_app

# 创建应用实例
app = create_app(mode="web")

logger = logging.getLogger(__name__)

if __name__ == "__main__":
    import os
    import uvicorn
    import sys
    
    # 默认端口
    port = 8000
    reload = False
    
    # 检查命令行参数
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--port" and i + 1 < len(args):
            try:
                port = int(args[i + 1])
            except ValueError:
                logger.error(f"无效的端口号: {args[i + 1]}")
                port = 8000
            i += 2
            continue
        if arg in ("--reload", "-r"):
            reload = True
        i += 1
    
    logger.info(f"启动服务器，端口: {port}" + ("（热重载）" if reload else ""))
    if reload:
        # 排除 data/：Whisper 运行时 pip 会写入 data/whisper-runtime，触发热重载会打断安装
        uvicorn.run(
            "backend.main:app",
            host="0.0.0.0",
            port=port,
            reload=True,
            reload_dirs=["backend"],
            reload_includes=["*.py"],
            reload_excludes=["data/*", "logs/*", "uploads/*", "*.log"],
        )
    else:
        uvicorn.run(app, host="0.0.0.0", port=port)