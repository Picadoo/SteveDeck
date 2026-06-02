// 重连策略：判断断开/踢出原因是否"不可恢复"（重连也没用，应停止并通知）
// 与 BotInstance 解耦，便于单测。误判也有重试次数兜底，故关键词求稳不求全。
const FATAL_PATTERNS = [
    'banned', 'you are banned', 'ban for', '封禁', '封号', '已被封', '永久封',
    'blacklist', '黑名单',
    'whitelist', 'white-list', 'white list', '白名单',
    'outdated', 'incompatible', 'unsupported client', 'unsupported version',
    '版本不', '版本过', '版本错', '不支持的版本',
];

function extractText(reason) {
    if (!reason) return '';
    if (typeof reason === 'string') return reason;
    try {
        if (typeof reason.toString === 'function') {
            const s = reason.toString();
            if (s && s !== '[object Object]') return s;
        }
        let out = reason.text || '';
        if (Array.isArray(reason.extra)) {
            out += reason.extra.map(e => (typeof e === 'string' ? e : (e && e.text) || '')).join('');
        }
        return out || JSON.stringify(reason);
    } catch (e) { return ''; }
}

function isFatalKick(reason) {
    const text = extractText(reason).toLowerCase().replace(/§[0-9a-fk-orx]/gi, '');
    if (!text) return false;
    return FATAL_PATTERNS.some(p => text.includes(p));
}

module.exports = { isFatalKick, extractText, FATAL_PATTERNS };
