use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const HEALTH_CHECK_INTERVAL_SEC: u64 = 5;
const HEALTH_CHECK_TIMEOUT_SEC: u64 = 20;
const HEALTH_CHECK_FAILURES_BEFORE_RESTART: u32 = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendStatus {
    pub is_running: bool,
    pub port: u16,
    pub pid: Option<u32>,
    pub start_time: Option<u64>, // 改为u64以支持序列化
}

impl Default for BackendStatus {
    fn default() -> Self {
        Self {
            is_running: false,
            port: 8000,
            pid: None,
            start_time: None,
        }
    }
}

pub struct BackendManager {
    status: Arc<Mutex<BackendStatus>>,
    process: Arc<Mutex<Option<Child>>>,
    health_epoch: Arc<AtomicU64>,
}

struct BackendLaunch {
    program: String,
    args: Vec<String>,
    working_dir: PathBuf,
}

impl BackendManager {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(BackendStatus::default())),
            process: Arc::new(Mutex::new(None)),
            health_epoch: Arc::new(AtomicU64::new(0)),
        }
    }

    fn bump_health_epoch(&self) -> u64 {
        self.health_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        let mut status = self.status.lock().unwrap();
        if status.is_running {
            return Err("后端服务已在运行".to_string());
        }

        // 启动后端服务
        let launch = self.get_backend_launch(&app_handle)?;

        let mut         cmd = Command::new(&launch.program);
        cmd.args(&launch.args)
            .current_dir(&launch.working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("AUTOCLIP_DESKTOP_MODE", "true")
            .env("AUTOCLIP_MODE", "desktop")
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8");

        if let Some(data_dir) = Self::load_persisted_data_dir() {
            cmd.env("AUTOCLIP_DATA_DIR", data_dir);
        }

        // Point the backend at the bundled ffmpeg/ffprobe when present.
        // The backend's ffmpeg_utils reads these env vars before falling back
        // to PATH, so this is what makes video processing work on machines
        // without a system ffmpeg installed.
        let ffmpeg_bin = launch.working_dir.join("ffmpeg").join("ffmpeg");
        if ffmpeg_bin.is_file() {
            cmd.env("AUTOCLIP_FFMPEG_PATH", &ffmpeg_bin);
        }
        let ffprobe_bin = launch.working_dir.join("ffmpeg").join("ffprobe");
        if ffprobe_bin.is_file() {
            cmd.env("AUTOCLIP_FFPROBE_PATH", &ffprobe_bin);
        }

        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id();
                let start_time = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0);

                // 启动时先设置为运行状态，但端口未知
                *status = BackendStatus {
                    is_running: true,
                    port: 0, // 端口将在读取stdout后更新
                    pid: Some(pid),
                    start_time: Some(start_time),
                };

                let mut process = self.process.lock().unwrap();
                *process = Some(child);

                // 启动端口读取和健康检查（递增 epoch 使旧 health loop 退出）
                let epoch = self.bump_health_epoch();
                let status_clone = self.status.clone();
                let process_clone = self.process.clone();
                let app_handle_clone = app_handle.clone();
                let health_epoch = self.health_epoch.clone();

                thread::spawn(move || {
                    Self::read_port_and_health_check(
                        status_clone,
                        process_clone,
                        app_handle_clone,
                        health_epoch,
                        epoch,
                    );
                });

                Ok(())
            }
            Err(e) => Err(format!("启动后端服务失败: {}", e)),
        }
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut status = self.status.lock().unwrap();
        if !status.is_running {
            return Err("后端服务未运行".to_string());
        }

        let mut process = self.process.lock().unwrap();
        if let Some(mut child) = process.take() {
            if let Err(e) = child.kill() {
                return Err(format!("停止后端服务失败: {}", e));
            }
            let _ = child.wait();
        }

        *status = BackendStatus::default();
        self.bump_health_epoch();
        Ok(())
    }

    pub fn restart(&self, app_handle: AppHandle) -> Result<(), String> {
        // 先停止
        let _ = self.stop();

        // 等待一秒
        std::thread::sleep(Duration::from_secs(1));

        // 再启动
        self.start(app_handle)
    }

    pub fn get_status(&self) -> BackendStatus {
        self.status.lock().unwrap().clone()
    }

    fn resolve_venv_python(project_root: &std::path::Path) -> Option<PathBuf> {
        let candidates = if cfg!(target_os = "windows") {
            vec![project_root.join("venv").join("Scripts").join("python.exe")]
        } else {
            vec![project_root.join("venv").join("bin").join("python")]
        };
        candidates.into_iter().find(|path| path.is_file())
    }

    fn get_backend_launch(&self, app_handle: &AppHandle) -> Result<BackendLaunch, String> {
        if let Ok(resource_path) = app_handle.path().resource_dir() {
            for backend_work_dir in [resource_path.clone(), resource_path.join("resources")] {
                for backend_binary in [
                    backend_work_dir.join(Self::backend_binary_name()),
                    backend_work_dir
                        .join("autoclip-backend")
                        .join(Self::backend_binary_name()),
                ] {
                    if backend_binary.is_file() {
                        let working_dir = backend_binary
                            .parent()
                            .map(|path| path.to_path_buf())
                            .unwrap_or_else(|| backend_work_dir.clone());
                        return Ok(BackendLaunch {
                            program: backend_binary.to_string_lossy().to_string(),
                            args: Vec::new(),
                            working_dir,
                        });
                    }
                }

                let backend_dir = backend_work_dir.join("backend");
                if !backend_dir.exists() {
                    continue;
                }

                if let Some(venv_python) = Self::resolve_venv_python(&backend_work_dir) {
                    return Ok(Self::python_launch(
                        venv_python.to_string_lossy().to_string(),
                        backend_work_dir,
                    ));
                }

                // python-build-standalone bundle: resources/python/bin/python3
                let pbs_python = backend_work_dir.join("python").join("bin").join("python3");
                if pbs_python.exists() {
                    return Ok(Self::python_launch(
                        pbs_python.to_string_lossy().to_string(),
                        backend_work_dir,
                    ));
                }

                if Command::new("python3").arg("--version").output().is_ok() {
                    return Ok(Self::python_launch("python3".to_string(), backend_work_dir));
                } else if Command::new("python").arg("--version").output().is_ok() {
                    return Ok(Self::python_launch("python".to_string(), backend_work_dir));
                }
            }
        }

        // 开发模式回退到仓库根目录
        if let Ok(current_dir) = std::env::current_dir() {
            if let Some(project_root) = current_dir.parent() {
                let backend_dir = project_root.join("backend");
                if backend_dir.exists() {
                    if let Some(venv_python) = Self::resolve_venv_python(&project_root) {
                        return Ok(Self::python_launch(
                            venv_python.to_string_lossy().to_string(),
                            project_root.to_path_buf(),
                        ));
                    }
                    if Command::new("python3").arg("--version").output().is_ok() {
                        return Ok(Self::python_launch(
                            "python3".to_string(),
                            project_root.to_path_buf(),
                        ));
                    } else if Command::new("python").arg("--version").output().is_ok() {
                        return Ok(Self::python_launch(
                            "python".to_string(),
                            project_root.to_path_buf(),
                        ));
                    }
                }
            }
        }

        if let Ok(current_dir) = std::env::current_dir() {
            let backend_dir = current_dir.join("backend");
            if backend_dir.exists() {
                if let Some(venv_python) = Self::resolve_venv_python(&current_dir) {
                    return Ok(Self::python_launch(
                        venv_python.to_string_lossy().to_string(),
                        current_dir,
                    ));
                }
                if Command::new("python3").arg("--version").output().is_ok() {
                    return Ok(Self::python_launch("python3".to_string(), current_dir));
                } else if Command::new("python").arg("--version").output().is_ok() {
                    return Ok(Self::python_launch("python".to_string(), current_dir));
                }
            }
        }

        Err("找不到可用的 Python 环境或后端代码".to_string())
    }

    fn python_launch(program: String, working_dir: PathBuf) -> BackendLaunch {
        BackendLaunch {
            program,
            args: vec!["-m".to_string(), "backend.desktop_main".to_string()],
            working_dir,
        }
    }

    fn bootstrap_paths_file() -> Option<PathBuf> {
        if cfg!(target_os = "windows") {
            std::env::var("LOCALAPPDATA")
                .ok()
                .map(|dir| PathBuf::from(dir).join("AutoClip").join("app_paths.json"))
        } else if cfg!(target_os = "macos") {
            std::env::var("HOME").ok().map(|dir| {
                PathBuf::from(dir)
                    .join("Library")
                    .join("Application Support")
                    .join("AutoClip")
                    .join("app_paths.json")
            })
        } else {
            std::env::var("XDG_DATA_HOME")
                .ok()
                .map(|dir| PathBuf::from(dir).join("AutoClip").join("app_paths.json"))
                .or_else(|| {
                    std::env::var("HOME").ok().map(|dir| {
                        PathBuf::from(dir)
                            .join(".local")
                            .join("share")
                            .join("AutoClip")
                            .join("app_paths.json")
                    })
                })
        }
    }

    fn load_persisted_data_dir() -> Option<String> {
        let path = Self::bootstrap_paths_file()?;
        let content = std::fs::read_to_string(&path).ok()?;
        let value: serde_json::Value = serde_json::from_str(&content).ok()?;
        value
            .get("data_dir")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string())
    }

    fn backend_binary_name() -> &'static str {
        if cfg!(target_os = "windows") {
            "autoclip-backend.exe"
        } else {
            "autoclip-backend"
        }
    }

    fn read_port_and_health_check(
        status: Arc<Mutex<BackendStatus>>,
        process: Arc<Mutex<Option<Child>>>,
        app_handle: AppHandle,
        health_epoch: Arc<AtomicU64>,
        spawn_epoch: u64,
    ) {
        let (stdout, stderr) = {
            let mut process_guard = process.lock().unwrap();
            if let Some(child) = process_guard.as_mut() {
                (child.stdout.take(), child.stderr.take())
            } else {
                (None, None)
            }
        };

        if let Some(stderr) = stderr {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    eprintln!("Backend error: {}", line);
                }
            });
        }

        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            let mut emitted_started = false;

            for line in reader.lines().flatten() {
                println!("Backend output: {}", line);

                if !emitted_started && line.starts_with("PORT=") {
                    if let Some(port_str) = line.strip_prefix("PORT=") {
                        if let Ok(port) = port_str.parse::<u16>() {
                            let backend_status = {
                                let mut status_guard = status.lock().unwrap();
                                status_guard.port = port;
                                BackendStatus {
                                    is_running: true,
                                    port,
                                    pid: status_guard.pid,
                                    start_time: status_guard.start_time,
                                }
                            };

                            let _ = app_handle.emit("backend-started", backend_status);
                            println!("Backend started on port: {}", port);

                            let status_health = status.clone();
                            let process_health = process.clone();
                            let app_handle_health = app_handle.clone();
                            let health_epoch_health = health_epoch.clone();
                            thread::spawn(move || {
                                Self::health_check_loop(
                                    status_health,
                                    process_health,
                                    app_handle_health,
                                    health_epoch_health,
                                    spawn_epoch,
                                );
                            });

                            emitted_started = true;
                        }
                    }
                } else if line.starts_with("BACKEND_SERVER_EXITED") {
                    {
                        let mut status_guard = status.lock().unwrap();
                        *status_guard = BackendStatus::default();
                    }
                    let _ = app_handle.emit("backend-unhealthy", ());
                    eprintln!("后端 HTTP 服务已退出，但进程可能仍在运行");
                }
            }
        }
    }

    fn http_health_check(port: u16) -> bool {
        let url = format!("http://127.0.0.1:{}/health", port);
        match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(HEALTH_CHECK_TIMEOUT_SEC))
            .build()
        {
            Ok(client) => client
                .get(&url)
                .send()
                .map(|response| response.status().is_success())
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    fn health_check_loop(
        status: Arc<Mutex<BackendStatus>>,
        process: Arc<Mutex<Option<Child>>>,
        app_handle: AppHandle,
        health_epoch: Arc<AtomicU64>,
        loop_epoch: u64,
    ) {
        let mut http_failures = 0_u32;

        loop {
            thread::sleep(Duration::from_secs(HEALTH_CHECK_INTERVAL_SEC));

            if health_epoch.load(Ordering::SeqCst) != loop_epoch {
                break;
            }

            // 检查状态
            let should_continue = {
                let status_guard = status.lock().unwrap();
                status_guard.is_running
            };

            if !should_continue {
                break;
            }

            // 检查进程是否还在运行
            let process_exited = {
                let mut process_guard = process.lock().unwrap();
                if let Some(ref mut child) = process_guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(_)) => {
                            // 进程已退出
                            *process_guard = None;
                            true
                        }
                        Ok(None) => false, // 进程仍在运行
                        Err(_) => {
                            // 检查进程状态失败
                            *process_guard = None;
                            true
                        }
                    }
                } else {
                    true
                }
            };

            if process_exited {
                // 更新状态
                let mut status_guard = status.lock().unwrap();
                *status_guard = BackendStatus::default();
                break;
            }

            // 健康检查
            let port = {
                let status_guard = status.lock().unwrap();
                status_guard.port
            };

            if port > 0 {
                if Self::http_health_check(port) {
                    http_failures = 0;
                } else {
                    http_failures += 1;
                    eprintln!(
                        "后端 HTTP 健康检查失败 ({}/{}): http://127.0.0.1:{}/health",
                        http_failures,
                        HEALTH_CHECK_FAILURES_BEFORE_RESTART,
                        port
                    );

                    if http_failures >= HEALTH_CHECK_FAILURES_BEFORE_RESTART {
                        let _ = app_handle.emit("backend-unhealthy", ());

                        let process_still_alive = {
                            let mut process_guard = process.lock().unwrap();
                            if let Some(ref mut child) = process_guard.as_mut() {
                                matches!(child.try_wait(), Ok(None))
                            } else {
                                false
                            }
                        };

                        if process_still_alive {
                            eprintln!("后端进程仍在运行但 API 无响应，尝试自动重启...");
                            let backend_manager = app_handle.state::<BackendManager>();
                            if let Err(error) = backend_manager.restart(app_handle.clone()) {
                                eprintln!("后端自动重启失败: {}", error);
                            }
                        }
                        break;
                    }
                }
            }
        }
    }
}
