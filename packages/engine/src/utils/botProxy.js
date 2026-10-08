// 每账号 SOCKS5 路由。凭据单独存 /data/proxies.json，不进入面板配置响应或日志。
const fs = require('fs');
const { SocksClient } = require('socks');
const { dataPath } = require('../config/paths');
function loadBotProxy(id) {
    const file = dataPath('proxies.json');
    if (!fs.existsSync(file)) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))[id];
    if (!value || value.enabled === false) return null;
    if (value.pending === true) throw new Error('此账号等待独立 SOCKS5 配置，禁止直连');
    if (value.type !== 'socks5' || typeof value.host !== 'string' || !value.host.trim()
        || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
        throw new Error('SOCKS5 配置无效，未使用直连替代');
    if (value.expiresAt && (!/^\d{4}-\d{2}-\d{2}$/.test(value.expiresAt)
        || Date.now() > Date.parse(`${value.expiresAt}T23:59:59+08:00`)))
        throw new Error('SOCKS5 代理已过期或日期无效，未使用直连替代');
    return value;
}
function proxyOptions(profile, destination, isCurrent = () => true, connected = () => {}) {
    if (!profile) return {};
    return { connect(client) {
        let ended = false;
        const onEnd = () => { ended = true; };
        client.once('end', onEnd);
        SocksClient.createConnection({ command: 'connect',
            proxy: { host: profile.host, port: profile.port, type: 5, userId: profile.username, password: profile.password },
            destination: { host: destination.host, port: destination.port || 25565 }, timeout: 12000,
        }).then(({ socket }) => {
            if (ended || !isCurrent()) { socket.destroy(); return; }
            socket.setKeepAlive(true, 15000);
            socket.setNoDelay(true);
            client.setSocket(socket);
            connected({ type: 'socks5', endpoint: `${profile.host}:${profile.port}`, connectedAt: Date.now() });
            client.emit('connect');
        }).catch(error => {
            if (ended || !isCurrent()) return;
            let message = String(error?.message || 'connection failed');
            for (const secret of [profile.username, profile.password]) if (secret) message = message.split(secret).join('[redacted]');
            const safe = new Error(`SOCKS5 连接失败（不回退直连）：${message}`);
            // 隧道尚未建立时没有 socket close 事件，主动通知 end 以进入原有重连流程。
            client.emit('error', safe);
            if (!ended) client.emit('end', safe.message);
        });
    } };
}
module.exports = { loadBotProxy, proxyOptions };
