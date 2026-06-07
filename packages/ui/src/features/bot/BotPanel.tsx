import { useEffect, useState, type FormEvent, type ReactNode, type KeyboardEvent } from "react";
import {
  RotateCw,
  Square,
  Trash2,
  Send,
  Bot as BotIcon,
  Pencil,
  History,
  SlidersHorizontal,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button, Input, Badge, StatusDot } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { computeMetrics, loadCfg, saveCfg, defaultCfg, type HeaderCfg } from "@/lib/headerMetrics";
import HeaderMetricsConfig from "./HeaderMetricsConfig";
import AddBotDialog, { type EditInitial } from "./AddBotDialog";
import Console from "./Console";
import GuiWindow from "./GuiWindow";
import OverviewTab from "./OverviewTab";
import ModulesTab from "./ModulesTab";
import LiveTab from "./LiveTab";
import LocationsTab from "./LocationsTab";
import ScriptsTab from "./ScriptsTab";
import InventoryTab from "./InventoryTab";
import AiTab from "./AiTab";
import { cn } from "@/lib/cn";

type Tab = "overview" | "live" | "modules" | "scripts" | "inventory" | "locations" | "ai" | "console";

export default function BotPanel() {
  const bot = useStore((s) => s.bots.find((b) => b.id === s.selectedId));
  const pushToast = useStore((s) => s.pushToast);
  const chatHistory = useStore((s) => s.chatHistory);
  const pushCmd = useStore((s) => s.pushCmd);
  const [tab, setTab] = useState<Tab>("overview");
  const [chat, setChat] = useState("");
  const [histIdx, setHistIdx] = useState(-1);
  const [showHist, setShowHist] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [edit, setEdit] = useState<{ open: boolean; initial?: EditInitial }>({ open: false });
  const [metricsCfg, setMetricsCfg] = useState<HeaderCfg>(defaultCfg);
  const [metricsCfgOpen, setMetricsCfgOpen] = useState(false);
  const [sbLines, setSbLines] = useState<string[]>([]);

  // 顶栏指标配置按 host 加载；钉了计分板指标（或正在配置）时轮询计分板取实时数字
  const host = bot?.host;
  useEffect(() => {
    if (host) setMetricsCfg(loadCfg(host));
  }, [host]);
  useEffect(() => {
    const id = bot?.id;
    if (!id || !bot?.online || (metricsCfg.pinned.length === 0 && !metricsCfgOpen)) return;
    let live = true;
    const poll = async () => {
      const r = await cmd.moduleAction(id, "scoreboard", "get");
      if (!live || !r.ok || !r.data) return;
      const sb = r.data as { items?: { raw?: string; name?: string }[]; sidebar?: { raw?: string; name?: string }[] };
      const lines = (sb.items || sb.sidebar || []).map((it) => it.raw || it.name || "").filter(Boolean);
      setSbLines(lines);
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot?.id, bot?.online, metricsCfg.pinned.length, metricsCfgOpen]);

  if (!bot) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center text-muted">
        <BotIcon className="mb-3 h-10 w-10 opacity-40" />
        <p className="text-sm">从左侧选择一个机器人，或点击 + 添加</p>
      </div>
    );
  }

  const metricChips = computeMetrics(bot, sbLines, metricsCfg);
  const updateMetricsCfg = (c: HeaderCfg) => {
    setMetricsCfg(c);
    saveCfg(bot.host, c);
  };

  async function send(msg: string) {
    if (!msg.trim() || !bot) return;
    pushCmd(msg.trim());
    const r = await cmd.chat(bot.id, msg.trim());
    if (!r.ok) pushToast(r.error || "发送失败", "error");
  }
  async function sendChat(e: FormEvent) {
    e.preventDefault();
    const msg = chat.trim();
    setChat("");
    setHistIdx(-1);
    await send(msg);
  }
  function onChatKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = Math.min(histIdx + 1, chatHistory.length - 1);
      if (i >= 0 && chatHistory[i] !== undefined) {
        setHistIdx(i);
        setChat(chatHistory[i]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = histIdx - 1;
      setHistIdx(i);
      setChat(i < 0 ? "" : chatHistory[i] ?? "");
    }
  }

  async function openEdit() {
    if (!bot) return;
    const r = await cmd.getBotConfig(bot.id);
    setEdit({ open: true, initial: r.ok && r.data ? (r.data as EditInitial) : { username: bot.username, host: bot.host } });
  }

  return (
    <div className="flex h-full flex-col">
      {/* 状态头 */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <StatusDot online={bot.online} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{bot.username}</h2>
                {bot.online ? (
                  <Badge tone="success">在线</Badge>
                ) : bot.reconnecting ? (
                  <Badge tone="warning">重连中</Badge>
                ) : (
                  <Badge tone="neutral">离线</Badge>
                )}
              </div>
              <div className="text-xs text-muted">{bot.note || bot.host}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => cmd.reconnect(bot.id)}>
              <RotateCw className="h-3.5 w-3.5" /> 重连
            </Button>
            <Button size="sm" variant="secondary" onClick={() => cmd.stop(bot.id)}>
              <Square className="h-3.5 w-3.5" /> 停止
            </Button>
            <Button size="sm" variant="ghost" onClick={openEdit} title="编辑">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(true)} title="删除">
              <Trash2 className="h-3.5 w-3.5 text-danger" />
            </Button>
          </div>
        </div>

        {bot.online && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {metricChips.map((chip) => {
              const Icon = chip.icon;
              return (
                <Metric
                  key={chip.key}
                  icon={<Icon className={cn("h-3.5 w-3.5", chip.iconClass)} />}
                  label={chip.label}
                  value={chip.value}
                />
              );
            })}
            <button
              onClick={() => setMetricsCfgOpen(true)}
              title="配置顶栏指标（从计分板提取金币/点卷等）"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {bot.fatalReason && (
          <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            已停止重连：{bot.fatalReason}
          </div>
        )}
      </div>

      {/* 标签栏 */}
      <div className="flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-4 [&::-webkit-scrollbar]:hidden">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>概览</TabButton>
        <TabButton active={tab === "live"} onClick={() => setTab("live")}>交互</TabButton>
        <TabButton active={tab === "modules"} onClick={() => setTab("modules")}>模块</TabButton>
        <TabButton active={tab === "scripts"} onClick={() => setTab("scripts")}>脚本</TabButton>
        <TabButton active={tab === "inventory"} onClick={() => setTab("inventory")}>背包</TabButton>
        <TabButton active={tab === "locations"} onClick={() => setTab("locations")}>地点</TabButton>
        <TabButton active={tab === "ai"} onClick={() => setTab("ai")}>AI</TabButton>
        <TabButton active={tab === "console"} onClick={() => setTab("console")}>日志</TabButton>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" && <OverviewTab bot={bot} />}
        {tab === "live" && <LiveTab bot={bot} />}
        {tab === "modules" && <ModulesTab bot={bot} />}
        {tab === "scripts" && <ScriptsTab bot={bot} />}
        {tab === "inventory" && <InventoryTab bot={bot} />}
        {tab === "locations" && <LocationsTab bot={bot} />}
        {tab === "ai" && <AiTab bot={bot} />}
        {tab === "console" && <Console botId={bot.id} />}
      </div>

      {/* 聊天栏 */}
      <form onSubmit={sendChat} className="relative flex shrink-0 gap-2 border-t border-border p-3">
        {showHist && chatHistory.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
            <div className="px-3 py-1 text-[10px] text-muted">最近命令（点击重发）</div>
            {chatHistory.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setShowHist(false);
                  send(c);
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-surface-2"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={!bot.online || chatHistory.length === 0}
          onClick={() => setShowHist((v) => !v)}
          title="最近命令（输入框里按 ↑/↓ 也能翻历史）"
        >
          <History className="h-4 w-4" />
        </Button>
        <Input
          value={chat}
          onChange={(e) => {
            setChat(e.target.value);
            setHistIdx(-1);
          }}
          onKeyDown={onChatKey}
          placeholder={bot.online ? "发送聊天 / 命令（如 /home）· ↑ 翻历史" : "机器人离线"}
          disabled={!bot.online}
        />
        <Button type="submit" variant="primary" disabled={!bot.online || !chat.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {/* 删除确认 */}
      <Modal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="删除机器人"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmDel(false);
                await cmd.deleteBot(bot.id);
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          确定删除机器人 <span className="font-medium text-fg">{bot.username}</span> 吗？此操作不可撤销。
        </p>
      </Modal>

      {/* 编辑机器人 */}
      <AddBotDialog open={edit.open} editId={bot.id} initial={edit.initial} onClose={() => setEdit({ open: false })} />

      {/* 服务器打开的窗口/GUI（箱子/菜单），自动弹出可操作 */}
      <GuiWindow bot={bot} />

      {/* 顶栏指标配置（内置开关 + 从计分板勾选自定义数字，按服务器独立） */}
      <HeaderMetricsConfig
        open={metricsCfgOpen}
        onClose={() => setMetricsCfgOpen(false)}
        cfg={metricsCfg}
        onChange={updateMetricsCfg}
        scoreboardLines={sbLines}
      />
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
      {icon}
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "text-fg" : "text-muted hover:text-fg",
      )}
    >
      {children}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
    </button>
  );
}
