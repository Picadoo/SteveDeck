// 已启用协议配置的 VV 菜单观察器：只读取数据，不执行下发脚本。
const { gunzipSync, gzipSync } = require('zlib');
const fs = require('fs');
const { dataPath } = require('../config/paths');
const { getProfile } = require('./dragoncore/profiles');
const { attachDragonCore } = require('./dragoncore/runtime');
function attachVexMenuObserver(inst, client) {
    const profile = getProfile(inst.config);
    if (!profile) return;
    const core = attachDragonCore(inst, client), state = core.state;
    inst._vexMenuState = state;
    inst._vexVersionSent = false;
    let timer;
    const flush = () => {
        timer = null;
        try { fs.writeFileSync(dataPath(`vex-menu-${inst.config.id}.json`), JSON.stringify(state, null, 2)); } catch (_) { /* 记录失败不影响挂机 */ }
    };
    const scheduleFlush = () => { if (!timer) timer = setTimeout(flush, 300); };
    core.events.on('packet', scheduleFlush);
    const listener = p => {
        if (p.channel !== 'VexView') return;
        try {
            const data = JSON.parse(gunzipSync(p.data, { maxOutputLength: 524288 }).toString('utf8'));
            if (profile.vexVersion && data.packet_type === 'ver' && data.packet_sub_type === 'get' && !inst._vexVersionSent) {
                inst._vexVersionSent = true;
                client.write('custom_payload', { channel: 'VexView', data: gzipSync(Buffer.from(JSON.stringify({ packet_type: 'ver', packet_data: profile.vexVersion, packet_sub_type: '854:480' }), 'utf8')) });
            }
            if (data.packet_type === 'scorebroad') return;
            if (data.packet_type === 'hud' && /dl\.ms\.(valuestatushud|texthud)\.(food|health)/.test(String(data.packet_data))) return;
            state.packets.push({ at: Date.now(), ...data });
            if (state.packets.length > 40) state.packets.shift();
            if (!timer) timer = setTimeout(flush, 300);
        } catch (_) { state.errors++; }
    };
    client.on('custom_payload', listener);
    client.once('end', () => { client.removeListener('custom_payload', listener); core.events.removeListener('packet', scheduleFlush); if (timer) clearTimeout(timer); flush(); });
}
module.exports = { attachVexMenuObserver };
