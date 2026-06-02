// GUI 菜单按钮匹配：脚本按"name/lore 包含关键词 + 槽位范围"定位菜单按钮。
// 纯函数，无 bot 依赖，便于单测。供 script_engine 的 find_and_click_slot / gui 条件复用。

// 提取一个窗口槽位物品的可搜索文本（name + 可选 lore），统一小写、去颜色码。
function slotText(item, matchLore) {
    if (!item) return '';
    let name = item.displayName || item.name || '';
    let lore = [];
    try {
        const disp = item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value;
        if (disp) {
            if (disp.Name && disp.Name.value) name = disp.Name.value;
            if (matchLore && disp.Lore && disp.Lore.value && disp.Lore.value.value) {
                lore = disp.Lore.value.value.map(line => {
                    // 1.12.2 部分 lore 是 JSON 字符串 {"text":"..."}
                    if (typeof line === 'string' && line.startsWith('{"text":')) {
                        try { return JSON.parse(line).text || ''; } catch (e) { return line; }
                    }
                    return String(line);
                });
            }
        }
    } catch (e) { /* 解析失败用基础 name */ }
    const all = matchLore ? [name, ...lore].join(' ') : name;
    return String(all).replace(/§[0-9a-fk-orx]/gi, '').toLowerCase();
}

// 在 slots 数组中找第一个匹配关键词的槽位下标；找不到返回 -1。
// opts: { matchLore, slotFrom, slotTo } 均可选。slotFrom/slotTo 为闭区间，限定搜索范围。
function findMatchingSlot(slots, keyword, opts) {
    if (!Array.isArray(slots)) return -1;
    opts = opts || {};
    const kw = String(keyword == null ? '' : keyword).replace(/§[0-9a-fk-orx]/gi, '').toLowerCase().trim();
    if (!kw) return -1;
    const from = Number.isFinite(opts.slotFrom) ? Math.max(0, opts.slotFrom) : 0;
    const to = Number.isFinite(opts.slotTo) ? Math.min(slots.length - 1, opts.slotTo) : slots.length - 1;
    for (let i = from; i <= to; i++) {
        const t = slotText(slots[i], opts.matchLore);
        if (t && t.includes(kw)) return i;
    }
    return -1;
}

module.exports = { slotText, findMatchingSlot };
