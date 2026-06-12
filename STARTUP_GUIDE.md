# AutoClip 系统启动指南

## 📋 概述

AutoClip 是一个基于AI的视频切片处理系统，采用前后端分离架构。本指南将帮助您快速启动和运行整个系统。

## 🚀 快速开始

### 1. 一键启动（macOS / Linux）

```bash
# 完整启动（包含详细检查和健康监控）
./start_autoclip.sh

# 快速启动（开发环境，跳过详细检查）
./quick_start.sh
```

### 2. Windows 手动启动（推荐）

在 **两个终端** 中分别启动后端与前端（项目根目录示例：`F:\software\autoclip`）。

**终端 1 — 后端（端口 8000）**

```powershell
cd F:\software\autoclip
.\venv\Scripts\Activate.ps1
$env:AUTOCLIP_DESKTOP_MODE = "true"
python -m backend.main --reload
```

> **PowerShell 不要用 `activate.bat`**：`.bat` 会在子进程里执行，**不会**改变当前终端的 PATH，  
> 之后敲 `python` 仍可能指向 `D:\Programs\python14\python.exe`。  
> 请用 `Activate.ps1`（如上），或直接用 venv 解释器（最稳）：
>
> ```powershell
> F:\software\autoclip\venv\Scripts\python.exe -m backend.main --reload
> ```
>
> 若用 **CMD**，才用 `venv\Scripts\activate.bat`。

启动后可在日志里确认：`py=F:\software\autoclip\venv\Scripts\python.exe`。

**终端 2 — 前端（端口 3000）**

```powershell
cd F:\software\autoclip\frontend
npm.cmd run dev
```

> 若 PowerShell 报「禁止运行脚本 / npm.ps1」，是因为执行策略拦截了 `npm.ps1`。  
> **最快**：改用 `npm.cmd run dev`（走 `D:\Program Files\nodejs\npm.cmd`，无需改系统策略）。  
> **或** 在当前用户放宽策略（一次性）：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`  
> **或** 用 **CMD** 终端执行 `npm run dev`。

启动后访问：

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |
| 健康检查 | http://localhost:8000/api/v1/health/ |

> **Whisper 安装注意**：开发时请用 `python -m backend.main --reload` 启动后端。该方式只监视 `backend/`，不会因 pip 写入 `data/whisper-runtime` 触发热重载而中断安装。  
> 不要使用裸命令 `uvicorn backend.main:app --reload`（会监视整个项目目录）。

等价的后端启动命令（**PowerShell 必须用 `=` 连接参数**，否则 `data/*` 会被展开成多个路径报错）：

```powershell
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend --reload-exclude='data/*' --reload-exclude='logs/*'
```

**首次运行（依赖未安装时）**

```powershell
# 后端
cd F:\software\autoclip
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy env.example .env

# 前端
cd F:\software\autoclip\frontend
npm.cmd install
npm.cmd run dev
```

`.env` 中建议设置 `AUTOCLIP_DESKTOP_MODE=true`（本地无 Redis 时使用本地队列与桌面设置 API）。

### 3. 系统管理（macOS / Linux）

```bash
# 检查系统状态
./status_autoclip.sh

# 停止所有服务
./stop_autoclip.sh
```

## 📊 系统架构

### 后端服务
- **FastAPI**: RESTful API 和 WebSocket 支持
- **Celery**: 异步任务队列
- **Redis**: 消息代理和缓存
- **SQLite**: 数据存储

### 前端服务
- **React**: 用户界面
- **Vite**: 开发服务器
- **TypeScript**: 类型安全

## 🔧 环境要求

### 系统要求
- macOS、Linux 或 Windows
- Python 3.8+
- Node.js 16+
- Redis 服务器（可选；Windows 本地开发可设 `AUTOCLIP_DESKTOP_MODE=true` 跳过）

### 依赖安装

**macOS / Linux**

```bash
# 1. 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 2. 安装Python依赖
pip install -r requirements.txt

# 3. 安装前端依赖
cd frontend
npm install
cd ..

# 4. 安装Redis（macOS）
brew install redis
brew services start redis

# 5. 配置环境变量
cp env.example .env
# 编辑 .env 文件，填入必要的配置
```

**Windows**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd frontend
npm install
cd ..
copy env.example .env
```

## 📝 配置文件

### 环境变量 (.env)

```bash
# 数据库配置
DATABASE_URL=sqlite:///./data/autoclip.db

# Redis配置
REDIS_URL=redis://localhost:6379/0

# API配置
API_DASHSCOPE_API_KEY=your_api_key_here
API_MODEL_NAME=qwen-plus

# 日志配置
LOG_LEVEL=INFO
ENVIRONMENT=development
DEBUG=true
```

## 🌐 服务端口

| 服务 | 端口 | 描述 |
|------|------|------|
| 前端界面 | 3000 | React 开发服务器 |
| 后端API | 8000 | FastAPI 服务器 |
| Redis | 6379 | 消息代理 |
| API文档 | 8000/docs | Swagger UI |

## 📁 目录结构

```
autoclip/
├── backend/                 # 后端代码
│   ├── api/                # API路由
│   ├── core/               # 核心配置
│   ├── models/             # 数据模型
│   ├── services/           # 业务逻辑
│   └── tasks/              # Celery任务
├── frontend/               # 前端代码
│   ├── src/                # 源代码
│   └── public/             # 静态资源
├── data/                   # 数据存储
│   ├── projects/           # 项目数据
│   └── uploads/            # 上传文件
├── logs/                   # 日志文件
├── scripts/                # 工具脚本
└── *.sh                    # 启动脚本
```

## 🔍 故障排除

### 常见问题

1. **PowerShell 启动 uvicorn 报 `unexpected extra arguments (data\cache ...)`**

   PowerShell 会把 `--reload-exclude "data/*"` 里的 `*` 展开成 `data/` 下所有文件。请改用：

   ```powershell
   python -m backend.main --reload
   ```

   或 uvicorn 等价命令（参数用 `=` 连接）：

   ```powershell
   python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend --reload-exclude='data/*'
   ```

2. **PowerShell 运行 `npm` 报「禁止运行脚本 / npm.ps1」**

   改用 CMD 版 npm（推荐，无需改策略）：

   ```powershell
   npm.cmd run dev
   npm.cmd install
   ```

   或一次性放宽当前用户执行策略：

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

3. **已 activate 但日志仍显示 `py=D:\Programs\python14\python.exe`**

   在 **PowerShell** 里执行 `activate.bat` **无效**（只作用于子进程）。请改用：

   ```powershell
   .\venv\Scripts\Activate.ps1
   ```

   或直接：

   ```powershell
   .\venv\Scripts\python.exe -m backend.main --reload
   ```

   验证当前终端：

   ```powershell
   Get-Command python | Select-Object Source
   python -c "import sys; print(sys.executable)"
   ```

4. **端口被占用**
   ```bash
   # 检查端口占用
   lsof -i :8000
   lsof -i :3000
   
   # 停止占用进程
   kill -9 <PID>
   ```

5. **Redis连接失败**
   ```bash
   # 检查Redis状态
   redis-cli ping
   
   # 启动Redis
   brew services start redis  # macOS
   systemctl start redis      # Linux
   ```

6. **Python依赖问题**
   ```bash
   # 重新安装依赖
   pip install -r requirements.txt --force-reinstall
   ```

7. **前端依赖问题**
   ```bash
   # 清理并重新安装
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   ```

### 日志查看

```bash
# 查看所有日志
tail -f logs/*.log

# 查看特定服务日志
tail -f logs/backend.log
tail -f logs/frontend.log
tail -f logs/celery.log
```

### 系统状态检查

```bash
# 详细状态检查
./status_autoclip.sh

# 手动检查服务
curl http://localhost:8000/api/v1/health/
curl http://localhost:3000/
redis-cli ping
```

## 🛠️ 开发模式

### 后端开发

**macOS / Linux**

```bash
source venv/bin/activate
export AUTOCLIP_DESKTOP_MODE=true   # 本地无 Redis 时建议开启
python -m backend.main --reload
```

**Windows（PowerShell）**

```powershell
.\venv\Scripts\Activate.ps1
$env:AUTOCLIP_DESKTOP_MODE = "true"
python -m backend.main --reload
```

### 前端开发

```bash
cd frontend
npm run dev
```

### Celery Worker

```bash
# 启动Worker
celery -A backend.core.celery_app worker --loglevel=info

# 启动Beat调度器
celery -A backend.core.celery_app beat --loglevel=info

# 启动Flower监控
celery -A backend.core.celery_app flower --port=5555
```

## 📈 性能优化

### 生产环境配置

1. **数据库优化**
   - 使用PostgreSQL替代SQLite
   - 配置连接池
   - 启用查询缓存

2. **Redis优化**
   - 配置内存限制
   - 启用持久化
   - 设置过期策略

3. **Celery优化**
   - 调整并发数
   - 配置任务路由
   - 启用结果后端

## 🔒 安全配置

### 生产环境安全

1. **环境变量**
   - 使用强密码
   - 定期轮换密钥
   - 限制API访问

2. **网络安全**
   - 配置防火墙
   - 使用HTTPS
   - 限制CORS

3. **数据安全**
   - 定期备份
   - 加密敏感数据
   - 访问控制

## 📞 支持

如果遇到问题，请：

1. 查看日志文件
2. 运行状态检查脚本
3. 检查环境配置
4. 参考故障排除部分

## 📄 许可证

本项目采用 MIT 许可证。
