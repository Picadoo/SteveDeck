import { useEffect, useRef, useState } from "react";
import {
  User,
  Users,
  Send,
  Heart,
  Drumstick,
  MapPin,
  Gamepad2,
  ChevronUp,
  RotateCcw,
  RotateCw,
  Maximize2,
  Play,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import Joystick, { HoldButton } from "@/components/Joystick";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { healthPct } from "@/lib/format";
import { MODULES } from "./moduleDefs";
import { cn } from "@/lib/cn";
import type { BotSummary } from "@mcbot/protocol";

/**
 * 机器人实时视角（同一组件，可内嵌可弹出放大）。看 / 控 / 走三件事彻底分离：
 *  - 第三人称＝自由看：用 prismarine-viewer 原生 OrbitControls 拖动转相机、滚轮缩放，点地面寻路过去。
 *    **不覆盖全屏指针层**，所以转镜头丝滑、不动机器人朝向。
 *  - 第一人称＝转视线：镜头=机器人眼睛，此时才挂全屏拖动层 → 拖动=转机器人 yaw/pitch（转身体即转镜头，自洽）。
 *  - 走动：摇杆 / 跳 / 左右转（control.set / control.turn），与看/转解耦；开走动时关「点地寻路」防误触。
 * 内嵌默认懒启动（按需开渲染服务，省资源）；弹出则自动开。
 */
export default function Viewer({
  bot,
  popout = false,
  autoStart = false,
  frameClass = "h-[46vh]",
  onPopout,
}: {
  bot: BotSummary;
  popout?: boolean;
  autoStart?: boolean;
  frameClass?: string;
  onPopout?: () => void;
}) {
  const connUrl = useStore((s) => s.conn.url);
  const pushToast = useStore((s) => s.pushToast);
  const [started, setStarted] = useState(autoStart);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); // 等待服务端 ack（启动渲染服务）
  const [frameKey, setFrameKey] = useState(0); // iframe 重载键：变更即强制刷新画面（换端口/重载/复用都靠它必触发 onLoad）
  const [frameLoading, setFrameLoading] = useState(false); // iframe 引导中（拿到端口→真正渲染好之间），用覆盖层盖住黑屏
  const [err, setErr] = useState(false);
  const [nonce, setNonce] = useState(0); // 「重试」：自增触发启动 effect 重跑（重启渲染服务）
  // 默认第三人称（仿原版 F5）：看得到机器人本体，自由转镜头
  const [firstPerson, setFirstPerson] = useState(false);
  const [walk, setWalk] = useState(false); // 操控模式：显示摇杆并关掉点地寻路
  const [showMods, setShowMods] = useState(false); // 模块快速开关折叠（默认收起，不挤占视角）
  const [showHelp, setShowHelp] = useState(false); // 操作说明默认收起，点 ? 展开
  const [cmdText, setCmdText] = useState("");
  const lastStates = useRef("");
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // 拖动转向 rAF 合帧：pointermove 在高刷鼠标可达 125-1000Hz，逐事件直发 socket
  // 每次还建一个 8s ack 计时器；改为帧内累加 dx/dy、每帧最多发一次。
  const turnAcc = useRef({ dx: 0, dy: 0, raf: 0 });
  const flushTurn = () => {
    turnAcc.current.raf = 0;
    const { dx, dy } = turnAcc.current;
    if (dx === 0 && dy === 0) return;
    turnAcc.current.dx = 0;
    turnAcc.current.dy = 0;
    cmd.control.turn(bot.id, dx * 0.012, dy * 0.012); // 水平转身体，竖直俯仰
  };
  const stopDrag = () => {
    dragRef.current = null;
    if (turnAcc.current.raf) cancelAnimationFrame(turnAcc.current.raf);
    turnAcc.current = { dx: 0, dy: 0, raf: 0 };
  };
  const startGen = useRef(0); // 本地「代际」：每次启动 effect 自增，过期 ack 直接丢弃

  // 启动 / 切人称：服务端 startViewer 对同一 bot 幂等 + 原地重启（人称变才换端口），
  // 所以这里**不再先 stop 后 start**（那是 UIFEAT-2/3 黑屏的根因：晚到的 stop 拆掉新实例）。
  // 直接调 start，靠本地代际丢弃过期 ack → iframe 必定指向「最后一次 start」的端口。
  // 真正卸载时才 stop（见下方独立 effect），且服务端代际化会忽略被新 start 取代的过期 stop。
  useEffect(() => {
    if (!started) return;
    const gen = ++startGen.current;
    let cancelled = false;
    setLoading(true);
    setErr(false);
    cmd.viewer.start(bot.id, firstPerson).then((r) => {
      // 已卸载，或已被更晚的一次 start 取代 → 丢弃本次结果，避免把 iframe 切回旧端口
      if (cancelled || gen !== startGen.current) return;
      setLoading(false);
      if (r.ok && r.data?.port) {
        const host = connUrl.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
        setUrl(`http://${host}:${r.data.port}`);
        // 盖住「换端口/复用后 iframe 重新引导」的黑屏：升覆盖层，待 iframe onLoad 再揭开。
        // frameKey 自增 → src 必变 → onLoad 必触发（即便服务端复用同端口也不会卡在加载态）。
        setFrameKey((k) => k + 1);
        setFrameLoading(true);
      } else {
        setErr(true); // 不退回占位：保留工具条与「重试」，避免抖动误伤
        setFrameLoading(false);
        pushToast(r.error || "视角启动失败", "error");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, firstPerson, bot.id, nonce]);

  // 仅在组件真正卸载时停视角服务（切人称/重试不触发，避免误杀刚起的实例）。
  // 服务端代际化保证：若卸载的同一瞬间另一个 Viewer（如放大窗口）已对同 bot start，
  // 这条 stop 会被更晚的 start 取代而成为 no-op，不会拆掉新实例。
  useEffect(() => {
    if (!started) return;
    return () => {
      cmd.viewer.stop(bot.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, bot.id]);

  // 卸载时停一切操控，避免机器人继续走
  useEffect(() => {
    return () => {
      cmd.control.stop(bot.id);
    };
  }, [bot.id]);

  // 走动模式时关「点地寻路」（拖动/摇杆不误触发寻路）；非走动恢复
  useEffect(() => {
    if (!started) return;
    cmd.viewer.clickWalk(bot.id, !walk);
  }, [started, walk, bot.id]);

  // 桌面键盘操控：操控模式下 WASD=移动 / 空格=跳 / Shift=疾跑（手机无键盘，无副作用）。
  // 仅在「操控」开启时挂载，避免劫持普通页面按键；输入框内不拦截；卸载清掉所有按住状态。
  useEffect(() => {
    if (!started || !walk) return;
    const MAP: Record<string, string> = {
      w: "forward",
      s: "back",
      a: "left",
      d: "right",
      " ": "jump",
      shift: "sprint",
    };
    const held = new Set<string>();
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const st = MAP[e.key.toLowerCase()];
      if (!st || held.has(st)) return;
      held.add(st);
      e.preventDefault();
      cmd.control.set(bot.id, { [st]: true });
    };
    const up = (e: KeyboardEvent) => {
      const st = MAP[e.key.toLowerCase()];
      if (!st || !held.has(st)) return;
      held.delete(st);
      cmd.control.set(bot.id, { [st]: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (held.size)
        cmd.control.set(bot.id, { forward: false, back: false, left: false, right: false, jump: false, sprint: false });
    };
  }, [started, walk, bot.id]);

  const pos = bot.pos;
  const pct = healthPct(bot);

  function onVector(v: { x: number; y: number }) {
    const dead = 0.28;
    const mag = Math.hypot(v.x, v.y);
    const states = {
      forward: v.y < -dead,
      back: v.y > dead,
      left: v.x < -dead,
      right: v.x > dead,
      sprint: mag > 0.85,
    };
    const key = JSON.stringify(states);
    if (key !== lastStates.current) {
      lastStates.current = key;
      cmd.control.set(bot.id, states);
    }
  }
  async function send() {
    const m = cmdText.trim();
    if (!m) return;
    setCmdText("");
    await cmd.chat(bot.id, m);
  }
  function toggleWalk() {
    const next = !walk;
    setWalk(next);
    if (next) {
      setFirstPerson(true); // 操控=第一人称：走动时镜头跟机器人，不乱晃
    } else {
      setFirstPerson(false); // 退出操控自动回第三人称（绑定对称，不再单向卡在第一人称）
      cmd.control.stop(bot.id); // 收起即停
    }
  }
  // 踩点：取机器人当前精确坐标。录制中→插一条 goto；否则复制坐标（可粘到脚本/地点）
  async function markHere() {
    const r = await cmd.moduleAction<{ x: number; y: number; z: number; recorded: boolean }>(
      bot.id,
      "recording",
      "mark",
    );
    if (!r.ok || !r.data) {
      pushToast(r.error || "获取位置失败", "error");
      return;
    }
    const { x, y, z, recorded } = r.data;
    const coord = `${x}, ${y}, ${z}`;
    if (recorded) {
      pushToast(`已踩点 → ${coord}（已加入录制）`, "success");
    } else {
      try {
        await navigator.clipboard?.writeText(coord);
        pushToast(`已复制当前坐标 ${coord}`, "success");
      } catch {
        pushToast(`当前坐标 ${coord}`, "info");
      }
    }
  }

  // 仅第一人称挂全屏拖动转向层（镜头=机器人视线，拖动=转身体+俯仰）
  const dragTurn = firstPerson;

  if (!started) {
    return (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-2/40 text-muted",
          frameClass,
        )}
      >
        <Button variant="secondary" disabled={!bot.online} onClick={() => setStarted(true)}>
          <Play className="h-4 w-4" /> 开启实时画面
        </Button>
        <p className="px-6 text-center text-[11px] leading-relaxed">
          按需开启（会启动一个轻量渲染服务，不看时关掉省资源）
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={cn("relative w-full overflow-hidden rounded-lg border border-border bg-black", frameClass)}>
        {url ? (
          <iframe
            src={`${url}?k=${frameKey}`}
            onLoad={() => setFrameLoading(false)}
            className="h-full w-full border-0"
            title="bot-view"
            allow="fullscreen"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {loading ? "正在启动视角…" : "未启动"}
          </div>
        )}

        {/* 画面引导覆盖层：盖住换端口/重载/复用时 prismarine 重新拉区块的黑屏，iframe onLoad 后揭开。
            z 低于工具条(z-20)，加载时仍可点人称/放大/重载。 */}
        {url && (loading || frameLoading) && !err && (
          <div className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center gap-2 bg-surface-2/80 text-sm text-muted backdrop-blur-sm">
            <RefreshCw className="h-4 w-4 animate-spin" />
            画面加载中…
          </div>
        )}

        {/* 启动失败覆盖层：不退回占位，原地重试 */}
        {err && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm text-white">
            <span>视角启动失败</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setErr(false);
                setNonce((n) => n + 1);
              }}
            >
              重试
            </Button>
          </div>
        )}

        {/* 坐标 / 状态浮层 */}
        {pos && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2.5 rounded-md bg-black/55 px-2.5 py-1 font-mono text-[11px] text-white shadow">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-emerald-400" />
              {pos.x}, {pos.y}, {pos.z}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3 text-rose-400" />
              {pct ?? "-"}%
            </span>
            <span className="flex items-center gap-1">
              <Drumstick className="h-3 w-3 text-amber-400" />
              {bot.food ?? "-"}
            </span>
          </div>
        )}

        {/* 工具条（右上）：人称切换 + 放大（内嵌时） */}
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
          {/* 驾驶(操控)时人称被绑定为第一人称，隐藏独立切换避免破坏绑定；观察时才可自由切看法 */}
          {!walk && (
            <button
              onClick={() => setFirstPerson((v) => !v)}
              title={firstPerson ? "切第三人称（自由转镜头）" : "切第一人称（机器人视线）"}
              className="flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white transition-colors hover:bg-black/75"
            >
              {firstPerson ? (
                <>
                  <Users className="h-3 w-3" /> 三人称
                </>
              ) : (
                <>
                  <User className="h-3 w-3" /> 一人称
                </>
              )}
            </button>
          )}
          {!popout && onPopout && (
            <button
              onClick={onPopout}
              title="放大"
              className="rounded-md bg-black/55 px-2 py-1 text-white transition-colors hover:bg-black/75"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 第一人称：全屏拖动 = 转机器人视线（yaw + pitch） */}
        {dragTurn && (
          <div
            className="absolute inset-0 z-[5] cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
              dragRef.current = { x: e.clientX, y: e.clientY };
              turnAcc.current.dx += dx;
              turnAcc.current.dy += dy;
              if (!turnAcc.current.raf) turnAcc.current.raf = requestAnimationFrame(flushTurn);
            }}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          />
        )}

        {/* 走动摇杆（角落小控件，pointer-events 仅自身，不挡第三人称 orbit / 第一人称转向） */}
        {walk && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute bottom-3 left-3">
              <Joystick onVector={onVector} />
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col items-center gap-2">
              <HoldButton
                title="跳"
                className="h-12 w-12 rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-sm active:bg-white/30"
                onPress={() => cmd.control.set(bot.id, { jump: true })}
                onRelease={() => cmd.control.set(bot.id, { jump: false })}
              >
                <ChevronUp className="h-6 w-6" />
              </HoldButton>
              <div className="flex gap-2">
                <HoldButton
                  title="左转"
                  className="h-11 w-11 rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-sm active:bg-white/30"
                  onTick={() => cmd.control.turn(bot.id, -0.32)}
                >
                  <RotateCcw className="h-5 w-5" />
                </HoldButton>
                <HoldButton
                  title="右转"
                  className="h-11 w-11 rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-sm active:bg-white/30"
                  onTick={() => cmd.control.turn(bot.id, 0.32)}
                >
                  <RotateCw className="h-5 w-5" />
                </HoldButton>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 控制条：操控 + 踩点 + 重载画面 + 模块快速开关 + 操作说明 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant={walk ? "primary" : "ghost"} onClick={toggleWalk} disabled={!bot.online}>
          <Gamepad2 className="h-3.5 w-3.5" /> {walk ? "停操控" : "操控"}
        </Button>
        <Button size="sm" variant="ghost" onClick={markHere} disabled={!bot.online} title="获取当前位置（踩点）——录制中插入 goto，否则复制坐标">
          <MapPin className="h-3.5 w-3.5 text-emerald-400" /> 踩点
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setFrameLoading(true);
            setFrameKey((k) => k + 1); // 客户端重载 iframe：复位第三人称镜头 / 卡顿花屏时恢复，不重启渲染服务、不影响机器人
          }}
          disabled={!url}
          title="重载画面（复位镜头 / 卡顿花屏时恢复，不影响机器人）"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 重载
        </Button>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => setShowMods((v) => !v)}>
          模块
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMods && "rotate-180")} />
        </Button>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          title="操作说明"
          className={cn(
            "ml-auto flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-colors",
            showHelp ? "border-accent/40 bg-accent/15 text-accent" : "border-border text-muted hover:text-fg",
          )}
        >
          ?
        </button>
      </div>
      {showMods && (
        <div className="flex flex-wrap gap-1.5">
          {MODULES.map((def) => {
            const Icon = def.icon;
            const active = !!bot.modules[def.activeFlag];
            return (
              <button
                key={def.key}
                type="button"
                disabled={!bot.online}
                onClick={() =>
                  cmd.toggleModule(bot.id, def.key, !active).then((r) => {
                    if (!r.ok) pushToast(r.error || "操作失败", "error");
                  })
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                  active
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border bg-surface-2/50 text-muted hover:text-fg",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {def.name}
              </button>
            );
          })}
        </div>
      )}

      {showHelp && (
        <p className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <span className="text-fg">第三人称</span>：拖动转相机（像 F5）、滚轮缩放、点地面寻路过去；
          <span className="text-fg">第一人称</span>：镜头=机器人视线，拖动转视线。开「操控」后：电脑用 <span className="text-fg">WASD / 空格 / Shift</span>、手机用摇杆走动，按住左右转身；退出操控自动回第三人称。
        </p>
      )}

      {/* 弹出放大时：底部全局聊天栏被遮住，这里补一个边看边发指令 */}
      {popout && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2"
        >
          <Input
            value={cmdText}
            onChange={(e) => setCmdText(e.target.value)}
            placeholder="边看边发指令 / 聊天…"
            disabled={!bot.online}
          />
          <Button type="submit" variant="primary" disabled={!bot.online || !cmdText.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
