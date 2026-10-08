// 通用扩展注册表。服务器识别和玩法全部由注册的适配包提供。
const adapters = new Map();
function registerAdapter(adapter) {
    if (!adapter || typeof adapter.id !== 'string' || typeof adapter.matches !== 'function') throw Error('Invalid server adapter');
    if (adapters.has(adapter.id)) throw Error(`Duplicate server adapter: ${adapter.id}`);
    adapters.set(adapter.id, adapter);
}
function getServerAdapter(config) {
    return [...adapters.values()].find(adapter => adapter.matches(config)) || null;
}
module.exports = { registerAdapter, getServerAdapter };
