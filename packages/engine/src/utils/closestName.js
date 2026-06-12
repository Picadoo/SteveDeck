// 拼写建议：在候选名单里找编辑距离最近的名字（automine/trash_cleaner 输错物品名时提示用）
// 阈值随输入长度放宽：短词容差 2，长词约 1/4 长度——超过阈值认为不是手滑，返回 null。

function levenshtein(a, b, cap) {
    const m = a.length, n = b.length;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > cap) return cap + 1; // 整行都超阈值，后面只会更大，提前截断
        const t = prev; prev = cur; cur = t;
    }
    return prev[n];
}

function closestName(input, names) {
    const s = String(input).toLowerCase().trim();
    if (!s) return null;
    const maxDist = Math.max(2, Math.floor(s.length / 4));
    let best = null, bestD = maxDist + 1;
    for (const n of names) {
        if (Math.abs(n.length - s.length) >= bestD) continue; // 长度差就超了，不用算
        const d = levenshtein(s, n, bestD - 1);
        if (d < bestD) {
            bestD = d;
            best = n;
            if (d === 0) break;
        }
    }
    return best;
}

module.exports = { closestName };
