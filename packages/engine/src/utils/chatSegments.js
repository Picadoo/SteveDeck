// 可点击 / 可悬浮聊天解析（从 BotInstance.js 抽出的纯函数，便于单测）：
// 把聊天 JSON 组件树展平成片段：每片段带文字 + 样式 + 可选 click(点→执行命令/开链接) / hover(悬浮→展示物品/文字)。

/** 递归拼出组件树的纯文本（不带样式）。 */
function flattenChatText(c) {
    if (c == null) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(flattenChatText).join('');
    let s = c.text != null ? String(c.text) : '';
    if (Array.isArray(c.extra)) s += c.extra.map(flattenChatText).join('');
    return s;
}

/** hoverEvent → 简短悬浮文案：show_item 提取物品 id，其余展平为纯文本（去 §色码）。取不到返回 undefined。 */
function extractHoverText(h) {
    if (!h) return undefined;
    try {
        const action = h.action || '';
        const val = h.contents != null ? h.contents : h.value;
        if (action === 'show_item') {
            const s = (val && typeof val === 'object') ? (val.id || JSON.stringify(val)) : String(val || '');
            const m = s.match(/(?:minecraft:)?([a-z_]{3,})/i);
            return m ? `[物品] ${m[1]}` : '[物品]';
        }
        if (val == null) return undefined;
        const flat = (typeof val === 'string' ? val : flattenChatText(val)).replace(/§./gi, '').trim();
        return flat || undefined;
    } catch (_e) { return undefined; }
}

/** 深度优先展平组件树：样式/click/hover 沿 extra 向下继承，产出片段列表（上限 150 防恶意超深树）。 */
function extractChatSegments(node, inherited, out) {
    if (node == null || out.length > 150) return;
    if (typeof node === 'string') { if (node) out.push({ text: node, ...inherited }); return; }
    const ce = node.clickEvent || node.click_event;
    const he = node.hoverEvent || node.hover_event;
    const style = {
        color: node.color || inherited.color,
        bold: node.bold != null ? !!node.bold : inherited.bold,
        italic: node.italic != null ? !!node.italic : inherited.italic,
        underlined: node.underlined != null ? !!node.underlined : inherited.underlined,
        strikethrough: node.strikethrough != null ? !!node.strikethrough : inherited.strikethrough,
        click: ce ? { action: String(ce.action || ''), value: String(ce.value != null ? ce.value : '') } : inherited.click,
        hover: extractHoverText(he) || inherited.hover,
    };
    const text = node.text != null ? String(node.text) : '';
    if (text) out.push({ text, ...style });
    if (Array.isArray(node.extra)) for (const c of node.extra) extractChatSegments(c, style, out);
}

module.exports = { flattenChatText, extractHoverText, extractChatSegments };
