import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, RotateCcw, Pencil, Radio, FlaskConical, Power, Settings, ChevronDown, Sparkles } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { useConfirmClick } from "@/lib/useConfirmClick";
import { fmtBig } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MONITOR_PRESETS, instantiatePreset, blankRule } from "./monitorPresets";
import type { MonitorRule, MonitorStat, MonitorKeyStat } from "@mcbot/protocol";
import { hasServerFishingYield, ServerFishingYield, ServerFishingStock } from '@/adapters';

const AGG: { key: MonitorRule["agg"]; label: string; hint: string }[] = [
  { key: "sum", label: "累加", hint: "总收入/总量" },
  { key: "count", label: "计次", hint: "命中次数" },
  { key: "last", label: "取最新", hint: "当前余额" },
  { key: "max", label: "峰值", hint: "最高值" },
  { key: "rate", label: "速率", hint: "每分钟" },
];
const aggLabel = (a: MonitorRule["agg"]) => AGG.find((x) => x.key === a)?.label ?? a;

const fmtVal = (v: number | string | null | undefined): string =>
  v == null ? "—" : typeof v === "number" ? fmtBig(v) : String(v);

/** 一条规则的主数（按聚合方式） */
function mainValue(rule: MonitorRule, st?: MonitorStat): string {
  if (!st || st.count === 0) return "—";
  if (rule.keyGroup && st.byKey) return `${Object.keys(st.byKey).length} 种`; // 分组规则：主数=种类数，细分在下方
  switch (rule.agg) {
    case "count":
      return fmtBig(st.count);
    case "last":
      return fmtVal(st.last);
    case "max":
      return st.max != null ? fmtBig(st.max) : "—";
    case "rate":
      return `${fmtBig(Math.round(st.perMin))}/分`;
    default:
      return fmtBig(st.total);
  }
}
/** 某个分类键桶按聚合方式取展示值 */
function keyValue(rule: MonitorRule, k: MonitorKeyStat): string {
  switch (rule.agg) {
    case "count":
      return fmtBig(k.count);
    case "last":
      return fmtVal(k.last);
    case "max":
      return k.max != null ? fmtBig(k.max) : "—";
    default:
      return fmtBig(k.total);
  }
}
function subText(rule: MonitorRule, st?: MonitorStat): string {
  if (!st || st.count === 0) return "未命中";
  const rate = st.perMin >= 0.1 && (rule.agg === "sum" || rule.agg === "count") ? ` · ${fmtBig(Math.round(st.perMin))}/分` : "";
  return `命中 ${st.count} 次${rate}`;
}
function keyRows(rule: MonitorRule, st?: MonitorStat): [string, MonitorKeyStat][] {
  if (!st?.byKey) return [];
  const num = (k: MonitorKeyStat): number => {
    switch (rule.agg) {
      case "count":
        return k.count;
      case "last":
        return typeof k.last === "number" ? k.last : 0;
      case "max":
        return k.max ?? 0;
      default:
        return k.total;
    }
  };
  return Object.entries(st.byKey).sort((a, b) => num(b[1]) - num(a[1]));
}

export default function MonitorPanel({ botId, fishing = false }: { botId: string; fishing?: boolean }) {
  const bot = useStore((s) => s.bots.find((b) => b.id === botId));
  const stats = useStore((s) => s.monitorStats[botId]) ?? {};
  const setMonitorStats = useStore((s) => s.setMonitorStats);
  const pushToast = useStore((s) => s.pushToast);
  const [rules, setRules] = useState<MonitorRule[]>([]);
  // 规则未加载成功前禁止任何保存：save() 是整表替换，「加载失败/超时 + 空表基础上编辑」
  // 会把引擎侧已有规则整体覆盖丢失（切 bot 后旧列表残留同理）
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<MonitorRule | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);
  const [incomeView, setIncomeView] = useState<"fishing" | "purchase" | "opening" | "other" | "history">("fishing");
  const [valuationBusy, setValuationBusy] = useState(false);

  useEffect(() => {
    setRules([]);
    setRulesLoaded(false);
    setShowAllItems(false);
    setIncomeView("fishing");
    let stale = false;
    (async () => {
      const r = await cmd.monitor.get(botId);
      if (stale) return; // bot 已切换：丢弃过期响应，避免 A 的规则挂在 B 名下
      if (r.ok && r.data) {
        setRules(r.data.rules || []);
        setMonitorStats(botId, r.data.stats || {});
        setRulesLoaded(true);
      } else {
        pushToast(`监听规则加载失败：${r.error || "请求超时"}（编辑已禁用，切回该页重试）`, "error");
      }
    })();
    return () => { stale = true; };
  }, [botId, pushToast, setMonitorStats]);

  async function save(next: MonitorRule[]) {
    if (!rulesLoaded) { pushToast("规则尚未加载成功，禁止保存（防止覆盖引擎侧已有规则）", "error"); return; }
    setRules(next);
    const r = await cmd.monitor.setRules(botId, next);
    if (!r.ok) pushToast(r.error || "保存失败", "error");
  }
  const toggle = (id: string) => save(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const del = (id: string) => save(rules.filter((r) => r.id !== id));
  const upsert = (rule: MonitorRule) => {
    const has = rules.some((r) => r.id === rule.id);
    save(has ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
    setEditing(null);
  };
  function applyPreset(p: (typeof MONITOR_PRESETS)[number]) {
    const existing = new Set(rules.map((r) => r.label));
    const fresh = instantiatePreset(p).filter((r) => !existing.has(r.label));
    save([...rules, ...fresh]);
    setShowPresets(false);
    pushToast(`已应用预设「${p.name}」（新增 ${fresh.length} 条）`, fresh.length ? "success" : "info");
  }
  async function resetStats() {
    const r = await cmd.monitor.reset(botId);
    pushToast(r.ok ? "统计已重置" : (r.error || "重置失败"), r.ok ? "info" : "error");
  }
  // 两段式确认：累计数据一键清零不可恢复，第一次点变「确认?」，2.5s 内再点才执行
  const resetHeader = useConfirmClick(resetStats);
  const resetDialog = useConfirmClick(resetStats);

  const enabled = rules.filter((r) => r.enabled);
  const lootRule = fishing ? enabled.find((r) => stats[r.id]?.fishingIncome || stats[r.id]?.fishingValuation) : undefined;
  const loot = lootRule ? stats[lootRule.id] : undefined;
  const income = loot?.fishingIncome;
  const valuation = loot?.fishingValuation;
  const customYield = !!loot?.fishingYield && hasServerFishingYield(bot);
  const refreshValuation = async () => {
    setValuationBusy(true);
    try {
      const r = await cmd.moduleAction<{ requested: boolean }>(botId, "monitor", "refreshValuation");
      pushToast(r.ok ? (r.data?.requested ? "正在读取鱼库，完成后自动更新估值" : "后台任务运行中，请稍后刷新") : r.error || "请求失败", r.ok ? "info" : "error");
    } finally { setValuationBusy(false); }
  };
  const incomeBucket = incomeView === "history" ? income?.history : income?.totals[incomeView];
  const lootRows: [string, MonitorKeyStat][] = incomeBucket
    ? Object.entries(incomeBucket.byName).sort((a, b) => b[1] - a[1]).map(([name, total]) => [name, { total, count: total, last: total, max: total }])
    : lootRule ? keyRows(lootRule, loot) : [];
  const fishKinds = income ? Object.keys(income.totals.fishing.byName).length : lootRows.length;
  const hintCount = stats["fishing-80-grid-hint"]?.count ?? 0;

  return (
    <div className="mb-2 shrink-0 rounded-lg border border-border bg-surface-2/30">
      {/* 折叠头：紧凑统计条 + 配置入口 */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="shrink-0 font-medium">{fishing ? "钓鱼收获" : "监听统计"}</span>
          {lootRule ? (
            <span className="flex min-w-0 flex-wrap gap-x-2 text-muted">
              <span><b className="text-fg">{fmtBig(income?.totals.fishing.total ?? loot?.total ?? 0)}</b> 件</span>
              <span>{fishKinds}{!income && fishKinds >= 30 ? "+" : ""} 种</span>
              <span>{(income?.recentPerMin ?? loot?.perMin ?? 0).toFixed(1)}/分{income && " · 近10分钟"}</span>
              {customYield && <ServerFishingYield bot={bot} report={loot?.fishingYield} compact />}
              {valuation && <span className="text-accent" title={`${valuation.totalValue.toLocaleString('zh-CN')} 游戏币`}>库存估值 {fmtBig(valuation.totalValue)}</span>}
              {hintCount > 0 && <span className="text-warning">距离限制提示 {hintCount} 次</span>}
            </span>
          ) : !open && (
            <span className="flex min-w-0 items-center gap-2 overflow-hidden text-muted">
              {enabled.length === 0 ? (
                <span className="text-muted/70">未配置</span>
              ) : (
                enabled.slice(0, 5).map((r) => (
                  <span key={r.id} className="shrink-0 whitespace-nowrap">
                    {r.label} <span className="font-semibold text-fg">{mainValue(r, stats[r.id])}</span>
                  </span>
                ))
              )}
            </span>
          )}
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {enabled.length > 0 && (
          <button type="button"
            onClick={resetHeader.onClick}
            className={cn(
              "shrink-0 rounded p-1 transition-colors",
              resetHeader.arming ? "bg-danger/15 text-danger" : "text-muted hover:bg-surface hover:text-fg",
            )}
            title={resetHeader.arming ? "再点一次确认清零" : "清零统计数值"}
          >
            {resetHeader.arming ? <span className="px-0.5 text-[10px] font-medium">确认?</span> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        )}
        <button type="button"
          onClick={() => setManage(true)}
          className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-fg"
          title="配置监听规则"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 展开：完整统计卡（含分类键细分） */}
      {open && (
        <div className="space-y-1.5 border-t border-border px-2.5 py-2">
          {lootRule ? (
            <div>
              {income && <div className="mb-2 rounded-md bg-surface-2/50 px-2 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>鱼获仓库 <b className="text-accent">{valuation ? fmtBig(valuation.warehouseValue) : '待读取'}</b></span>
                  <span>鱼篓 <b className="text-accent">{valuation ? fmtBig(valuation.basketValue) : '待读取'}</b></span>
                  <span>合计 <b>{valuation ? fmtBig(valuation.totalValue) : '—'}</b> 游戏币</span>
                  <button type="button" disabled={valuationBusy} onClick={refreshValuation} className="ml-auto text-[11px] text-accent disabled:opacity-50">{valuationBusy ? '请求中…' : '刷新估值'}</button>
                </div>
                <div className="mt-1 text-[10px] text-muted">{valuation?.policyLabel || '估值规则由服务器适配提供'}{valuation
                  ? ` · ${new Date(valuation.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}${valuation.canEstimate ? ' 快照＋新增鱼获估算' : ' 库存快照'}${valuation.unpricedNames.length ? ` · 未定价 ${valuation.unpricedNames.length} 种` : ''}${valuation.error ? ` · ${valuation.error}` : ''}`
                  : ' · 等待程序读取真实库存'}</div>
                <ServerFishingStock bot={bot} report={valuation} />
                {valuation && <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-accent">查看库存估值明细</summary>
                  <div className="mt-1 overflow-x-auto"><table className="w-full text-right text-[11px] tabular-nums">
                    <thead className="text-muted"><tr><th className="text-left font-normal">鱼种</th><th className="font-normal">仓库数量</th><th className="font-normal">鱼篓数量</th><th className="font-normal">单价</th><th className="font-normal">估值</th></tr></thead>
                    <tbody>{valuation.items.map(item => <tr key={item.name}><td className="text-left">{item.name}</td><td>{item.warehouseCount.toLocaleString('zh-CN')}</td><td>{item.basketCount.toLocaleString('zh-CN')}</td><td>{item.unit?.toLocaleString('zh-CN') ?? '未定价'}</td><td>{item.value?.toLocaleString('zh-CN') ?? '—'}</td></tr>)}</tbody>
                    <tfoot><tr><td className="text-left" colSpan={4}>合计</td><td className="font-semibold text-accent">{valuation.totalValue.toLocaleString('zh-CN')}</td></tr></tfoot>
                  </table></div>
                </details>}
              </div>}
              {income && <div className="mb-2 flex flex-wrap gap-1">
                {([['fishing', '鱼获'], ['purchase', '采购/合成'], ['opening', '开箱'], ['other', '其他'], ['history', '旧入账']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => { setIncomeView(key); setShowAllItems(false); }}
                    className={cn("rounded px-2 py-1 text-[11px]", incomeView === key ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface")}>{label} {fmtBig(key === 'history' ? income.history.total : income.totals[key].total)}</button>
                ))}
              </div>}
              {customYield && incomeView === 'fishing' ? <ServerFishingYield bot={bot} report={loot?.fishingYield} />
                : lootRows.length === 0 ? <div className="py-1 text-xs text-muted">等待系统掉落回执</div> : (
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 text-xs">
                  {lootRows.slice(0, showAllItems ? lootRows.length : 8).map(([name, stat]) => (
                    <div key={name} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 break-words text-muted">{name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">×{keyValue(lootRule, stat)}</span>
                    </div>
                  ))}
                </div>
              )}
              {!(customYield && incomeView === 'fishing') && lootRows.length > 8 && <button type="button" onClick={() => setShowAllItems((v) => !v)} className="mt-1 text-[11px] text-accent">
                {showAllItems ? "收起" : `展开其他 ${lootRows.length - 8} 种`}
              </button>}
              <div className="mt-1 text-[10px] text-muted">{income
                ? `分类自 ${new Date(income.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 起 · 近10分钟鱼获 ${income.recentItems} 件${income.windowMinutes < 10 ? '（不足10分钟按实际时长）' : ''} · 鱼逃脱 ${income.serverEscapes} 次（服务器机制）${incomeView === 'history' ? ' · 旧记录来源未分类，完整保留' : ''}`
                : '按系统掉落累计 · 速率为累计平均 · 不按背包变化计数'}</div>
            </div>
          ) : rules.length === 0 ? (
            <button type="button" onClick={() => setManage(true)} className="w-full py-3 text-center text-xs text-muted hover:text-fg">
              还没有监听规则，点此配置 →
            </button>
          ) : (
            rules.map((rule) => {
              const st = stats[rule.id];
              const krows = keyRows(rule, st);
              return (
                <div key={rule.id} className={cn("rounded-md bg-surface-2/50 px-2.5 py-1.5", !rule.enabled && "opacity-40")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs">
                      {rule.label}
                      <Badge tone="neutral">{aggLabel(rule.agg)}</Badge>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-sm font-semibold tabular-nums">{mainValue(rule, st)}</span>
                      <span className="ml-1.5 text-[10px] text-muted">{subText(rule, st)}</span>
                    </span>
                  </div>
                  {krows.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      {krows.slice(0, 8).map(([k, v]) => (
                        <span key={k} className="whitespace-nowrap">
                          {k} <span className="font-medium text-fg">{keyValue(rule, v)}</span>
                        </span>
                      ))}
                      {krows.length > 8 && <span>…+{krows.length - 8}</span>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 配置弹窗：规则增删改 + 预设 + 重置 */}
      <Modal
        open={manage}
        onClose={() => setManage(false)}
        title="监听规则配置"
        size="lg"
        footer={
          <>
            <Button
              variant={resetDialog.arming ? "danger" : "ghost"}
              onClick={resetDialog.onClick}
            >
              <RotateCcw className="h-3.5 w-3.5" /> {resetDialog.arming ? "确认重置?" : "重置统计"}
            </Button>
            <Button variant="secondary" onClick={() => setShowPresets(true)}>
              预设
            </Button>
            <Button variant="primary" onClick={() => setEditing(blankRule())}>
              <Plus className="h-3.5 w-3.5" /> 新建规则
            </Button>
          </>
        }
      >
        {rules.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">
            还没有规则，点「预设」一键导入，或「新建规则」手动添加
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map((rule) => (
              <div key={rule.id} className={cn("flex items-center gap-2 rounded-lg bg-surface-2/50 px-2.5 py-2", !rule.enabled && "opacity-50")}>
                <button type="button" onClick={() => toggle(rule.id)} className={cn("shrink-0", rule.enabled ? "text-success" : "text-muted")} title={rule.enabled ? "停用" : "启用"}>
                  <Power className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{rule.label || "(未命名)"}</span>
                    <Badge tone="neutral">{aggLabel(rule.agg)}</Badge>
                    {rule.keyGroup ? <Badge tone="accent">分组</Badge> : null}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted/70">/{rule.pattern}/</div>
                </div>
                <button type="button" onClick={() => setEditing(rule)} className="shrink-0 rounded p-1 text-muted hover:text-fg" title="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => del(rule.id)} className="shrink-0 rounded p-1 text-muted hover:text-danger" title="删除">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {editing && <RuleEditor botId={botId} rule={editing} onSave={upsert} onClose={() => setEditing(null)} />}

      <Modal open={showPresets} onClose={() => setShowPresets(false)} title="选择预设">
        <div className="space-y-2">
          {MONITOR_PRESETS.map((p) => (
            <button type="button"
              key={p.name}
              onClick={() => applyPreset(p)}
              className="w-full rounded-lg border border-border bg-surface-2/50 p-3 text-left transition-colors hover:border-accent hover:bg-accent/10"
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="mt-0.5 text-[11px] text-muted">{p.rules.map((r) => r.label).join(" · ")}</div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ===== 通用「消息→规则」助手：粘一条消息，点数字=要统计的值、点词=按它分类，自动生成正则规则。 =====
// 不针对任何服务器：纯靠用户标注 + 文本结构生成。这样不会写正则的人也能在任意服务器搓出自己的统计（含按材料分类计数）。
type Tok = { type: "num" | "word" | "sep"; text: string };
function tokenize(msg: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?[万亿兆]?)|([一-龥]+|[A-Za-z]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    if (m.index > last) out.push({ type: "sep", text: msg.slice(last, m.index) });
    out.push({ type: m[1] ? "num" : "word", text: m[0] });
    last = re.lastIndex;
  }
  if (last < msg.length) out.push({ type: "sep", text: msg.slice(last) });
  return out;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sepToRe = (s: string) => s.replace(/(\s+)|(\S+)/g, (_m, ws, nw) => (ws ? "\\s*" : escapeRe(nw)));
function buildRule(toks: Tok[], valueIdx: number, keyIdx: number) {
  let pattern = "";
  let grp = 0;
  let valueGroup = 1;
  let keyGroup = 0;
  toks.forEach((t, i) => {
    if (i === valueIdx) {
      grp++;
      valueGroup = grp;
      pattern += "([\\d,]+(?:\\.\\d+)?\\s*[万亿兆]?)";
    } else if (i === keyIdx) {
      grp++;
      keyGroup = grp;
      pattern += "(.+?)";
    } else if (t.type === "num") {
      pattern += "\\d[\\d,]*";
    } else if (t.type === "sep") {
      pattern += sepToRe(t.text);
    } else {
      pattern += escapeRe(t.text);
    }
  });
  return { pattern, valueGroup, keyGroup };
}

function RuleFromMessage({
  onApply,
}: {
  onApply: (p: { pattern: string; valueGroup: number; keyGroup: number; agg: MonitorRule["agg"] }) => void;
}) {
  const [msg, setMsg] = useState("");
  const [valueIdx, setValueIdx] = useState(-1);
  const [keyIdx, setKeyIdx] = useState(-1);
  const toks = useMemo(() => tokenize(msg), [msg]);
  useEffect(() => {
    setValueIdx(-1);
    setKeyIdx(-1);
  }, [msg]);

  function apply() {
    if (valueIdx < 0) return;
    const { pattern, valueGroup, keyGroup } = buildRule(toks, valueIdx, keyIdx);
    // 余额/当前类→取最新；否则累加
    const before = toks.slice(Math.max(0, valueIdx - 3), valueIdx).map((t) => t.text).join("");
    const agg: MonitorRule["agg"] = /当前|现有|剩余|余额|拥有|共有|还有/.test(before) ? "last" : "sum";
    onApply({ pattern, valueGroup, keyGroup, agg });
  }

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent">
        <Sparkles className="h-3.5 w-3.5" /> 从消息生成（不会写正则也能用）
      </div>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        rows={2}
        placeholder="粘一条游戏里的消息，如：已存入 天秤座灵息X3, 当前 473 个"
        className="w-full resize-none rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-accent/50"
      />
      {toks.some((t) => t.type !== "sep") && (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-1 rounded bg-surface-2/50 p-1.5 text-xs">
            {toks.map((t, i) =>
              t.type === "sep" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: token 身份就是下标（选中态 keyIdx/valueIdx 也按下标存）
                <span key={i} className="whitespace-pre text-muted">{t.text}</span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: token 身份就是下标（选中态 keyIdx/valueIdx 也按下标存）
                <button key={i}
                  type="button"
                  onClick={() =>
                    t.type === "num" ? setValueIdx((v) => (v === i ? -1 : i)) : setKeyIdx((k) => (k === i ? -1 : i))
                  }
                  className={cn(
                    "rounded px-1 transition-colors",
                    i === valueIdx
                      ? "bg-success/25 text-success ring-1 ring-success/50"
                      : i === keyIdx
                        ? "bg-accent/25 text-accent ring-1 ring-accent/50"
                        : t.type === "num"
                          ? "bg-surface hover:bg-success/15"
                          : "bg-surface hover:bg-accent/15",
                  )}
                >
                  {t.text}
                </button>
              ),
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] leading-tight text-muted">
              点<span className="text-success">数字</span>=要统计的值 · 点<span className="text-accent">词</span>=按它分类（材料多种）
            </span>
            <Button size="sm" variant="secondary" disabled={valueIdx < 0} onClick={apply}>
              生成规则
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function RuleEditor({
  botId,
  rule,
  onSave,
  onClose,
}: {
  botId: string;
  rule: MonitorRule;
  onSave: (r: MonitorRule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MonitorRule>(rule);
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<MonitorRule>) => setDraft((d) => ({ ...d, ...patch }));

  async function runTest() {
    const r = await cmd.monitor.test(botId, draft.pattern, draft.valueGroup || 1, draft.numberMode, sample);
    if (!r.ok || !r.data) setResult({ ok: false, text: r.error || "测试失败" });
    else if (r.data.error) setResult({ ok: false, text: r.data.error });
    else if (!r.data.matched) setResult({ ok: false, text: "未命中" });
    else setResult({ ok: true, text: `命中 · 值捕获="${r.data.group}"${draft.numberMode ? ` → 数值 ${r.data.value}` : ""}` });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rule.label ? "编辑规则" : "新建规则"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!draft.label.trim() || !draft.pattern.trim()} onClick={() => onSave(draft)}>保存</Button>
        </>
      }
    >
      <div className="space-y-3">
        <RuleFromMessage
          onApply={(p) =>
            set({
              pattern: p.pattern,
              valueGroup: p.valueGroup,
              keyGroup: p.keyGroup || undefined,
              numberMode: true,
              agg: p.agg,
            })
          }
        />
        <Field label="名称">
          <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="如：金币收入" />
        </Field>
        <Field label="正则（对去色码纯文本匹配，可含多个捕获组）">
          <Input
            value={draft.pattern}
            onChange={(e) => set({ pattern: e.target.value })}
            placeholder="已存入\s*(.+?)X(\d+)"
            className="font-mono text-xs"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-4">
          <Field label="值捕获组">
            <NumIn value={draft.valueGroup ?? 1} min={1} onChange={(v) => set({ valueGroup: v })} />
          </Field>
          <Field label="分组键组（0=不分组）">
            <NumIn value={draft.keyGroup ?? 0} min={0} onChange={(v) => set({ keyGroup: v || undefined })} />
          </Field>
          <label className="flex cursor-pointer items-center gap-1.5 pt-5 text-sm">
            <input type="checkbox" checked={draft.numberMode} onChange={(e) => set({ numberMode: e.target.checked })} className="h-4 w-4 accent-accent" />
            解析为数字（认 万/亿/兆）
          </label>
        </div>
        <p className="-mt-1 text-[11px] text-muted">
          分组键：把某个捕获组当「物品名」等分类，按它各自累计。如「已存入 (物品)X(数量)」设 分组键=1、值=2，就能分物品统计。
        </p>
        <Field label="聚合方式">
          <div className="flex flex-wrap gap-1">
            {AGG.map((a) => (
              <button type="button"
                key={a.key}
                onClick={() => set({ agg: a.key })}
                title={a.hint}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                  draft.agg === a.key ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-fg",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="rounded-lg border border-border bg-surface-2/40 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <FlaskConical className="h-3.5 w-3.5" /> 测试匹配（粘一条服务器消息，§ 色码自动忽略）
          </div>
          <div className="flex gap-1.5">
            <Input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="已存入 §f§b梦魇营长残障§7X3, 当前 8706 个" className="flex-1 text-xs" />
            <Button size="sm" variant="secondary" onClick={runTest} disabled={!draft.pattern.trim() || !sample.trim()}>测试</Button>
          </div>
          {result && <div className={cn("mt-1.5 text-xs", result.ok ? "text-success" : "text-danger")}>{result.text}</div>}
        </div>
      </div>
    </Modal>
  );
}

function NumIn({ value, min, onChange }: { value: number; min: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children 即控件，包裹式关联在运行时成立（点标题可聚焦控件）
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
