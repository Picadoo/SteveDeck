/* 引擎纯函数工具单测：聊天安全过滤 / 致命断开判定 / GUI 槽位匹配 / 实体名牌解析。
   这些是最适合单测的纯逻辑（此前零覆盖），直接测源码 JS（无需构建）。 */
const test = require('node:test');
const assert = require('node:assert');

const { isChatBlocked } = require('../src/utils/chatSafety.js');
const { isFatalKick, isMaintenanceKick, extractText } = require('../src/utils/reconnectPolicy.js');
const { slotText, findMatchingSlot } = require('../src/utils/guiMatch.js');
const { stripMcCodes, flattenChatComponent, entityDisplayName, isArmorStand, hologramNameFor } = require('../src/utils/entityName.js');

// ===== chatSafety =====

test('chatSafety：危险命令拦截、白名单放行、未知命令默认放行', () => {
  assert.equal(isChatBlocked('/op me'), true);
  assert.equal(isChatBlocked('/gamemode creative'), true);
  assert.equal(isChatBlocked('/lp user x permission set *'), true, '权限插件提权命令在黑名单');
  assert.equal(isChatBlocked('/login abc123'), false, '登录类白名单放行');
  assert.equal(isChatBlocked('/home'), false);
  assert.equal(isChatBlocked('/job join miner'), false, 'RPG 自定义命令默认放行');
  assert.equal(isChatBlocked('大家好'), false, '普通聊天放行');
});

test('chatSafety：绕过手段——命名空间前缀、换行注入、超长', () => {
  assert.equal(isChatBlocked('/minecraft:gamemode creative'), true, '去命名空间后仍命中黑名单');
  assert.equal(isChatBlocked('hello\n/op me'), true, '换行夹带第二条命令一律拒绝');
  assert.equal(isChatBlocked('a'.repeat(300)), true, '超长消息拒绝');
  assert.equal(isChatBlocked(''), true);
  assert.equal(isChatBlocked(null), true);
});

// ===== reconnectPolicy =====

test('reconnectPolicy：致命断开判定', () => {
  assert.equal(isFatalKick('You are banned from this server'), true);
  assert.equal(isFatalKick('§c你已被封禁'), true, '带色码也能命中');
  assert.equal(isFatalKick('Outdated client! Please use 1.16.5'), true);
  assert.equal(isFatalKick({ text: 'This server requires FML/Forge to be installed on the client' }), true, 'JSON 组件形态');
  assert.equal(isFatalKick('Internal server error'), false, '普通错误可重连');
  assert.equal(isFatalKick('Welcome to Forge Craft!'), false, '服务器名含 forge 不误判致命');
  assert.equal(isFatalKick(null), false);
});

test('reconnectPolicy：白名单类降级为维护型（低频重试而非永久停止）', () => {
  // 服务器维护重启临时开白名单是常见场景——归永久致命会让 bot 维护结束也永不回来
  assert.equal(isMaintenanceKick('You are not white-listed on this server!'), true);
  assert.equal(isMaintenanceKick('§e白名单模式已开启'), true);
  assert.equal(isFatalKick('You are not white-listed on this server!'), false, '不再算永久致命');
  assert.equal(isMaintenanceKick('You are banned'), false, '封禁不算维护');
  assert.equal(isMaintenanceKick(null), false);
});

test('reconnectPolicy：extractText 兼容字符串/组件/extra', () => {
  assert.equal(extractText('plain'), 'plain');
  assert.equal(extractText({ text: 'a', extra: ['b', { text: 'c' }] }), 'abc');
  assert.equal(extractText(null), '');
});

// ===== guiMatch =====

test('guiMatch：名字/lore 匹配、槽位范围、色码清洗', () => {
  const slots = [
    { name: 'stone', displayName: 'Stone' },
    { name: 'paper', displayName: '§a每日§b签到' },
    {
      name: 'paper',
      displayName: 'VIP菜单',
      nbt: { value: { display: { value: { Lore: { value: { value: ['§7点击打开商店'] } } } } } },
    },
  ];
  assert.equal(findMatchingSlot(slots, '签到'), 1, '显示名含色码也能按看到的字匹配');
  assert.equal(findMatchingSlot(slots, '商店', { matchLore: true }), 2, 'lore 匹配需显式开启');
  assert.equal(findMatchingSlot(slots, '商店', { matchLore: false }), -1);
  assert.equal(findMatchingSlot(slots, '签到', { slotFrom: 2 }), -1, '槽位范围限定');
  assert.equal(findMatchingSlot(slots, ''), -1);
  assert.equal(slotText(null), '');
});

// ===== entityName =====

test('entityName：洗码 / 组件展平（含 1.20.3+ NBT 形态）', () => {
  assert.equal(stripMcCodes('§u庄§j稼§x汉'), '庄稼汉');
  assert.equal(flattenChatComponent('plain'), 'plain');
  assert.equal(flattenChatComponent({ text: 'a', extra: [{ text: 'b' }, 'c'] }), 'abc');
  assert.equal(flattenChatComponent({ type: 'compound', value: { text: { type: 'string', value: '§c魔王' } } }), '§c魔王');
});

test('entityName：显示名解析优先级与回退', () => {
  assert.equal(entityDisplayName({ metadata: { 2: '§6金币猪' } }), '金币猪', 'metadata 字符串名牌');
  assert.equal(entityDisplayName({ metadata: { 2: { text: '§bBoss', extra: ['·一阶'] } } }), 'Boss·一阶', 'metadata 组件名牌');
  assert.equal(entityDisplayName({ name: 'zombie' }), 'zombie', '回退类型名');
  assert.equal(entityDisplayName(null, 'unknown'), 'unknown', '空实体回退 fallback');
});

test('entityName：盔甲架判定与全息名牌联想', () => {
  assert.equal(isArmorStand({ name: 'armor_stand' }), true);
  assert.equal(isArmorStand({ name: 'armorstand' }), true);
  assert.equal(isArmorStand({ name: 'zombie' }), false);
  const stands = [{ pos: { x: 10, y: 66, z: 10 }, name: '精英怪' }];
  assert.equal(hologramNameFor({ position: { x: 10.5, y: 64.5, z: 10 } }, stands), '精英怪', '头顶 1.6 格内命中');
  assert.equal(hologramNameFor({ position: { x: 20, y: 64, z: 20 } }, stands), null, '距离外不命中');
});
