// 轻量 ReDoS 防护(API-3/MODB-7)：用户在监听规则里写的正则会对每条聊天 exec，
// 灾难性回溯(如 (a+)+$ )可冻结整个事件循环、拖垮所有 bot。Node 内置正则无超时。
//
// 取舍：不引 re2（原生依赖，会破坏自包含桌面打包），改用「长度上限 + 嵌套量词启发式」
// 覆盖最常见的 ReDoS 形态。属 best-effort：单主人信任模型下足够，且不误伤普通监听正则。
const MAX_PATTERN_LEN = 200;

// 嵌套量词：对一个本身含无界量词(+/*)的分组再加量词 → 指数级回溯。
// 例: (a+)+  (a*)*  ([a-z]+)+  (\d+)*  ((ab)+)+
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*[*+{]/;

function validatePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return { ok: false, error: "正则为空" };
  }
  if (pattern.length > MAX_PATTERN_LEN) {
    return { ok: false, error: `正则过长(>${MAX_PATTERN_LEN} 字符)，已拒绝` };
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    return { ok: false, error: "疑似灾难性回溯(嵌套量词，如 (a+)+)，已拒绝" };
  }
  try {
    new RegExp(pattern);
  } catch (e) {
    return { ok: false, error: "正则无效: " + e.message };
  }
  return { ok: true };
}

module.exports = { validatePattern, MAX_PATTERN_LEN };
