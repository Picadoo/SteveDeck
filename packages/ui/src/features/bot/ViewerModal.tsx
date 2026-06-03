import { useEffect, useRef, useState } from "react";
import { User, Users, Send, Heart, Drumstick, MapPin, Gamepad2, ChevronUp, RotateCcw, RotateCw } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Input } from "@/components/ui/primitives";
import Joystick, { HoldButton } from "@/components/Joystick";
import { cmd } from "@/lib/engine";
import { useStore } from "@/store/useStore";
import { healthPct } from "@/lib/format";
import { MODULES } from "./moduleDefs";
import { cn } from "@/lib/cn";
import type { BotSummary } from "@mcbot/protocol";

/** 机器人实时视角：第三/第一人称 + 坐标浮层 + 虚拟摇杆操控 + 模块快速开关 + 边看边发指令 */
export default function ViewerModal({
  bot,
  open,
  onClose,
}: {
  bot: BotSummary;
  open: boolean;
  onClose: () => void;
}) {
  const connUrl = useStore((s) => s.conn.url);
  const pushToast = useStore((s) => s.pushToast);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 默认第三人称（仿原版 F5）：拖动画面转视角、看得到机器人本体；切第一人称则镜头=机器人视线
  const [firstPerson, setFirstPerson] = useState(false);
  const [controls, setControls] = useState(false);
  const [cmdText, setCmdText] = useState("");
  const lastStates = useRef("");
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    cmd.viewer.start(bot.id, firstPerson).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok && r.data?.port) {
        const host = connUrl.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
        setUrl(`http://${host}:${r.data.port}?fp=${firstPerson ? 1 : 0}`);
      } else {
        pushToast(r.error || "视角启动失败", "error");
      }
    });
    return () => {
      cancelled = true;
      cmd.viewer.stop(bot.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bot.id, firstPerson]);

  // 关闭视角时停止一切操控，避免机器人继续走
  useEffect(() => {
    if (!open) return;
    return () => {
      cmd.control.stop(bot.id);
    };
  }, [open, bot.id]);

  // 操控模式开启时禁用「点击地面走路」，这样第三人称里能放心拖动画面转视角
  useEffect(() => {
    if (!open) return;
    cmd.viewer.clickWalk(bot.id, !controls);
  }, [open, controls, bot.id]);

  const pos = bot.pos;
  const pct = healthPct(bot);

  async function send() {
    const m = cmdText.trim();
    if (!m) return;
    setCmdText("");
    await cmd.chat(bot.id, m);
  }
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
  function toggleControls() {
    setControls((v) => {
      if (v) cmd.control.stop(bot.id); // 收起即停
      return !v;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${bot.username} · 实时视角`}
      footer={
        <>
          <Button variant={controls ? "primary" : "ghost"} onClick={toggleControls}>
            <Gamepad2 className="h-3.5 w-3.5" /> {controls ? "隐藏操控" : "操控"}
          </Button>
          <Button variant="ghost" onClick={() => setFirstPerson((v) => !v)}>
            {firstPerson ? (
              <>
                <Users className="h-3.5 w-3.5" /> 第三人称
              </>
            ) : (
              <>
                <User className="h-3.5 w-3.5" /> 第一人称
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      <div className="relative h-[52vh] w-full overflow-hidden rounded-lg border border-border bg-black">
        {url ? (
          <iframe src={url} className="h-full w-full border-0" title="bot-view" allow="fullscreen" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {loading ? "正在启动视角…" : "未启动"}
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

        {/* 拖动转向层（操控模式）：在画面上拖动=转机器人朝向，相机随之转（解决"转向机械"） */}
        {controls && (
          <div
            className="absolute inset-0 z-[5] cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              if (Math.abs(dx) < 1) return;
              dragRef.current = { x: e.clientX, y: e.clientY };
              cmd.control.turn(bot.id, dx * 0.012, 0); // 水平拖动→转身体；F5 俯角固定，竖直忽略
            }}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
          />
        )}

        {/* 虚拟摇杆操控层（手机端式）：摇杆走动 + 跳 + 左右转 */}
        {controls && (
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

      {/* 模块快速开关：所有模块，边看边切 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
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

      {/* 边看边发指令 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="mt-2 flex gap-2"
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
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        <span className="text-fg">第三人称</span>：<span className="text-fg">拖动画面</span>转视角（像原版 F5）、滚轮缩放；
        <span className="text-fg">第一人称</span>则镜头=机器人视线。
        开「操控」后<span className="text-fg">点击不再走路</span>（方便拖视角），用摇杆走、方向键转身体；关操控时可点地面寻路过去。关闭即停。
      </p>
    </Modal>
  );
}
