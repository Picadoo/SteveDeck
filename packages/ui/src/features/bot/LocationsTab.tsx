import { useState, type FormEvent } from "react";
import { MapPin, Plus, Navigation, Trash2 } from "lucide-react";
import { Card, Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import type { BotSummary } from "@mcbot/protocol";

export default function LocationsTab({ bot }: { bot: BotSummary }) {
  const [name, setName] = useState("");
  const locs = bot.savedLocations ?? [];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await cmd.moduleAction(bot.id, "location", "save", { name: name.trim() });
    if (r.ok) setName("");
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">保存当前位置（最多 5 个）</h3>
        <form onSubmit={save} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：主世界的家"
            disabled={!bot.online}
          />
          <Button type="submit" variant="primary" disabled={!bot.online || !name.trim()}>
            <Plus className="h-4 w-4" /> 保存
          </Button>
        </form>
      </Card>

      <div className="space-y-2">
        {locs.length === 0 ? (
          <p className="px-1 text-xs text-muted">还没有保存的地点</p>
        ) : (
          locs.map((l) => (
            <Card key={l.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 text-success" />
                <div>
                  <div className="text-sm font-medium">{l.name}</div>
                  <div className="text-[11px] text-muted">
                    {l.x}, {l.y}, {l.z}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!bot.online}
                  onClick={() => cmd.moduleAction(bot.id, "location", "goto", { locationId: l.id })}
                >
                  <Navigation className="h-3.5 w-3.5" /> 前往
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => cmd.moduleAction(bot.id, "location", "delete", { locationId: l.id })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
