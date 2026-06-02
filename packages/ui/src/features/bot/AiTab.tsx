import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Copy } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import type { BotSummary, Observation } from "@mcbot/protocol";

const SCRIPT_HELP = `脚本格式：
{ "name":"...", "loop":false, "trigger":{"type":"manual"}, "steps":[ {"do":"chat","msg":"hi"}, {"do":"wait","s":2} ] }
可用 do：chat(msg) cmd(cmd) whisper(player,msg) wait(s) log(msg) goto(x,y,z) return_home equip(item) equip_best_weapon drop(item,count) use_item attack(entity) jump swap_hands look(x,y,z) if(cond,steps) repeat(times,steps) while(cond,steps) run_script(name) stop set_var(name,value) math_var(name,op,value)
可用 trigger.type：manual interval(value=秒) schedule(value=HH:MM) chat_match(value=关键词) health_below(value=数) respawn player_nearby inventory_full
条件(cond)示例："health < 10"、"inventory_has diamond"、"players_nearby"、"no_players_nearby"`;

function buildPrompt(obs: Observation): string {
  return [
    "你是 Minecraft 挂机机器人的脚本助手。下面是机器人的【当前世界状态】。请根据我在末尾写的【目标】，只输出一个脚本 JSON（不要解释、不要代码块外的文字），我会直接导入运行。",
    "",
    "# 当前世界状态",
    "```json",
    JSON.stringify(obs, null, 2),
    "```",
    "",
    "# 脚本规范",
    SCRIPT_HELP,
    "",
    "# 我的目标",
    "（在这里写你想让机器人做什么，例如：先回家，然后每隔 30 秒发一次 /home，血量低于 8 就停止）",
  ].join("\n");
}

export default function AiTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [obs, setObs] = useState<Observation | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await cmd.observe(bot.id);
    setLoading(false);
    if (r.ok) setObs(r.data as Observation);
    else pushToast(r.error || "获取感知失败", "error");
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(label + "已复制", "success");
    } catch {
      pushToast("复制失败（浏览器限制）", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">让 AI 感知机器人状态并生成脚本</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 刷新
          </Button>
          <Button size="sm" variant="primary" disabled={!obs} onClick={() => obs && copy(buildPrompt(obs), "AI 提示词")}>
            <Sparkles className="h-3.5 w-3.5" /> 复制 AI 提示词
          </Button>
        </div>
      </div>

      {!obs ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">自身</h3>
              {obs.self ? (
                <div className="space-y-1 text-xs">
                  <Row k="坐标" v={`${obs.self.pos.x}, ${obs.self.pos.y}, ${obs.self.pos.z}`} />
                  <Row k="生命 / 饱食" v={`${obs.self.health} / ${obs.self.food}`} />
                  <Row k="手持" v={obs.self.heldItem || "—"} />
                  <Row k="维度" v={obs.self.dimension || "—"} />
                </div>
              ) : (
                <p className="text-xs text-muted">机器人离线</p>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">周围</h3>
              <div className="space-y-1 text-xs">
                <Row k="附近玩家" v={String(obs.nearbyPlayers.length)} />
                <Row k="附近实体" v={String(obs.nearbyEntities.length)} />
                <Row k="背包物品种类" v={String(obs.inventory.length)} />
                <Row k="最近消息" v={String(obs.recentChat.length)} />
              </div>
            </Card>
          </div>

          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">完整感知 JSON</h3>
              <Button size="sm" variant="ghost" onClick={() => copy(JSON.stringify(obs, null, 2), "状态 JSON")}>
                <Copy className="h-3.5 w-3.5" /> 复制
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2/50 p-3 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(obs, null, 2)}
            </pre>
          </Card>

          <p className="text-[11px] leading-relaxed text-muted">
            用法：点「复制 AI 提示词」→ 粘到 Claude/任意 AI，在末尾写下目标 → AI 返回脚本 JSON → 到「脚本」标签粘贴运行。
            也可程序化调用 <code className="text-fg">GET /api/observe/:id</code> 与 <code className="text-fg">POST /api/ai/script/:id</code>（见 docs/AI_INTEGRATION.md）。
          </p>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className="truncate pl-2 font-medium">{v}</span>
    </div>
  );
}
