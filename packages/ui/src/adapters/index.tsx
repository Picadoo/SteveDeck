// UI 扩展装配入口；通用页面只按服务端声明的适配能力渲染。
import type { BotSummary, LogLine, MonitorStat } from '@mcbot/protocol';
import type { ModuleDef } from '@/features/bot/moduleDefs';
import type { ComponentType } from 'react';

export interface ServerUiAdapter {
  id: string;
  Menu?: ComponentType<{ bot: BotSummary }>;
  menuHint?: string;
  FishingStockPanel?: ComponentType<{ report: NonNullable<MonitorStat['fishingValuation']> }>;
  FishingYieldPanel?: ComponentType<{ report: NonNullable<MonitorStat['fishingYield']> }>;
  FishingYieldSummary?: ComponentType<{ report: NonNullable<MonitorStat['fishingYield']> }>;
  fishingLogLines?: (logs: LogLine[], username: string, detail: boolean) => LogLine[];
  fishingOptions?: { value: string; label: string }[];
  fishingHint?: string;
}
const adapters = new Map<string, ServerUiAdapter>();
export function registerServerUiAdapter(extension: ServerUiAdapter) {
  if (!extension.id || adapters.has(extension.id)) throw Error('Invalid or duplicate server UI adapter');
  adapters.set(extension.id, extension);
}
function adapter(bot?: BotSummary) { return adapters.get(bot?.serverAdapter?.id || '') || null; }
export function ServerMenu({ bot }: { bot: BotSummary }) {
  const extension = adapter(bot);
  return extension?.Menu && bot.serverAdapter?.menu ? <extension.Menu key={bot.id} bot={bot} /> : null;
}
export function serverMenuHint(bot: BotSummary) { return adapter(bot)?.menuHint || ''; }
export function ServerFishingStock({ bot, report }: { bot?: BotSummary; report?: MonitorStat['fishingValuation'] }) {
  const extension = adapter(bot);
  return extension?.FishingStockPanel && report ? <extension.FishingStockPanel report={report} /> : null;
}
export function hasServerFishingYield(bot?: BotSummary) { return !!adapter(bot)?.FishingYieldPanel; }
export function ServerFishingYield({ bot, report, compact = false }: { bot?: BotSummary; report?: MonitorStat['fishingYield']; compact?: boolean }) {
  const extension = adapter(bot);
  if (!extension || !report) return null;
  if (compact && extension.FishingYieldSummary) return <extension.FishingYieldSummary report={report} />;
  return extension.FishingYieldPanel ? <extension.FishingYieldPanel report={report} /> : null;
}
export function serverFishingLogs(bot: BotSummary | undefined, logs: LogLine[], detail: boolean) {
  return adapter(bot)?.fishingLogLines?.(logs, bot?.username || '', detail) || logs;
}
export function serverModuleDefs(bot: BotSummary, defs: ModuleDef[]): ModuleDef[] {
  const extension = adapter(bot);
  return !extension?.fishingOptions ? defs : defs.map(def => def.key === 'fishing' ? { ...def, fields: def.fields.map(field => field.key === 'mode'
    ? { ...field, options: extension.fishingOptions, hint: extension.fishingHint } : field) } : def);
}
