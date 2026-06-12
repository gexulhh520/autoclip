# Backend package — 尽早加载 .env，供 os.getenv 使用
from backend.core.env_loader import load_project_env

load_project_env()
