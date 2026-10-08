const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getServerAdapter, registerAdapter } = require('../src/adapters');

test('公开框架默认不注册任何服务器、账号或玩法', () => {
    assert.equal(getServerAdapter({ host: 'mc.example.test', port: 25565, username: 'player' }), null);
    assert.equal(getServerAdapter({ host: 'localhost', port: 25565 }), null);
});

test('独立扩展显式注册，地址和端口由适配包匹配，重复注册被拒绝', () => {
    const extension = { id: 'example-test', matches: config => config?.host === 'adapter.example.test' && config.port === 25565 };
    registerAdapter(extension);
    assert.equal(getServerAdapter({ host: 'adapter.example.test', port: 25565 }), extension);
    assert.equal(getServerAdapter({ host: 'adapter.example.test', port: 25566 }), null);
    assert.equal(getServerAdapter({ host: 'other.example.test', port: 25565 }), null);
    assert.throws(() => registerAdapter(extension), /Duplicate/);
    assert.throws(() => registerAdapter({ id: 'invalid' }), /Invalid/);
});
