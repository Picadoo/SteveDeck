import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Copy, Loader2, ChevronDown } from "lucide-react";
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

function buildPrompt(obs: Observation, goal: string): string {
  const goalText = goal.trim() || "（在这里写你想让机器人做什么，例如：先回家，然后每隔 30 秒发一次 /home，血量低于 8 就停止）";
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
    goalText,
  ].join("\n");
}

export default function AiTab({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [obs, setObs] = useState<Observation | null>(null);
  const [loading, setLoading] = useState(false);
  const [goal, setGoal] = useState("");
  const [jsonExpanded, setJsonExpanded] = useState(false);

  async function refresh(alive?: () => boolean) {
    setLoading(true);
    const r = await cmd.observe(bot.id);
    if (alive && !alive()) return;
    setLoading(false);
    if (r.ok) setObs(r.data as Observation);
    else pushToast(r.error || "获取感知失败", "error");
  }
  useEffect(() => {
    let cancelled = false;
    refresh(() => !cancelled);
    return () => {
      cancelled = true;
    };
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
          <Button size="sm" variant="secondary" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 刷新
          </Button>
        </div>
      </div>

      {!obs ? (
        <Card className="flex items-center justify-center gap-2 p-8">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <span className="text-sm text-muted">正在获取机器人感知…</span>
        </Card>
      ) : (
        <>
          {obs.summary && (
            <Card className="flex items-center gap-2 p-3">
              <Sparkles className="h-4 w-4 shrink-0 text-accent" />
              <span className="text-xs leading-relaxed">{obs.summary}</span>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">自身</h3>
              {obs.self ? (
                <div className="space-y-1 text-xs">
                  <Row k="坐标" v={`${obs.self.pos.x}, ${obs.self.pos.y}, ${obs.self.pos.z}`} />
                  <Row
                    k="生命"
                    v={`${obs.self.health}/${obs.self.maxHealth ?? 20}${
                      obs.self.healthPct != null ? ` (${obs.self.healthPct}%)` : ""
                    }`}
                  />
                  <Row k="饱食 / 饱和" v={`${obs.self.food} / ${obs.self.foodSaturation ?? "—"}`} />
                  {obs.self.oxygen != null && <Row k="氧气" v={`${obs.self.oxygen}/20`} />}
                  <Row k="经验" v={`Lv${obs.self.xpLevel} (${obs.self.xpProgress ?? 0}%)`} />
                  <Row k="朝向" v={obs.self.facing ?? "—"} />
                  <Row
                    k="状态"
                    v={[
                      obs.self.onGround ? "落地" : "空中",
                      obs.self.inWater ? "水中" : "",
                      obs.self.moving ? "移动中" : "静止",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Row k="手持" v={obs.self.heldItem || "—"} />
                  <Row k="维度 / 模式" v={`${obs.self.dimension || "—"} / ${obs.self.gameMode || "—"}`} />
                  {(obs.self as any).blocks && (
                    <>
                      <Row k="脚下方块" v={(obs.self as any).blocks.below} />
                      {(obs.self as any).blocks.biome && <Row k="群系" v={(obs.self as any).blocks.biome} />}
                      {(obs.self as any).blocks.lightLevel != null && <Row k="光照" v={String((obs.self as any).blocks.lightLevel)} />}
                    </>
                  )}
                  {obs.self.effects && obs.self.effects.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {obs.self.effects.map((e, i) => (
                        <span
                          key={i}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            e.bad ? "bg-danger/15 text-danger" : "bg-success/15 text-success",
                          )}
                        >
                          {e.name}
                          {e.level > 1 ? ` ${e.level}` : ""}
                          {e.seconds != null ? ` ${e.seconds}s` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted">机器人离线</p>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">周围</h3>
              <div className="space-y-1 text-xs">
                <Row
                  k="敌对生物"
                  v={
                    obs.threats
                      ? `${obs.threats.hostileCount}${
                          obs.threats.nearest
                            ? ` (最近 ${obs.threats.nearest.name} ${obs.threats.nearest.distance}m)`
                            : ""
                        }`
                      : "0"
                  }
                />
                <Row k="附近玩家" v={String(obs.nearbyPlayers.length)} />
                <Row k="附近实体" v={String(obs.nearbyEntities.length)} />
                <Row
                  k="环境"
                  v={
                    obs.environment
                      ? `${obs.environment.timeOfDay}${obs.environment.raining ? " · 雨" : ""}${
                          obs.environment.thundering ? " · 雷" : ""
                        }`
                      : "—"
                  }
                />
                <Row k="背包物品种类" v={String(obs.inventory.length)} />
                {(obs as any).inventorySlots && (
                  <Row k="背包容量" v={`${(obs as any).inventorySlots.used}/${(obs as any).inventorySlots.total} 格`} />
                )}
              </div>
            </Card>
          </div>

          {/* 目标输入 + 一键复制提示词 */}
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">AI 脚本生成</h3>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="描述你想让机器人做什么，例如：先回家，然后每隔 30 秒发一次 /home，血量低于 8 就停止"
              rows={3}
              className="mb-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={!obs} onClick={() => obs && copy(buildPrompt(obs, goal), "AI 提示词")}>
                <Sparkles className="h-3.5 w-3.5" /> 复制 AI 提示词
              </Button>
              <Button size="sm" variant="secondary" disabled={!obs} onClick={() => obs && copy(JSON.stringify(obs, null, 2), "状态 JSON")}>
                <Copy className="h-3.5 w-3.5" /> 仅复制状态
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              复制后粘贴到 Claude / ChatGPT → AI 返回脚本 JSON → 到「脚本」标签粘贴导入运行
            </p>
          </Card>

          {/* 可折叠的完整 JSON */}
          <Card className="p-3">
            <button
              onClick={() => setJsonExpanded(!jsonExpanded)}
              className="flex w-full items-center justify-between text-sm font-semibold transition-colors hover:text-accent"
            >
              <span>完整感知 JSON</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", jsonExpanded && "rotate-180")} />
            </button>
            {jsonExpanded && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2/50 p-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(obs, null, 2)}
              </pre>
            )}
          </Card>

          <p className="text-[11px] leading-relaxed text-muted">
            程序化调用：<code className="text-fg">GET /api/observe/:id</code> 获取感知，<code className="text-fg">POST /api/ai/script/:id</code> 导入脚本。
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
