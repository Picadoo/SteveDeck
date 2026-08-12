// localStorage 安全封装——隐私模式/配额满/被禁用时 localStorage 会抛异常，
// 此前 24 处调用点各裹一层 try/catch。读失败回退默认值，写失败静默（本地偏好丢了不致命）。

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 隐私模式/配额满：静默 */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  /** 读 JSON；缺失/损坏返回 fallback */
  getJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
