// modules/mining/humanizer.js
// 纯函数：根据拟人档位生成随机参数，无 bot 依赖，便于单测。
const LEVELS = {
    high:   { aim: [200, 500], jitter: 0.40, pauseProb: 0.12, pause: [1000, 3000], imperfect: 0.25 },
    medium: { aim: [120, 300], jitter: 0.25, pauseProb: 0.06, pause: [800, 2000],  imperfect: 0.12 },
    low:    { aim: [50, 120],  jitter: 0.10, pauseProb: 0.02, pause: [500, 1000],  imperfect: 0.03 },
};

const cfg = (level) => LEVELS[level] || LEVELS.medium;
const randIn = ([a, b]) => a + Math.random() * (b - a);

function aimDelay(level) { return Math.round(randIn(cfg(level).aim)); }

function actionInterval(level, base) {
    const j = cfg(level).jitter;
    const factor = 1 + (Math.random() * 2 - 1) * j; // 1 ± jitter
    return Math.max(0, Math.round(base * factor));
}

function shouldPause(level) { return Math.random() < cfg(level).pauseProb; }

function pauseDuration(level) { return Math.round(randIn(cfg(level).pause)); }

// 多数返回 0（最近），偶尔返回 1（次近），制造不完美。空/单元素安全返回 0。
function pickTargetIndex(queueLen, level) {
    if (queueLen <= 1) return 0;
    if (Math.random() < cfg(level).imperfect) return 1;
    return 0;
}

module.exports = { aimDelay, actionInterval, shouldPause, pauseDuration, pickTargetIndex, LEVELS };
