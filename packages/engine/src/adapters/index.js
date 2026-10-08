// 扩展装配入口；核心模块不直接依赖任何具体服务器包。
const registry = require('./registry');
// 公开框架默认不注册具体服务器；由部署方在此显式装配独立扩展。
module.exports = registry;
