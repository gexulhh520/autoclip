/**
 * API 配置管理器
 * 处理动态后端地址和端口配置
 */

interface ApiConfig {
  baseUrl: string;
  port: number;
  isReady: boolean;
}

function isTauriRuntime(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)
  );
}

/** tauri:dev 从 Vite :3000 加载，应与浏览器一样走 /api 代理，避免后端换端口后桌面 axios 仍连旧端口 */
export function isTauriViteDev(): boolean {
  if (!isTauriRuntime() || typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const port = window.location.port;
  return (host === '127.0.0.1' || host === 'localhost') && port === '3000';
}

class ApiConfigManager {
  private static instance: ApiConfigManager;
  private config: ApiConfig = {
    baseUrl: '/api/v1',
    port: 0,
    isReady: false,
  };
  private listeners: Array<(config: ApiConfig) => void> = [];
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private tauriInvoke: ((cmd: string) => Promise<unknown>) | null = null;

  private constructor() {
    void this.initializeConfig();
  }

  static getInstance(): ApiConfigManager {
    if (!ApiConfigManager.instance) {
      ApiConfigManager.instance = new ApiConfigManager();
    }
    return ApiConfigManager.instance;
  }

  private async initializeConfig() {
    if (!isTauriRuntime()) return;

    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      this.tauriInvoke = invoke;

      await listen('backend-started', (event: { payload?: { port?: number } }) => {
        const port = event.payload?.port;
        if (port) {
          this.applyBackendPort(port);
        }
      });

      await listen('backend-unhealthy', () => {
        this.handleBackendUnhealthy();
      });

      const backendStatus = (await invoke('get_service_status')) as {
        is_running?: boolean;
        port?: number;
      };
      if (backendStatus?.is_running && backendStatus?.port) {
        this.applyBackendPort(backendStatus.port);
      } else {
        this.startBackendPoll();
      }
    } catch (error) {
      console.warn('无法初始化 Tauri 事件监听:', error);
    }
  }

  private applyBackendPort(port: number) {
    if (isTauriViteDev()) {
      // 与 Web 相同：相对路径经 Vite 读 data/backend.port，后端重启换端口时仍可用
      this.updateConfig({
        baseUrl: '/api/v1',
        port,
        isReady: true,
      });
      return;
    }
    this.updateConfig({
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      port,
      isReady: true,
    });
  }

  private handleBackendUnhealthy() {
    console.warn('[apiConfig] 内嵌后端不健康或正在重启…');
    this.updateConfig({ isReady: false });
    this.startBackendPoll();
  }

  private startBackendPoll() {
    if (this.pollTimer != null) return;
    const startedAt = Date.now();
    const tick = async () => {
      this.pollTimer = null;
      if (this.isReady() || Date.now() - startedAt > 120000) return;

      const port = await this.readDevBackendPort();
      if (port) {
        this.applyBackendPort(port);
        return;
      }

      if (this.tauriInvoke) {
        try {
          const backendStatus = (await this.tauriInvoke('get_service_status')) as {
            is_running?: boolean;
            port?: number;
          };
          if (backendStatus?.is_running && backendStatus?.port) {
            this.applyBackendPort(backendStatus.port);
            return;
          }
        } catch {
          // ignore
        }
      }

      this.pollTimer = window.setTimeout(() => {
        void tick();
      }, 500);
    };
    void tick();
  }

  private async readDevBackendPort(): Promise<number | null> {
    try {
      const devPortRes = await fetch('/__autoclip/backend-port');
      if (!devPortRes.ok) return null;
      const devPort = (await devPortRes.json()) as { port?: number | null };
      return devPort?.port && devPort.port > 0 ? devPort.port : null;
    } catch {
      return null;
    }
  }

  /** 网络错误后尝试重新对齐后端（tauri:dev 读 port 文件，正式包读 Rust 状态） */
  async refreshConnection(): Promise<boolean> {
    if (!isTauriRuntime()) return true;

    if (isTauriViteDev()) {
      const port = await this.readDevBackendPort();
      if (port) {
        this.applyBackendPort(port);
        return true;
      }
      this.updateConfig({ isReady: false });
      this.startBackendPoll();
      return this.waitForReady(15000);
    }

    if (this.tauriInvoke) {
      try {
        const backendStatus = (await this.tauriInvoke('get_service_status')) as {
          is_running?: boolean;
          port?: number;
        };
        if (backendStatus?.is_running && backendStatus?.port) {
          this.applyBackendPort(backendStatus.port);
          return true;
        }
      } catch {
        // ignore
      }
    }
    this.updateConfig({ isReady: false });
    this.startBackendPoll();
    return this.waitForReady(15000);
  }

  private updateConfig(newConfig: Partial<ApiConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener(this.config));
  }

  getConfig(): ApiConfig {
    return { ...this.config };
  }

  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  isReady(): boolean {
    return this.config.isReady;
  }

  addListener(listener: (config: ApiConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async waitForReady(timeout: number = 90000): Promise<boolean> {
    if (this.isReady()) {
      return true;
    }

    if (isTauriRuntime() && !this.pollTimer) {
      this.startBackendPoll();
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(false);
      }, timeout);

      const removeListener = this.addListener((config) => {
        if (config.isReady) {
          clearTimeout(timeoutId);
          removeListener();
          resolve(true);
        }
      });
    });
  }

  buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.config.baseUrl}${normalizedPath}`;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.isReady) {
      return false;
    }

    try {
      const url = isTauriViteDev()
        ? '/health'
        : `http://127.0.0.1:${this.config.port}/health`;
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      console.warn('API 健康检查失败:', error);
      return false;
    }
  }
}

export const apiConfigManager = ApiConfigManager.getInstance();

export const getApiBaseUrl = () => apiConfigManager.getBaseUrl();
export const isApiReady = () => apiConfigManager.isReady();
export const waitForApiReady = (timeout?: number) => apiConfigManager.waitForReady(timeout);
export const buildApiUrl = (path: string) => apiConfigManager.buildUrl(path);
export const checkApiHealth = () => apiConfigManager.healthCheck();
export const refreshApiConnection = () => apiConfigManager.refreshConnection();
