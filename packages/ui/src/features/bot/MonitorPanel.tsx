import { useEffect, useState } from "react";
import { Plus, Trash2, RotateCcw, Pencil, Radio, FlaskConical, Power, Settings, ChevronDown } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { fmtBig } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MONITOR_PRESETS, instantiatePreset, blankRule } from "./monitorPresets";
import type { MonitorRule, MonitorStat, MonitorKeyStat } from "@mcbot/protocol";

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

export default function MonitorPanel({ botId }: { botId: string }) {
  const stats = useStore((s) => s.monitorStats[botId]) ?? {};
  const pushToast = useStore((s) => s.pushToast);
  const [rules, setRules] = useState<MonitorRule[]>([]);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<MonitorRule | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await cmd.monitor.get(botId);
      if (r.ok && r.data) setRules(r.data.rules || []);
    })();
  }, [botId]);

  async function save(next: MonitorRule[]) {
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
    await cmd.monitor.reset(botId);
    pushToast("统计已重置", "info");
  }

  const enabled = rules.filter((r) => r.enabled);

  return (
    <div className="mb-2 shrink-0 rounded-lg border border-border bg-surface-2/30">
      {/* 折叠头：紧凑统计条 + 配置入口 */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="shrink-0 font-medium">监听统计</span>
          {!open && (
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
        <button
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
          {rules.length === 0 ? (
            <button onClick={() => setManage(true)} className="w-full py-3 text-center text-xs text-muted hover:text-fg">
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
            <Button variant="ghost" onClick={resetStats}>
              <RotateCcw className="h-3.5 w-3.5" /> 重置统计
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
                <button onClick={() => toggle(rule.id)} className={cn("shrink-0", rule.enabled ? "text-success" : "text-muted")} title={rule.enabled ? "停用" : "启用"}>
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
                <button onClick={() => setEditing(rule)} className="shrink-0 rounded p-1 text-muted hover:text-fg" title="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => del(rule.id)} className="shrink-0 rounded p-1 text-muted hover:text-danger" title="删除">
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
            <button
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
              <button
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
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
