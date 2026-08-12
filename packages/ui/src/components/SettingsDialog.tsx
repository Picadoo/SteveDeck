import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Copy, BellRing } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Switch } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import {
  cmd,
  fetchConnectionInfo,
  disconnect,
  forgetConn,
  isTauri,
  getEngineConfig,
  setEngineConfig,
  restartApp,
  parseConnectionString,
  normalizeUrl,
  fetchNotifyConfig,
  saveNotifyConfig,
  testNotify,
  type NotifyConfig,
} from "@/lib/engine";

interface ConnInfo {
  addresses: string[];
  port: number;
  connectionString: string;
  qrcodeDataUrl?: string;
  /** 网页直开地址（引擎带网页客户端时才有） */
  webUrl?: string;
}

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const conn = useStore((s) => s.conn);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const invMode = useStore((s) => s.invMode);
  const setInvMode = useStore((s) => s.setInvMode);
  const pushToast = useStore((s) => s.pushToast);
  const [info, setInfo] = useState<ConnInfo | null>(null);
  // 内置引擎只监听 127.0.0.1（安全考虑），二维码里的局域网地址手机必然连不上——别摆个死二维码骗人
  const [builtinEngine, setBuiltinEngine] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true; // UICORE-5：关闭/卸载后丢弃迟到/慢响应，避免对无关组件 setState
    setInfo(null);
    fetchConnectionInfo().then((r) => {
      if (alive) setInfo(r);
    });
    if (isTauri()) {
      getEngineConfig().then((c) => {
        if (alive) setBuiltinEngine(c?.mode !== "remote");
      });
    }
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  async function copy(t: string) {
    if (await copyText(t)) pushToast("已复制", "success");
    else pushToast("复制失败", "error");
  }

  return (
    <Modal open={open} onClose={onClose} title="设置">
      <div className="space-y-5">
        <Section title="当前引擎">
          <Row k="地址" v={conn.url.replace(/^https?:\/\//, "") || "—"} />
          <Row k="版本" v={conn.engine?.version ? `v${conn.engine.version}` : "—"} />
          <Row
            k="状态"
            v={
              conn.status === "online"
                ? "已连接"
                : conn.status === "connecting"
                  ? "连接中"
                  : conn.status === "error"
                    ? `连接出错${conn.error ? `：${conn.error}` : ""}`
                    : "未连接"
            }
          />
        </Section>

        {isTauri() && <EngineSourceSection />}

        <Section title="连接手机 / 其他设备">
          {isTauri() && builtinEngine ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              内置引擎出于安全只监听本机（127.0.0.1），手机扫码连不上。要用手机控制：把引擎部署到
              服务器/NAS（Docker），在上面的「引擎来源」切到远程模式后，手机即可扫那台引擎的二维码，
              或直接用手机浏览器打开远程引擎地址。
            </p>
          ) : info?.qrcodeDataUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img src={info.qrcodeDataUrl} alt="连接二维码" className="h-40 w-40 rounded-lg bg-white p-1" />
              <p className="text-center text-[11px] text-muted">
                {info.webUrl
                  ? "手机相机扫码 → 浏览器打开即自动连接（零安装）；或复制下面的连接串"
                  : "在另一台设备的客户端里扫描，或复制下面的连接串"}
              </p>
              {info.webUrl && (
                <code className="w-full truncate rounded-lg bg-surface-2 px-2 py-1.5 text-center text-[11px] text-muted">
                  {info.webUrl.split("#")[0]}
                </code>
              )}
              <div className="flex w-full items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]">
                  {info.connectionString}
                </code>
                <Button size="sm" variant="secondary" onClick={() => copy(info.connectionString)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">加载中… 若长期为空，可能是引擎不可达。</p>
          )}
        </Section>

        <NotifySection />

        <BackupSection />

        <Section title="其它">
          <div className="flex items-center justify-between">
            <span className="text-sm">主题</span>
            <Button size="sm" variant="secondary" onClick={toggleTheme}>
              {theme === "dark" ? "深色" : "浅色"}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">背包显示</div>
              <div className="text-[11px] text-muted">完全版带贴图/彩色名/描述；精简版纯文本更轻</div>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-xs">
              {(["lite", "full"] as const).map((m) => (
                <button type="button"
                  key={m}
                  onClick={() => setInvMode(m)}
                  className={cn(
                    "px-2.5 py-1 transition-colors",
                    invMode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
                  )}
                >
                  {m === "lite" ? "精简" : "完全"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">切换 / 断开引擎</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                disconnect();
                forgetConn();
                onClose();
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> 断开
            </Button>
          </div>
        </Section>
      </div>
    </Modal>
  );
}

// 引擎来源（仅桌面版）：内置自带引擎 / 连远程 Docker 引擎。改动写入 AppData，重启后由 Rust 侧决定起不起内置引擎。
function EngineSourceSection() {
  const pushToast = useStore((s) => s.pushToast);
  const [mode, setMode] = useState<"builtin" | "remote">("builtin");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [dirty, setDirty] = useState(false);
  const [needRestart, setNeedRestart] = useState(false);

  useEffect(() => {
    let alive = true; // UICORE-5：卸载后不 setState
    getEngineConfig().then((c) => {
      if (!alive || !c) return;
      setMode(c.mode === "remote" ? "remote" : "builtin");
      setUrl(c.url || "");
      setToken(c.token || "");
    });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    let u = url.trim();
    let t = token.trim();
    if (mode === "remote") {
      // 用户常把整条 mcbot:// 连接串粘进地址框——这本来就是我们自己生成的格式，认它：自动拆出地址和令牌
      const parsed = parseConnectionString(u);
      if (parsed) {
        u = parsed.url;
        if (parsed.token) t = parsed.token;
      } else if (u) {
        u = normalizeUrl(u); // 允许省略 http://（如 192.168.1.10:8723）
      }
      if (!u) {
        pushToast("请填写引擎地址（http://主机:端口，或直接粘贴 mcbot:// 连接串）", "error");
        return;
      }
      setUrl(u);
      setToken(t);
    }
    const ok = await setEngineConfig(mode, u, t);
    if (ok) {
      setDirty(false);
      setNeedRestart(true);
      pushToast("已保存，重启后生效", "success");
    } else {
      pushToast("保存失败", "error");
    }
  }

  return (
    <Section title="引擎来源（桌面版）">
      <div className="flex items-center justify-between">
        <div className="pr-3">
          <div className="text-sm">引擎运行在哪</div>
          <div className="text-[11px] text-muted">内置=本机自带引擎；远程=连 Docker/服务器引擎，本机不再起引擎</div>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-xs">
          {(["builtin", "remote"] as const).map((m) => (
            <button type="button"
              key={m}
              onClick={() => {
                setMode(m);
                setDirty(true);
              }}
              className={cn(
                "px-2.5 py-1 transition-colors",
                mode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
              )}
            >
              {m === "builtin" ? "内置" : "远程"}
            </button>
          ))}
        </div>
      </div>
      {mode === "remote" && (
        <div className="space-y-2">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setDirty(true);
            }}
            placeholder="引擎地址，如 http://192.168.1.10:8723"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg"
          />
          <input
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setDirty(true);
            }}
            placeholder="访问令牌"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg"
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {needRestart && (
          <Button size="sm" variant="secondary" onClick={() => restartApp()}>
            立即重启
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={!dirty}>
          保存
        </Button>
      </div>
    </Section>
  );
}

// 挂机通知推送：引擎侧 Webhook——死亡/被踢/掉线时推到手机。配置存引擎数据目录（多端共享），
// 这里只是编辑器；「测试」用已保存的配置发真实请求，成败即时反馈。
const NOTIFY_PRESETS: { value: NotifyConfig["preset"]; label: string; placeholder: string }[] = [
  { value: "serverchan", label: "Server酱", placeholder: "https://sctapi.ftqq.com/<SendKey>.send" },
  { value: "dingtalk", label: "钉钉群机器人", placeholder: "https://oapi.dingtalk.com/robot/send?access_token=…" },
  { value: "feishu", label: "飞书群机器人", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…" },
  { value: "wecom", label: "企业微信群机器人", placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" },
  { value: "bark", label: "Bark（iOS）", placeholder: "https://api.day.app/<你的Key>" },
  { value: "discord", label: "Discord Webhook", placeholder: "https://discord.com/api/webhooks/…" },
  { value: "generic", label: "通用 JSON POST", placeholder: "https://你的接收端/webhook" },
];
const NOTIFY_EVENTS: { key: keyof NotifyConfig["events"]; label: string }[] = [
  { key: "death", label: "死亡" },
  { key: "kick", label: "被踢出" },
  { key: "offline", label: "掉线（停止重连）" },
  { key: "online", label: "上线" },
];

function NotifySection() {
  const pushToast = useStore((s) => s.pushToast);
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unsupported">("loading");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test">(null);

  useEffect(() => {
    let alive = true; // UICORE-5：卸载后不 setState
    fetchNotifyConfig().then((c) => {
      if (!alive) return;
      if (c) {
        setCfg(c);
        setState("ready");
      } else {
        setState("unsupported"); // 老引擎无此接口
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  function patch(p: Partial<NotifyConfig>) {
    setCfg((c) => (c ? { ...c, ...p, events: { ...c.events, ...(p.events ?? {}) } } : c));
    setDirty(true);
  }

  async function save() {
    if (!cfg) return;
    if (cfg.enabled && !/^https?:\/\//i.test(cfg.url.trim())) {
      pushToast("Webhook 地址需以 http:// 或 https:// 开头", "error");
      return;
    }
    setBusy("save");
    const saved = await saveNotifyConfig(cfg);
    setBusy(null);
    if (saved) {
      setCfg(saved);
      setDirty(false);
      pushToast("通知配置已保存", "success");
    } else {
      pushToast("保存失败（引擎不可达或版本过旧）", "error");
    }
  }

  async function test() {
    setBusy("test");
    const r = await testNotify();
    setBusy(null);
    if (r.ok) pushToast("测试通知已发出，请查看手机/群", "success");
    else pushToast(`测试失败：${r.error}`, "error");
  }

  if (state === "unsupported") return null; // 老引擎：不渲染半残区块，升级引擎后自然出现

  const preset = NOTIFY_PRESETS.find((p) => p.value === cfg?.preset) ?? NOTIFY_PRESETS[0];
  return (
    <Section title="挂机通知推送">
      <div className="flex items-center justify-between">
        <div className="pr-3">
          <div className="flex items-center gap-1.5 text-sm">
            <BellRing className="h-3.5 w-3.5 text-muted" /> 出事推送到手机
          </div>
          <div className="text-[11px] text-muted">死亡 / 被踢 / 掉线时经 Webhook 推送（人不在电脑前也能知道）</div>
        </div>
        {state === "ready" && cfg && (
          <Switch checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
        )}
      </div>
      {state === "loading" && <p className="text-xs text-muted">加载配置…</p>}
      {state === "ready" && cfg && cfg.enabled && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={cfg.preset}
              onChange={(e) => patch({ preset: e.target.value as NotifyConfig["preset"] })}
              className="h-9 shrink-0 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
            >
              {NOTIFY_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={cfg.url}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder={preset.placeholder}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-fg"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {NOTIFY_EVENTS.map((ev) => (
              <label key={ev.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={cfg.events[ev.key]}
                  onChange={(e) => patch({ events: { ...cfg.events, [ev.key]: e.target.checked } })}
                  className="h-3.5 w-3.5"
                />
                {ev.label}
              </label>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            同一机器人的同类事件 {cfg.cooldownSec}s 内只推一次（防死亡循环刷屏）。钉钉机器人若设了
            「自定义关键词」，把关键词配成 SteveDeck 即可。
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null || dirty || !cfg.url}
              title={dirty ? "先保存再测试" : "用已保存的配置发一条测试消息"}
              onClick={test}
            >
              {busy === "test" ? "发送中…" : "测试"}
            </Button>
            <Button size="sm" disabled={busy !== null || !dirty} onClick={save}>
              {busy === "save" ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      )}
      {/* 关着也允许保存（把「开→关」落盘） */}
      {state === "ready" && cfg && !cfg.enabled && dirty && (
        <div className="flex justify-end">
          <Button size="sm" disabled={busy !== null} onClick={save}>
            {busy === "save" ? "保存中…" : "保存"}
          </Button>
        </div>
      )}
    </Section>
  );
}

// 配置备份/迁移：导出全部 bots+脚本+JS 为一个 JSON 文件下载；导入合并（不删现有）。
function BackupSection() {
  const pushToast = useStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  async function doExport() {
    setBusy(true);
    const r = await cmd.exportData();
    setBusy(false);
    if (!r.ok || !r.data) return pushToast(r.error || "导出失败", "error");
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mcbot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast(`已导出 ${r.data.bots?.length ?? 0} 个机器人配置`, "success");
  }

  function pickAndImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let bundle: unknown;
      try {
        bundle = JSON.parse(await file.text());
      } catch {
        pushToast("文件不是合法 JSON", "error");
        return;
      }
      setBusy(true);
      const r = await cmd.importData(bundle);
      setBusy(false);
      if (!r.ok) return pushToast(r.error || "导入失败", "error");
      const d = r.data as { bots: number; scripts: number; customScripts: number };
      pushToast(`导入完成：+${d.bots} 机器人 · +${d.scripts} 脚本 · +${d.customScripts} JS（合并，未删现有）`, "success");
    };
    input.click();
  }

  return (
    <Section title="配置备份 / 迁移">
      <p className="rounded-lg bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
        ⚠️ 导出文件含明文登录密码，请妥善保管、勿随意分享。导入为合并（按 用户名@host / 名字去重，不删现有）。
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={doExport}>
          导出配置
        </Button>
        <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={pickAndImport}>
          导入配置
        </Button>
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-muted">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{k}</span>
      <span className="truncate pl-2 font-medium">{v}</span>
    </div>
  );
}
