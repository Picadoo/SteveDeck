// 实体名牌解析共享工具。此前 mob_hunter 与 follow 各写一套、行为略有出入
// （follow 的展平不认 1.20.3+ NBT {value} 形态、不洗 {}" 残渣）——统一到功能更全的版本。


/** 洗 Minecraft § 格式码：§ 后任意字符都算码（含 §u/§j 等服务器自造码），匹配两侧都要洗。 */
function stripMcCodes(s) {
  return String(s == null ? '' : s).replace(/§./g, '');
}

/**
 * 展平聊天组件取纯文本，兼容三种形态（任一形态可嵌套）：
 * 纯字符串、JSON 组件({text,extra})、NBT 解码形态({type,value} 包一层，1.20.3+ 协议的实体元数据）。
 */
function flattenChatComponent(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenChatComponent).join('');
  if (typeof node === 'object') {
    if ('value' in node) {
      return typeof node.value === 'object' ? flattenChatComponent(node.value) : String(node.value);
    }
    let s = node.text != null ? flattenChatComponent(node.text) : '';
    if (node.extra != null) s += flattenChatComponent(node.extra);
    return s;
  }
  return '';
}

/**
 * 实体显示名：metadata[2] 名牌（字符串/组件）→ customName/displayName/类型名，统一洗码。
 * fallback：取不到任何名字时的返回值（mob_hunter 用 'unknown'、follow 用 ''）。
 */
function entityDisplayName(entity, fallback = '') {
  if (!entity) return fallback;
  try {
    const cn = entity.metadata && entity.metadata[2];
    if (typeof cn === 'string' && cn.length > 0) {
      // 老服务器可能把 JSON 字符串原样塞进名牌：顺手洗掉 {}" 残渣
      const cleaned = stripMcCodes(cn).replace(/[{}"]/g, '').trim();
      if (cleaned) return cleaned;
    }
    if (cn && typeof cn === 'object') {
      const cleaned = stripMcCodes(flattenChatComponent(cn)).trim();
      if (cleaned) return cleaned;
    }
  } catch (e) { /* ignore */ }
  return stripMcCodes(entity.customName || entity.displayName || entity.name || '').trim() || fallback;
}

/** 盔甲架判定（低版本 type 可能不是 object，按名字/种类匹配） */
function isArmorStand(e) {
  return !!(e && /armor.?stand/i.test(String(e.name || e.kind || '')));
}

/**
 * RPG 全息名牌联想：怪物名字常挂在头顶的隐形盔甲架上，怪本体没有 CustomName。
 * stands = [{ pos, name }]。命中条件：头顶 1.6 格水平半径内、脚下 -0.5 到 3.2 格高。
 */
function hologramNameFor(entity, stands) {
  for (const h of stands) {
    const dx = h.pos.x - entity.position.x;
    const dz = h.pos.z - entity.position.z;
    const dy = h.pos.y - entity.position.y;
    if (dx * dx + dz * dz <= 1.6 * 1.6 && dy > -0.5 && dy < 3.2) return h.name;
  }
  return null;
}

module.exports = { stripMcCodes, flattenChatComponent, entityDisplayName, isArmorStand, hologramNameFor };
