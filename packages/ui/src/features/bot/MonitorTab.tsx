import { useEffect, useState } from "react";
import { Plus, Trash2, RotateCcw, Pencil, Radio, FlaskConical, Power } from "lucide-react";
import { Card, Button, Badge, Input } from "@/components/ui/primitives";
import Modal from "@/components/ui/Modal";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { fmtBig } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MONITOR_PRESETS, instantiatePreset, blankRule } from "./monitorPresets";
import type { BotSummary, MonitorRule, MonitorStat } from "@mcbot/protocol";

const AGG: { key: MonitorRule["agg"]; label: string; hint: string }[] = [
  { key: "sum", label: "累加", hint: "总收入/总量" },
  { key: "count", label: "计次", hint: "命中次数" },
  { key: "last", label: "取最新", hint: "当前余额" },
  { key: "max", label: "峰值", hint: "最高值" },
  { key: "rate", label: "速率", hint: "每分钟" },
];
const aggLabel = (a: MonitorRule["agg"]) => AGG.find((x) => x.key === a)?.label ?? a;

/** 把一条规则的统计转成主数 + 说明 */
function statView(rule: MonitorRule, st?: MonitorStat): { main: string; sub: string; dim: boolean } {
  if (!st || st.count === 0) return { main: "—", sub: "未命中", dim: true };
  const rate = st.perMin >= 0.1 ? ` · ${fmtBig(Math.round(st.perMin))}/分` : "";
  switch (rule.agg) {
    case "count":
      return { main: fmtBig(st.count), sub: `次${rate}`, dim: false };
    case "last":
      return {
        main: typeof st.last === "number" ? fmtBig(st.last) : String(st.last ?? "—"),
        sub: `命中 ${st.count} 次`,
        dim: false,
      };
    case "max":
      return { main: st.max != null ? fmtBig(st.max) : "—", sub: `命中 ${st.count} 次`, dim: false };
    case "rate":
      return { main: `${fmtBig(Math.round(st.perMin))}/分`, sub: `命中 ${st.count} 次`, dim: false };
    default: // sum
      return { main: fmtBig(st.total), sub: `命中 ${st.count} 次${rate}`, dim: false };
  }
}

export default function MonitorTab({ bot }: { bot: BotSummary }) {
  const stats = useStore((s) => s.monitorStats[bot.id]) ?? {};
  const pushToast = useStore((s) => s.pushToast);
  const [rules, setRules] = useState<MonitorRule[]>([]);
  const [editing, setEditing] = useState<MonitorRule | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await cmd.monitor.get(bot.id);
      if (r.ok && r.data) setRules(r.data.rules || []);
    })();
  }, [bot.id]);

  async function save(next: MonitorRule[]) {
    setRules(next);
    const r = await cmd.monitor.setRules(bot.id, next);
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
    await cmd.monitor.reset(bot.id);
    pushToast("统计已重置", "info");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Radio className="h-3.5 w-3.5 text-accent" />
          正则匹配服务器消息做统计（金币/经验/掉落…），每服可定制
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={resetStats} title="重置统计（保留规则）">
            <RotateCcw className="h-3.5 w-3.5" /> 重置
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowPresets(true)}>
            预设
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing(blankRule())}>
            <Plus className="h-3.5 w-3.5" /> 规则
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center text-muted">
          <Radio className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">还没有监听规则</p>
          <p className="mt-1 text-xs">点「预设」一键导入，或「规则」手动添加</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const v = statView(rule, stats[rule.id]);
            return (
              <Card key={rule.id} className={cn("p-3", !rule.enabled && "opacity-50")}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      onClick={() => toggle(rule.id)}
                      title={rule.enabled ? "已启用（点击停用）" : "已停用（点击启用）"}
                      className={cn(
                        "shrink-0 rounded p-1",
                        rule.enabled ? "text-success" : "text-muted",
                      )}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{rule.label || "(未命名)"}</span>
                        <Badge tone="neutral">{aggLabel(rule.agg)}</Badge>
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted/70">/{rule.pattern}/</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <div className={cn("text-base font-semibold tabular-nums", v.dim ? "text-muted" : "text-fg")}>
                        {v.main}
                      </div>
                      <div className="text-[10px] text-muted">{v.sub}</div>
                    </div>
                    <button onClick={() => setEditing(rule)} title="编辑" className="rounded p-1 text-muted hover:text-fg">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => del(rule.id)} title="删除" className="rounded p-1 text-muted hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <RuleEditor botId={bot.id} rule={editing} onSave={upsert} onClose={() => setEditing(null)} />
      )}

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
    else
      setResult({
        ok: true,
        text: `命中 · 捕获="${r.data.group}"${draft.numberMode ? ` → 数值 ${r.data.value}` : ""}`,
      });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rule.label ? "编辑规则" : "新建规则"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!draft.label.trim() || !draft.pattern.trim()} onClick={() => onSave(draft)}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="名称">
          <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="如：金币收入" />
        </Field>
        <Field label="正则（对去色码纯文本匹配，含一个捕获组=值）">
          <Input
            value={draft.pattern}
            onChange={(e) => set({ pattern: e.target.value })}
            placeholder="你增加了\s*([\d,\.]+)\s*金币"
            className="font-mono text-xs"
          />
        </Field>
        <div className="flex items-center gap-4">
          <Field label="捕获组">
            <input
              type="number"
              min={1}
              value={draft.valueGroup ?? 1}
              onChange={(e) => set({ valueGroup: Math.max(1, Number(e.target.value) || 1) })}
              className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-accent/50"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-1.5 pt-5 text-sm">
            <input
              type="checkbox"
              checked={draft.numberMode}
              onChange={(e) => set({ numberMode: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            解析为数字（认 万/亿/兆）
          </label>
        </div>
        <Field label="聚合方式">
          <div className="flex flex-wrap gap-1">
            {AGG.map((a) => (
              <button
                key={a.key}
                onClick={() => set({ agg: a.key })}
                title={a.hint}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                  draft.agg === a.key
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-muted hover:text-fg",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        {/* 测试匹配 */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <FlaskConical className="h-3.5 w-3.5" /> 测试匹配（粘一条服务器消息，§ 色码会自动忽略）
          </div>
          <div className="flex gap-1.5">
            <Input
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              placeholder="你增加了 §610 §b金币"
              className="flex-1 text-xs"
            />
            <Button size="sm" variant="secondary" onClick={runTest} disabled={!draft.pattern.trim() || !sample.trim()}>
              测试
            </Button>
          </div>
          {result && (
            <div className={cn("mt-1.5 text-xs", result.ok ? "text-success" : "text-danger")}>{result.text}</div>
          )}
        </div>
      </div>
    </Modal>
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
