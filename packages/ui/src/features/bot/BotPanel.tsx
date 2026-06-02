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
  Swords,
  Fish,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button, Card, Input, Switch, Badge, StatusDot } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import Console from "./Console";
import { cn } from "@/lib/cn";

type Tab = "overview" | "console";

export default function BotPanel() {
  const bot = useStore((s) => s.bots.find((b) => b.id === s.selectedId));
  const [tab, setTab] = useState<Tab>("overview");
  const [chat, setChat] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

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
    await cmd.chat(bot.id, msg);
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

        {/* 指标 */}
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
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          概览
        </TabButton>
        <TabButton active={tab === "console"} onClick={() => setTab("console")}>
          日志
        </TabButton>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">快捷模块</h3>
              <ModuleRow
                icon={<Swords className="h-4 w-4 text-accent" />}
                name="自动战斗"
                checked={!!bot.modules.combat}
                onChange={(v) => cmd.toggleModule(bot.id, "combat", v)}
                disabled={!bot.online}
              />
              <ModuleRow
                icon={<Fish className="h-4 w-4 text-accent" />}
                name="自动钓鱼"
                checked={!!bot.modules.fishing}
                onChange={(v) => cmd.toggleModule(bot.id, "fishing", v)}
                disabled={!bot.online}
              />
              <p className="mt-2 text-[11px] text-muted">更多模块将在后续版本接入</p>
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">信息</h3>
              <InfoRow label="服务器" value={bot.host} />
              <InfoRow label="状态" value={bot.online ? "在线" : bot.reconnecting ? "重连中" : "离线"} />
              {bot.modules.script && <InfoRow label="运行脚本" value={bot.modules.script} />}
            </Card>
          </div>
        ) : (
          <Console botId={bot.id} />
        )}
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

      <Modal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="删除机器人"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(false)}>
              取消
            </Button>
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
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

function ModuleRow({
  icon,
  name,
  checked,
  onChange,
  disabled,
}: {
  icon: ReactNode;
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm">{name}</span>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
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
