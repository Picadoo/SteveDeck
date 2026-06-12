// 假人起名器：生成「像真人玩家」的 MC 用户名（[A-Za-z0-9_]{3,16}）。
// 反识别要点：同一批名字混用多种风格（拼音/英文/混搭/数字尾缀各异、大小写不一、
// 长短不一），绝不出现 玩家_01、bot2、abc3 这类一眼假的连号规律。

const PINYIN = [
  "xiao", "feng", "yun", "chen", "mo", "ling", "yu", "han", "tian", "ye",
  "qing", "shan", "hai", "xing", "meng", "long", "hu", "lan", "bai", "hei",
  "jiu", "wan", "gu", "su", "li", "zhao", "wang", "ning", "an", "luo",
  "shen", "xia", "dong", "nan", "bei", "zi", "yan", "song", "lin", "tang",
  "cheng", "jiang", "he", "lei", "fan", "rui", "kai", "bo", "hao", "jun",
];

const EN_WORDS = [
  "Shadow", "Wolf", "Sky", "Ice", "Fire", "Moon", "Star", "Dark", "Light", "Cloud",
  "Dream", "Wind", "Stone", "Leaf", "River", "Night", "Snow", "Rain", "Sun", "Blade",
  "Ghost", "Panda", "Tiger", "Lemon", "Mint", "Coco", "Mocha", "Echo", "Nova", "Pixel",
  "Frost", "Ember", "Storm", "Ocean", "Maple", "Cherry", "Honey", "Ash", "Fox", "Crow",
];

const SUFFIX_STYLES: ((r: () => number) => string)[] = [
  () => "", // 无尾缀（最常见）
  () => "",
  (r) => String(Math.floor(r() * 90 + 10)), // 两位数
  (r) => String(Math.floor(r() * 900 + 100)), // 三位数
  (r) => String(1995 + Math.floor(r() * 18)), // 年份 1995-2012
  (r) => ["233", "666", "520", "007", "521", "999"][Math.floor(r() * 6)], // 网络梗数字
];

const pick = <T,>(arr: T[], r: () => number): T => arr[Math.floor(r() * arr.length)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 单个名字：随机选一种构词模式 */
function makeOne(r: () => number): string {
  const mode = Math.floor(r() * 6);
  const sep = r() < 0.22 ? "_" : "";
  let base: string;
  switch (mode) {
    case 0: { // 拼音+拼音：MoChen / moyu / Lin_an
      const a = pick(PINYIN, r);
      const b = pick(PINYIN, r);
      base = r() < 0.5 ? cap(a) + sep + cap(b) : a + sep + b;
      break;
    }
    case 1: // 英文词+英文词：IceMoon / Frost_Fox
      base = pick(EN_WORDS, r) + sep + pick(EN_WORDS, r);
      break;
    case 2: { // 拼音+英文：Ling_Wolf / chenSky
      const a = pick(PINYIN, r);
      base = (r() < 0.5 ? cap(a) : a) + sep + pick(EN_WORDS, r);
      break;
    }
    case 3: // 单英文词（靠尾缀区分）：Shadow2008
      base = pick(EN_WORDS, r);
      break;
    case 4: { // 三连拼音：suyunan / XiaYeLin
      const parts = [pick(PINYIN, r), pick(PINYIN, r), pick(PINYIN, r)];
      base = r() < 0.4 ? parts.map(cap).join("") : parts.join("");
      break;
    }
    default: { // 前缀风：imLanya / itsMoYu / McFrost
      const pre = pick(["im", "its", "Mc", "i", "the"], r);
      const a = pick(PINYIN, r);
      base = pre + cap(a) + (r() < 0.5 ? cap(pick(PINYIN, r)) : "");
      break;
    }
  }
  const suffix = pick(SUFFIX_STYLES, r)(r);
  let name = base + suffix;
  if (name.length > 16) name = name.slice(0, 16);
  return name;
}

/** 生成 count 个互不重复、风格混杂的名字 */
export function generateFakeNames(count: number): string[] {
  const r = Math.random;
  const out = new Set<string>();
  let guard = 0;
  while (out.size < count && guard++ < count * 50) {
    const n = makeOne(r);
    if (n.length >= 3 && /^[A-Za-z0-9_]+$/.test(n)) out.add(n);
  }
  return [...out];
}
