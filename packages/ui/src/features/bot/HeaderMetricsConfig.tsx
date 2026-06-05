import Modal from "@/components/ui/Modal";
import { Switch } from "@/components/ui/primitives";
import McText from "@/components/McText";
import { BUILTINS, detectFromScoreboard, type HeaderCfg, type BuiltinId } from "@/lib/headerMetrics";

/** 顶栏指标配置：内置开关 + 从计分板勾选要钉的数字。改动通过 onChange 即时回传（上层负责存 localStorage）。 */
export default function HeaderMetricsConfig({
  open,
  onClose,
  cfg,
  onChange,
  scoreboardLines,
}: {
  open: boolean;
  onClose: () => void;
  cfg: HeaderCfg;
  onChange: (cfg: HeaderCfg) => void;
  scoreboardLines: string[];
}) {
  if (!open) return null;
  const detected = detectFromScoreboard(scoreboardLines);
  const isPinned = (key: string) => cfg.pinned.some((p) => p.labelKey === key);
  const toggleBuiltin = (id: BuiltinId) =>
    onChange({ ...cfg, builtins: { ...cfg.builtins, [id]: !cfg.builtins[id] } });
  const togglePin = (d: { labelKey: string; label: string }) => {
    const pinned = isPinned(d.labelKey)
      ? cfg.pinned.filter((p) => p.labelKey !== d.labelKey)
      : [...cfg.pinned, { labelKey: d.labelKey, label: d.label }];
    onChange({ ...cfg, pinned });
  };

  return (
    <Modal open={open} onClose={onClose} title="顶栏指标配置" size="md">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">内置</div>
          <div className="grid grid-cols-2 gap-2">
            {BUILTINS.map((b) => {
              const Icon = b.icon;
              return (
                <label
                  key={b.id}
                  className="flex items-center justify-between rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-muted" />
                    {b.label}
                  </span>
                  <Switch checked={cfg.builtins[b.id]} onChange={() => toggleBuiltin(b.id)} />
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">计分板（勾选要钉到顶栏的数字，随计分板实时更新）</div>
          {detected.length === 0 ? (
            <p className="rounded-lg bg-surface-2/40 px-3 py-3 text-xs text-muted">
              未检测到含数字的计分板行。需机器人在线、且该服务器有侧边栏计分板（金币/战力等）。
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {detected.map((d) => (
                <label
                  key={d.labelKey}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-sm hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={isPinned(d.labelKey)}
                    onChange={() => togglePin(d)}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <McText text={d.clean} />
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {d.label}={d.value}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-muted">
          配置按<span className="text-fg">服务器</span>独立保存，不同服互不影响。钉住的是「标签」，金币涨了顶栏跟着变；该行消失则显示「—」。
        </p>
      </div>
    </Modal>
  );
}
