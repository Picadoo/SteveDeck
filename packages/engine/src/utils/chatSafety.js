// 聊天/命令安全过滤：Socket 与脚本引擎共用
const BLOCKED_COMMANDS = [
    '/op ', '/deop ', '/stop', '/ban ', '/ban-ip ', '/pardon ',
    '/whitelist ', '/kick ', '/gamemode ', '/give ', '/tp ',
    '/teleport ', '/kill ', '/setblock ', '/fill ', '/clone ',
    '/execute ', '/function ', '/reload', '/save-all', '/save-off',
    '/save-on', '/spreadplayers ', '/summon ', '/weather ',
    '/worldborder ', '/difficulty ', '/gamerule ', '/defaultgamemode ',
    '/seed', '/publish', '/debug '
];

const ALLOWED_PREFIXES = [
    '/login', '/register', '/l ', '/r ', '/msg ', '/tell ', '/w ',
    '/reply ', '/tpa ', '/tpaccept', '/tpdeny', '/home', '/spawn',
    '/warp', '/pay ', '/money', '/bal', '/shop', '/menu', '/help'
];

function isChatBlocked(msg) {
    if (!msg || typeof msg !== 'string') return true;
    if (msg.length > 256) return true;
    const lower = msg.toLowerCase().trim();
    if (lower.startsWith('/')) {
        if (ALLOWED_PREFIXES.some(p => lower.startsWith(p))) return false;
        return BLOCKED_COMMANDS.some(cmd => lower.startsWith(cmd.trim()));
    }
    return false;
}

module.exports = { isChatBlocked, BLOCKED_COMMANDS, ALLOWED_PREFIXES };
