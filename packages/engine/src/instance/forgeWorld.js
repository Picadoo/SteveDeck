// FML1 自定义维度不一定是 -1/0/1。Mineflayer 只按这三个 ID 判断天空光照，
// 在其它有天空光的维度会把光照字节当成下一个 section，读出空气或 varint 错误。
// 只在 Forge 1.9–1.12 的自定义维度中按完整区块布局判断；不修改全局注册表。

function hasLayout(data, mask, fullChunk, skyLight) {
    let offset = 0;
    const readVarInt = () => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            if (offset >= data.length) throw new Error('truncated varint');
            const byte = data[offset++];
            value += (byte & 0x7f) * (2 ** (7 * i));
            if (!(byte & 0x80)) return value;
        }
        throw new Error('invalid varint');
    };
    try {
        for (let section = 0; section < 16; section++) {
            if (!(mask & (1 << section))) continue;
            const bits = data[offset++];
            if (!Number.isInteger(bits) || bits < 4 || bits > 16) return false;
            const paletteLength = readVarInt();
            if (bits <= 8) {
                if (paletteLength < 1 || paletteLength > (1 << bits)) return false;
                for (let i = 0; i < paletteLength; i++) readVarInt();
            } else if (paletteLength !== 0) return false;
            const longs = readVarInt();
            if (longs !== bits * 64) return false; // 4096 连续打包状态 / 64 位
            offset += longs * 8 + 2048 + (skyLight ? 2048 : 0);
            if (offset > data.length) return false;
        }
        return offset + (fullChunk ? 256 : 0) === data.length;
    } catch {
        return false;
    }
}

function detectSkyLight(packet) {
    if (!Buffer.isBuffer(packet.chunkData) || !Number.isInteger(packet.bitMap)
        || packet.bitMap <= 0 || packet.bitMap > 0xffff) return null;
    const withSky = hasLayout(packet.chunkData, packet.bitMap, packet.groundUp, true);
    const withoutSky = hasLayout(packet.chunkData, packet.bitMap, packet.groundUp, false);
    return withSky === withoutSky ? null : withSky;
}

function installForgeWorld(bot, report) {
    let dimensionId;
    let skyLight = null;
    const supported = () => /^1\.(9|10|11|12)(\.|$)/.test(bot.version || '');
    const customDimension = () => Number.isInteger(dimensionId) && ![-1, 0, 1].includes(dimensionId);
    const apply = () => {
        if (!supported() || !customDimension() || skyLight === null) return;
        // dimension 是 Mineflayer 的环境类型；保留实际 ID，世界切换仍由原始包驱动。
        bot.game.forgeDimensionId = dimensionId;
        bot.game.dimension = skyLight ? 'overworld' : `forge:${dimensionId}`;
    };
    const reset = (packet) => {
        dimensionId = packet.dimension;
        skyLight = null;
        if (bot.game) delete bot.game.forgeDimensionId;
    };
    bot._client.prependListener('login', reset);
    bot._client.prependListener('respawn', reset);
    bot.prependListener('game', apply);
    bot._client.prependListener('map_chunk', (packet) => {
        if (!supported() || !customDimension()) return;
        // 完整匹配布局才采用结果；不能以「load 没抛错」为依据，错位也可能静默成功。
        const detected = detectSkyLight(packet);
        if (detected === null) return;
        if (skyLight !== detected) {
            skyLight = detected;
            report?.(`Forge 自定义维度 ${dimensionId}：已识别${skyLight ? '有' : '无'}天空光照，修正区块读取`);
        }
        apply();
    });
}

module.exports = { detectSkyLight, installForgeWorld };
