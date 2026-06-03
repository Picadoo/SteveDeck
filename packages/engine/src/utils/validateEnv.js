const crypto = require('crypto');

/**
 * 验证环境变量配置是否完整和安全
 */
function validateEnv() {
    const errors = [];
    const warnings = [];

    // 1. 验证SESSION_SECRET
    if (!process.env.SESSION_SECRET) {
        errors.push('SESSION_SECRET未设置');
    } else if (process.env.SESSION_SECRET.length < 32) {
        errors.push('SESSION_SECRET长度不足32字符');
    } else if (process.env.SESSION_SECRET.includes('change-this') ||
               process.env.SESSION_SECRET.includes('your-secret-key')) {
        errors.push('SESSION_SECRET使用默认值，请修改为随机字符串');
    }

    // 2. 生产环境检查
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.HTTPS_ENABLED || process.env.HTTPS_ENABLED !== 'true') {
            errors.push('生产环境必须启用HTTPS (设置 HTTPS_ENABLED=true)');
        }
    }

    // 3. 邮件配置检查（可选）
    if (process.env.EMAIL_USER && !process.env.EMAIL_PASS) {
        warnings.push('EMAIL_USER已设置但EMAIL_PASS未设置，邮件功能可能无法使用');
    }

    // 4. 端口检查
    const port = parseInt(process.env.PORT || '3000');
    if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`PORT配置无效: ${process.env.PORT}`);
    }

    // 打印结果
    if (errors.length > 0) {
        if (process.env.NODE_ENV === 'production') {
            console.error('\n环境配置错误:');
            errors.forEach(err => console.error(`  - ${err}`));
            console.error('\n请检查.env文件或环境变量设置\n');
            process.exit(1);
        } else {
            // 开发环境降级为警告，不阻止启动
            console.warn('\n 环境配置问题（开发环境，不阻止启动）:');
            errors.forEach(err => console.warn(`  - ${err}`));
            console.warn('');
        }
    }

    if (warnings.length > 0) {
        console.warn('\n 环境配置警告:');
        warnings.forEach(warn => console.warn(`  - ${warn}`));
        console.warn('');
    }

    console.log('环境变量验证通过');
}

/**
 * 生成强随机SESSION_SECRET
 * @returns {string} 64字符的十六进制字符串
 */
function generateSecretKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    validateEnv,
    generateSecretKey
};
