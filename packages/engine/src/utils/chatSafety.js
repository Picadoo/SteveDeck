// 聊天/命令安全过滤：Socket 与脚本引擎共用
const BLOCKED_COMMANDS = [
    '/op ', '/deop ', '/stop', '/ban ', '/ban-ip ', '/pardon ',
    '/whitelist ', '/kick ', '/gamemode ', '/give ', '/tp ',
    '/teleport ', '/kill ', '/setblock ', '/fill ', '/clone ',
    '/execute ', '/function ', '/reload', '/save-all', '/save-off',
    '/save-on', '/spreadplayers ', '/summon ', '/weather ',
    '/worldborder ', '/difficulty ', '/gamerule ', '/defaultgamemode ',
    '/seed', '/publish', '/debug ',
    // 常见权限插件的提权命令（LuckPerms / PermissionsEx / GroupManager）——同属提权面，纳入黑名单(API-2)
    '/lp ', '/luckperms ', '/pex ', '/permissionsex ', '/manuadd ', '/manuaddp '
];

const ALLOWED_PREFIXES = [
    '/login', '/register', '/l ', '/r ', '/msg ', '/tell ', '/w ',
    '/reply ', '/tpa ', '/tpaccept', '/tpdeny', '/home', '/spawn',
    '/warp', '/pay ', '/money', '/bal', '/shop', '/menu', '/help'
];

function isChatBlocked(msg) {
    if (!msg || typeof msg !== 'string') return true;
    if (msg.length > 256) return true;
    // 注入防护(API-2)：换行/回车/控制字符可在一条 chat 里夹带第二行命令（如 "hello\n/op me"），一律拒绝。
    // 用 charCode 逐字符判断而非内嵌控制字符的正则，避免源码里出现裸控制字节。
    for (let i = 0; i < msg.length; i++) {
        if (msg.charCodeAt(i) < 0x20) return true; // \n \r \t 及其它 C0 控制字符
    }
    const lower = msg.toLowerCase().trim();
    if (lower.startsWith('/')) {
        if (ALLOWED_PREFIXES.some((p) => lower.startsWith(p))) return false;
        // 归一化(API-2)：剥掉命名空间前缀（/minecraft:gamemode → /gamemode）后再比对黑名单，防绕过。
        // 注意：未知 / 命令仍默认放行——RPG 服大量自定义命令(/job /skill 等)需可用；这里只拦已知危险命令，
        // 不做白名单(default-deny)以免误伤通用场景；危险面靠黑名单 + 去命名空间 + 去注入覆盖。
        const norm = lower.replace(/^\/[a-z0-9_]+:/, '/');
        return BLOCKED_COMMANDS.some((cmd) => {
            const c = cmd.trim();
            return lower.startsWith(c) || norm.startsWith(c);
        });
    }
    return false;
}

module.exports = { isChatBlocked, BLOCKED_COMMANDS, ALLOWED_PREFIXES };
