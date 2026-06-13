// AI 直连脚本生成：引擎代理调用 OpenAI 兼容接口（默认 DeepSeek），
// 把「世界感知 + 脚本规范 + 用户目标」组装成提示词 → 拿回脚本 JSON → 校验后返回。
// 走引擎而非前端直调的原因：apiKey 只落引擎数据目录（不进浏览器 localStorage / 不暴露给网页端）、
// 没有 CORS 问题、提示词与感知组装在同一进程零拷贝。
import * as fs from "fs";
import { dataPath } from "../config/paths";
import { buildObservation } from "./observe";
import { SCRIPT_SPEC, SCRIPT_DO_TYPES, compactObservation } from "@mcbot/protocol";

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

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** 调一次 OpenAI 兼容 chat/completions，返回首条文本内容（失败 throw 中文消息）。 */
async function callModel(cfg: AiConfig, messages: ChatMsg[]): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let resp: Response;
  try {
    resp = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
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
  return content;
}

/** 容错解析模型输出为脚本对象；不合形状 throw。 */
function parseScript(content: string): any {
  // response_format 下应是裸 JSON；万一带了代码栅栏/前后缀，截取首个 { 到末个 }
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

const KNOWN_DOS = new Set<string>(SCRIPT_DO_TYPES);
const CONTAINER_KEYS = ["steps", "then", "else"] as const;

/** 递归收集脚本里所有不在白名单内的 do 类型（模型幻觉的重灾区）。 */
function collectUnknownDos(steps: any[], bad = new Set<string>()): Set<string> {
  if (!Array.isArray(steps)) return bad;
  for (const st of steps) {
    if (!st || typeof st !== "object") continue;
    if (typeof st.do === "string" && st.do && !KNOWN_DOS.has(st.do)) bad.add(st.do);
    for (const k of CONTAINER_KEYS) if (Array.isArray(st[k])) collectUnknownDos(st[k], bad);
  }
  return bad;
}

/** 把非法 do 的步骤标记 disabled（引擎跳过禁用步骤），保留给用户看而不是悄悄删掉。 */
function disableUnknownSteps(steps: any[]): void {
  if (!Array.isArray(steps)) return;
  for (const st of steps) {
    if (!st || typeof st !== "object") continue;
    if (typeof st.do === "string" && st.do && !KNOWN_DOS.has(st.do)) st.disabled = true;
    for (const k of CONTAINER_KEYS) if (Array.isArray(st[k])) disableUnknownSteps(st[k]);
  }
}

const KNOWN_TRIGGERS = new Set([
  "manual", "interval", "schedule", "chat_match", "health_below", "food_below",
  "mob_nearby", "damage", "respawn", "player_nearby", "inventory_full",
]);

export interface GenerateResult {
  script: any;
  /** 非空时表示生成结果有瑕疵（已自动处理），UI 提示用户复查 */
  warnings: string[];
}

/** 调 OpenAI 兼容接口生成脚本。成功返回 {script, warnings}；失败 throw（带可读中文消息）。 */
export async function generateScript(botId: string, goal: string): Promise<GenerateResult> {
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
  // 紧凑版感知进 prompt：完整版有装备耐久/朝向/操作日志等写脚本用不上的字段，徒耗 token
  const user = [
    "# 当前世界状态",
    JSON.stringify(compactObservation(obs)),
    "",
    "# 我的目标",
    goal.trim() || "（用户没写目标——生成一个原地待命并定时报告状态的脚本）",
  ].join("\n");

  const messages: ChatMsg[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let content = await callModel(cfg, messages);
  let script = parseScript(content);

  // 步骤白名单校验：模型编出不存在的 do → 带着错误清单重试一轮；仍不合规则禁用问题步骤并告警
  let unknown = collectUnknownDos(script.steps);
  if (unknown.size > 0) {
    const retryMsg =
      `你的脚本用了不存在的动作类型：${[...unknown].join("、")}。` +
      `只能使用规范里列出的 do 类型，请改用等价的合法动作，重新输出完整的脚本 JSON（不要解释）。`;
    try {
      content = await callModel(cfg, [
        ...messages,
        { role: "assistant", content },
        { role: "user", content: retryMsg },
      ]);
      const retried = parseScript(content);
      const stillBad = collectUnknownDos(retried.steps);
      if (stillBad.size < unknown.size) {
        script = retried;
        unknown = stillBad;
      }
    } catch {
      /* 重试失败就用第一轮结果走禁用兜底 */
    }
  }
  const warnings: string[] = [];
  if (unknown.size > 0) {
    disableUnknownSteps(script.steps);
    warnings.push(`含不存在的动作（已自动禁用）：${[...unknown].join("、")}`);
  }
  if (script.trigger?.type && !KNOWN_TRIGGERS.has(String(script.trigger.type))) {
    warnings.push(`触发器类型「${script.trigger.type}」不存在，已改为手动触发`);
    script.trigger = { type: "manual" };
  }
  return { script, warnings };
}

// ==================== Agent 闭环 ====================
// 生成 → 自动运行 → 等待 → 重新观测 → 评估 → 修正，最多 maxRounds 轮。
// 通过 onProgress 回调实时推送进度给前端（SSE / socket 均可接）。

const logger = require("../utils/logger");

export interface AgentProgress {
  round: number;
  maxRounds: number;
  phase: "generate" | "run" | "wait" | "observe" | "evaluate" | "done" | "error";
  message: string;
  script?: any;
  evaluation?: string;
}

export async function runAgent(
  botId: string,
  goal: string,
  opts: { maxRounds?: number; waitSec?: number; onProgress?: (p: AgentProgress) => void },
): Promise<{ script: any; rounds: number; evaluation: string; warnings: string[] }> {
  const maxRounds = Math.min(opts.maxRounds ?? 3, 5);
  const waitSec = Math.min(opts.waitSec ?? 15, 60);
  const emit = opts.onProgress ?? (() => {});
  const cfg = loadAiConfig();
  if (!cfg.apiKey) throw new Error("未配置 AI API Key（AI 标签 → API 设置）");

  const inst = (require("../botManager") as any).botManager.getInstance(botId);
  if (!inst?.bot?.entity) throw new Error("机器人不在线");

  const systemPrompt = [
    "你是 Minecraft 挂机机器人的脚本助手。你有能力：生成脚本、执行后观测结果、根据结果修正。",
    "只输出 JSON 对象，不要解释。",
    "",
    "# 脚本规范",
    SCRIPT_SPEC,
    "",
    "# 规则",
    "- name 用简短中文描述目标",
    "- 坐标/物品名/实体名必须取自世界状态里真实存在的值，不要编造",
    "- 偏保守：宁可少步骤，不要做破坏性操作",
  ].join("\n");

  const history: ChatMsg[] = [{ role: "system", content: systemPrompt }];
  let currentScript: any = null;
  let warnings: string[] = [];
  let lastEval = "";

  for (let round = 1; round <= maxRounds; round++) {
    // 1. 感知当前状态
    emit({ round, maxRounds, phase: "observe", message: `第 ${round} 轮：感知世界状态…` });
    const obs = buildObservation(botId);
    if (!obs) throw new Error("机器人不存在");
    const compact = compactObservation(obs);

    // 2. 生成/修正脚本
    emit({ round, maxRounds, phase: "generate", message: round === 1 ? "生成脚本…" : "根据执行结果修正脚本…" });
    const userMsg = round === 1
      ? `# 当前世界状态\n${JSON.stringify(compact)}\n\n# 我的目标\n${goal}`
      : `# 执行后的世界状态\n${JSON.stringify(compact)}\n\n请分析脚本执行效果，判断是否达成目标「${goal}」。\n如果已达成，输出 {"done": true, "evaluation": "达成理由"}。\n如果未达成或需要修正，输出修正后的完整脚本 JSON（不要 done 字段）。`;

    history.push({ role: "user", content: userMsg });
    const content = await callModel(cfg, history);
    history.push({ role: "assistant", content });

    // 检查是否 AI 认为已完成
    try {
      const parsed = JSON.parse(content);
      if (parsed.done) {
        lastEval = String(parsed.evaluation || "AI 认为目标已达成");
        emit({ round, maxRounds, phase: "done", message: lastEval, script: currentScript, evaluation: lastEval });
        return { script: currentScript, rounds: round, evaluation: lastEval, warnings };
      }
    } catch { /* not a done response, continue */ }

    // 解析为脚本
    try {
      currentScript = parseScript(content);
      const unknown = collectUnknownDos(currentScript.steps);
      if (unknown.size > 0) {
        disableUnknownSteps(currentScript.steps);
        warnings.push(`第 ${round} 轮：含不存在的动作（已禁用）：${[...unknown].join("、")}`);
      }
    } catch (e: any) {
      emit({ round, maxRounds, phase: "error", message: `脚本解析失败：${e.message}` });
      if (currentScript) break; // 用上一轮的
      throw e;
    }

    emit({ round, maxRounds, phase: "run", message: `运行脚本「${currentScript.name}」…`, script: currentScript });

    // 3. 保存并运行脚本
    try {
      if (inst.stopScript) inst.stopScript();
      if (inst.saveScript) inst.saveScript(currentScript, true);
      if (inst.startScript) inst.startScript(currentScript.name);
    } catch (e: any) {
      logger.warn(`[AI Agent] 运行脚本失败: ${e?.message}`);
    }

    // 最后一轮不等待（没有下一轮观测了）
    if (round === maxRounds) {
      lastEval = "已达到最大轮次，最终脚本已在运行";
      emit({ round, maxRounds, phase: "done", message: lastEval, script: currentScript, evaluation: lastEval });
      break;
    }

    // 4. 等待脚本执行
    emit({ round, maxRounds, phase: "wait", message: `等待 ${waitSec} 秒观察效果…` });
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }

  return { script: currentScript, rounds: maxRounds, evaluation: lastEval, warnings };
}
