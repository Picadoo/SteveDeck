// 脚本动作：变量类（set_var/math_var）——纯状态操作，最适合单测的动作。
module.exports = {
    async set_var(deps, step, _ctx) {
        const { bot, botInstance, emitLog, emitVars, evalMath } = deps;
        const varName = step.name || step.var;
        let val = step.value;
        if (typeof val === 'string') {
            if (val === '$health') val = bot.health;
            else if (val === '$food') val = bot.food;
            else if (val === '$x') val = Math.floor(bot.entity.position.x);
            else if (val === '$y') val = Math.floor(bot.entity.position.y);
            else if (val === '$z') val = Math.floor(bot.entity.position.z);
            else if (val.startsWith('$scoreboard:')) {
                const keyword = val.substring(12);
                val = botInstance.getScoreboardValue ? botInstance.getScoreboardValue(keyword) : null;
            } else if (val.startsWith('=')) {
                val = evalMath(val.slice(1));
            } else {
                // 纯数字字符串转数值（保留 "007"/"1.0" 这类会丢形态的原样）
                const numVal = Number(val);
                if (val.trim() !== '' && !Number.isNaN(numVal) && val.trim() === String(numVal)) val = numVal;
            }
        }
        botInstance._scriptVars[varName] = val;
        emitLog(`变量 ${varName} = ${val}`);
        emitVars();
    },

    async math_var(deps, step, _ctx) {
        const { botInstance, emitLog, emitVars } = deps;
        const varName = step.name || step.var;
        const current = Number(botInstance._scriptVars[varName]) || 0;
        const operand = Number(step.value) || 0;
        let result;
        switch (step.op) {
            case '+': result = current + operand; break;
            case '-': result = current - operand; break;
            case '*': result = current * operand; break;
            case '/': result = operand !== 0 ? current / operand : 0; break;
            case '%': result = operand !== 0 ? current % operand : 0; break;
            default: result = current;
        }
        botInstance._scriptVars[varName] = result;
        emitLog(`变量 ${varName} = ${result} (${current} ${step.op} ${operand})`);
        emitVars();
    },
};
