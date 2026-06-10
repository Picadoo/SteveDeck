// AI 直连脚本生成：引擎代理调用 OpenAI 兼容接口（默认 DeepSeek），
// 把「世界感知 + 脚本规范 + 用户目标」组装成提示词 → 拿回脚本 JSON → 校验形状后返回。
// 走引擎而非前端直调的原因：apiKey 只落引擎数据目录（不进浏览器 localStorage / 不暴露给网页端）、
// 没有 CORS 问题、提示词与感知组装在同一进程零拷贝。
import * as fs from "fs";
import { dataPath } from "../config/paths";
import { buildObservation } from "./observe";

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const FILE = dataPath("ai-config.json");
const DEFAULTS: Omit<AiConfig, "apiKey"> = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
};

export function loadAiConfig(): AiConfig {
  try {
    if (fs.existsSync(FILE)) {
      const v = JSON.parse(fs.readFileSync(FILE, "utf8"));
      return {
        baseUrl: String(v.baseUrl || DEFAULTS.baseUrl),
        model: String(v.model || DEFAULTS.model),
        apiKey: String(v.apiKey || ""),
      };
    }
  } catch {
    /* 损坏当未配置 */
  }
  return { ...DEFAULTS, apiKey: "" };
}

export function saveAiConfig(patch: Partial<AiConfig>): AiConfig {
  const cur = loadAiConfig();
  const next: AiConfig = {
    baseUrl: (patch.baseUrl ?? cur.baseUrl).trim() || DEFAULTS.baseUrl,
    model: (patch.model ?? cur.model).trim() || DEFAULTS.model,
    // apiKey 传空串 = 不修改；传 "-" = 清除
    apiKey: patch.apiKey === "-" ? "" : patch.apiKey ? patch.apiKey.trim() : cur.apiKey,
  };
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

const SCRIPT_SPEC = `脚本格式：
{ "name":"...", "loop":false, "trigger":{"type":"manual"}, "steps":[ {"do":"chat","msg":"hi"}, {"do":"wait","s":2} ] }
可用 do：chat(msg) cmd(cmd) whisper(player,msg) wait(s) log(msg) goto(x,y,z) return_home equip(item) equip_best_weapon drop(item,count) use_item attack(entity) jump swap_hands look(x,y,z) if(cond,steps) repeat(times,steps) while(cond,steps) run_script(name) stop set_var(name,value) math_var(name,op,value)
可用 trigger.type：manual interval(value=秒) schedule(value=HH:MM) chat_match(value=关键词) health_below(value=数) respawn player_nearby inventory_full
条件(cond)示例："health < 10"、"inventory_has diamond"、"players_nearby"、"no_players_nearby"`;

/** 调 OpenAI 兼容接口生成脚本。成功返回脚本对象；失败 throw（带可读中文消息）。 */
export async function generateScript(botId: string, goal: string): Promise<any> {
  const cfg = loadAiConfig();
  if (!cfg.apiKey) throw new Error("未配置 AI API Key（AI 标签 → API 设置）");
  const obs = buildObservation(botId);
  if (!obs) throw new Error("机器人不存在");

  const system = [
    "你是 Minecraft 挂机机器人的脚本生成器。根据用户目标和机器人当前世界状态，生成一个可直接执行的脚本。",
    "只输出一个 JSON 对象（脚本本体），不要解释、不要 markdown 代码块。",
    "",
    "# 脚本规范",
    SCRIPT_SPEC,
    "",
    "# 注意",
    "- name 用简短中文描述目标",
    "- 坐标/物品名/实体名必须取自世界状态里真实存在的值，不要编造",
    "- 不确定时偏保守：宁可少步骤，不要做破坏性操作（丢贵重物品/攻击玩家）",
  ].join("\n");
  const user = [
    "# 当前世界状态",
    JSON.stringify(obs),
    "",
    "# 我的目标",
    goal.trim() || "（用户没写目标——生成一个原地待命并定时报告状态的脚本）",
  ].join("\n");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let resp: Response;
  try {
    resp = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    throw new Error(e?.name === "AbortError" ? "AI 接口超时（90 秒）" : `AI 接口不可达: ${e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    if (resp.status === 401) throw new Error("API Key 无效（401）");
    if (resp.status === 402) throw new Error("API 余额不足（402）");
    throw new Error(`AI 接口错误 ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await resp.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "");
  if (!content) throw new Error("AI 返回为空");

  // 容错解析：response_format 下应是裸 JSON；万一带了代码栅栏/前后缀，截取首个 { 到末个 }
  let script: any;
  try {
    script = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI 返回的不是 JSON");
    script = JSON.parse(m[0]);
  }
  // 有些模型会包一层 { "script": {...} }
  if (script && !script.steps && script.script?.steps) script = script.script;
  if (!script || typeof script.name !== "string" || !Array.isArray(script.steps)) {
    throw new Error("AI 返回的脚本缺 name/steps，已拒绝");
  }
  if (!script.trigger || typeof script.trigger !== "object") script.trigger = { type: "manual" };
  return script;
}
