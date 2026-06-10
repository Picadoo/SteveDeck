import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Copy, Loader2, ChevronDown, Settings2, Wand2, Play, Save } from "lucide-react";
import { Card, Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { copyText } from "@/lib/clipboard";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import type { BotSummary, BotScript, Observation } from "@mcbot/protocol";

// AI 直连走引擎 HTTP（key 存引擎侧不进浏览器；socket ack 8s 超时太短，生成要 20-60s）
function authedFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const { url, token } = useStore.getState().conn;
  return fetch(`${url.replace(/\/+$/, "")}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}
type AiCfg = { baseUrl: string; model: string; hasKey: boolean };

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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [jsonExpanded, setJsonExpanded] = useState(false);

  // AI 直连：配置状态 + 生成流程
  const [aiCfg, setAiCfg] = useState<AiCfg | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgForm, setCfgForm] = useState({ baseUrl: "", model: "", apiKey: "" });
  const [generating, setGenerating] = useState(false);
  const [genScript, setGenScript] = useState<BotScript | null>(null);

  useEffect(() => {
    let alive = true;
    authedFetch("/api/ai/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (alive && c) {
          setAiCfg(c);
          setCfgForm({ baseUrl: c.baseUrl, model: c.model, apiKey: "" });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bot.id]);

  async function saveAiCfg() {
    const r = await authedFetch("/api/ai/config", {
      method: "POST",
      body: JSON.stringify({ baseUrl: cfgForm.baseUrl, model: cfgForm.model, apiKey: cfgForm.apiKey }),
    });
    if (r.ok) {
      const c = (await r.json()) as AiCfg;
      setAiCfg(c);
      setCfgForm((f) => ({ ...f, apiKey: "" }));
      setCfgOpen(false);
      pushToast(c.hasKey ? "AI 配置已保存" : "已保存（还没有 API Key）", c.hasKey ? "success" : "info");
    } else {
      pushToast("保存失败", "error");
    }
  }

  async function generate() {
    if (!aiCfg?.hasKey) {
      setCfgOpen(true);
      pushToast("先配置 API Key（DeepSeek 开放平台申请，几块钱能用很久）", "info");
      return;
    }
    setGenerating(true);
    setGenScript(null);
    try {
      const r = await authedFetch(`/api/ai/generate/${bot.id}`, {
        method: "POST",
        body: JSON.stringify({ goal }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data?.script) {
        setGenScript(data.script as BotScript);
        pushToast(`已生成「${data.script.name}」（${data.script.steps.length} 步）`, "success");
      } else {
        pushToast(data?.error || "生成失败", "error");
      }
    } catch {
      pushToast("生成请求失败（引擎不可达）", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function importGenerated(run: boolean) {
    if (!genScript) return;
    const r = await cmd.script.save(genScript);
    if (!r.ok) return pushToast(r.error || "保存失败", "error");
    if (run) {
      const rr = await cmd.script.start(bot.id, genScript.name);
      pushToast(rr.ok ? `已保存并运行「${genScript.name}」` : (rr.error || "运行失败"), rr.ok ? "success" : "error");
    } else {
      pushToast(`已保存到脚本库「${genScript.name}」`, "success");
    }
    setGenScript(null);
  }

  async function refresh(alive?: () => boolean) {
    setLoading(true);
    setLoadErr(null);
    const r = await cmd.observe(bot.id);
    if (alive && !alive()) return;
    setLoading(false);
    if (r.ok) {
      setObs(r.data as Observation);
    } else {
      setLoadErr(r.error || "获取感知失败"); // 空态显示错误卡+重试
      // 已有旧数据时错误卡不渲染（界面仍显示旧快照）——必须 toast，否则刷新失败完全静默
      if (obs) pushToast(r.error || "刷新感知失败（仍显示旧数据）", "error");
    }
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
    if (await copyText(text)) pushToast(label + "已复制", "success");
    else pushToast("复制失败", "error");
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

      {!obs && loadErr ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-8">
          <span className="text-sm text-danger">{loadErr}</span>
          <Button size="sm" variant="secondary" onClick={() => refresh()}>
            <RefreshCw className="h-3.5 w-3.5" /> 重试
          </Button>
        </Card>
      ) : !obs ? (
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
                  {obs.self.blocks && (
                    <>
                      <Row k="脚下方块" v={obs.self.blocks.below} />
                      {obs.self.blocks.biome && <Row k="群系" v={obs.self.blocks.biome} />}
                      {obs.self.blocks.lightLevel != null && <Row k="光照" v={String(obs.self.blocks.lightLevel)} />}
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
                {obs.inventorySlots && (
                  <Row k="背包容量" v={`${obs.inventorySlots.used}/${obs.inventorySlots.total} 格`} />
                )}
              </div>
            </Card>
          </div>

          {/* 目标输入 + 直连生成 / 复制提示词 */}
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">AI 脚本生成</h3>
              <button
                onClick={() => setCfgOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
                  aiCfg?.hasKey ? "text-success hover:bg-surface-2" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
                title="配置 AI 接口（DeepSeek / 任意 OpenAI 兼容）"
              >
                <Settings2 className="h-3.5 w-3.5" /> {aiCfg?.hasKey ? "已连接 " + (aiCfg?.model || "") : "API 设置"}
              </button>
            </div>

            {cfgOpen && (
              <div className="mb-3 space-y-2 rounded-lg border border-border/60 bg-surface-2/30 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">接口地址（OpenAI 兼容）</span>
                    <Input value={cfgForm.baseUrl} onChange={(e) => setCfgForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.deepseek.com" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">模型</span>
                    <Input value={cfgForm.model} onChange={(e) => setCfgForm((f) => ({ ...f, model: e.target.value }))} placeholder="deepseek-chat" />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">API Key（存在引擎端，浏览器不保存；填 - 清除）</span>
                  <Input type="password" value={cfgForm.apiKey} onChange={(e) => setCfgForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder={aiCfg?.hasKey ? "已保存，留空＝不修改" : "sk-..."} />
                </label>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setCfgOpen(false)}>收起</Button>
                  <Button size="sm" variant="primary" onClick={saveAiCfg}>保存配置</Button>
                </div>
              </div>
            )}

            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="描述你想让机器人做什么，例如：先回家，然后每隔 30 秒发一次 /home，血量低于 8 就停止"
              rows={3}
              className="mb-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={!obs || generating} onClick={generate}>
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {generating ? "生成中（约 20-60 秒）…" : "直接生成"}
              </Button>
              <Button size="sm" variant="secondary" disabled={!obs} onClick={() => obs && copy(buildPrompt(obs, goal), "AI 提示词")}>
                <Sparkles className="h-3.5 w-3.5" /> 复制提示词
              </Button>
              <Button size="sm" variant="ghost" disabled={!obs} onClick={() => obs && copy(JSON.stringify(obs, null, 2), "状态 JSON")}>
                <Copy className="h-3.5 w-3.5" /> 仅复制状态
              </Button>
            </div>

            {genScript && (
              <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium">「{genScript.name}」 · {genScript.steps.length} 步 · 触发 {genScript.trigger?.type ?? "manual"}</span>
                  <button onClick={() => setGenScript(null)} className="text-[11px] text-muted hover:text-fg">丢弃</button>
                </div>
                <pre className="mb-2 max-h-44 overflow-auto rounded bg-surface-2/50 p-2 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(genScript, null, 2)}
                </pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={!bot.online} onClick={() => importGenerated(true)}>
                    <Play className="h-3.5 w-3.5" /> 保存并运行
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => importGenerated(false)}>
                    <Save className="h-3.5 w-3.5" /> 仅保存到脚本库
                  </Button>
                </div>
              </div>
            )}

            <p className="mt-2 text-[11px] text-muted">
              「直接生成」走引擎调用 DeepSeek（或任意 OpenAI 兼容接口），生成后可预览再导入；
              没有 Key 也可以「复制提示词」粘到 Claude / ChatGPT，把返回的 JSON 到「脚本」标签导入。
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
