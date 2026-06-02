import { useEffect, useState, type FormEvent } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { Card, Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import type { BotSummary, Schedule } from "@mcbot/protocol";

export default function SchedulerTab({ bot }: { bot: BotSummary }) {
  const [list, setList] = useState<Schedule[]>([]);
  const [time, setTime] = useState("");
  const [command, setCommand] = useState("");

  async function refresh() {
    const r = await cmd.moduleAction<Schedule[]>(bot.id, "scheduler", "list");
    if (r.ok && Array.isArray(r.data)) setList(r.data);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!time || !command.trim()) return;
    const r = await cmd.moduleAction<Schedule[]>(bot.id, "scheduler", "add", {
      schedule: { time, command: command.trim() },
    });
    if (r.ok && Array.isArray(r.data)) {
      setList(r.data);
      setCommand("");
    }
  }
  async function remove(i: number) {
    const r = await cmd.moduleAction<Schedule[]>(bot.id, "scheduler", "remove", { index: i });
    if (r.ok && Array.isArray(r.data)) setList(r.data);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">添加定时任务</h3>
        <form onSubmit={add} className="flex gap-2">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="到点执行的命令，如 /home"
          />
          <Button type="submit" variant="primary" disabled={!time || !command.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        <p className="mt-2 text-[11px] text-muted">到达设定时刻后自动发送该命令（机器人需在线）</p>
      </Card>

      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="px-1 text-xs text-muted">还没有定时任务</p>
        ) : (
          list.map((s, i) => (
            <Card key={i} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-accent" />
                <div>
                  <div className="font-mono text-sm font-medium">{s.time}</div>
                  <div className="text-[11px] text-muted">{s.command}</div>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
