import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Card, Switch, Button } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { cmd } from "@/lib/engine";
import { MODULES, defaultConfig, type ModuleDef } from "./moduleDefs";
import ModuleConfigDialog from "./ModuleConfigDialog";
import type { BotSummary } from "@mcbot/protocol";

export default function ModulesTab({ bot }: { bot: BotSummary }) {
  const moduleConfigs = useStore((s) => s.moduleConfigs);
  const setModuleConfig = useStore((s) => s.setModuleConfig);
  const pushToast = useStore((s) => s.pushToast);
  const [editing, setEditing] = useState<ModuleDef | null>(null);

  const isActive = (def: ModuleDef) => !!bot.modules[def.activeFlag];
  const getCfg = (def: ModuleDef) =>
    moduleConfigs[`${bot.id}:${def.key}`] ?? defaultConfig(def);

  function onToggle(def: ModuleDef, active: boolean) {
    const cfg = def.fields.length ? getCfg(def) : undefined;
    cmd.toggleModule(bot.id, def.key, active, cfg).then((r) => {
      if (!r.ok) pushToast(r.error || "操作失败", "error");
    });
  }

  function onSaveConfig(def: ModuleDef, cfg: Record<string, unknown>) {
    setModuleConfig(bot.id, def.key, cfg);
    if (def.applyVia === "config") cmd.configModule(bot.id, def.key, cfg);
    else if (isActive(def)) cmd.toggleModule(bot.id, def.key, true, cfg);
    setEditing(null);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MODULES.map((def) => {
        const Icon = def.icon;
        const active = isActive(def);
        return (
          <Card key={def.key} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{def.name}</div>
                  <div className="text-[11px] text-muted">{def.desc}</div>
                </div>
              </div>
              <Switch checked={active} onChange={(v) => onToggle(def, v)} disabled={!bot.online} />
            </div>
            {def.fields.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-3 w-full"
                onClick={() => setEditing(def)}
              >
                <Settings2 className="h-3.5 w-3.5" /> 配置
              </Button>
            )}
          </Card>
        );
      })}

      {editing && (
        <ModuleConfigDialog
          def={editing}
          open
          initial={getCfg(editing)}
          onClose={() => setEditing(null)}
          onSave={(cfg) => onSaveConfig(editing, cfg)}
        />
      )}
    </div>
  );
}
