// Forge/FML 模组服支持（从 BotInstance.js 抽出）：
// 1) pingForgeMods：连接前 ping 服务器拿模组表（正确 modid+version），供握手时声明「我有这些模组」。
// 2) installFmlHandshake：FML1 握手状态机（1.7–1.12），把裸客户端伪装成 Forge 客户端。
// 编解码（varint/字符串/ModList）为可导出纯函数，有单测。
const path = require('path');
const logger = require('../utils/logger');

// pnpm 下引擎不能直接 require 传递依赖；借 mineflayer 的解析路径拿到 minecraft-protocol（用其 ping 探测 Forge 模组表）。
let _mcp = null;
function getMcp() {
    if (_mcp !== null) return _mcp || null;
    try {
        const mfDir = path.dirname(require.resolve('mineflayer'));
        _mcp = require(require.resolve('minecraft-protocol', { paths: [mfDir] }));
    } catch (_e) { _mcp = false; }
    return _mcp || null;
}

// ===== FML 编解码（纯函数） =====
/** 无符号 LEB128 varint 编码。 */
function vInt(n) { const o = []; do { let b = n & 0x7f; n = n >>> 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); }
/** varint 长度前缀 + UTF-8 字符串。 */
function vStr(s) { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([vInt(b.length), b]); }
/** ClientHello 之后的 ModList 包（判别符 0x02）：声明客户端「拥有」的模组列表。 */
function buildModList(mods) {
    const parts = [Buffer.from([0x02]), vInt(mods.length)];
    for (const m of mods) { parts.push(vStr(m.modid || m.id || '')); parts.push(vStr(m.version || '')); }
    return Buffer.concat(parts);
}
/** 解析服务器 ModList 包（同 0x02 布局），返回 ["modid@version", ...]；解析失败抛错由调用方兜底。 */
function parseModList(data) {
    let off = 1;
    const rdV = () => { let v = 0, s = 0, b; do { b = data[off++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
    const cnt = rdV(); const names = [];
    for (let i = 0; i < cnt; i++) {
        const nl = rdV(); const nm = data.toString('utf8', off, off + nl); off += nl;
        const vl = rdV(); const ver = data.toString('utf8', off, off + vl); off += vl;
        names.push(`${nm}@${ver}`);
    }
    return names;
}

module.exports.fml = { vInt, vStr, buildModList, parseModList };

// ===== BotInstance mixin =====
module.exports.mixin = {
    // Forge 模组服：ping 一下服务器，从状态响应里拿到它的模组表（含正确 modid+version），
    // 用于 FML 握手时声明「我有这些模组」骗过校验。任何 Forge 服都能自动适配，无需手填。失败返回 null。
    pingForgeMods() {
        return new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            const mc = getMcp();
            if (!mc || typeof mc.ping !== 'function') return finish(null);
            try {
                mc.ping({ host: this.config.host, port: this.config.port || 25565, version: this.config.version || '1.12.2' }, (err, res) => {
                    if (err || !res) return finish(null);
                    let list = null;
                    if (res.modinfo && Array.isArray(res.modinfo.modList)) {
                        // 1.7–1.12 FML：modinfo.modList = [{modid, version}]
                        list = res.modinfo.modList.map((m) => ({ modid: m.modid, version: m.version }));
                    } else if (res.forgeData && Array.isArray(res.forgeData.mods)) {
                        // 1.13+ Forge：forgeData.mods = [{modId, modmarker}]
                        list = res.forgeData.mods.map((m) => ({ modid: m.modId || m.modid, version: m.modmarker || m.version || '' }));
                    }
                    finish(list?.length ? list : null);
                });
                setTimeout(() => finish(null), 8000); // 超时兜底
            } catch (_e) { finish(null); }
        });
    },

    // Forge/FML 模组服（龙核 DragonCore 等）：在握手 serverHost 后附加 \0FML\0 标记，
    // 让服务器把我们当 Forge 客户端，否则登录阶段直接被 "requires FML/Forge" 踢。
    // 并监听 FML|HS 握手消息，走完 FML1 状态机。
    installFmlHandshake(client) {
        client.tagHost = '\0FML\0';
        logger.info(`[${this.config.username}] 已启用 Forge 模式（FML 握手）`);
        this.uiLog('已启用 Forge 模式（FML 握手）');

        // FML1 握手状态机（1.7–1.12）。判别符为有符号字节：
        //   ServerHello=0 / ClientHello=1 / ModList=2 / RegistryData=3 / HandshakeAck=-1 / HandshakeReset=-2
        // Ack 的 phase：WAITINGSERVERDATA=2 / WAITINGSERVERCOMPLETE=3 / PENDINGCOMPLETE=4 / COMPLETE=5 / START=1
        const writeFML = (buf) => { try { client.write('custom_payload', { channel: 'FML|HS', data: buf }); } catch (_e) { /* ignore */ } };
        const ack = (phase) => writeFML(Buffer.from([0xFF, phase]));
        const forgeMods = Array.isArray(this._forgeMods) ? this._forgeMods : (Array.isArray(this.config.settings?.forgeMods) ? this.config.settings.forgeMods : []);
        let regTimer = null;
        client.on('custom_payload', (p) => {
            if (p?.channel !== 'FML|HS' || !p.data || !p.data.length) return;
            const disc = p.data.readInt8(0);
            if (disc === 0) { // ServerHello → REGISTER + ClientHello + ModList + Ack(2)
                const fmlProto = p.data.length > 1 ? p.data[1] : 2;
                try { client.write('custom_payload', { channel: 'REGISTER', data: Buffer.from(['FML|HS', 'FML', 'FML|MP', 'FORGE'].join('\0'), 'utf8') }); } catch (_e) { /* ignore */ }
                writeFML(Buffer.from([0x01, fmlProto])); // ClientHello
                writeFML(buildModList(forgeMods));       // ModList：声明拥有配置里的模组（空数组=不声明）
                ack(2);
                this.uiLog(`[FML] ServerHello(proto=${fmlProto}) → ClientHello/ModList(${forgeMods.length}个)/Ack(2)`);
            } else if (disc === 2) { // 服务器 ModList：解析出全部 modid（便于核对正确名字）
                try {
                    const names = parseModList(p.data);
                    logger.info(`[${this.config.username}] [FML] 服务器模组(${names.length}): ${names.join(', ')}`);
                    this.uiLog(`[FML] 服务器模组(${names.length}个)，详见引擎日志`);
                } catch (_e) { this.uiLog('[FML] 收到服务器 ModList（解析失败）'); }
            } else if (disc === 3) { // RegistryData：可能多条，防抖后 Ack(3)
                if (regTimer) clearTimeout(regTimer);
                regTimer = setTimeout(() => { ack(3); this.uiLog('[FML] RegistryData 结束 → Ack(3)'); }, 700);
            } else if (disc === -1) { // 服务器 HandshakeAck
                const phase = p.data.length > 1 ? p.data.readInt8(1) : 0;
                if (phase === 2) { ack(4); this.uiLog('[FML] 服务器Ack(2) → Ack(4)'); }
                else if (phase === 3) { ack(5); this.uiLog('[FML] 握手完成 → Ack(5) ✅'); }
            } else if (disc === -2) { // HandshakeReset
                ack(1);
            }
        });
    },
};
