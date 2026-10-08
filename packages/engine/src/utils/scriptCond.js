// 脚本条件叶子的解析层（从 script_engine.js 的 evalAtom 抽出）：
// 「文本 → 结构化条件」是纯逻辑（正则边界/空格容错/数值解析），在此单测；
// 「结构化条件 → 真假」需要读 bot 运行时状态，留在 script_engine 的执行侧。
//
// 支持的叶子（与积木编辑器/文档一致）：
//   health<10  food>=6  inventory_full  inventory_has 钻石  inventory_count 圆石>=64
//   players_nearby  no_players_nearby  holding 剑  gui_open  gui_closed
//   gui_has 下一页  gui_slot_has 13 确认  alive  dead  var counter>=5

/** 解析单个条件叶子。返回 { kind, ...参数 }；不认识返回 null（调用方报「未知条件」）。 */
function parseCondAtom(c) {
    c = String(c == null ? '' : c).trim();
    if (!c) return null;
    let m;

    m = c.match(/^health\s*([<>]=?)\s*(\d+\.?\d*)$/);
    if (m) return { kind: 'health', op: m[1], value: parseFloat(m[2]) };

    m = c.match(/^food\s*([<>]=?)\s*(\d+\.?\d*)$/);
    if (m) return { kind: 'food', op: m[1], value: parseFloat(m[2]) };

    if (c === 'inventory_full') return { kind: 'inventory_full' };

    m = c.match(/^inventory_count\s+(.+?)\s*([<>]=?)\s*(\d+)$/);
    if (m) return { kind: 'inventory_count', name: m[1].trim().toLowerCase(), op: m[2], value: parseInt(m[3], 10) };

    m = c.match(/^inventory_has\s+(.+)$/);
    if (m) return { kind: 'inventory_has', name: m[1].trim().toLowerCase() };

    if (c === 'players_nearby') return { kind: 'players_nearby' };
    if (c === 'no_players_nearby') return { kind: 'no_players_nearby' };

    m = c.match(/^holding\s+(.+)$/);
    if (m) return { kind: 'holding', name: m[1].trim().toLowerCase() };

    if (c === 'gui_open') return { kind: 'gui_open' };
    if (c === 'gui_closed') return { kind: 'gui_closed' };

    m = c.match(/^gui_slot_has\s+(\d+)\s+(.+)$/);
    if (m) return { kind: 'gui_slot_has', slot: parseInt(m[1], 10), name: m[2].trim().toLowerCase() };

    m = c.match(/^gui_has\s+(.+)$/);
    if (m) return { kind: 'gui_has', name: m[1].trim() };

    if (c === 'alive') return { kind: 'alive' };
    if (c === 'dead') return { kind: 'dead' };

    m = c.match(/^var\s+(\w+)\s*([<>=!]+)\s*(.+)$/);
    if (m) {
        const raw = m[3].trim();
        // 相等/不等按「字符串形态」宽松比较（"5" 与 5 混比），数值比较用 parseFloat——与执行侧约定一致
        const cmpVal = Number.isNaN(Number(raw)) ? raw : parseFloat(raw);
        return { kind: 'var', name: m[1], op: m[2], value: cmpVal };
    }

    return null;
}

module.exports = { parseCondAtom };
