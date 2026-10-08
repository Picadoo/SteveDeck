// 通用协议配置：服务器默认绑定由扩展包提供，显式配置绑定到当前端点。
const PROTOCOL = 'dragoncore-2.4.71-mc1.12';
function keyName(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value)) throw Error('按键名称无效');
    return value.toUpperCase();
}
function configureProfile(config, input) {
    if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean') throw Error('请指定 enabled');
    if (input.protocol !== undefined && input.protocol !== PROTOCOL) throw Error('尚未适配该龙核心协议版本');
    const keys = input.keys ?? [];
    if (!Array.isArray(keys) || keys.length > 128) throw Error('按键列表无效');
    return { enabled: input.enabled, protocol: PROTOCOL,
        server: { host: config.host, port: Number(config.port || 25565) }, keys: [...new Set(keys.map(keyName))] };
}
function getProfile(config) {
    const custom = config?.settings?.dragonCore;
    if (custom) {
        if (!custom.enabled || custom.protocol !== PROTOCOL || custom.server?.host !== config.host
            || Number(custom.server?.port) !== Number(config.port || 25565)) return null;
        try { return { ...configureProfile(config, custom), id: 'custom', keyProviders: {}, textureLabels: {} }; }
        catch (_) { return null; }
    }
    return require('../../adapters').getServerAdapter(config)?.dragonCore || null;
}
module.exports = { PROTOCOL, getProfile, configureProfile, keyName };
