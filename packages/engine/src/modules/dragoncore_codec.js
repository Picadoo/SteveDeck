const { gunzipSync } = require('zlib');
const MAX = 4 * 1024 * 1024;
function createDragonDecoder() {
    const fragments = new Map();
    return bytes => {
        const now = Date.now();
        for (const [opcode, entry] of fragments) if (now - entry.at > 30000) fragments.delete(opcode);
        const raw = gunzipSync(bytes[0] === 64 ? bytes.subarray(1) : bytes, { maxOutputLength: MAX });
        if (raw.length < 8) throw new Error('DragonCore header truncated');
        const opcode = raw.readInt32BE(0), complete = raw.readInt32BE(4);
        let body = raw.subarray(8);
        if (complete === 0) {
            const prev = fragments.get(opcode);
            const pendingBytes = [...fragments.values()].reduce((sum, entry) => sum + entry.body.length, 0);
            if ((prev?.body.length || 0) + body.length > MAX || pendingBytes + body.length > 2 * MAX || (!prev && fragments.size >= 32)) {
                fragments.delete(opcode); throw new Error('DragonCore fragments too large');
            }
            fragments.set(opcode, { body: prev ? Buffer.concat([prev.body, body]) : body, at: now });
            return null;
        }
        if (complete !== 1) throw new Error('Unknown DragonCore fragment flag');
        if (fragments.has(opcode)) { body = fragments.get(opcode).body; fragments.delete(opcode); }
        let offset = 0;
        const readInt = () => { if (offset + 4 > body.length) throw new Error('truncated integer'); const n = body.readInt32BE(offset); offset += 4; return n; };
        const readString = () => { const n = readInt(); if (n < 0 || n > MAX || offset + n > body.length) throw new Error('truncated string'); const v = body.toString('utf8', offset, offset + n); offset += n; return v; };
        if (opcode === 2) return { opcode, config: { name: readString().replace(/\\/g, '/'), text: readString() } };
        if (opcode === 14) {
            const n = readInt(); if (n < 0 || n > 256) throw new Error('too many keys');
            return { opcode, keys: Array.from({ length: n }, readString) };
        }
        if (opcode === 16) return { opcode, slot: { identifier: readString(), data: body.subarray(offset).toString('base64') } };
        if (opcode === 100) {
            const name = readString(), action = readString();
            if (['opengui', 'closegui'].includes(action)) return { opcode, gui: { name, action } };
            // 同一 opcode 也用于组件更新表达式。只保留诊断摘要，不执行，不改变菜单生命周期。
            return { opcode, guiUpdate: { name, text: action.slice(0, 2000) }, bytes: body.length };
        }
        return { opcode, bytes: body.length, text: body.toString('utf8').slice(0, 2000) };
    };
}
function writeString(value) {
    if (typeof value !== 'string') throw Error('DragonCore argument must be a string');
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > 131072) throw Error('DragonCore string too large');
    const length = []; let n = bytes.length;
    do { let v = n & 127; n >>>= 7; if (n) v |= 128; length.push(v); } while (n);
    return Buffer.concat([Buffer.from(length), bytes]);
}
// 2.4.71 客户端的发包格式与服务端下发 gzip 格式不同，不能互相套用。
function encodeDragonKey(key) {
    const encoded = writeString(key);
    if (!key || Buffer.byteLength(key) > 32) throw Error('DragonCore key too large');
    return Buffer.concat([Buffer.from([64, 0, 0, 0, 5]), encoded, Buffer.from([0, 0, 0, 1]), encoded]);
}
function encodeDragonEvent(event, args) {
    if (!event || !Array.isArray(args) || args.length > 128) throw Error('DragonCore event arguments invalid');
    const count = Buffer.alloc(4); count.writeInt32BE(args.length);
    const packet = Buffer.concat([Buffer.from([64, 0, 0, 0, 100]), writeString(event), count, ...args.map(writeString)]);
    if (packet.length > MAX) throw Error('DragonCore event too large');
    return packet;
}
module.exports = { createDragonDecoder, encodeDragonKey, encodeDragonEvent };
