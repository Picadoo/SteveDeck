// MC 风格物品悬浮框（深紫底）：名字+数量 / 附魔 / lore / 物品id。
// 此前同一套 JSX 在 整理面板、物品行、GUI 窗口 各拷一份，改样式要改三处。
// 容器定位方式各不相同（锚定格子 / 跟随光标 / 固定），所以只共享「内容体 + 容器样式类」。
import McText from "@/components/McText";

/** 悬浮框容器的公共外观类（调用方自行拼定位/层级/尺寸类） */
export const MC_TIP_CLASS =
  "rounded border border-[#34106b] bg-[#100016]/95 px-2.5 py-2 shadow-xl";

export interface McItemTipData {
  /** 展示名（可带 § 色码），回退物品 id */
  name: string;
  count?: number | null;
  enchants?: string[] | null;
  lore?: string | null;
  texture?: string | null;
  /** 传了就在底部显示槽位号（整理面板用） */
  slot?: number | null;
}

export function McItemTipBody({ name, count, enchants, lore, texture, slot }: McItemTipData) {
  return (
    <>
      <div className="text-sm font-semibold leading-snug">
        <McText text={name} onDark />
        {count && count > 1 ? (
          <span className="ml-1 text-[11px] font-normal text-white/50">×{count}</span>
        ) : null}
      </div>
      {enchants && enchants.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {enchants.map((e, i) => (
            <div key={i} className="text-[11px] text-[#9d8bff]">
              {e}
            </div>
          ))}
        </div>
      )}
      {lore && (
        <div className="mt-1 whitespace-pre-line text-[11px] leading-snug text-white/75">
          <McText text={lore} onDark />
        </div>
      )}
      {texture && (
        <div className="mt-1.5 text-[10px] text-white/30">
          minecraft:{texture}
          {slot != null ? ` · #${slot}` : ""}
        </div>
      )}
    </>
  );
}
