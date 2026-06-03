import { useState } from "react";
import { Search, Boxes, BarChart3, RefreshCw, Clock } from "lucide-react";
import { Card, Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import SchedulerTab from "./SchedulerTab";
import type { BotSummary } from "@mcbot/protocol";

/** 交互中心：NPC / 容器·菜单 / 计分板 / 定时任务。动作均走 action 接口，AI 同样可调。 */
export default function InteractionTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const setWindow = useStore((s) => s.setWindow);
  const [npcName, setNpcName] = useState("");
  const [xyz, setXyz] = useState({ x: "", y: "", z: "" });
  const [sb, setSb] = useState<any>(null);
  const disabled = !bot.online;

  async function openContainer() {
    const x = Number(xyz.x),
      y = Number(xyz.y),
      z = Number(xyz.z);
    if (![x, y, z].every(Number.isFinite)) return pushToast("请输入有效坐标", "error");
    const r = await cmd.window.openAt(bot.id, x, y, z);
    if (r.ok && r.data) {
      setWindow(bot.username, r.data);
      pushToast("已打开容器", "success");
    } else pushToast(r.error || "打开失败（太远或不是容器）", "error");
  }

  async function fetchScoreboard() {
    const r = await cmd.moduleAction(bot.id, "scoreboard", "get");
    if (r.ok) setSb(r.data ?? { empty: true });
    else pushToast(r.error || "获取计分板失败", "error");
  }
  const sbItems: { name: string; value: number | string }[] = sb?.items || sb?.sidebar || [];

  return (
    <div className="space-y-4">
      {/* NPC 交互 */}
      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Search className="h-4 w-4 text-accent" /> NPC 交互
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => cmd.moduleAction(bot.id, "npc", "scan")}
          >
            <Search className="h-3.5 w-3.5" /> 扫描附近 NPC
          </Button>
        </div>
        <div className="mt-2 flex gap-2">
          <Input value={npcName} onChange={(e) => setNpcName(e.target.value)} placeholder="NPC 名称" disabled={disabled} />
          <Button
            size="sm"
            variant="primary"
            disabled={disabled || !npcName.trim()}
            onClick={() => cmd.moduleAction(bot.id, "npc", "interact", { name: npcName.trim() })}
          >
            交互
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted">扫描结果见「日志」标签</p>
      </Card>

      {/* 容器 / 菜单 */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Boxes className="h-4 w-4 text-accent" /> 容器 / 菜单
        </h3>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          在底部聊天栏输入菜单命令（如 <code className="rounded bg-surface-2 px-1">/menu</code>、
          <code className="rounded bg-surface-2 px-1">/bp</code>），界面会自动弹出可点击操作；或按坐标打开附近箱子：
        </p>
        <div className="flex gap-1.5">
          <Input value={xyz.x} onChange={(e) => setXyz((v) => ({ ...v, x: e.target.value }))} placeholder="X" disabled={disabled} />
          <Input value={xyz.y} onChange={(e) => setXyz((v) => ({ ...v, y: e.target.value }))} placeholder="Y" disabled={disabled} />
          <Input value={xyz.z} onChange={(e) => setXyz((v) => ({ ...v, z: e.target.value }))} placeholder="Z" disabled={disabled} />
          <Button size="sm" variant="primary" disabled={disabled} onClick={openContainer}>
            打开
          </Button>
        </div>
      </Card>

      {/* 计分板 */}
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-accent" /> 计分板
        </h3>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={fetchScoreboard}>
          <RefreshCw className="h-3.5 w-3.5" /> 查看计分板
        </Button>
        {sbItems.length > 0 ? (
          <div className="mt-2 space-y-1">
            {sb?.title && <div className="text-sm font-semibold">{sb.title}</div>}
            {sbItems.map((it, i) => (
              <div key={i} className="flex justify-between border-b border-border/40 py-1 text-sm last:border-0">
                <span className="truncate pr-2 text-muted">{it.name}</span>
                <span className="font-medium tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        ) : sb ? (
          <p className="mt-2 text-xs text-muted">该服务器当前无侧边栏计分板</p>
        ) : null}
      </Card>

      {/* 定时任务（折叠自原「定时」标签） */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">
          <Clock className="h-4 w-4 text-accent" /> 定时任务
        </h3>
        <SchedulerTab bot={bot} />
      </div>
    </div>
  );
}
