import { Socket } from "socket.io";
import { ClientCommands } from "@mcbot/protocol";
import { botManager } from "../botManager";
import { Ack, ok, fail } from "./ack";

/** 脚本库为全局（单主人）。运行/停止作用于指定机器人实例。 */
export function registerScriptHandlers(socket: Socket): void {
  socket.on(ClientCommands.SCRIPT_LIST, (payload: { id?: string } = {}, ack?: Ack) => {
    const lib = botManager.loadScripts();
    const inst = payload?.id ? botManager.getInstance(payload.id) : undefined;
    const running: string | null = inst?._runningScript?.name || null;
    const list = Object.entries(lib).map(([name, s]: [string, any]) => ({
      name,
      trigger: s.trigger || { type: "manual" },
      loop: !!s.loop,
      server: s.server,
      stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
      running: running === name,
    }));
    ack?.(ok(list));
  });

  socket.on(ClientCommands.SCRIPT_DETAIL, ({ name }: { name: string }, ack?: Ack) => {
    const lib = botManager.loadScripts();
    ack?.(ok(lib[name] ?? null));
  });

  socket.on(ClientCommands.SCRIPT_SAVE, ({ script }: { script: any }, ack?: Ack) => {
    if (!script || !script.name || !Array.isArray(script.steps)) {
      return ack?.(fail("脚本格式不正确（需 name 与 steps 数组）"));
    }
    const lib = botManager.loadScripts();
    lib[script.name] = script;
    botManager.saveScripts(lib);
    botManager.eachInstance((inst) => inst.preloadScripts && inst.preloadScripts(lib));
    ack?.(ok());
  });

  socket.on(ClientCommands.SCRIPT_DELETE, ({ name }: { name: string }, ack?: Ack) => {
    const lib = botManager.loadScripts();
    delete lib[name];
    botManager.saveScripts(lib);
    botManager.eachInstance((inst) => {
      if (inst.deleteScript) inst.deleteScript(name);
      if (inst.preloadScripts) inst.preloadScripts(lib);
    });
    ack?.(ok());
  });

  socket.on(ClientCommands.SCRIPT_START, ({ id, name }: { id: string; name: string }, ack?: Ack) => {
    const inst = botManager.getInstance(id);
    if (!inst || !inst.startScript) return ack?.(fail("机器人需在线才能运行脚本"));
    const lib = botManager.loadScripts();
    if (!lib[name]) return ack?.(fail(`脚本不存在: ${name}`));
    try {
      if (inst.preloadScripts) inst.preloadScripts(lib);
      inst.startScript(name);
      ack?.(ok());
    } catch (e: any) {
      ack?.(fail(String(e?.message ?? e)));
    }
  });

  socket.on(ClientCommands.SCRIPT_STOP, ({ id }: { id: string }, ack?: Ack) => {
    const inst = botManager.getInstance(id);
    if (inst?.stopScript) inst.stopScript();
    ack?.(ok());
  });
}
