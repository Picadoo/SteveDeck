/**
 * 验证密码强度
 * @param {string} password - 要验证的密码
 * @returns {{valid: boolean, errors: string[]}} 验证结果
 */
function validatePassword(password) {
    const errors = [];

    if (!password || typeof password !== 'string') {
        errors.push('密码不能为空');
        return { valid: false, errors };
    }

    if (password.length < 8) {
        errors.push('密码长度至少8个字符');
    }

    if (!/[a-z]/.test(password)) {
        errors.push('密码必须包含小写字母');
    }

    if (!/[A-Z]/.test(password)) {
        errors.push('密码必须包含大写字母');
    }

    if (!/[0-9]/.test(password)) {
        errors.push('密码必须包含数字');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('密码必须包含特殊字符 (!@#$%^&*等)');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 生成密码强度提示信息
 * @param {string} password - 密码
 * @returns {string} 强度描述
 */
function getPasswordStrength(password) {
    const checks = {
        length: password.length >= 12,
        lower: /[a-z]/.test(password),
        upper: /[A-Z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    };

    const passedChecks = Object.values(checks).filter(v => v).length;

    if (passedChecks === 5) return '强';
    if (passedChecks >= 3) return '中等';
    return '弱';
}

module.exports = {
    validatePassword,
    getPasswordStrength
};
