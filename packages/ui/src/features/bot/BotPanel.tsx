import { useState, type FormEvent, type ReactNode } from "react";
import {
  Heart,
  Drumstick,
  Star,
  MapPin,
  RotateCw,
  Square,
  Trash2,
  Send,
  Bot as BotIcon,
  BarChart3,
  Search,
  Package,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button, Card, Input, Badge, StatusDot } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import Console from "./Console";
import ModulesTab from "./ModulesTab";
import LocationsTab from "./LocationsTab";
import SchedulerTab from "./SchedulerTab";
import ScriptsTab from "./ScriptsTab";
import InventoryTab from "./InventoryTab";
import { cn } from "@/lib/cn";

type Tab = "overview" | "modules" | "locations" | "scheduler" | "scripts" | "inventory" | "console";

export default function BotPanel() {
  const bot = useStore((s) => s.bots.find((b) => b.id === s.selectedId));
  const pushToast = useStore((s) => s.pushToast);
  const [tab, setTab] = useState<Tab>("overview");
  const [chat, setChat] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [sb, setSb] = useState<{ open: boolean; data: any }>({ open: false, data: null });
  const [npcName, setNpcName] = useState("");

  if (!bot) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center text-muted">
        <BotIcon className="mb-3 h-10 w-10 opacity-40" />
        <p className="text-sm">从左侧选择一个机器人，或点击 + 添加</p>
      </div>
    );
  }

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    const msg = chat.trim();
    if (!msg || !bot) return;
    setChat("");
    const r = await cmd.chat(bot.id, msg);
    if (!r.ok) pushToast(r.error || "发送失败", "error");
  }

  async function openScoreboard() {
    if (!bot) return;
    const r = await cmd.moduleAction(bot.id, "scoreboard", "get");
    if (!r.ok) pushToast(r.error || "获取计分板失败", "error");
    setSb({ open: true, data: r.ok ? r.data : null });
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
              <div className="text-xs text-muted">{bot.host}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => cmd.reconnect(bot.id)}>
              <RotateCw className="h-3.5 w-3.5" /> 重连
            </Button>
            <Button size="sm" variant="secondary" onClick={() => cmd.stop(bot.id)}>
              <Square className="h-3.5 w-3.5" /> 停止
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(true)} title="删除">
              <Trash2 className="h-3.5 w-3.5 text-danger" />
            </Button>
          </div>
        </div>

        {bot.online && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Metric icon={<Heart className="h-3.5 w-3.5 text-danger" />} label="生命" value={bot.health ?? "-"} />
            <Metric icon={<Drumstick className="h-3.5 w-3.5 text-warning" />} label="饱食" value={bot.food ?? "-"} />
            <Metric icon={<Star className="h-3.5 w-3.5 text-accent" />} label="等级" value={bot.level ?? "-"} />
            <Metric
              icon={<MapPin className="h-3.5 w-3.5 text-success" />}
              label="坐标"
              value={bot.pos ? `${bot.pos.x}, ${bot.pos.y}, ${bot.pos.z}` : "-"}
            />
          </div>
        )}

        {bot.fatalReason && (
          <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            已停止重连：{bot.fatalReason}
          </div>
        )}
      </div>

      {/* 标签栏 */}
      <div className="flex shrink-0 gap-1 border-b border-border px-4">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>概览</TabButton>
        <TabButton active={tab === "modules"} onClick={() => setTab("modules")}>模块</TabButton>
        <TabButton active={tab === "locations"} onClick={() => setTab("locations")}>地点</TabButton>
        <TabButton active={tab === "scheduler"} onClick={() => setTab("scheduler")}>定时</TabButton>
        <TabButton active={tab === "scripts"} onClick={() => setTab("scripts")}>脚本</TabButton>
        <TabButton active={tab === "inventory"} onClick={() => setTab("inventory")}>背包</TabButton>
        <TabButton active={tab === "console"} onClick={() => setTab("console")}>日志</TabButton>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">信息</h3>
              <InfoRow label="服务器" value={bot.host} />
              <InfoRow label="状态" value={bot.online ? "在线" : bot.reconnecting ? "重连中" : "离线"} />
              {bot.modules.script && <InfoRow label="运行脚本" value={bot.modules.script} />}
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">服务器信息</h3>
              <Button size="sm" variant="secondary" disabled={!bot.online} onClick={openScoreboard}>
                <BarChart3 className="h-3.5 w-3.5" /> 查看计分板
              </Button>
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                <Package className="h-4 w-4 text-accent" /> NPC 交互
              </h3>
              <Button
                size="sm"
                variant="secondary"
                disabled={!bot.online}
                onClick={() => cmd.moduleAction(bot.id, "npc", "scan")}
              >
                <Search className="h-3.5 w-3.5" /> 扫描附近 NPC
              </Button>
              <div className="mt-2 flex gap-2">
                <Input
                  value={npcName}
                  onChange={(e) => setNpcName(e.target.value)}
                  placeholder="NPC 名称"
                  disabled={!bot.online}
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!bot.online || !npcName.trim()}
                  onClick={() => cmd.moduleAction(bot.id, "npc", "interact", { name: npcName.trim() })}
                >
                  交互
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted">扫描结果见「日志」标签</p>
            </Card>
          </div>
        )}
        {tab === "modules" && <ModulesTab bot={bot} />}
        {tab === "locations" && <LocationsTab bot={bot} />}
        {tab === "scheduler" && <SchedulerTab bot={bot} />}
        {tab === "scripts" && <ScriptsTab bot={bot} />}
        {tab === "inventory" && <InventoryTab bot={bot} />}
        {tab === "console" && <Console botId={bot.id} />}
      </div>

      {/* 聊天栏 */}
      <form onSubmit={sendChat} className="flex shrink-0 gap-2 border-t border-border p-3">
        <Input
          value={chat}
          onChange={(e) => setChat(e.target.value)}
          placeholder={bot.online ? "发送聊天 / 命令（如 /home）" : "机器人离线"}
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

      {/* 计分板 */}
      <Modal open={sb.open} onClose={() => setSb({ open: false, data: null })} title="计分板">
        <Scoreboard data={sb.data} />
      </Modal>
    </div>
  );
}

function Scoreboard({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-muted">暂无计分板数据（服务器可能不支持）</p>;
  const items: { name: string; value: number | string }[] = data.items || data.sidebar || [];
  if (Array.isArray(items) && items.length) {
    return (
      <div className="space-y-1">
        {data.title && <div className="mb-2 text-sm font-semibold">{data.title}</div>}
        {items.map((it, i) => (
          <div key={i} className="flex justify-between border-b border-border/50 py-1 text-sm last:border-0">
            <span>{it.name}</span>
            <span className="font-medium">{it.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2/50 p-3 font-mono text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
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
        "relative px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "text-fg" : "text-muted hover:text-fg",
      )}
    >
      {children}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="truncate pl-3 font-medium">{value}</span>
    </div>
  );
}
