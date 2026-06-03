import { useEffect, useState } from "react";
import { Play, Square, Save, Trash2, FileCode2, AlertTriangle, Pin } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { cn } from "@/lib/cn";
import type { BotSummary } from "@mcbot/protocol";

const SAMPLE = `// 可用：api, bot, log, sleep, chat, Vec3, require
// 示例：报告状态 → 回城 → 绕个圈
log("坐标 " + JSON.stringify(api.pos()));
chat("/spawn");
await sleep(2000);
for (let i = 0; i < 4 && !api.stopped; i++) {
  const p = api.pos();
  await api.goto(p.x + 5, p.y, p.z, 1);
  log("到达拐角 " + (i + 1));
}
log("完成");`;

export default function CustomJsPanel({ bot }: { bot: BotSummary }) {
  const pushToast = useStore((s) => s.pushToast);
  const [list, setList] = useState<{ name: string; pinned: boolean; updatedAt: number | null }[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState(SAMPLE);

  const running = !!bot.modules.script && bot.modules.script.startsWith("JS:");
  const runningName = running ? bot.modules.script!.slice(3) : null;

  async function refresh() {
    const r = await cmd.js.list(bot.id);
    if (r.ok && Array.isArray(r.data)) setList(r.data);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  async function load(n: string) {
    const r = await cmd.js.get(bot.id, n);
    if (r.ok && r.data) {
      setName(r.data.name);
      setCode(r.data.code);
    }
  }
  async function save() {
    if (!name.trim()) return pushToast("请填写脚本名", "error");
    const r = await cmd.js.save(bot.id, name.trim(), code);
    if (r.ok) {
      pushToast("已保存", "success");
      refresh();
    } else pushToast(r.error || "保存失败", "error");
  }
  async function run() {
    const r = await cmd.js.run(bot.id, name.trim() || "临时脚本", code);
    if (!r.ok) pushToast(r.error || "运行失败", "error");
  }
  async function stop() {
    await cmd.js.stop(bot.id);
  }
  async function del(n: string) {
    await cmd.js.del(bot.id, n);
    if (n === name) setName("");
    refresh();
  }
  async function togglePin(n: string, pinned: boolean) {
    const r = await cmd.js.pin(bot.id, n, pinned);
    if (r.ok) {
      refresh();
      pushToast(pinned ? "已置顶到模块页" : "已取消置顶", "success");
    } else pushToast(r.error || "操作失败", "error");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-2.5 text-[11px] text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>自定义 JS 在引擎主机上以完整权限执行，只运行你信任的代码。共享部署可设 ENGINE_ALLOW_JS=0 关闭。</span>
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => (
            <span
              key={s.name}
              className="group flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
            >
              <button onClick={() => load(s.name)} className="flex items-center gap-1 hover:text-accent">
                <FileCode2 className="h-3 w-3" /> {s.name}
              </button>
              <button onClick={() => togglePin(s.name, !s.pinned)} title={s.pinned ? "取消置顶" : "置顶到模块页一键开关"}>
                <Pin className={cn("h-3 w-3", s.pinned ? "fill-accent text-accent" : "text-muted opacity-50 hover:opacity-100")} />
              </button>
              <button onClick={() => del(s.name)} title="删除">
                <Trash2 className="h-3 w-3 text-danger opacity-50 hover:opacity-100" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="脚本名（用于保存/运行）" />
        <Button size="sm" variant="secondary" onClick={save}>
          <Save className="h-3.5 w-3.5" /> 保存
        </Button>
        {running ? (
          <Button size="sm" variant="secondary" onClick={stop}>
            <Square className="h-3.5 w-3.5" /> 停止
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!bot.online} onClick={run}>
            <Play className="h-3.5 w-3.5" /> 运行
          </Button>
        )}
      </div>

      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="h-72 w-full resize-y rounded-lg border border-border bg-surface-2/50 p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent"
        placeholder="// JavaScript…（可 await）"
      />

      {running && (
        <p className="text-[11px] text-success">
          运行中：{runningName} · 输出见「日志」/概览「最近动态」
        </p>
      )}

      <details className="rounded-lg border border-border p-3 text-xs">
        <summary className="cursor-pointer font-medium">可用 API 文档</summary>
        <div className="mt-2 grid gap-1 text-muted sm:grid-cols-2">
          <Doc k="bot" v="原始 mineflayer 实例（完整能力）" />
          <Doc k="log(...args)" v="输出到日志 / 最近动态" />
          <Doc k="chat(msg)" v="发送聊天 / 命令" />
          <Doc k="await sleep(ms)" v="等待毫秒（≤600s）" />
          <Doc k="api.stopped" v="是否被停止（循环里判断）" />
          <Doc k="api.pos()" v="当前坐标 Vec3" />
          <Doc k="api.health()" v="{ health, food }" />
          <Doc k="await api.goto(x,y,z,range?)" v="寻路前往" />
          <Doc k="await api.openContainer(x,y,z)" v="打开容器，返回窗口" />
          <Doc k="await api.clickSlot(slot,btn?,mode?)" v="点击当前窗口槽位" />
          <Doc k="api.closeWindow()" v="关闭窗口" />
          <Doc k="api.observe()" v="完整感知快照" />
          <Doc k="Vec3 / require / api.mineflayer" v="可直接使用" />
        </div>
      </details>
    </div>
  );
}

function Doc({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <code className="rounded bg-surface-2 px-1 text-fg">{k}</code> — {v}
    </div>
  );
}
