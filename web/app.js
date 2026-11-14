/* 阿福蔬果 · 店主第一视角原型
 * 数据层见 catalog.js：71 种常见蔬果、6 个品类、7 个可选店址。
 * 前台只负责接待与展示，进货、调价都收在后台。
 * 顾客 = 职业 × 年龄 × 家境 × 性格 × 店址客群。
 */
const SPRITE_DIR = "../assets/sprites/";
const BASE_TRAFFIC = 20;
const MAX_CUSTOMERS = 28;
/* 连续欠费超过该天数后进入破产清算 */
const BANKRUPT_GRACE_DAYS = 3;
/* 提前退租：按 1 个月（30 天）日租计算违约金；库存按成本 50% 清算 */
const EXIT_PENALTY_DAYS = 30;
const EXIT_LIQUIDATION_RATE = 0.5;
/* 提前退租时，分店按估值的 70% 一并清算，避免门店资产凭空消失 */
const EXIT_BRANCH_RATE = 0.7;
const MAX_DAY_REVENUE = 5000000;
const SHELF_PAGE_SIZE = 12;
const MOVE_BASE_FEE = 5000;
/* 员工体力：接待、开门自动任务、营业中维护都会消耗，隔夜按心情恢复 */
const STAMINA_MAX = 100;
const STAMINA_RECOVER_BASE = 38;
const STAMINA_MAINTENANCE_COST = 16;
const DUTY_STAMINA_LOAD = { cashier: 1.1, manager: 0.7, stocker: 0.7, promoter: 1.3, chef: 1.1, buyer: 0.35, pricer: 0.35 };
/* 施工停业：等待该时长后自动进入下一天，也可手动跳过 */
const BUILD_WAIT_MS = 5 * 60 * 1000;

/* 每日损耗率：商品可单独覆写 decay，否则按品类默认值。
 * 苹果耐放，水蜜桃、草莓呼吸作用强，损耗快得多。 */
const CATEGORY_DECAY = {
  叶菜: 0.2, 根茎: 0.05, 茄果: 0.13, 菌菇豆类: 0.17, 水果: 0.06, 葱姜调味: 0.11,
  肉串: 0.16, 素串: 0.12, 海鲜: 0.2, 烤鱼: 0.22, 主食: 0.11,
  凉菜: 0.13, 小吃: 0.1, 酒水: 0.015,
  面包: 0.2, 蛋糕: 0.24, 甜点: 0.14, 饮品: 0.04,
  吊坠: 0.0004, 手镯: 0.0004, 摆件: 0.0004,
  小菜: 0.1, 炖汤: 0.12, 饮料: 0.02,
  零食: 0.015, 日用品: 0.001,
};

function decayRateOf(goods) {
  const base = goods.decay ?? CATEGORY_DECAY[goods.cat] ?? 0.08;
  return clamp(base * seasonDecayMult(goods) * weatherDecayMult(goods), 0.0002, 0.6);
}

/* 仓储条件：烧烤的冰箱让后台损耗很低，但台面没卖完的串坏得快。
 * 冷藏/精品货架只改善台面陈列，后台仓库不受影响。 */
function storageDecayMult(area) {
  let base;
  if (state.shopType === "bbq") base = area === "backroom" ? 0.25 : 1.6;
  else if (state.shopType === "cake") base = area === "backroom" ? 0.55 : 1.35;
  else if (state.shopType === "fruit") base = area === "backroom" ? 0.7 : 1.15;
  else base = area === "backroom" ? 0.6 : 1;
  return area === "backroom" ? base : base * shelfDecayMult();
}

/* 商品可售截止日：标称保质期 + 少量宽限。
 * 宽限最多为保质期的 25% 且不超过 3 天：卖相好最多 +2 天，洒水护理 +1 天。
 * 这样短保商品只多卖 1 天，长保商品也不会被无限延长。 */
function shelfLifeOf(goods, lot) {
  const shelf = Math.max(1, Number(goods?.shelf) || 1);
  const graceCap = Math.min(3, Math.max(1, Math.round(shelf * 0.25)));
  const appeal = appealOf(goods.id);
  const appealBonus = appeal >= 85 ? 2 : appeal >= 70 ? 1 : 0;
  const sprayBonus = lot && state.sprayed[goods.id] === state.day - 1 ? 1 : 0;
  return shelf + Math.min(graceCap, appealBonus + sprayBonus);
}

function lotExpireDay(goods, lot) {
  return (lot.dayIn || 0) + shelfLifeOf(goods, lot);
}

/* 日均腐损率：台面受货架/冷链影响，后台按仓储条件计算（不含库龄加速） */
function spoilageRates(goods) {
  const base = decayRateOf(goods);
  return {
    shelf: base * storageDecayMult("inventory"),
    back: base * storageDecayMult("backroom"),
  };
}

/* 售卖风格：果蔬散称多份 / 烧烤统一点单 / 其余单件成交 */
function salesStyleOf() {
  return SHOP_TYPES.find((type) => type.id === state.shopType)?.salesStyle || "unit";
}

function roundStyleOf() {
  return SHOP_TYPES.find((type) => type.id === state.shopType)?.roundStyle || "yuan";
}

/* 晚市清仓按店型自适应：烧烤现点现烤、玉石非生鲜，不参与八点清仓 */
function clearanceEnabled() {
  return SHOP_TYPES.find((type) => type.id === state.shopType)?.clearance !== false;
}

function clearanceLabel() {
  return `${Math.round((state.clearanceRate || 0.5) * 10)}折`;
}

/* 统一抹零：整单金额向下取整到整元 / 整角 */
function roundOff(cents) {
  const style = roundStyleOf();
  const step = style === "yuan" ? 100 : style === "jiao" ? 10 : 1;
  return Math.max(0, Math.floor(cents / step) * step);
}

/* 每日水电杂费：随日租与铺面规模变化 */
function utilityCost() {
  const capMult = Number(sizeOf()?.capMult) || 1;
  return Math.max(300, Math.round((state.location?.rent || 0) * 0.12 + 420 * capMult));
}


const WEATHERS = [
  { name: "晴", w: 0.42, traffic: 1.0, market: 0.96 },
  { name: "多云", w: 0.28, traffic: 0.9, market: 1.0 },
  { name: "小雨", w: 0.16, traffic: 0.76, market: 1.06 },
  { name: "暴雨", w: 0.06, traffic: 0.5, market: 1.18 },
  { name: "闷热", w: 0.08, traffic: 1.06, market: 1.02 },
];

/* 四季循环：每 10 天一个季节，影响进价、损耗与需求。
 * 价格系数按品类覆盖，未列出的品类按 1 处理。 */
const SEASON_DAYS = 10;
const SEASONS = [
  {
    id: "spring", name: "春", icon: "🌱", decay: 1,
    tip: "叶菜便宜、水果偏贵，适合做绿叶菜引流",
    price: { 叶菜: 0.9, 水果: 1.08, 根茎: 1, 菌菇豆类: 0.96 },
    demand: { 叶菜: 1.1, 水果: 0.98, 菌菇豆类: 1.04 },
  },
  {
    id: "summer", name: "夏", icon: "☀️", decay: 1.15,
    tip: "水果和冷饮走量，但高温让生鲜损耗明显加快",
    price: { 水果: 0.9, 叶菜: 1.16, 凉菜: 0.95, 酒水: 0.92, 海鲜: 1.06 },
    demand: { 水果: 1.16, 凉菜: 1.14, 酒水: 1.12, 炖汤: 0.86, 热饮: 0.8 },
  },
  {
    id: "autumn", name: "秋", icon: "🍂", decay: 0.96,
    tip: "水果和菌菇丰收，进价回落，适合囤耐放品类",
    price: { 水果: 0.94, 菌菇豆类: 0.9, 根茎: 0.95, 海鲜: 1.02 },
    demand: { 水果: 1.1, 菌菇豆类: 1.1, 根茎: 1.04 },
  },
  {
    id: "winter", name: "冬", icon: "❄️", decay: 0.9,
    tip: "叶菜和海鲜涨价，根茎、炖汤类更受欢迎",
    price: { 叶菜: 1.18, 根茎: 0.9, 水果: 1.12, 海鲜: 1.12, 炖汤: 0.95 },
    demand: { 根茎: 1.12, 炖汤: 1.15, 酒水: 1.06, 凉菜: 0.85, 水果: 0.98 },
  },
];

function seasonOf(day = state.day) {
  return SEASONS[Math.floor(Math.max(0, day - 1) / SEASON_DAYS) % SEASONS.length];
}

function seasonDayOf(day = state.day) {
  return ((Math.max(1, day) - 1) % SEASON_DAYS) + 1;
}

function seasonPriceMult(goods) {
  return seasonOf().price[goods.cat] ?? 1;
}

function seasonDecayMult(goods) {
  const season = seasonOf();
  const fresh = ["叶菜", "水果", "菌菇豆类", "海鲜", "凉菜", "肉串", "烤鱼", "蛋糕", "甜点"];
  if (season.id === "summer" && fresh.includes(goods.cat)) return season.decay * 1.08;
  if (season.id === "winter" && (goods.cat === "根茎" || goods.cat === "叶菜")) return season.decay * 0.92;
  return season.decay;
}

function seasonDemandMult(goods) {
  return seasonOf().demand[goods.cat] ?? 1;
}

/* 季节改变天气概率：夏季闷热、暴雨多见，冬季几乎不闷热 */
const SEASON_WEATHER_BIAS = {
  spring: { 小雨: 1.7, 暴雨: 1.2 },
  summer: { 闷热: 3.4, 暴雨: 1.8, 晴: 1.15 },
  autumn: { 晴: 1.7, 多云: 1.3 },
  winter: { 晴: 1.25, 多云: 1.45, 闷热: 0.08, 暴雨: 0.55 },
};

function weatherPoolFor(season) {
  const bias = SEASON_WEATHER_BIAS[season.id] || {};
  return WEATHERS.map((w) => ({ ...w, w: w.w * (bias[w.name] ?? 1) }));
}

/* 天气对损耗的额外影响：闷热天水果损耗翻倍，叶菜、凉菜、海鲜也明显加快 */
function weatherDecayMult(goods) {
  const name = state.weather?.name;
  if (name === "闷热") {
    if (goods.cat === "水果") return 2;
    if (["叶菜", "凉菜", "菌菇豆类", "海鲜"].includes(goods.cat)) return 1.35;
  }
  if (name === "暴雨") return 1.08;
  return 1;
}

/* 三类供货商：低价高风险 / 均衡 / 高价低损耗
 * volume 是每日到货额度系数：散户货多但不稳，冷链量少但品质好。 */
const SUPPLIERS = [
  { id: "street", name: "散户批发", icon: "🧺", price: 0.9, decay: 1.25, quality: 2, volume: 1.35, desc: "进价 -10%、额度 +35%，品质不稳，损耗 +25%" },
  { id: "market", name: "本地农贸", icon: "🏪", price: 1, decay: 1, quality: 5, volume: 1, desc: "价格、额度与品质均衡" },
  { id: "cold", name: "品牌冷链", icon: "❄️", price: 1.14, decay: 0.6, quality: 9, volume: 0.6, desc: "进价 +14%、额度 -40%，损耗 -40%，卖相更好" },
];
const SUPPLIER_INDEX = Object.fromEntries(SUPPLIERS.map((supplier) => [supplier.id, supplier]));

/* 大额进货走物流：10 秒起步，最多约 30 秒；暴雨再延迟。
 * 下单即扣款，资金先被预占，到货后才进后台。 */
const BULK_SHIPPING_QTY = 30;
const BULK_DELAY_BASE = 10000;
const BULK_DELAY_MAX = 15000;

function supplierOf() {
  return SUPPLIER_INDEX[state.supplier] || SUPPLIERS[1];
}

/* 渠道每日到货额度：基础额度 × 渠道 volume */
function supplyQuotaOf(gid) {
  return Math.round((state.supplyQuota?.[gid] || 0) * (supplierOf().volume ?? 1));
}

function supplyLeftOf(gid) {
  return Math.max(0, supplyQuotaOf(gid) - (state.supplyUsed?.[gid] || 0));
}

/* 在途数量：已下单、物流未送达 */
function shipmentQtyOf(gid) {
  return (state.shipments || []).filter((ship) => ship.gid === gid).reduce((sum, ship) => sum + ship.qty, 0);
}

function shippingDelayMs(qty) {
  const supplier = supplierOf();
  const bulk = Math.min(BULK_DELAY_MAX, Math.max(0, qty - BULK_SHIPPING_QTY) * 200);
  const weather = state.weather?.name === "暴雨" ? 5000 : state.weather?.name === "小雨" ? 2000 : 0;
  return Math.round((BULK_DELAY_BASE + bulk + weather) * (supplier.id === "cold" ? 0.75 : 1));
}

/* ---------------- 经营阶段：把店型、铺面和硬件串成关卡 ---------------- */
const STAGES = [
  {
    id: 1, name: "路边摊", icon: "🧺", tip: "低资金起步，先练选品、控损与议价",
    sizes: ["stall"], shopTypes: ["fruit", "bbq", "shaxian"], req: null,
  },
  {
    id: 2, name: "社区小店", icon: "🏪", tip: "解锁小门面、蛋糕/便利店与精品货架",
    sizes: ["stall", "small"], shopTypes: ["fruit", "bbq", "shaxian", "cake", "store"],
    req: { days: 3, profit: 100000 },
  },
  {
    id: 3, name: "精品生鲜", icon: "🏬", tip: "解锁大门店、冷藏货架与分店经营",
    sizes: ["stall", "small", "large"], shopTypes: ["fruit", "bbq", "shaxian", "cake", "store", "jade"],
    req: { days: 10, profit: 600000, rep: 3.8 },
  },
  {
    id: 4, name: "连锁经营", icon: "🏢", tip: "解锁整层物业与多店托管",
    sizes: ["stall", "small", "large", "floor"], shopTypes: ["fruit", "bbq", "shaxian", "cake", "store", "jade"],
    req: { days: 20, profit: 2500000, branches: 1, asset: 2000000 },
  },
];

function stageStats() {
  const profit = state.history.reduce((sum, h) => sum + h.profit, 0);
  return {
    days: state.history.length,
    profit,
    rep: state.reputation || 0,
    branches: state.branches.length,
    asset: totalAssetValue(),
  };
}

function stageReqMet(req) {
  if (!req) return true;
  const stats = stageStats();
  return (!req.days || stats.days >= req.days)
    && (!req.profit || stats.profit >= req.profit)
    && (!req.rep || stats.rep >= req.rep)
    && (!req.branches || stats.branches >= req.branches)
    && (!req.asset || stats.asset >= req.asset);
}

/* 阶段只升不降：花钱扩店后资产回落，也不该被降级 */
function stageIndex() {
  let idx = 1;
  for (let i = 1; i < STAGES.length; i += 1) {
    if (stageReqMet(STAGES[i].req)) idx = i + 1;
    else break;
  }
  const previous = Math.max(1, Number(state.stageReached) || 1);
  state.stageReached = Math.max(previous, idx);
  /* 阶段可能在任意一次渲染中被判定达成；只在首次跨级时庆祝一次 */
  if (state.stageReached > previous) {
    const stage = STAGES[state.stageReached - 1];
    state.stageUp = { id: stage.id, name: stage.name, icon: stage.icon, tip: stage.tip };
    if (state.settlement) state.settlement.stageUp = state.stageUp;
    logLine(`经营阶段提升：${stage.icon} ${stage.name} —— ${stage.tip}`, "good");
    toast(`进入「${stage.name}」阶段：${stage.tip}`);
  }
  return state.stageReached;
}

function stageOf() {
  return STAGES[stageIndex() - 1] || STAGES[0];
}

function canUseSize(id) {
  return stageOf().sizes.includes(id);
}

function canUseShopType(id) {
  return stageOf().shopTypes.includes(id);
}

function stageReqText(req) {
  if (!req) return "开局即拥有";
  const parts = [];
  if (req.days) parts.push(`经营 ${req.days} 天`);
  if (req.profit) parts.push(`累计净利 ${money(req.profit)}`);
  if (req.rep) parts.push(`口碑 ${req.rep.toFixed(1)}`);
  if (req.branches) parts.push(`分店 ${req.branches} 家`);
  if (req.asset) parts.push(`总资产 ${money(req.asset)}`);
  return parts.join(" · ");
}

/* ---------------- 菜品分级：按经营天数与累计净利解锁 ---------------- */
const GOOD_TIERS = [
  { id: 1, name: "基础", req: null },
  { id: 2, name: "进阶", req: { days: 3, profit: 100000 } },
  { id: 3, name: "精品", req: { days: 7, profit: 300000 } },
];

function runProfitTotal() {
  return (state.history || []).reduce((sum, item) => sum + (item.profit || 0), 0);
}

function goodsUnlockState(goods) {
  const tier = GOOD_TIERS[(goods.tier || 1) - 1] || GOOD_TIERS[0];
  const days = (state.history || []).length;
  const profit = runProfitTotal();
  const unlocked = !tier.req
    || ((!tier.req.days || days >= tier.req.days) && (!tier.req.profit || profit >= tier.req.profit));
  return { tier, days, profit, unlocked };
}

function goodsUnlocked(goods) {
  return goodsUnlockState(goods).unlocked;
}

/* 未解锁时给出还差多少，避免玩家只看到一把锁 */
function goodsUnlockText(goods) {
  const { tier, days, profit, unlocked } = goodsUnlockState(goods);
  if (!tier.req) return `${tier.name} · 开局可用`;
  if (unlocked) return `${tier.name} · 已解锁`;
  const parts = [];
  if (tier.req.days) parts.push(`经营 ${Math.min(days, tier.req.days)}/${tier.req.days} 天`);
  if (tier.req.profit) parts.push(`累计净利 ${money(profit)}/${money(tier.req.profit)}`);
  return `${tier.name} · 还需 ${parts.join(" · ")}`;
}

/* ---------------- 货架分级：花钱换容量、转化与保鲜 ---------------- */
const SHELF_TIERS = [
  { id: "wood", name: "普通木架", icon: "🪵", cost: 0, capMult: 1, sellMult: 1, decayMult: 1, stage: 1, desc: "基础陈列，损耗正常" },
  { id: "premium", name: "精品货架", icon: "✨", cost: 60000, capMult: 1.15, sellMult: 1.15, decayMult: 0.9, stage: 2, desc: "台面容量 +15%，顾客购买意愿 +15%，损耗 -10%" },
  { id: "cold", name: "冷藏货架", icon: "❄️", cost: 180000, capMult: 1.3, sellMult: 1.2, decayMult: 0.5, stage: 3, desc: "台面容量 +30%，生鲜损耗 -50%，购买意愿 +20%" },
];
const SHELF_TIER_INDEX = Object.fromEntries(SHELF_TIERS.map((tier) => [tier.id, tier]));

function shelfTierOf() {
  return SHELF_TIER_INDEX[state.shelfTier] || SHELF_TIERS[0];
}

function shelfCapMult() {
  return shelfTierOf().capMult;
}

/* 精品货架抬高购买意愿；买了皮肤货架再叠加 5% */
function shelfSellMult() {
  return shelfTierOf().sellMult;
}

function shelfDecayMult() {
  return shelfTierOf().decayMult;
}

/* ---------------- 温柔刺激：连续经营里程碑与每日手记 ----------------
 * 核心循环还在调参期，这里只做「被看见」的正反馈：
 * 不发放现金、不改变损耗与客流，避免干扰经济数值。 */
const MILESTONES = [
  { days: 1, name: "开张大吉", icon: "🌱" },
  { days: 3, name: "街坊脸熟", icon: "🙂" },
  { days: 7, name: "一周老店", icon: "🌿" },
  { days: 14, name: "社区熟人", icon: "🏡" },
  { days: 30, name: "街区老字号", icon: "🏮" },
  { days: 60, name: "四季常客", icon: "🍂" },
];
const DAILY_WHISPERS = [
  "慢慢来，第一天能把灯点亮就很好了。",
  "进货别贪多，卖得完的才是好库存。",
  "街坊记住的不是价格，是你挑货时的认真。",
  "今天也把台面理一理，顾客看得见的地方最值钱。",
  "生意有起伏很正常，先把今天这一单做好。",
  "利润藏在损耗里，少坏一点就是多赚一点。",
  "不着急扩店，先把这一条街照顾好。",
];


const EVENTS = [
  { name: "平常日", w: 0.28, traffic: 1.0, market: 1.0, kind: "normal" },
  { name: "丰收季", w: 0.09, traffic: 1.02, market: 0.9, cat: "叶菜", supply: 1.35, kind: "normal" },
  { name: "运输受阻", w: 0.07, traffic: 0.96, market: 1.12, supply: 0.62, kind: "normal" },
  { name: "周末集市", w: 0.08, traffic: 1.28, market: 1.02, kind: "festival" },
  { name: "社区团购", w: 0.07, traffic: 0.84, market: 0.98, kind: "normal" },
  { name: "网红探店", w: 0.05, traffic: 1.45, market: 1.02, kind: "normal" },
  { name: "水果季", w: 0.06, traffic: 1.06, market: 0.92, cat: "水果", supply: 1.4, kind: "normal" },
  { name: "冷空气", w: 0.05, traffic: 0.98, market: 1.06, cat: "叶菜", supply: 0.85, kind: "normal" },
  { name: "发薪日", w: 0.05, traffic: 1.18, market: 1.02, kind: "festival" },
  { name: "社区节日", w: 0.06, traffic: 1.32, market: 1.05, kind: "festival" },
  { name: "街角竞争店开业", w: 0.07, traffic: 0.72, market: 0.94, kind: "rival" },
  { name: "对手低价促销", w: 0.06, traffic: 0.8, market: 0.9, kind: "rival" },
  { name: "中秋庙会", w: 0.03, traffic: 1.4, market: 1.08, cat: "水果", supply: 1.2, kind: "festival" },
  { name: "春节前采购", w: 0.03, traffic: 1.5, market: 1.1, cat: "叶菜", supply: 1.15, kind: "festival" },
];

/* 全天营业时段：早市到晚市，权重为基准客流强度。
 * 实际权重由 slotWeights() 结合店址、事件、天气、口碑动态计算（AI 自适应人流）。 */
const TIME_SLOTS = [
  { id: "early", label: "早市", hour: "7-9", w: 1.25 },
  { id: "morning", label: "上午", hour: "9-11", w: 0.85 },
  { id: "noon", label: "午间", hour: "11-14", w: 0.95 },
  { id: "afternoon", label: "下午", hour: "14-17", w: 0.7 },
  { id: "evening", label: "晚市", hour: "17-20", w: 1.4 },
];

/* 店址对时段客流的偏好：地铁口通勤早晚高峰、菜市场早市、大学城午晚等 */
const LOC_SLOT_BOOST = {
  alley: { early: 1.25, evening: 1.3 },
  hospital: { morning: 1.4, noon: 1.2 },
  market: { early: 1.55, morning: 1.2 },
  metro: { early: 1.4, evening: 1.5 },
  university: { noon: 1.3, evening: 1.4 },
  office: { morning: 1.25, noon: 1.4, evening: 1.25 },
  luxury: { morning: 1.3, evening: 1.35 },
};

const AGES = {
  teen: { id: "teen", label: "少年", budget: [900, 2600], sens: [0.62, 0.92], patience: [0.35, 0.65], social: [0.45, 0.85], bulk: 0.18 },
  young: { id: "young", label: "青年", budget: [2500, 7000], sens: [0.4, 0.75], patience: [0.3, 0.7], social: [0.35, 0.8], bulk: 0.38 },
  middle: { id: "middle", label: "中年", budget: [3000, 8500], sens: [0.45, 0.78], patience: [0.45, 0.85], social: [0.5, 0.9], bulk: 0.55 },
  elder: { id: "elder", label: "老年", budget: [1500, 4800], sens: [0.58, 0.9], patience: [0.65, 1.0], social: [0.55, 0.95], bulk: 0.42 },
};

const WEALTHS = {
  tight: {
    id: "tight", label: "手头紧", mult: 0.55, sens: 0.18, bulk: -0.12, review: -0.12,
    demeanors: ["反复看价签", "把钱包攥得很紧", "先问有没有便宜的"],
  },
  average: {
    id: "average", label: "小康", mult: 1.0, sens: 0, bulk: 0, review: 0,
    demeanors: ["不紧不慢", "随手挑拣", "看看今天的成色"],
  },
  rich: {
    id: "rich", label: "宽裕", mult: 1.9, sens: -0.18, bulk: 0.12, review: 0.1,
    demeanors: ["不太看价", "挑最水灵的", "抬手看表，赶时间"],
  },
};

const TRAITS = [
  { id: "forthright", label: "爽快", patience: 0.12, social: 0.08, review: 0.08 },
  { id: "picky", label: "挑剔", patience: -0.05, review: -0.18 },
  { id: "chatty", label: "健谈", social: 0.18, review: 0.04 },
  { id: "quiet", label: "沉默", social: -0.25 },
  { id: "impatient", label: "急躁", patience: -0.2, bulk: -0.08 },
  { id: "patient", label: "慢性子", patience: 0.18 },
  { id: "thrifty", label: "精打细算", sens: 0.16, review: -0.04 },
  { id: "haggler", label: "爱砍价", sens: 0.12, bargain: 0.35 },
  { id: "face", label: "好面子", sens: -0.12, review: 0.06 },
];

/* ---------------- 员工 ---------------- */
const STAFF_ROLES = [
  { id: "cashier", name: "收银员", icon: "🧾", wage: 6000, desc: "缺货抱怨 -20%/人，可代你讲价" },
  { id: "manager", name: "店长", icon: "📋", wage: 9000, desc: "客流 +3%/人，开门前自动维护 2 种货" },
  { id: "stocker", name: "理货员", icon: "📦", wage: 5000, desc: "腐损 -12%/人，卖相每天自动 +1" },
  { id: "promoter", name: "叫卖员", icon: "📣", wage: 5500, desc: "客流 +8%/人，顾客愿付 +5%" },
  { id: "buyer", name: "采购员", icon: "🛒", wage: 6000, desc: "开门前按策略自动补货下单" },
  { id: "chef", name: "师傅", icon: "👨‍🍳", wage: 8000, desc: "品控：卖相每天 +2，好评 +0.05/人" },
];
const STAFF_ROLE_INDEX = Object.fromEntries(STAFF_ROLES.map((role) => [role.id, role]));

/* 可分配岗位：员工能收银、管理、理货、叫卖、采购、定价、品控。
 * 岗位决定实际加成，角色只决定招聘时的底薪与默认岗位。 */
const STAFF_DUTIES = [
  { id: "cashier", name: "收银", icon: "🧾", desc: "缺货抱怨 -20%/人" },
  { id: "manager", name: "管理", icon: "📋", desc: "客流 +3%/人，自动维护货品" },
  { id: "stocker", name: "理货", icon: "📦", desc: "腐损 -12%/人，卖相 +1/天" },
  { id: "promoter", name: "叫卖", icon: "📣", desc: "客流 +8%/人，愿付 +5%/人" },
  { id: "buyer", name: "采购", icon: "🛒", desc: "开门前按策略补货下单" },
  { id: "pricer", name: "定价", icon: "🏷️", desc: "开门前按策略自动调价" },
  { id: "chef", name: "品控", icon: "👨‍🍳", desc: "卖相 +2/天，好评 +0.05/人" },
];
const STAFF_DUTY_INDEX = Object.fromEntries(STAFF_DUTIES.map((duty) => [duty.id, duty]));

/* 岗位策略：采购补货力度 / 定价倍率 / 吆喝力度 */
const STAFF_POLICIES = {
  buyer: [
    { id: "conservative", name: "少进快销", desc: "只补最缺的 5 种，每种最多 18 件", below: 0.35, fill: 0.5, maxKinds: 5, maxQty: 18 },
    { id: "standard", name: "正常补货", desc: "补最缺的 9 种，每种最多 30 件", below: 0.55, fill: 0.75, maxKinds: 9, maxQty: 30 },
    { id: "aggressive", name: "备足货", desc: "补最缺的 14 种，每种最多 50 件", below: 0.75, fill: 1, maxKinds: 14, maxQty: 50 },
  ],
  pricer: [
    { id: "value", name: "薄利多销", desc: "基准价 92 折", mult: 0.92 },
    { id: "market", name: "随行就市", desc: "维持基准价", mult: 1 },
    { id: "premium", name: "精品高价", desc: "基准价 +10%", mult: 1.1 },
  ],
  promoter: [
    { id: "soft", name: "温和吆喝", desc: "效果 70%，不扰民", mult: 0.7 },
    { id: "standard", name: "正常吆喝", desc: "效果 100%", mult: 1 },
    { id: "loud", name: "卖力吆喝", desc: "效果 130%，心情 -3/天", mult: 1.3 },
  ],
};

/* 员工性格：work=效率系数；bias=各类事件触发权重；
 * react=通用事件选项下的心情变化；special=性格专属事件 */
const EMPLOYEE_PERSONALITIES = [
  {
    id: "diligent", label: "勤快", work: 1.25,
    bias: { raise: 0.28, leave: 0.08, lazy: 0.04, special: 0.6 },
    react: { raiseNo: -8, leaveNo: -8, scold: -6, ignore: 2, raiseYes: 15 },
    special: {
      title: "主动挑出烂货",
      text: "「老板，有几样货不新鲜了，我顺手挑出来重新摆了一下。」",
      options: [
        { key: "sp-praise", label: "表扬 + 记一功（心情 +10，卖相 +2）" },
        { key: "sp-nothing", label: "哦，知道了（心情 -5）" },
      ],
    },
  },
  {
    id: "honest", label: "老实", work: 1.0,
    bias: { raise: 0.14, leave: 0.12, lazy: 0.04, special: 0.7 },
    react: { raiseNo: -10, leaveNo: -10, scold: -5, ignore: 3, raiseYes: 12 },
    special: {
      title: "多找了顾客零钱",
      text: "「老板……刚才一着急，多找了客人 5 毛钱，是我没看清。」",
      options: [
        { key: "sp-pay", label: "从工资里扣（心情 -15）" },
        { key: "sp-ignore", label: "算了，下不为例（心情 +5，亏 5 毛）" },
      ],
    },
  },
  {
    id: "smooth", label: "圆滑", work: 0.95,
    bias: { raise: 0.42, leave: 0.1, lazy: 0.08, special: 0.4 },
    react: { raiseNo: -12, leaveNo: -10, scold: -8, ignore: 8, raiseYes: 18 },
    special: {
      title: "旁敲侧击要福利",
      text: "「老板，隔壁水果店都包午饭了，咱店里也意思意思？」",
      options: [
        { key: "sp-welfare", label: "每天加 5% 伙食补贴（心情 +15）" },
        { key: "sp-fob", label: "画个饼，年底再说（心情 -8）" },
      ],
    },
  },
  {
    id: "lazy", label: "爱摸鱼", work: 0.7,
    bias: { raise: 0.06, leave: 0.24, lazy: 0.5, special: 0.2 },
    react: { raiseNo: -8, leaveNo: -15, scold: -10, ignore: 15, raiseYes: 10 },
    special: {
      title: "今天又迟到了",
      text: "「老板，闹钟没响……就晚了二十分钟，嘿嘿。」",
      options: [
        { key: "sp-deduct", label: "扣半天工资（心情 -12，退回一半日薪）" },
        { key: "sp-ignore", label: "睁只眼闭只眼（心情 +12，今天效率减半）" },
      ],
    },
  },
  {
    id: "cheerful", label: "乐观", work: 1.1,
    bias: { raise: 0.22, leave: 0.08, lazy: 0.04, special: 0.66 },
    react: { raiseNo: -6, leaveNo: -8, scold: -8, ignore: 5, raiseYes: 20 },
    special: {
      title: "提议搞点气氛",
      text: "「老板，今天摆两个喇叭放点歌，门口再喊两嗓子，肯定热闹！」",
      options: [
        { key: "sp-adopt", label: "采纳（心情 +12，今天客流 +5%）" },
        { key: "sp-decline", label: "还是安安静静卖货吧（心情 -6）" },
      ],
    },
  },
  {
    id: "grumpy", label: "脾气急", work: 1.0,
    bias: { raise: 0.2, leave: 0.14, lazy: 0.16, special: 0.5 },
    react: { raiseNo: -25, leaveNo: -20, scold: -20, ignore: 4, raiseYes: 14 },
    quitRisk: 0.4,
    special: {
      title: "和顾客吵起来了",
      text: "「那人挑了半天还嫌贵，我顶了两句，他就说再也不来了……」",
      options: [
        { key: "sp-mediate", label: "安抚顾客，回头再聊（心情 +8，口碑 -0.03）" },
        { key: "sp-scold", label: "当着面训一顿（心情 -18）" },
        { key: "sp-backup", label: "护短，跟顾客硬刚（心情 +10，口碑 -0.08）" },
      ],
    },
  },
];

const STAFF_NAMES = ["小周", "阿强", "小美", "老赵", "婷婷", "阿明", "小芳", "老陈", "小刘", "秀兰"];

/* 分店补货策略：进货量 / 损耗风险（定价另由 BRANCH_PRICE_STRATEGIES 控制） */
const BRANCH_POLICIES = {
  conservative: { id: "conservative", name: "保守", supply: 0.72, spoil: 0.5, desc: "少进货，损耗低，可能不够卖" },
  standard: { id: "standard", name: "标准", supply: 0.95, spoil: 1, desc: "进销平衡，稳妥" },
  aggressive: { id: "aggressive", name: "激进", supply: 1.15, spoil: 1.35, desc: "多备货抢销量，卖不掉就烂" },
};

/* 分店定价策略：调价会反向影响客流（薄利多销 vs 精品高价） */
const BRANCH_PRICE_STRATEGIES = [
  { id: "thin", name: "薄利多销", mult: 0.92, desc: "降价 8% 拉客流，薄利走量" },
  { id: "market", name: "随行就市", mult: 1, desc: "跟随市场价，进销价差稳妥" },
  { id: "premium", name: "精品高价", mult: 1.1, desc: "加价 10% 提毛利，可能劝退部分顾客" },
];
const BRANCH_PRICE_INDEX = Object.fromEntries(BRANCH_PRICE_STRATEGIES.map((p) => [p.id, p]));

/* 门店估值波动权重：老板自选，权重越高每日涨跌越猛 */
const BRANCH_VOLATILITIES = [
  { id: "steady", name: "稳健", mult: 0.5, desc: "日波动约 ±1.5%，慢慢涨" },
  { id: "balanced", name: "均衡", mult: 1, desc: "日波动约 ±3%，涨跌都正常" },
  { id: "bold", name: "激进", mult: 2, desc: "日波动约 ±6%，可能大涨也可能大跌" },
];
const BRANCH_VOLATILITY_INDEX = Object.fromEntries(BRANCH_VOLATILITIES.map((v) => [v.id, v]));

/* 成就：结算/操作后检查，只解锁一次 */
const ACHIEVEMENTS = [
  { id: "firstDay", name: "开业大吉", icon: "🎉", desc: "完成第一天营业", test: (s) => s.history.length >= 1 },
  { id: "profit300", name: "日进斗金", icon: "💰", desc: "单日净利 ≥ ¥300", test: (s) => s.history.some((h) => h.profit >= 30000) },
  { id: "sales30", name: "门庭若市", icon: "🧍", desc: "单日成交 ≥ 30 单", test: (s) => s.history.some((h) => h.sales >= 30) },
  { id: "rep4", name: "有口皆碑", icon: "⭐", desc: "口碑达到 4.0", test: (s) => s.reputation >= 4 },
  { id: "staff2", name: "人手齐备", icon: "🧑‍🍳", desc: "同时雇佣 2 名员工", test: (s) => s.staff.length >= 2 },
  { id: "branch1", name: "开枝散叶", icon: "🏬", desc: "开出第 1 家分店", test: (s) => s.branches.length >= 1 },
  { id: "cash6000", name: "小有积蓄", icon: "🏦", desc: "资产达到 ¥6000", test: (s) => s.cash + bookValue() >= 600000 },
  { id: "units100", name: "百件达成", icon: "📦", desc: "累计卖出 100 件", test: (s) => s.totalUnits >= 100 },
];

/* 新手目标：随时根据当前状态计算进度 */
const GOALS = [
  { id: "day1", name: "完成第一天营业", icon: "🌅", target: 1, value: (s) => s.history.length },
  { id: "profit", name: "单日净利达到 ¥300", icon: "📈", target: 30000, value: (s) => Math.max(0, ...s.history.map((h) => h.profit), 0) },
  { id: "rep", name: "口碑达到 4.0", icon: "⭐", target: 4, value: (s) => s.reputation },
  { id: "staff", name: "同时雇佣 2 名员工", icon: "🧑‍🍳", target: 2, value: (s) => s.staff.length },
  { id: "branch", name: "开出第 1 家分店", icon: "🏬", target: 1, value: (s) => s.branches.length },
  { id: "units", name: "累计卖出 100 件", icon: "📦", target: 100, value: (s) => s.totalUnits },
];



const JOBS = [
  {
    id: "housewife", label: "家庭主妇", sprite: "customer_housewife.png", w: 0.13,
    age: "middle", wealth: "average", affinity: { 叶菜: 1.3, 根茎: 1.25, 茄果: 1.15, 菌菇豆类: 1.1 },
    patience: 0.05, social: 0.12, bulk: 0.05, mood: "neutral",
    demeanors: ["手里攥着购物清单", "先翻看今天的菜叶"],
    greet: ["老板，今天的菜新鲜不？", "给我称点菜，家里等着做饭。", "又来啦，今天有什么好的？"],
  },
  {
    id: "office", label: "上班族", sprite: "customer_office_worker.png", w: 0.13,
    age: "young", wealth: "average", affinity: { 茄果: 1.2, 水果: 1.15, 菌菇豆类: 1.1 },
    patience: -0.15, social: -0.12, bulk: -0.05, mood: "impatient",
    demeanors: ["不停看手表", "手机还贴在耳边"],
    greet: ["老板快点，我赶时间。", "有什么能直接拿走的？", "随便装一点，要迟到了。"],
  },
  {
    id: "student", label: "学生", sprite: "customer_student.png", w: 0.11,
    age: "teen", wealth: "tight", affinity: { 水果: 1.3, 茄果: 1.05 },
    patience: 0.05, social: 0.15, bulk: -0.1, mood: "curious",
    demeanors: ["把零钱数了两遍", "盯着水果看了半天"],
    greet: ["老板好，我看看便宜的。", "这个多少钱呀？", "有打折的吗？"],
  },
  {
    id: "regular", label: "老顾客", sprite: "customer_regular.png", w: 0.09,
    age: "elder", wealth: "average", affinity: { 叶菜: 1.3, 根茎: 1.25, 葱姜调味: 1.1 },
    patience: 0.15, social: 0.2, bulk: 0.05, mood: "neutral",
    demeanors: ["熟门熟路地走到摊位前", "先和你点头打招呼"],
    greet: ["老样子，还是你这儿靠谱。", "又来了，给我留点好的。", "今天进的什么货？"],
  },
  {
    id: "blogger", label: "美食博主", sprite: "customer_blogger.png", w: 0.05,
    age: "young", wealth: "rich", affinity: { 水果: 1.35, 茄果: 1.3, 菌菇豆类: 1.15 },
    patience: 0.05, social: 0.25, bulk: -0.05, mood: "curious",
    demeanors: ["举起手机找角度", "对颜色格外挑剔"],
    greet: ["听说你家菜不错，我来拍一下。", "有适合做沙拉的食材吗？", "这颜色真好看，可以拍吗？"],
  },
  {
    id: "fitness", label: "健身达人", sprite: "customer_fitness.png", w: 0.06,
    age: "young", wealth: "average", affinity: { 根茎: 1.3, 水果: 1.2, 叶菜: 1.15 },
    patience: 0.1, social: -0.05, bulk: 0.08, mood: "focused",
    demeanors: ["肩膀挺得很直", "扫一眼就看配比"],
    greet: ["有高蛋白低热量的吗？", "给我来点能生吃的。", "今天想配个健身餐。"],
  },
  {
    id: "sanitation", label: "环卫工人", sprite: "customer_sanitation.png", w: 0.11,
    age: "middle", wealth: "tight", affinity: { 根茎: 1.35, 叶菜: 1.2 },
    patience: 0.2, social: -0.05, bulk: 0.02, mood: "tired",
    demeanors: ["袖口还沾着清晨的灰", "把扫帚靠在门边"],
    greet: ["刚扫完这条街，来点实惠的。", "给我挑几个耐放的。", "老板，今天有便宜菜吗？"],
  },
  {
    id: "police", label: "警察", sprite: "customer_police.png", w: 0.06,
    age: "young", wealth: "average", affinity: { 水果: 1.25, 茄果: 1.1 },
    patience: 0.15, social: -0.1, bulk: 0.02, mood: "focused",
    demeanors: ["站姿笔直", "目光很快扫过整排货架"],
    greet: ["值完班，随便买点。", "给我来两个苹果。", "今天菜挺全的。"],
  },
  {
    id: "soldier", label: "军人", sprite: "customer_soldier.png", w: 0.05,
    age: "young", wealth: "average", affinity: { 根茎: 1.25, 水果: 1.15 },
    patience: 0.2, social: -0.05, bulk: 0.1, mood: "focused",
    demeanors: ["站得笔直，说话干脆", "手里的布袋叠得方方正正"],
    greet: ["来点耐放的，谢谢。", "不用挑，够称就行。", "给我装一份。"],
  },
  {
    id: "teen", label: "中学生", sprite: "customer_teen.png", w: 0.08,
    age: "teen", wealth: "average", affinity: { 水果: 1.35, 茄果: 1.05 },
    patience: -0.05, social: 0.2, bulk: -0.08, mood: "curious",
    demeanors: ["耳机挂在脖子上", "东张西望看新鲜"],
    greet: ["老板，草莓甜吗？", "我就要一盒。", "同学说你家水果不错。"],
  },
  {
    id: "wealthy", label: "阔太太", sprite: "customer_wealthy.png", w: 0.05,
    age: "middle", wealth: "rich", affinity: { 水果: 1.4, 茄果: 1.2, 菌菇豆类: 1.15 },
    patience: 0.1, social: 0.1, bulk: 0.15, mood: "proud",
    demeanors: ["下巴微微抬起", "拎着包，不太看价签"],
    greet: ["把最好的水果给我看看。", "今天的货新不新鲜？", "给我挑一盒品相好的。"],
  },
  {
    id: "poorElder", label: "节俭老人", sprite: "customer_poor_elder.png", w: 0.08,
    age: "elder", wealth: "tight", affinity: { 根茎: 1.3, 叶菜: 1.25, 葱姜调味: 1.1 },
    patience: 0.25, social: 0.05, bulk: -0.02, mood: "cautious",
    demeanors: ["先问价，再伸手翻看", "把布袋叠好放在臂弯"],
    greet: ["这个怎么卖？", "有没有便宜一点的？", "我少买点，行不行？"],
  },
];

const MOODS = {
  neutral: { label: "平静" },
  curious: { label: "东张西望" },
  cautious: { label: "眉头紧锁" },
  proud: { label: "神色傲气" },
  tired: { label: "一脸疲惫" },
  focused: { label: "神情专注" },
  expect: { label: "眼里有期待" },
  hesitant: { label: "拿不定主意" },
  impatient: { label: "有些不耐烦" },
  happy: { label: "眉开眼笑" },
  disappointed: { label: "有点失望" },
};

const NAMES = {
  teen: ["乐乐", "果果", "苗苗", "小宇", "小雨", "阿哲"],
  young: ["小李", "小林", "楠楠", "阿凯", "小陶", "何同学"],
  middle: ["阿珍", "王阿姨", "周姐", "大刘", "赵老师", "钱师傅", "张姨"],
  elder: ["老许", "陈叔", "孙大爷", "李奶奶", "吴伯", "周婆婆"],
};

/* 新开局口碑基线：所有账号与游客都从同一口碑起步 */
const INITIAL_REPUTATION = 3.2;

const state = {
  booted: false,
  day: 0,
  seed: 2024,
  cash: 200000,
  reputation: INITIAL_REPUTATION,
  /* 玩家自取店名，空字符串时回退到店型默认招牌 */
  shopName: "",
  pendingName: "",
  /* 服务分：由评价、成交转化、缺货与拒绝滚动而来，影响次日门店客流 */
  serviceScore: 60,
  location: null,
  prices: {},
  inventory: {},
  backroom: {},
  supplyQuota: {},
  supplyUsed: {},
  shipments: [],
  market: 1,
  weather: null,
  event: null,
  festival: null,
  rival: null,
  weekend: false,
  trafficMult: 1,
  phase: "prep",
  speed: 2,
  dayRent: 0,
  /* 首日租金已在选址确认时扣除，避免开局当天重复计租 */
  rentPaidDay: 0,
  daySpoilage: 0,
  dayRevenue: 0,
  dayCogs: 0,
  /* 当日售出商品的进价成本与进货台账：用于精确对账 */
  daySoldValue: 0,
  dayPurchaseCost: 0,
  dayPurchaseValue: 0,
  baseWealth: 200000,
  ratings: [],
  queue: [],
  currentIndex: -1,
  salesCount: 0,
  stockoutsToday: 0,
  serving: false,
  lastCheck: { ok: true, checks: [], issues: [] },
  shelfCat: CATEGORIES[0].name,
  shelfPage: 0,
  backCat: "all",
  backQuery: "",
  backLowOnly: false,
  mapMode: "start",
  pendingLoc: null,
  decor: { ...DEFAULT_DECOR },
  build: null,
  dayDecorCost: 0,
  /* 装修损益台账：一次性投入、累计维护、施工停业与意外赔付 */
  decorSpend: 0,
  decorMaintainTotal: 0,
  decorDowntimeDays: 0,
  decorDowntimeRent: 0,
  decorLostRevenue: 0,
  decorRiskCost: 0,
  decorRiskEvents: 0,
  dayRiskCost: 0,
  pendingSellBranch: null,
  /* 分店切换：正在远程查看的分店 id，null 表示总店 */
  activeBranchId: null,
  /* 店长代管：自动进货/定价/上架并自动开门；招聘需老板审批 */
  managerAuto: false,
  hireRequests: [],
  daySpoilDiag: null,
  /* 进货渠道：street / market / cold */
  supplier: "market",
  /* 夜市清仓折扣：0.5–0.9 */
  clearanceRate: 0.5,
  dayUtility: 0,
  backView: "goods",
  autoPilot: false,
  /* 托管议价风格：strict 严肃到底 / balanced 中庸 / yield 妥协到底 */
  autoStyle: "balanced",
  /* 历史订单：最近 300 单，用于汇总与复盘 */
  orders: [],
  orderSeq: 0,
  /* 历史订单筛选：all 或 "起始-结束" 经营天数区间 */
  orderRange: "all",
  slot: null,
  clearance: false,
  condition: {},
  careSet: {},
  sprayed: {},
  wholesale: {},
  goldenCat: null,
  promo: null,
  dayPromoCost: 0,
  dayGiftCost: 0,
  dayVisitors: 0,
  dayBuyers: 0,
  dayBargainTries: 0,
  dayBargainWins: 0,
  dayDeclines: 0,
  dayMaxTicket: 0,
  dayGoodsUnits: {},
  dayGoodsRevenue: {},
  goodsDemand: {},
  daySlots: {},
  daySpoilRate: 0,
  daySalvage: 0,
  trafficBreakdown: null,
  overdueDays: 0,
  lastShortfall: 0,
  bankrupt: false,
  bankruptReason: "",
  bankruptDay: 0,
  quit: false,
  quitReason: "",
  quitDay: 0,
  quitPenalty: 0,
  quitLiquidation: 0,
  quitBranchLiquidation: 0,
  quitShortfall: 0,
  catRevenue: {},
  catCogs: {},
  shopType: null,
  size: "small",
  staff: [],
  staffAutoDay: 0,
  branches: [],
  dayStaffCost: 0,
  dayBranchProfit: 0,
  pendingSize: "stall",
  pendingBranchType: "bbq",
  pendingBranchLoc: "market",
  pendingBranchSize: "small",
  pendingStaffEvent: null,
  promoBoost: 1,
  history: [],
  achievements: {},
  totalUnits: 0,
  dayUnits: 0,
  settlement: null,
  suppressSave: false,
  servicePaused: false,
  servingCustomer: false,
  /* 用户与自适应经营 */
  userId: null,
  trafficAdapt: 1,
  decorWear: 0,
  dayBasketFactor: 1,
  dayRoundOff: 0,
  /* 阶段 / 货架 */
  stageReached: 1,
  stageUp: null,
  lastSettlement: null,
  shelfTier: "wood",
};

/* 开局快照：新店初始化时整体还原，避免上一局的历史、口碑、门店数据残留 */
const INITIAL_STATE = JSON.parse(JSON.stringify(state));

function resetRunForNewShop() {
  const keep = { userId: state.userId, suppressSave: state.suppressSave, speed: state.speed };
  Object.assign(state, JSON.parse(JSON.stringify(INITIAL_STATE)), keep);
  /* 口碑与新局评价必须归零重来，不继承上一家店 */
  state.reputation = INITIAL_REPUTATION;
  state.ratings = [];
  state.shopName = "";
  state.pendingName = "";
  /* 账号档案也从零开始，避免显示上一局的经营天数与净利 */
  if (state.userId) {
    const users = readUsers();
    if (users[state.userId]) {
      users[state.userId].totals = {};
      writeUsers(users);
    }
  }
}

const $ = (id) => document.getElementById(id);
const els = {
  dayLabel: $("dayLabel"),
  locationChip: $("locationChip"),
  locationName: $("locationName"),
  locationRent: $("locationRent"),
  branchSwitchBtn: $("branchSwitchBtn"),
  branchSwitchName: $("branchSwitchName"),
  branchSwitchMeta: $("branchSwitchMeta"),
  branchSwitchMenu: $("branchSwitchMenu"),
  seasonChip: $("seasonChip"),
  weatherChip: $("weatherChip"),
  eventChip: $("eventChip"),
  debtChip: $("debtChip"),
  checkPill: $("checkPill"),
  cashKpi: $("cashKpi"),
  wealthKpi: $("wealthKpi"),
  repKpi: $("repKpi"),
  signSub: $("signSub"),
  shelfWall: $("shelfWall"),
  shelfTabs: $("shelfTabs"),
  shelfPager: $("shelfPager"),
  shelfPageLabel: $("shelfPageLabel"),
  shelfPrev: $("shelfPrev"),
  shelfNext: $("shelfNext"),
  stage: $("customerStage"),
  floorProps: $("floorProps"),
  queueStrip: $("queueStrip"),
  receipt: $("receipt"),
  register: $("register"),
  registerCash: $("registerCash"),
  scaleScreen: $("scaleScreen"),
  counterSales: $("counterSales"),
  phaseMini: $("phaseMini"),
  phaseLabel: $("phaseLabel"),
  phaseHint: $("phaseHint"),
  primaryBtn: $("primaryBtn"),
  skipBuildBtn: $("skipBuildBtn"),
  sceneTip: $("sceneTip"),
  trafficLane: $("trafficLane"),
  festivalDeco: $("festivalDeco"),
  competitorSign: $("competitorSign"),
  door: $("door"),
  doorSign: $("doorSign"),
  speedGroup: $("speedGroup"),
  backstageBtn: $("backstageBtn"),
  backstage: $("backstage"),
  backstageMask: $("backstageMask"),
  backstageClose: $("backstageClose"),
  ledgerSummary: $("ledgerSummary"),
  ledgerList: $("ledgerList"),
  backTabs: $("backTabs"),
  backSearch: $("backSearch"),
  backSupplier: $("backSupplier"),
  backLowOnly: $("backLowOnly"),
  backFillCat: $("backFillCat"),
  backStockCat: $("backStockCat"),
  backViews: $("backViews"),
  goodsPanel: $("goodsPanel"),
  decorPanel: $("decorPanel"),
  strategyPanel: $("strategyPanel"),
  staffPanel: $("staffPanel"),
  branchPanel: $("branchPanel"),
  growthPanel: $("growthPanel"),
  ordersPanel: $("ordersPanel"),
  autoPilotToggle: $("autoPilotToggle"),
  pauseBtn: $("pauseBtn"),
  goodsModal: $("goodsModal"),
  goodsModalBody: $("goodsModalBody"),
  shopTypeBar: $("shopTypeBar"),
  mapSizes: $("mapSizes"),
  rulebookBtn: $("rulebookBtn"),
  rulebookModal: $("rulebookModal"),
  rulebookBody: $("rulebookBody"),
  resetGameBtn: $("resetGameBtn"),
  employeeModal: $("employeeModal"),
  employeeModalBody: $("employeeModalBody"),
  overlay: $("settleOverlay"),
  settleSub: $("settleSub"),
  settleNumbers: $("settleNumbers"),
  checkList: $("checkList"),
  nextDayBtn: $("nextDayBtn"),
  bankruptOverlay: $("bankruptOverlay"),
  bankruptReason: $("bankruptReason"),
  bankruptStats: $("bankruptStats"),
  bankruptResetBtn: $("bankruptResetBtn"),
  quitBizBtn: $("quitBizBtn"),
  quitOverlay: $("quitOverlay"),
  quitQuote: $("quitQuote"),
  quitWarning: $("quitWarning"),
  quitCancelBtn: $("quitCancelBtn"),
  quitConfirmBtn: $("quitConfirmBtn"),
  quitResultOverlay: $("quitResultOverlay"),
  quitReason: $("quitReason"),
  quitStats: $("quitStats"),
  quitResetBtn: $("quitResetBtn"),
  toast: $("toast"),
  userChip: $("userChip"),
  authOverlay: $("authOverlay"),
  authTitle: $("authTitle"),
  authHint: $("authHint"),
  authForm: $("authForm"),
  authName: $("authName"),
  authPass: $("authPass"),
  authError: $("authError"),
  authLoginBtn: $("authLoginBtn"),
  authRegisterBtn: $("authRegisterBtn"),
  authGuestBtn: $("authGuestBtn"),
  authProfile: $("authProfile"),
  authStats: $("authStats"),
  authLogoutBtn: $("authLogoutBtn"),
  authCloseBtn: $("authCloseBtn"),
  mapOverlay: $("mapOverlay"),
  mapMarkers: $("mapMarkers"),
  mapDetail: $("mapDetail"),
  mapConfirm: $("mapConfirm"),
  mapClose: $("mapClose"),
  mapFootNote: $("mapFootNote"),
};

/* ---------------- 工具 ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(a, b) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return h >>> 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = (ms) => sleep(ms / Math.max(1, state.speed));
const yuan = (cents) => (cents / 100).toFixed(2);
const money = (cents) => "¥" + (cents / 100).toLocaleString("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const rentLabel = (cents) => (cents > 0 ? `日租 ${money(cents)}` : "免租");
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const lerp = ([a, b], t) => a + (b - a) * t;

function weighted(list, rng) {
  const total = list.reduce((sum, item) => sum + item.w, 0);
  let roll = rng() * total;
  for (const item of list) {
    roll -= item.w;
    if (roll <= 0) return item;
  }
  return list[list.length - 1];
}

function pickTraits(rng) {
  const pool = TRAITS.slice();
  const count = rng() < 0.55 ? 2 : 1;
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return picked;
}

function traitTotal(traits, field) {
  return traits.reduce((sum, trait) => sum + (trait[field] || 0), 0);
}

function iconStyle(goods) {
  const icon = goods.icon;
  if (icon.emoji) return "";
  const base = `background-image:url('${SPRITE_DIR}${icon.src}');background-repeat:no-repeat;background-color:#f7f0df;`;
  if (icon.cols && icon.rows) {
    const col = icon.cell % icon.cols;
    const row = Math.floor(icon.cell / icon.cols);
    const x = icon.cols === 1 ? 50 : (col / (icon.cols - 1)) * 100;
    const y = icon.rows === 1 ? 50 : (row / (icon.rows - 1)) * 100;
    return `${base}background-size:${icon.cols * 100}% ${icon.rows * 100}%;background-position:${x}% ${y}%;`;
  }
  return `${base}background-size:cover;background-position:center;`;
}

function iconMarkup(goods, extraClass = "") {
  if (goods.icon?.emoji) {
    return `<span class="good-icon emoji-icon ${extraClass}" role="img" aria-label="${goods.name}">${goods.icon.emoji}</span>`;
  }
  return `<span class="good-icon ${extraClass}" style="${iconStyle(goods)}" role="img" aria-label="${goods.name}"></span>`;
}

/* ---------------- 库存与账务 ---------------- */
/* 台面库存用于销售；后台库存用于囤货，需先上架才能卖。 */
function shelfStockOf(gid) {
  return (state.inventory[gid] || []).reduce((sum, lot) => sum + lot.qty, 0);
}

function backStockOf(gid) {
  return (state.backroom[gid] || []).reduce((sum, lot) => sum + lot.qty, 0);
}

/* 顾客能看到的可售库存 */
function stockOf(gid) {
  return shelfStockOf(gid);
}

function totalStockOf(gid) {
  return shelfStockOf(gid) + backStockOf(gid);
}

/* 货值：台面 + 后台 + 在途，全部按各批次的真实进价计价 */
function bookValue() {
  const stored = [...Object.values(state.inventory), ...Object.values(state.backroom)].reduce(
    (sum, lots) => sum + lots.reduce((acc, lot) => acc + lot.qty * lot.cost, 0), 0
  );
  /* 在途货物已经付过钱，计入资产，保证对账守恒 */
  const transit = (state.shipments || []).reduce((sum, ship) => sum + ship.qty * ship.cost, 0);
  return stored + transit;
}

/* 分店估值属于老板资产，但不参与主店现金对账 */
function branchAssetValue() {
  return (state.branches || []).reduce((sum, branch) => sum + (branch.value || branch.invested || 0), 0);
}

/* 资产拆项：现金 + 货值（按进价）+ 分店估值 */
function assetBreakdown() {
  const cash = state.cash;
  const goods = bookValue();
  const branches = branchAssetValue();
  return { cash, goods, branches, total: cash + goods + branches };
}

/* 顶栏、结算、破产、阶段统一使用「总资产」口径 */
function totalAssetValue() {
  return assetBreakdown().total;
}

function avgUnitCost(gid) {
  const lots = [...(state.inventory[gid] || []), ...(state.backroom[gid] || [])];
  const qty = lots.reduce((sum, lot) => sum + lot.qty, 0);
  if (qty <= 0) return 0;
  return lots.reduce((sum, lot) => sum + lot.qty * lot.cost, 0) / qty;
}

/* 同成本、同入库日、同保质期的批次合并，避免频繁搬货产生大量碎片批次 */
function addLot(area, gid, lot) {
  if (!state[area][gid]) state[area][gid] = [];
  const list = state[area][gid];
  const same = list.find((item) => item.cost === lot.cost && item.dayIn === lot.dayIn && item.shelf === lot.shelf && (item.decayMult || 1) === (lot.decayMult || 1));
  if (same) same.qty += lot.qty;
  else list.push({ ...lot });
}

/* 后台 → 台面：按 FIFO 搬货，最多补满台面 */
function moveToShelf(gid, wanted = "fill") {
  const goods = GOOD_INDEX[gid];
  if (!goods) return { moved: 0, room: 0, back: 0 };
  const room = Math.max(0, capOf(goods) - shelfStockOf(gid));
  const back = backStockOf(gid);
  if (room <= 0 || back <= 0) return { moved: 0, room, back };
  let remaining = wanted === "fill" ? room : Math.min(Math.max(0, Number(wanted) || 0), room);
  const movedLots = [];
  const kept = [];
  for (const lot of state.backroom[gid] || []) {
    if (remaining > 0 && lot.qty > 0) {
      const take = Math.min(lot.qty, remaining);
      lot.qty -= take;
      remaining -= take;
      movedLots.push({ ...lot, qty: take });
    }
    if (lot.qty > 0) kept.push(lot);
  }
  state.backroom[gid] = kept;
  for (const lot of movedLots) addLot("inventory", gid, lot);
  return { moved: movedLots.reduce((sum, lot) => sum + lot.qty, 0), room, back };
}

/* 台面 → 后台：打烊前把易损商品收回仓库，按 FIFO 搬运，最多填满后台 */
function moveToBackroom(gid, wanted = "fill") {
  const goods = GOOD_INDEX[gid];
  if (!goods) return { moved: 0, room: 0, shelf: 0 };
  const room = Math.max(0, backCapOf(goods) - backStockOf(gid) - shipmentQtyOf(gid));
  const shelf = shelfStockOf(gid);
  if (room <= 0 || shelf <= 0) return { moved: 0, room, shelf };
  let remaining = wanted === "fill" ? room : Math.min(Math.max(0, Number(wanted) || 0), room);
  const movedLots = [];
  const kept = [];
  for (const lot of state.inventory[gid] || []) {
    if (remaining > 0 && lot.qty > 0) {
      const take = Math.min(lot.qty, remaining);
      lot.qty -= take;
      remaining -= take;
      movedLots.push({ ...lot, qty: take });
    }
    if (lot.qty > 0) kept.push(lot);
  }
  state.inventory[gid] = kept;
  for (const lot of movedLots) addLot("backroom", gid, lot);
  return { moved: movedLots.reduce((sum, lot) => sum + lot.qty, 0), room, shelf };
}

/* 把所有能上架的货都摆到台面，返回实际搬运件数 */
function autoStockShelf() {
  let units = 0;
  for (const goods of GOODS) units += moveToShelf(goods.id, "fill").moved;
  return units;
}

function unitCost(goods) {
  const wave = state.wholesale[goods.cat] || 1;
  return Math.max(1, Math.round(goods.cost * state.market * wave * seasonPriceMult(goods) * supplierOf().price));
}

/* 卖相/成色：0-100，受时间衰减与维护操作影响 */
function appealOf(gid) {
  return Math.round(clamp(state.condition[gid] ?? 80, 0, 100));
}

function appealLabel(appeal) {
  if (appeal >= 88) return "水灵";
  if (appeal >= 72) return "不错";
  if (appeal >= 55) return "一般";
  if (appeal >= 40) return "发蔫";
  return "打蔫挑剩";
}

function priceBounds(goods) {
  const unit = unitCost(goods);
  return {
    lower: Math.max(1, Math.ceil(unit * 1.05)),
    upper: goods.base * 2,
    unit,
  };
}

function takeStock(gid, qty) {
  let remaining = qty;
  let cogs = 0;
  const kept = [];
  for (const lot of state.inventory[gid] || []) {
    if (remaining > 0 && lot.qty > 0) {
      const take = Math.min(lot.qty, remaining);
      lot.qty -= take;
      remaining -= take;
      cogs += take * lot.cost;
    }
    if (lot.qty > 0) kept.push(lot);
  }
  state.inventory[gid] = kept;
  /* 记录当日售出商品实际减少的货值（按批次进价） */
  state.daySoldValue = (state.daySoldValue || 0) + cogs;
  return cogs;
}

function spoilExpired(day) {
  let gross = 0;
  let salvage = 0;
  let qty = 0;
  /* 损耗归因：按品类 / 商品 / 台面与后台 / 衰减与过期 / 库龄统计 */
  const diag = {
    byCat: {},
    top: [],
    decay: 0,
    decayQty: 0,
    expired: 0,
    expiredQty: 0,
    shelfLoss: 0,
    backLoss: 0,
    ageSum: 0,
    ageQty: 0,
  };
  /* 理货会减缓腐损；装修越好，商品衰减越慢，毛坯店反而更容易坏 */
  const stockerBonus = Math.min(0.35, dutyPower("stocker") * 0.12);
  const careMult = Math.max(0.4, (1 - stockerBonus) * decorGoodsMult());
  diag.careMult = +careMult.toFixed(2);
  diag.stockerBonus = +stockerBonus.toFixed(2);
  const noteLoss = (goods, area, netLoss, lostQty, ageDays, expired) => {
    const cat = goods.cat || "其他";
    const entry = diag.byCat[cat] || (diag.byCat[cat] = { loss: 0, qty: 0 });
    entry.loss += netLoss;
    entry.qty += lostQty;
    diag.top.push({ gid: goods.id, name: goods.name, loss: netLoss, qty: lostQty, expired });
    if (expired) {
      diag.expired += netLoss;
      diag.expiredQty += lostQty;
    } else {
      diag.decay += netLoss;
      diag.decayQty += lostQty;
    }
    if (area === "inventory") diag.shelfLoss += netLoss;
    else diag.backLoss += netLoss;
    diag.ageSum += ageDays * lostQty;
    diag.ageQty += lostQty;
  };
  /* 台面与后台都会损耗；烧烤后台冰箱慢、台面快 */
  for (const area of ["inventory", "backroom"]) {
    for (const gid of Object.keys(state[area])) {
      const goods = GOOD_INDEX[gid];
      if (!goods) continue;
      const kept = [];
      for (const lot of state[area][gid]) {
        /* 时间越久，损耗越快：按批次年龄与保质期计算加速系数 */
        const age = Math.max(0, day - lot.dayIn);
        const ageBoost = 1 + Math.min(2, age / Math.max(1, lot.shelf)) * 0.7;
        const rate = Math.min(0.72, decayRateOf(goods) * storageDecayMult(area) * ageBoost * careMult * (lot.decayMult || 1));
        const acc = (lot.decayAcc || 0) + lot.qty * rate;
        const lost = Math.min(lot.qty, Math.floor(acc));
        if (lost > 0) {
          lot.qty -= lost;
          lot.decayAcc = acc - lost;
          const cost = lost * lot.cost;
          gross += cost;
          qty += lost;
          noteLoss(goods, area, cost, lost, age, false);
        } else {
          lot.decayAcc = acc;
        }
        if (lot.qty <= 0) continue;
        if (lotExpireDay(goods, lot) <= day) {
          const cost = lot.qty * lot.cost;
          gross += cost;
          /* 过期货按两成残值处理（堆肥/低价清货），净损耗更接近真实经营 */
          const salvagePart = Math.round(cost * 0.2);
          salvage += salvagePart;
          qty += lot.qty;
          noteLoss(goods, area, cost - salvagePart, lot.qty, age, true);
        } else {
          kept.push(lot);
        }
      }
      state[area][gid] = kept;
    }
  }
  /* 合并同名商品，按净损失排序，保留前 5 名 */
  diag.top = Object.values(diag.top.reduce((acc, item) => {
    const cur = acc[item.gid] || (acc[item.gid] = { gid: item.gid, name: item.name, loss: 0, qty: 0, expiredQty: 0 });
    cur.loss += item.loss;
    cur.qty += item.qty;
    if (item.expired) cur.expiredQty += item.qty;
    return acc;
  }, {})).sort((a, b) => b.loss - a.loss).slice(0, 5);
  diag.avgAge = diag.ageQty ? +(diag.ageSum / diag.ageQty).toFixed(1) : 0;
  diag.total = gross - salvage;
  state.daySpoilDiag = diag;
  state.cash += salvage;
  state.daySalvage = salvage;
  return { loss: gross - salvage, gross, salvage, qty, diag };
}

/* ---------------- 装修 ---------------- */
function decorItem(cat) {
  return DECOR_INDEX[state.decor[cat]] || null;
}

function decorQuality() {
  const list = DECOR_CATS.map((cat) => decorItem(cat.id)).filter(Boolean);
  if (!list.length) return 1;
  return list.reduce((sum, item) => sum + item.quality, 0) / list.length;
}

function decorAppeal() {
  return DECOR_CATS.reduce((sum, cat) => sum + (decorItem(cat.id)?.appeal || 0), 0);
}

/* 装修净值 0–1：把 1–5 分折算成比例，旧化耗损直接折价 */
function decorScore() {
  const wear = clamp(state.decorWear || 0, 0, 0.8);
  return +clamp(((decorQuality() - 1) / 4) * (1 - wear * 0.75), 0, 1).toFixed(3);
}

/* 客流系数：毛坯店约 -10%，满配装修约 +50%，单品 appeal 再叠加 */
function decorTrafficMult() {
  const wear = clamp(state.decorWear || 0, 0, 0.8);
  return +(0.9 + decorScore() * 0.14 + decorAppeal() * (1 - wear * 0.5) * 0.75).toFixed(3);
}

/* 商品损耗系数：不装修货更容易坏（1.12），好装修到 0.9 左右，再乘保鲜设备 */
function decorGoodsMult() {
  const wear = clamp(state.decorWear || 0, 0, 0.8);
  const base = 1.12 - decorScore() * 0.18 + wear * 0.1;
  return +(base * decorSpoil()).toFixed(3);
}

function decorSpoil() {
  const fresh = decorItem("fresh");
  return fresh ? fresh.spoil : 1;
}

/* 装修日维护费：跟随铺面规格放大，并叠加装修耗损（每日递增，翻新后回落） */
function decorDaily() {
  const base = DECOR_CATS.reduce((sum, cat) => sum + (decorItem(cat.id)?.daily || 0), 0);
  const wear = clamp(state.decorWear || 0, 0, 0.8);
  return Math.round(base * sizeOf().capMult * (1 + wear));
}

/* 装修资产：工程原值按耗损折旧后的现值 */
function decorReplacementValue() {
  return DECOR_CATS.reduce((sum, cat) => sum + (decorItem(cat.id)?.price || 0), 0);
}

function decorBookValue() {
  return Math.round(decorReplacementValue() * (1 - clamp(state.decorWear || 0, 0, 0.8)));
}

/* 未知风险：装修越差、耗损越重，每天出事的概率越高。
 * 精装约 1.5%/天，普通装修 3%–6%/天，毛坯最差封顶 18%/天。 */
function decorRiskRate() {
  const wear = clamp(state.decorWear || 0, 0, 0.8);
  const gap = Math.max(0, 5 - decorQuality());
  return +clamp(0.015 + gap * 0.02 + wear * 0.1, 0.005, 0.18).toFixed(3);
}

const DECOR_INCIDENTS = {
  floor: { name: "顾客滑倒", text: "地面不防滑，顾客摔了一跤，赔了医药费", cost: [15000, 60000], rep: 0.18 },
  wall: { name: "墙面发霉返工", text: "墙面受潮发霉，被迫停工返工", cost: [8000, 30000], rep: 0.08 },
  shelf: { name: "货架倾倒", text: "货架固定不牢倒了，砸坏一批货", cost: [10000, 45000], rep: 0.15 },
  light: { name: "线路短路", text: "老旧线路短路跳闸，损失食材又赔电工", cost: [6000, 26000], rep: 0.1 },
  fresh: { name: "整批变质", text: "保鲜不到位，一批货整箱变质", cost: [12000, 40000], rep: 0.12 },
  sign: { name: "招牌掉落", text: "招牌被风吹落，赔了路人又得重装", cost: [5000, 25000], rep: 0.2 },
};

/* 开门前抽一次意外：只在当前最薄弱的装修项上出事，好装修显著降低概率 */
function rollDecorIncident(rng) {
  if (rng() >= decorRiskRate()) return null;
  const worst = DECOR_CATS
    .map((cat) => decorItem(cat.id))
    .filter(Boolean)
    .sort((a, b) => a.quality - b.quality)[0];
  if (!worst) return null;
  const incident = DECOR_INCIDENTS[worst.cat] || DECOR_INCIDENTS.floor;
  const cost = Math.round(incident.cost[0] + rng() * (incident.cost[1] - incident.cost[0]));
  const paid = Math.min(state.cash, cost);
  state.cash -= paid;
  state.baseWealth -= paid;
  state.decorRiskCost += paid;
  state.decorRiskEvents += 1;
  state.dayRiskCost += paid;
  state.reputation = clamp(state.reputation - incident.rep, 1, 5);
  return { name: incident.name, text: incident.text, cost: paid, item: worst.name };
}

/* 装修日增益估算：以近 7 天日均营收为基准，折算客流、溢价与减损 */
function decorBenefitEstimate() {
  const recent = state.history.slice(-7).map((h) => h.revenue).filter((v) => v > 0);
  const base = recent.length
    ? recent.reduce((a, b) => a + b, 0) / recent.length
    : Math.max(1500000, (state.dayRevenue || 0));
  const trafficGain = base * Math.max(0, decorTrafficMult() - 0.9) * 0.35;
  const premiumGain = base * decorScore() * 0.14;
  const spoilSaving = Math.max(0, 1.12 - decorGoodsMult()) * bookValue() * 0.06;
  const gross = trafficGain + premiumGain + spoilSaving;
  const net = gross - decorDaily();
  const payback = net > 0 ? Math.ceil(decorReplacementValue() / net) : 0;
  return { base, trafficGain, premiumGain, spoilSaving, gross, net, payback };
}

function decorHazards() {
  return DECOR_CATS
    .map((cat) => decorItem(cat.id))
    .filter((item) => item && item.hazard)
    .map((item) => ({ name: item.name, hazard: item.hazard }));
}

function decorStars(quality) {
  const filled = Math.round(quality);
  return "★".repeat(filled) + "☆".repeat(Math.max(0, 5 - filled));
}

function applyDecorTheme() {
  const scene = $("storeScene");
  if (!scene) return;
  for (const cat of DECOR_CATS) scene.dataset[cat.id] = state.decor[cat.id] || "";
}

function applyDecor(item) {
  state.decor[item.cat] = item.id;
  /* 新装修落地，旧耗损折半 */
  state.decorWear = +Math.max(0, (state.decorWear || 0) * 0.4).toFixed(3);
  applyDecorTheme();
}

/* ---------------- 每日生成 ---------------- */
function pickEvent(day, rng) {
  const cycle = ((day - 1) % 30) + 1;
  const calendar = {
    7: "周末集市",
    14: "发薪日",
    21: "社区节日",
    28: "街角竞争店开业",
  };
  if (calendar[cycle]) return EVENTS.find((item) => item.name === calendar[cycle]);
  const event = weighted(EVENTS, rng);
  const weekend = [6, 0].includes(day % 7);
  if (weekend && event.kind === "normal") {
    return EVENTS.find((item) => item.name === "周末集市");
  }
  return event;
}

function locationTrafficFactor(loc) {
  return loc.traffic * (1 - (loc.competition - 1) * 0.25);
}

/* ---------------- 门店经营印象 ----------------
 * 地段决定「有多少人路过」，经营决定「有多少人愿意进门」：
 * 货品卖相、服务评价、价格印象、品类齐全度会沉淀为门店印象，影响次日客流。 */
function shelfQuality() {
  let sum = 0;
  let count = 0;
  for (const goods of GOODS) {
    if (shelfStockOf(goods.id) <= 0) continue;
    sum += appealOf(goods.id);
    count += 1;
  }
  return count ? sum / count : 0;
}

function stockedCategoryCount() {
  const cats = new Set();
  for (const goods of GOODS) {
    if (shelfStockOf(goods.id) > 0) cats.add(goods.cat);
  }
  return cats.size;
}

/* 价格印象：实际售价相对基准价越便宜，分数越高（65 为持平） */
function priceImpression() {
  let sum = 0;
  let count = 0;
  for (const goods of GOODS) {
    if (shelfStockOf(goods.id) <= 0) continue;
    const base = Math.max(1, goods.base);
    sum += 65 + (1 - effectivePrice(goods) / base) * 120;
    count += 1;
  }
  return count ? clamp(sum / count, 0, 100) : 50;
}

function storeAppealNow() {
  const quality = shelfQuality();
  const service = clamp(state.serviceScore ?? 60, 0, 100);
  const value = priceImpression();
  const variety = CATEGORIES.length ? (stockedCategoryCount() / CATEGORIES.length) * 100 : 0;
  const score = quality * 0.4 + service * 0.32 + value * 0.2 + variety * 0.08;
  /* 65 分为中性；好货好服务最多把客流抬高 22%，差货差服务最多压低 20% */
  const factor = clamp(1 + (score - 65) / 100 * 0.55, 0.8, 1.22);
  return {
    score: Math.round(score),
    quality: Math.round(quality),
    service: Math.round(service),
    value: Math.round(value),
    variety: Math.round(variety),
    factor: +factor.toFixed(3),
  };
}

/* 日终把今天的评价、转化、缺货与拒绝滚动进服务分，供次日客流使用 */
function updateServiceScore() {
  const visitors = Math.max(1, state.dayVisitors);
  const conversion = state.dayBuyers / visitors;
  const stockoutRate = Math.min(1, state.stockoutsToday / visitors);
  const declineRate = Math.min(1, state.dayDeclines / visitors);
  const avgRating = state.ratings.length
    ? state.ratings.reduce((a, b) => a + b, 0) / state.ratings.length
    : state.reputation;
  const staffBonus = Math.min(6, state.staff.length * 2);
  const today = clamp(
    50 + (avgRating - 3) * 12 + (conversion - 0.55) * 50 + staffBonus
      - stockoutRate * 30 - declineRate * 18,
    15,
    95,
  );
  state.serviceScore = +(state.serviceScore * 0.65 + today * 0.35).toFixed(1);

  /* 客流自适应：转化高、缺货少就温和上调，连续冷清则下调，幅度限制在 ±10% */
  const demandSignal = 0.9 + conversion * 0.28 - stockoutRate * 0.16 - declineRate * 0.12;
  const target = clamp(demandSignal, 0.9, 1.1);
  state.trafficAdapt = +clamp((state.trafficAdapt || 1) * 0.7 + target * 0.3, 0.9, 1.1).toFixed(3);
}


function startDay() {
  if (!state.location || state.bankrupt || state.quit) return;
  const loc = state.location;
  state.day += 1;
  state.clearance = false;
  state.staffAutoDay = 0;
  const rng = mulberry32(hashSeed(state.seed, state.day));
  /* 天气按季节加权：夏天更容易闷热暴雨，冬天几乎不闷热 */
  const weather = weighted(weatherPoolFor(seasonOf()), rng);
  const event = pickEvent(state.day, rng);
  const weekend = [6, 0].includes(state.day % 7);

  state.weather = weather;
  state.event = event;
  state.weekend = weekend;
  state.market = +(weather.market * event.market).toFixed(3);
  state.festival = event.kind === "festival" ? event.name : null;

  if (event.kind === "rival") {
    state.rival = { name: event.name, until: state.day + 2 };
  } else if (state.rival && state.day > state.rival.until) {
    state.rival = null;
  }

  const rivalPressure = state.rival && event.kind !== "rival" ? 0.9 : 1;
  /* 周末效应因店址而异：社区/菜市场周末更旺，写字楼/大学城周末回落 */
  const weekendTraffic = weekend ? (loc.weekendTraffic ?? 1.2) : 1;
  state.trafficMult = +(
    weather.traffic * event.traffic * weekendTraffic * rivalPressure
    * locationTrafficFactor(loc) * decorTrafficMult()
    * clamp(state.trafficAdapt || 1, 0.85, 1.15)
  ).toFixed(3);

  /* 每日货源额度按基础量记录，渠道系数在进货时实时换算 */
  state.supplyQuota = {};
  state.supplyUsed = {};
  const waveRng = mulberry32(hashSeed(state.seed + 7, state.day));
  state.wholesale = {};
  for (const cat of CATEGORIES) {
    /* 批发行情每日波动：0.88 - 1.15 */
    state.wholesale[cat.name] = +(0.88 + waveRng() * 0.27).toFixed(3);
  }
  state.careSet = {};
  state.dayPromoCost = 0;
  state.dayGiftCost = 0;
  state.daySalvage = 0;
  state.promoBoost = 1;
  state.catRevenue = {};
  state.catCogs = {};
  for (const goods of GOODS) {
    const factor = event.cat === goods.cat ? (event.supply || 1) : 1;
    state.supplyQuota[goods.id] = Math.floor(goods.cap * 0.95 * factor * (0.65 + rng() * 0.72));
    /* 卖相自然衰减：按单品损耗速度，苹果慢、水蜜桃快；好装修缓一点（开业第一天不衰减） */
    const prev = state.condition[goods.id] ?? (70 + Math.round(rng() * 25));
    const speed = clamp(decayRateOf(goods) / 0.12, 0.25, 2.4);
    const decay = state.day <= 1 ? 0 : (2.5 + rng() * 4.5) * speed * (state.build ? 1.2 : 1) * (1 - (decorQuality() - 1) * 0.06);
    state.condition[goods.id] = Math.round(clamp(prev - decay, 25, 100));
  }

  const rentDue = Math.round(loc.rent * sizeOf().rentMult);
  let rent = rentDue;
  if (state.rentPaidDay === state.day) {
    /* 开店确认时已即时扣除首日租金，这里只记账不重复扣款 */
    state.dayRent = rentDue;
  } else {
    rent = Math.min(state.cash, rentDue);
    state.cash -= rent;
    state.dayRent = rent;
    if (rent < rentDue) state.reputation = clamp(state.reputation - 0.4, 1, 5);
  }

  /* 水电杂费：每天固定支出，施工日照付 */
  const utilityDue = utilityCost();
  const utility = Math.min(state.cash, utilityDue);
  state.cash -= utility;
  state.dayUtility = utility;

  /* 员工：日薪、离岗重置、卖相加成（理货员 +1/人，师傅 +2/人） */
  const wageDue = state.staff.reduce((sum, staff) => sum + staff.wage, 0);
  state.dayStaffCost = 0;
  for (const staff of state.staff) {
    staff.away = false;
    staff.slacking = false;
    staff.busyTurns = 0;
    staff.busyTask = null;
    const wage = staff.wage;
    const paid = Math.min(state.cash, wage);
    state.cash -= paid;
    state.baseWealth -= paid;
    state.dayStaffCost += paid;
    if (paid < wage) staff.mood = clamp(staff.mood - 15, 0, 100);
  }
  /* 隔夜恢复体力：心情越好恢复越快；连续加班会累积疲劳 */
  for (const staff of state.staff) {
    const recover = STAMINA_RECOVER_BASE + staff.mood * 0.15;
    staff.stamina = +clamp(staminaOf(staff) + recover, 0, STAMINA_MAX).toFixed(1);
  }
  const stockerCare = Math.round(dutyPower("stocker"));
  const chefCare = Math.round(dutyPower("chef") * 2);
  if (stockerCare || chefCare) {
    for (const goods of GOODS) {
      state.condition[goods.id] = Math.round(clamp(appealOf(goods.id) + stockerCare + chefCare, 25, 100));
    }
  }
  /* 心情过低的员工可能自己走人 */
  state.staff = state.staff.filter((staff) => {
    if (staff.mood < 25 && Math.random() < 0.35) {
      logLine(`${staff.name} 心情太差，自己辞职了`, "cost");
      return false;
    }
    return true;
  });
  syncManagerAutoState();

  /* 分店每日结算 */
  settleBranches();
  if (state.dayBranchProfit !== 0) {
    logLine(`分店今日净利 ${signed(state.dayBranchProfit)}`, state.dayBranchProfit >= 0 ? "sale" : "cost");
  }

  /* 员工事件：按性格权重选事件类型 */
  state.pendingStaffEvent = null;
  if (state.staff.length && Math.random() < 0.2) {
    const staff = state.staff[Math.floor(Math.random() * state.staff.length)];
    state.pendingStaffEvent = { type: pickStaffEventType(staff.persona), staff: staff.id };
  }
  /* 店长代管：有新缺口时推荐一位候选人，等老板审批 */
  maybeCreateHireRequest();
  /* 店长代管跨天持续：新的一天仍会自动备货并开门 */
  scheduleManagerAutoOpen();

  /* 装修耗损随营业天数增加，翻新后回落 */
  state.decorWear = +clamp((state.decorWear || 0) + 0.02, 0, 0.8).toFixed(3);
  const decorDue = decorDaily();
  const decorCost = Math.min(state.cash, decorDue);
  state.cash -= decorCost;
  state.dayDecorCost = decorCost;
  state.decorMaintainTotal += decorCost;
  state.dayRiskCost = 0;
  /* 全额支付日常维护会做一次保养，耗损小幅回落 */
  if (decorDue > 0 && decorCost >= decorDue) {
    state.decorWear = +Math.max(0, state.decorWear - 0.012).toFixed(3);
  }

  /* 施工占用的营业日：照付租金和维护，但当天不能开门 */
  let dayIncident = null;
  if (state.build) {
    const recent = state.history.slice(-7).map((h) => h.revenue).filter((v) => v > 0);
    const avgRevenue = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
    state.decorDowntimeDays += 1;
    state.decorDowntimeRent += state.dayRent + decorCost;
    state.decorLostRevenue += avgRevenue;
  }

  /* 未知风险：装修越差越容易出事，好装修把概率压到很低 */
  dayIncident = rollDecorIncident(mulberry32(hashSeed(state.seed + 41, state.day)));

  /* 固定成本缺口：连续欠费会进入破产流程 */
  const shortfall = Math.max(0, rentDue - rent)
    + Math.max(0, wageDue - state.dayStaffCost)
    + Math.max(0, decorDue - decorCost);
  state.lastShortfall = shortfall;
  state.overdueDays = shortfall > 0 ? state.overdueDays + 1 : 0;

  const stockValueBeforeSpoil = bookValue();
  const spoiled = spoilExpired(state.day);
  state.daySpoilage = spoiled.loss;
  state.daySpoilRate = stockValueBeforeSpoil > 0 ? +(spoiled.loss / stockValueBeforeSpoil).toFixed(4) : 0;
  /* 昨天洒的水今天仍然有效；处理完腐损后再清空，避免喷雾效果被提前抹掉 */
  state.sprayed = {};

  let finished = null;
  if (state.build) {
    state.build.daysLeft -= 1;
    if (state.build.daysLeft <= 0) {
      const item = DECOR_INDEX[state.build.id];
      if (item) {
        applyDecor(item);
        finished = item;
      }
      state.build = null;
    }
  }
  /* 仍在施工：重新开始 5 分钟等待；完工则撤掉倒计时 */
  state.buildAutoNextAt = state.build ? Date.now() + BUILD_WAIT_MS : null;

  state.dayRevenue = 0;
  state.dayCogs = 0;
  state.daySoldValue = 0;
  state.dayPurchaseCost = 0;
  state.dayPurchaseValue = 0;
  state.salesCount = 0;
  state.dayUnits = 0;
  state.dayVisitors = 0;
  state.dayBuyers = 0;
  state.dayBargainTries = 0;
  state.dayBargainWins = 0;
  state.dayDeclines = 0;
  state.dayMaxTicket = 0;
  state.dayRoundOff = 0;
  state.dayGoodsUnits = {};
  state.dayGoodsRevenue = {};
  state.daySlots = {};
  state.trafficBreakdown = null;
  /* 留住昨天的结算摘要，供备货时的小店日常给建议 */
  state.lastSettlement = state.settlement || state.lastSettlement;
  state.settlement = null;
  state.ratings = [];
  state.stockoutsToday = 0;
  state.stageUp = null;
  state.phase = "prep";
  state.serving = false;
  state.servicePaused = false;
  state.servingCustomer = false;
  state.currentIndex = -1;
  state.queue = [];
  state.baseWealth = state.cash + bookValue();
  state.lastCheck = { ok: true, checks: [], issues: [] };

  for (const goods of GOODS) {
    if (!state.inventory[goods.id]) state.inventory[goods.id] = [];
    if (!state.backroom[goods.id]) state.backroom[goods.id] = [];
    if (!state.prices[goods.id]) state.prices[goods.id] = goods.base;
  }

  els.receipt.innerHTML = "";
  const season = seasonOf();
  logLine(`第 ${state.day} 天 · ${season.icon}${season.name}季 ${seasonDayOf()}/${SEASON_DAYS} · ${loc.name} · ${weather.name} · ${event.name}${weekend ? " · 周末" : ""}`, "day");
  if (seasonDayOf() === 1) {
    logLine(`— ${season.name}季：${season.tip} —`, "good");
    toast(`换季：进入${season.name}季，进价、损耗与品类需求已调整`);
  }
  /* 昨晚下的物流单，夜里到店的先卸货 */
  deliverShipments(true);
  const openCosts = [
    rent > 0 ? `付租金 ${money(rent)}` : "",
    utility ? `水电 ${money(utility)}` : "",
    decorCost ? `装修维护 ${money(decorCost)}` : "",
    spoiled.loss ? `腐损 ${money(spoiled.loss)}` : "",
    spoiled.salvage ? `残值回收 +${money(spoiled.salvage)}` : "",
  ].filter(Boolean);
  if (openCosts.length) logLine(openCosts.join(" · "), "cost");
  if (dayIncident) {
    logLine(`意外：${dayIncident.name}（${dayIncident.item}）· ${dayIncident.text}，赔付 ${money(dayIncident.cost)}`, "cost");
    toast(`意外：${dayIncident.name}，赔付 ${money(dayIncident.cost)}`);
  }
  const payrollDue = state.staff.reduce((sum, staff) => sum + staff.wage, 0);
  if (payrollDue > 0 || state.dayStaffCost > 0) {
    const short = state.dayStaffCost < payrollDue ? " · 现金不足，欠薪" : "";
    logLine(`员工工资 ${money(state.dayStaffCost)}（${state.staff.length} 人 · 按天结算${short}）`, "cost");
  }
  if (finished) logLine(`${finished.name} 施工完成，店面已焕新`, "good");
  if (state.build) logLine(`施工中：${DECOR_INDEX[state.build.id]?.name || ""}，还需 ${state.build.daysLeft} 天`, "warn");
  if (shortfall > 0) {
    logLine(`资金缺口 ${money(shortfall)}，连续欠费 ${Math.min(state.overdueDays, BANKRUPT_GRACE_DAYS)}/${BANKRUPT_GRACE_DAYS} 天`, "cost");
    toast(`资金缺口 ${money(shortfall)}，连续欠费 ${Math.min(state.overdueDays, BANKRUPT_GRACE_DAYS)}/${BANKRUPT_GRACE_DAYS} 天`);
  }

  /* 连续欠费超过宽限期，房东收回铺面 */
  if (state.overdueDays > BANKRUPT_GRACE_DAYS) {
    triggerBankruptcy(`连续 ${state.overdueDays} 天无法支付租金、工资或维护费`);
    return;
  }
  const minUnit = Math.min(...GOODS.map((goods) => unitCost(goods)));
  const noStock = GOODS.every((goods) => totalStockOf(goods.id) === 0);
  if (state.cash < minUnit && noStock && !state.branches.length) {
    triggerBankruptcy("现金耗尽且没有可售库存，无法继续进货");
    return;
  }

  hideCustomer();
  renderAll();
  renderTraffic();
  renderFestival();
  if (finished) toast(`${finished.name} 完工，装修评分 ${decorQuality().toFixed(1)}`);
  else if (state.build) toast(`装修施工中，还剩 ${state.build.daysLeft} 天，暂不能营业`);
  if (state.pendingStaffEvent) showEmployeeEvent();
  saveGame();
}

/* ---------------- 顾客模型 ---------------- */
function locationJobs(loc) {
  return JOBS.map((job) => ({
    ...job,
    w: job.w * (loc?.jobBias?.[job.id] || 1),
  }));
}

function makeCustomer(index, rng) {
  const loc = state.location;
  const job = weighted(locationJobs(loc), rng);
  const age = AGES[job.age] || AGES.young;
  const wealth = WEALTHS[job.wealth] || WEALTHS.average;
  const traits = pickTraits(rng);

  const budget = Math.max(500, Math.round(
    lerp(age.budget, rng()) * wealth.mult * (loc?.wealthMult || 1)
  ));
  const sens = clamp(
    lerp(age.sens, rng()) + wealth.sens + traitTotal(traits, "sens") - ((loc?.wealthMult || 1) - 1) * 0.12,
    0, 0.98
  );
  const patience = clamp(
    lerp(age.patience, rng()) + (job.patience || 0) + traitTotal(traits, "patience"), 0.15, 1
  );
  const social = clamp(
    lerp(age.social, rng()) + (job.social || 0) + traitTotal(traits, "social"), 0.05, 1
  );
  const bulk = clamp(
    age.bulk + wealth.bulk + traitTotal(traits, "bulk"), 0.05, 0.95
  );

  const bargain = clamp(
    0.15 + traitTotal(traits, "bargain")
      + (wealth.id === "tight" ? 0.15 : 0)
      + (wealth.id === "rich" ? -0.1 : 0)
      + (rng() * 0.2 - 0.1),
    0.05, 0.9
  );

  const affinity = {};
  for (const cat of CATEGORY_NAMES) {
    affinity[cat] = (job.affinity?.[cat] || 1) * (0.9 + rng() * 0.2);
  }

  /* 口碑越好，老顾客越常见；老顾客更讲情面，议价容易成 */
  const isRegular = rng() < clamp((state.reputation - 2.2) / 3.2, 0.04, 0.3);

  return {
    id: state.day * 1000 + index,
    name: pick(NAMES[age.id], rng),
    job,
    age,
    wealth,
    traits,
    sprite: job.sprite,
    budget,
    sens,
    patience,
    patienceNow: patience,
    social,
    bulk,
    bargain,
    isRegular,
    affinity,
    mood: job.mood || "neutral",
    demeanor: pick([...(job.demeanors || []), ...wealth.demeanors], rng),
  };
}

function scoreCandidates(customer, rng = Math.random) {
  const stockoutCats = [];
  const byCat = new Map();
  for (const goods of GOODS) {
    if (shelfStockOf(goods.id) <= 0) {
      if (!stockoutCats.includes(goods.cat)) stockoutCats.push(goods.cat);
      continue;
    }
    if (!byCat.has(goods.cat)) byCat.set(goods.cat, []);
    byCat.get(goods.cat).push(goods);
  }

  /* 先按品类挑选「想逛的 3 个区」，再在区内选具体商品。
   * 这样菌菇、葱姜等低人气品类也会有稳定需求，不会整类营收为 0。 */
  const pool = [];
  for (const [cat, list] of byCat) {
    const affinity = customer.affinity[cat] || 1;
    const popSum = list.reduce((sum, goods) => sum + goods.pop * seasonDemandMult(goods), 0);
    const displayFactor = state.goldenCat ? (cat === state.goldenCat ? 1.15 : 0.95) : 1;
    const weight = Math.pow(affinity, 1.1) * Math.pow(popSum, 0.25) * displayFactor * (0.75 + rng() * 0.5);
    pool.push({ cat, goods: list, w: weight });
  }

  const scored = [];
  const picks = Math.min(3, pool.length);
  for (let i = 0; i < picks; i += 1) {
    const entry = weighted(pool, rng);
    pool.splice(pool.indexOf(entry), 1);
    const candidates = entry.goods.map((goods) => {
      const price = state.prices[goods.id] || goods.base;
      /* 卖相影响选择：好货更抢手 */
      const appeal = appealOf(goods.id);
      const appealFactor = 0.85 + (appeal / 100) * 0.3;
      const score = goods.pop * seasonDemandMult(goods) * Math.pow(goods.base / Math.max(1, price), 1.4) * appealFactor * (0.85 + rng() * 0.3);
      return { score, goods };
    }).sort((a, b) => b.score - a.score);
    if (candidates.length) scored.push(candidates[0]);
  }
  scored.sort((a, b) => b.score - a.score);
  return { scored, stockoutCats };
}

/* ---------------- 前台交互 ---------------- */
/* 全天人流 AI 自适应：基准权重 × 店址偏好 × 事件 × 天气 × 口碑 */
function slotWeights() {
  const loc = state.location;
  const weights = {};
  for (const slot of TIME_SLOTS) {
    let w = slot.w;
    if (loc) w *= LOC_SLOT_BOOST[loc.id]?.[slot.id] || 1;
    const ev = state.event;
    if (ev) {
      if (ev.kind === "festival") w *= slot.id === "evening" ? 1.3 : 1.15;
      if (ev.kind === "rival" && slot.id === "evening") w *= 0.65;
      if (ev.name === "社区团购" && slot.id === "morning") w *= 0.75;
      if (ev.name === "网红探店" && (slot.id === "noon" || slot.id === "evening")) w *= 1.3;
      if (ev.name === "发薪日" && slot.id === "evening") w *= 1.3;
      if (ev.name === "社区节日" && slot.id === "evening") w *= 1.4;
      if (ev.name === "中秋庙会" && slot.id === "evening") w *= 1.5;
      if (ev.name === "春节前采购" && (slot.id === "early" || slot.id === "morning")) w *= 1.4;
      if (ev.name === "运输受阻" && slot.id === "early") w *= 0.8;
      if (ev.name === "丰收季" && slot.id === "early") w *= 1.2;
      if (ev.name === "周末集市" && (slot.id === "early" || slot.id === "noon")) w *= 1.25;
      if (ev.name === "水果季" && slot.id === "afternoon") w *= 1.2;
      if (ev.name === "冷空气" && slot.id === "noon") w *= 0.85;
    }
    if (state.weather?.name === "暴雨") {
      if (slot.id === "early") w *= 0.6;
      if (slot.id === "noon") w *= 0.85;
    }
    if (state.weather?.name === "闷热" && slot.id === "evening") w *= 1.15;
    if (state.reputation >= 4 && slot.id === "evening") w *= 1.15;
    if (state.reputation < 2.5 && slot.id === "early") w *= 0.8;
    weights[slot.id] = Math.max(0.15, w);
  }
  return weights;
}

function slotLabel(entry) {
  return `${entry.slot.label}（${entry.slot.hour} 点）`;
}

/* 各店型的雨天敏感品类：供应紧张 → 售价上浮 */
const WEATHER_PRICE_RULES = {
  fruit: { cat: "叶菜", mult: 1.3, reason: "雨天叶菜供应紧张" },
  bbq: { cat: "海鲜", mult: 1.25, reason: "雨天渔船不出海" },
  cake: { cat: "面包", mult: 1.1, reason: "雨天面包囤货需求上升" },
  jade: null,
  shaxian: { cat: "主食", mult: 1.1, reason: "雨天热汤面需求上升" },
  store: { cat: "零食", mult: 1.08, reason: "雨天零食囤货需求上升" },
};

function weatherPriceRule() {
  const rain = state.weather?.name === "小雨" || state.weather?.name === "暴雨";
  if (!rain) return null;
  return WEATHER_PRICE_RULES[state.shopType] || null;
}

function weatherRuleFor(goods) {
  const rule = weatherPriceRule();
  return rule && goods.cat === rule.cat ? rule : null;
}

/* 动态定价：基准价 × 雨天敏感品类上浮 × 促销折扣 × 晚市清仓折扣 */
function effectivePrice(goods) {
  const base = state.prices[goods.id] || goods.base;
  let price = base;
  const rule = weatherRuleFor(goods);
  if (rule) price = Math.round(price * rule.mult);
  if (state.promo?.kind === "discount") price = Math.round(price * 0.9);
  if (state.clearance) price = Math.max(1, Math.round(price * (state.clearanceRate || 0.5)));
  return price;
}

/* 客单价自适应：价格印象越好、促销力度越大，顾客越愿意多买一点 */
function basketFactor() {
  const price = priceImpression();
  const priceFactor = clamp(1 + (price - 65) / 100 * 0.5, 0.86, 1.16);
  const promoFactor = state.promo?.kind === "discount" ? 1.08 : state.promo?.kind === "tasting" ? 1.04 : 1;
  const pressure = state.overdueDays > 0 ? 0.96 : 1;
  return +clamp(priceFactor * promoFactor * pressure, 0.8, 1.25).toFixed(3);
}

async function openDay() {
  if (state.quit) {
    renderQuit();
    return;
  }
  if (state.bankrupt) {
    renderBankruptcy();
    return;
  }
  if (!state.booted) {
    toast("先在地图上选一个店面");
    return;
  }
  if (state.phase !== "prep" || state.serving) return;
  if (state.build) {
    StallAudio.decline();
    toast(`装修施工中，还需 ${state.build.daysLeft} 天`);
    return;
  }
  /* 员工自动任务先跑：采购补货、自动定价、店长维护 */
  const dutyNotes = runStaffDuties();
  for (const note of dutyNotes) logLine(note, "good");
  if (dutyNotes.length) renderShelf();
  if (GOODS.every((goods) => shelfStockOf(goods.id) === 0)) {
    state.staffAutoDay = 0;
    StallAudio.decline();
    toast(GOODS.some((goods) => backStockOf(goods.id) > 0)
      ? "台面是空的，先去后台把货上架"
      : "货架是空的，先去后台进货");
    return;
  }

  closeBackstage();
  state.phase = "open";
  state.serving = true;
  state.servicePaused = false;
  state.servingCustomer = false;
  renderPhase();
  renderHud();
  StallAudio.setAmbience(true);
  StallAudio.openShop();

  const rng = mulberry32(hashSeed(state.seed + 99, state.day));
  const appeal = storeAppealNow();
  state.dayBasketFactor = basketFactor();
  const traffic = BASE_TRAFFIC * state.trafficMult * (0.45 + (state.reputation / 5) * 0.85) * appeal.factor;
  /* 促销带客流：9 折 +15%，试吃 +10%；叫卖员 +8%/效率，店长 +3%/效率 */
  const promoTraffic = state.promo?.kind === "discount" ? 1.15 : state.promo?.kind === "tasting" ? 1.1 : 1;
  const impact = staffImpact();
  const staffTraffic = 1 + impact.traffic;
  const jitter = 0.85 + rng() * 0.3;
  const rawTraffic = traffic * promoTraffic * staffTraffic * state.promoBoost * jitter;
  const count = clamp(Math.round(rawTraffic), 1, MAX_CUSTOMERS);
  state.trafficBreakdown = {
    multiplier: state.trafficMult,
    weather: state.weather?.traffic ?? 1,
    event: state.event?.traffic ?? 1,
    weekend: state.weekend ? (state.location?.weekendTraffic ?? 1.2) : 1,
    rival: state.rival && state.event?.kind !== "rival" ? 0.9 : 1,
    location: locationTrafficFactor(state.location),
    decor: decorTrafficMult(),
    reputation: 0.45 + (state.reputation / 5) * 0.85,
    appeal: appeal.factor,
    appealScore: appeal.score,
    appealQuality: appeal.quality,
    appealService: appeal.service,
    appealValue: appeal.value,
    appealVariety: appeal.variety,
    promo: promoTraffic,
    staff: staffTraffic,
    boost: state.promoBoost,
    adapt: state.trafficAdapt || 1,
    jitter,
    raw: rawTraffic,
    count,
  };
  const weights = slotWeights();
  const slots = TIME_SLOTS.map((slot) => ({ ...slot, w: weights[slot.id] }));
  const entries = Array.from({ length: count }, (_, index) => ({
    customer: makeCustomer(index, rng),
    slot: weighted(slots, rng),
  }));
  entries.sort((a, b) => TIME_SLOTS.findIndex((s) => s.id === a.slot.id) - TIME_SLOTS.findIndex((s) => s.id === b.slot.id));
  state.queue = entries;
  state.slot = null;
  state.currentIndex = -1;
  renderQueue();

  const totalW = slots.reduce((sum, s) => sum + s.w, 0);
  const forecast = slots.map((s) => `${s.label}约${Math.max(0, Math.round(count * s.w / totalW))}`).join(" · ");
  logLine(`开门营业，今天约有 ${count} 位顾客。`, "day");
  logLine(`人流预测：${forecast} 位`, "day");
  if (state.staff.length) {
    logLine(
      `员工影响：客流 ${signedPct(impact.traffic)} · 愿付 +${Math.round(impact.willing * 100)}%`
      + ` · 腐损 -${Math.round(impact.spoil * 100)}% · 缺货抱怨 -${Math.round(impact.complaint * 100)}%`,
      "day",
    );
  }
  logLine(
    `门店印象：货品 ${appeal.quality} · 服务 ${appeal.service} · 价格 ${appeal.value} · 齐全 ${appeal.variety}% → 客流 ×${appeal.factor.toFixed(2)}`,
    "day",
  );
  const styleLabel = salesStyleOf() === "bulk" ? "散称多份，单菜多数量" : salesStyleOf() === "combo" ? "统一点单，整单议价" : "单件成交";
  logLine(`售卖方式：${styleLabel} · 客单系数 ×${state.dayBasketFactor.toFixed(2)}`, "day");
  const wRule = weatherPriceRule();
  if (wRule) {
    logLine(`${state.weather.name}天，${wRule.cat}供应紧张，售价比平时上浮 ${Math.round((wRule.mult - 1) * 100)}%`, "cost");
  }

  await wait(320);

  saveGame();
  await runDay(0);
}

/* 从第 from 位顾客开始跑完当天；中途关页后会从下一位顾客继续 */
async function runDay(from) {
  const eveningIdx = state.queue.findIndex((e) => e.slot.id === "evening");
  const eveningCount = state.queue.filter((e) => e.slot.id === "evening").length;
  const clearanceAt = clearanceEnabled() && eveningCount > 2 ? eveningIdx + Math.floor(eveningCount * 0.5) : -1;

  let currentSlot = state.slot || null;
  for (let i = from; i < state.queue.length; i += 1) {
    /* 暂停接待：等当前顾客离店后停在柜台，可整理货架 */
    if (state.servicePaused) {
      state.servingCustomer = false;
      renderPhase();
      showPauseStage();
      renderQueue();
      while (state.servicePaused) await wait(220);
      hideCustomer();
      renderPhase();
    }
    const entry = state.queue[i];
    if (!currentSlot || currentSlot.id !== entry.slot.id) {
      currentSlot = entry.slot;
      state.slot = currentSlot;
      logLine(`— ${slotLabel(entry)} 客流到店 —`, "day");
    }
    if (i === clearanceAt) {
      state.clearance = true;
      logLine(`— 晚上 8 点，清仓甩卖：全场 ${clearanceLabel()} —`, "day");
      toast(`晚上 8 点清仓，全场 ${clearanceLabel()}`);
      els.doorSign.textContent = "清仓中";
      renderShelf();
    }
    state.currentIndex = i;
    state.servingCustomer = true;
    renderQueue();
    const revenueBefore = state.dayRevenue;
    const unitsBefore = state.dayUnits;
    const ordersBefore = state.salesCount;
    const result = await serveCustomer(entry.customer, i) || {};
    const spend = state.dayRevenue - revenueBefore;
    const orders = state.salesCount - ordersBefore;
    const units = state.dayUnits - unitsBefore;
    /* 客流与订单数据：按顾客、按时间段累计 */
    state.dayVisitors += 1;
    if (orders > 0) state.dayBuyers += 1;
    state.dayBargainTries += result.bargainTries || 0;
    state.dayBargainWins += result.bargains || 0;
    state.dayDeclines += result.declines || 0;
    state.dayMaxTicket = Math.max(state.dayMaxTicket, spend);
    const slotId = entry.slot.id;
    if (!state.daySlots[slotId]) {
      state.daySlots[slotId] = { visitors: 0, buyers: 0, orders: 0, revenue: 0, units: 0 };
    }
    const slotStats = state.daySlots[slotId];
    slotStats.visitors += 1;
    slotStats.orders += orders;
    slotStats.revenue += spend;
    slotStats.units += units;
    if (orders > 0) slotStats.buyers += 1;
    state.servingCustomer = false;
    /* 一位顾客结束，维护中的员工消耗一个班次 */
    releaseBusyStaff();
    /* 接待本身也耗体力：收银、叫卖、师傅等按岗位负荷扣减 */
    drainCustomerStamina();
    if (!els.backstage.hidden && state.backView === "staff") renderBackstage();
    /* 每接待完一位顾客落盘，关页最多丢当前这一位 */
    saveGame();
  }

  state.serving = false;
  state.servingCustomer = false;
  state.servicePaused = false;
  state.currentIndex = state.queue.length;
  state.slot = null;
  state.clearance = false;
  renderQueue();
  StallAudio.setAmbience(false);
  settleDay();
}

/* 恢复营业中的存档：接着下一位顾客继续 */
async function resumeDay() {
  state.phase = "open";
  state.serving = true;
  state.slot = state.slot || null;
  renderPhase();
  renderHud();
  renderQueue();
  hideCustomer();
  StallAudio.setAmbience(true);
  await wait(320);
  await runDay(state.currentIndex + 1);
}

async function serveCustomer(customer, index) {
  const rng = mulberry32(hashSeed(customer.id + state.seed, state.day));
  showCustomer(customer);
  StallAudio.tap();
  els.door.classList.add("open");
  setTimeout(() => els.door.classList.remove("open"), 760);
  await wait(260);

  if (rng() < customer.social) {
    say(pick(customer.job.greet, rng));
    await wait(260);
    /* 健谈的顾客多聊两句，心情好，评价略高 */
    if (customer.traits.some((trait) => trait.id === "chatty")) {
      customer.chatted = true;
      say(pick(["老板今天这货进得不错啊。", "我常来，就喜欢跟你唠两句。", "最近生意怎么样？"], rng));
      await wait(240);
    }
  }

  const { scored, stockoutCats } = scoreCandidates(customer, rng);
  let stockouts = 0;
  let declines = 0;
  let bargainTries = 0;
  let bargains = 0;
  let bought = 0;
  let budget = customer.budget;
  const fairness = [];

  /* 收银/店长在岗，缺货抱怨概率下降 */
  if (stockoutCats.length && rng() < 0.45 * Math.pow(0.8, dutyPower("cashier") + 0.5 * dutyPower("manager"))) {
    stockouts += 1;
    state.stockoutsToday += 1;
    setMood(customer, "disappointed");
    say(`${pick(stockoutCats, rng)}怎么卖完啦？`);
    await wait(320);
  }

  const style = salesStyleOf();
  if (style === "combo" || style === "bulk") {
    /* 烧烤/沙县统一点单，果蔬散称多份：整单一次报价、统一抹零 */
    const res = await sellOrder(customer, scored, rng);
    bought = res.bought;
    stockouts += res.stockouts;
    declines += res.declines;
    bargainTries += res.bargainTries;
    bargains += res.bargains;
    fairness.push(...res.fairness);
  } else {
  for (const { goods } of scored.slice(0, 3)) {
    if (budget <= 0) break;

    const price = effectivePrice(goods);
    /* 挑剔的顾客：卖相发蔫直接看不上 */
    if (customer.traits.some((trait) => trait.id === "picky") && appealOf(goods.id) < 55 && rng() < 0.35) {
      declines += 1;
      setMood(customer, "disappointed");
      say(`${goods.name}都蔫成这样了，还摆出来卖？`);
      await wait(300);
      continue;
    }
    /* 学生/少年：卖相水灵会拍照发圈，口碑小涨 */
    if ((customer.job.id === "student" || customer.job.id === "teen") && appealOf(goods.id) >= 88 && rng() < 0.3) {
      say("这卖相绝了，我拍个照发朋友圈！");
      state.reputation = clamp(state.reputation + 0.02, 1, 5);
    }
    const affinity = customer.affinity[goods.cat] || 1;
    /* 卖相好，顾客愿多付：88% - 112%；叫卖员按策略 +5%/效率 */
    const willing = Math.round(
      goods.base * affinity * (1.24 - 0.55 * customer.sens) * (1 + decorScore() * 0.14)
      * (0.88 + (appealOf(goods.id) / 100) * 0.24)
      * (1 + 0.05 * dutyPower("promoter") * promoterPolicyMult())
      * shelfSellMult()
    );
    const stock = stockOf(goods.id);
    let qty = 1 + (rng() < customer.bulk ? 1 : 0) + (rng() < customer.bulk * 0.6 ? 1 : 0);
    qty = Math.max(1, Math.round(qty * (state.dayBasketFactor || 1)));
    qty = Math.min(qty, stock, Math.floor(budget / Math.max(1, price)));

    if (qty <= 0) {
      if (stock <= 0) {
        stockouts += 1;
        state.stockoutsToday += 1;
        setMood(customer, "disappointed");
        say(`${goods.name}也没了呀。`);
        await wait(280);
      }
      continue;
    }

    let finalPrice = price;
    let bargainResult = null;

    if (price > willing) {
      /* 砍价属性：还价更狠，砍价意愿更强（价差容忍度更高） */
      const offer = Math.max(1, Math.round(willing * (1 - 0.3 * customer.bargain)));
      const canBargain = price <= Math.round(willing * (1.3 + customer.bargain * 0.5))
        && customer.patienceNow > 0.18
        && offer >= avgUnitCost(goods.id) * 1.05;

      if (!canBargain) {
        declines += 1;
        customer.patienceNow = Math.max(0, customer.patienceNow - 0.2);
        updatePatience(customer);
        setMood(customer, customer.patienceNow < 0.3 ? "impatient" : "hesitant");
        StallAudio.decline();
        say(`${goods.name}卖${yuan(price)}？有点贵了。`);
        await wait(300);
        continue;
      }

      setMood(customer, "hesitant");
      bargainTries += 1;
      say(`${goods.name}${yuan(price)}？${yuan(offer)}卖不卖？`);
      bargainResult = await askBargain(customer, goods, price, offer, rng);

      if (!bargainResult.deal) {
        declines += 1;
        customer.patienceNow = Math.max(0, customer.patienceNow - 0.25);
        updatePatience(customer);
        setMood(customer, bargainResult.mood || (customer.patienceNow < 0.3 ? "impatient" : "disappointed"));
        StallAudio.decline();
        say(bargainResult.reply);
        await wait(360);
        if (bargainResult.leave) break;
        continue;
      }

      finalPrice = bargainResult.price;
      bargains += 1;
      setMood(customer, bargainResult.mood === "expect" ? "expect" : "happy");
      say(bargainResult.reply);
      await wait(320);
    }

    const cogs = takeStock(goods.id, qty);
    const grossRevenue = qty * finalPrice;
    /* 统一抹零：整单向下抹去零头，营收按抹零后金额入账 */
    const revenue = roundOff(grossRevenue);
    state.dayRoundOff += grossRevenue - revenue;
    state.cash += revenue;
    state.dayRevenue += revenue;
    state.dayCogs += cogs;
    state.catRevenue[goods.cat] = (state.catRevenue[goods.cat] || 0) + revenue;
    state.catCogs[goods.cat] = (state.catCogs[goods.cat] || 0) + cogs;
    /* 送葱赠品：不降价，但搭一把小葱（成本约 ¥0.20，计入成本与现金保持对账） */
    if (bargainResult && bargainResult.action === "gift") {
      state.cash -= 20;
      state.dayCogs += 20;
      state.dayGiftCost += 20;
      state.catCogs[goods.cat] = (state.catCogs[goods.cat] || 0) + 20;
    }
    recordOrder({
      customer: customer.name,
      bargain: bargainResult ? bargainResult.action : null,
      items: [{
        gid: goods.id, name: goods.name, cat: goods.cat, unit: goods.unit,
        qty, price: finalPrice, revenue, cogs,
      }],
      revenue,
      cogs: cogs + (bargainResult && bargainResult.action === "gift" ? 20 : 0),
    });
    state.salesCount += 1;
    state.dayUnits += qty;
    state.dayGoodsUnits[goods.id] = (state.dayGoodsUnits[goods.id] || 0) + qty;
    state.dayGoodsRevenue[goods.id] = (state.dayGoodsRevenue[goods.id] || 0) + revenue;
    state.totalUnits += qty;
    bought += qty;
    budget -= revenue;
    fairness.push(willing / Math.max(1, finalPrice));

    setMood(customer, "happy");
    flashSale(revenue);
    showWeight(goods, qty);
    StallAudio.cash();
    logLine(`${customer.name} 买了 ${goods.name} ×${qty}${goods.unit}，收入 ${money(revenue)}`, "sale");
    renderHud();
    ensureShelfShows(goods);
    updateShelfItem(goods.id);
    /* 后台打开且停留在进货页时才刷新，避免营业中整表重绘 */
    if (!els.backstage.hidden && state.backView === "goods") renderBackstage();
    await wait(280);
  }
  }

  const rating = computeRating(customer, bought, stockouts, declines, bargains, fairness);
  state.ratings.push(rating);
  setMood(customer, rating >= 4 ? "happy" : rating < 2.6 ? "disappointed" : "neutral");
  say(reviewLine(rating, rng), starsFor(rating));
  await wait(440);

  const card = els.stage.querySelector(".customer-card");
  if (card) card.classList.add("leaving");
  await wait(220);
  if (index < state.queue.length - 1) hideCustomer();
  return { bought, stockouts, declines, bargainTries, bargains };
}

/* 历史订单：每笔成交记录一条，最多保留最近 300 单。
 * items 让汇总能按商品拆算，revenue/cogs 与当日营收成本口径一致。 */
const MAX_ORDER_HISTORY = 300;

function recordOrder({ customer, items, revenue, cogs, bargain = null }) {
  if (!Array.isArray(state.orders)) state.orders = [];
  const daySeq = state.orders.filter((order) => order.day === state.day).length + 1;
  state.orderSeq = (Number(state.orderSeq) || 0) + 1;
  state.orders.push({
    id: state.orderSeq,
    day: state.day,
    daySeq,
    customer: customer || "顾客",
    bargain,
    items,
    revenue,
    cogs,
    profit: revenue - cogs,
  });
  if (state.orders.length > MAX_ORDER_HISTORY) {
    state.orders.splice(0, state.orders.length - MAX_ORDER_HISTORY);
  }
}

/* 整单售卖：果蔬 bulk 单菜多份；烧烤/沙县 combo 多品合成一单，只议一次价、统一抹零 */
async function sellOrder(customer, scored, rng) {
  const combo = salesStyleOf() === "combo";
  const maxLines = combo ? (rng() < 0.6 ? 3 : 2) : 1;
  const lines = [];
  const result = { bought: 0, stockouts: 0, declines: 0, bargainTries: 0, bargains: 0, fairness: [] };
  let budget = customer.budget;
  const picky = customer.traits.some((trait) => trait.id === "picky");

  for (const { goods } of scored) {
    if (lines.length >= maxLines || budget <= 0) break;
    if (picky && appealOf(goods.id) < 55 && rng() < 0.3) {
      result.declines += 1;
      setMood(customer, "disappointed");
      say(`${goods.name}都蔫成这样了，还摆出来卖？`);
      await wait(260);
      continue;
    }
    const stock = stockOf(goods.id);
    if (stock <= 0) {
      result.stockouts += 1;
      state.stockoutsToday += 1;
      continue;
    }
    const price = effectivePrice(goods);
    if (price > budget) continue;
    const baseQty = combo
      ? 2 + Math.floor(rng() * 4) + (rng() < customer.bulk ? 2 : 0)
      : 3 + Math.floor(rng() * 4) + (rng() < customer.bulk ? 2 : 0);
    const afford = Math.max(1, Math.floor(budget / Math.max(1, price)));
    const qty = Math.min(stock, Math.max(1, Math.round(baseQty * (state.dayBasketFactor || 1))), afford);
    const affinity = customer.affinity[goods.cat] || 1;
    /* 与单件模式同一套愿付公式：卖相、装修、叫卖都会抬高整单心理价位 */
    const willing = Math.round(
      goods.base * affinity * (1.24 - 0.55 * customer.sens) * (1 + decorScore() * 0.14)
      * (0.88 + (appealOf(goods.id) / 100) * 0.24)
      * (1 + 0.05 * dutyPower("promoter") * promoterPolicyMult())
      * shelfSellMult()
    );
    lines.push({ goods, qty, price, willing });
    budget -= qty * price;
  }

  if (!lines.length) {
    if (result.stockouts || result.declines) {
      say(pick(["算了，那我换一家看看。", "今天想买的都没货。", "下次再来吧。"], rng));
      await wait(280);
    }
    return result;
  }

  const orderText = lines.map((line) => `${line.goods.name}×${line.qty}`).join("、");
  const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const willingTotal = lines.reduce((sum, line) => sum + line.willing * line.qty, 0);
  setMood(customer, "neutral");
  say(combo ? `老板，${orderText}，一起算。` : `老板，来 ${orderText}。`);
  await wait(380);

  let dealTotal = total;
  let bargainResult = null;
  if (total > willingTotal) {
    const offer = Math.max(1, Math.round(willingTotal * (1 - 0.3 * customer.bargain)));
    const costFloor = lines.reduce((sum, line) => sum + avgUnitCost(line.goods.id) * line.qty * 1.02, 0);
    const canBargain = total <= Math.round(willingTotal * (1.3 + customer.bargain * 0.5))
      && customer.patienceNow > 0.18 && offer >= costFloor;
    if (!canBargain) {
      result.declines += 1;
      customer.patienceNow = Math.max(0, customer.patienceNow - 0.2);
      updatePatience(customer);
      setMood(customer, customer.patienceNow < 0.3 ? "impatient" : "hesitant");
      StallAudio.decline();
      say(`一共 ${yuan(total)}？贵了，我再看看。`);
      await wait(300);
      return result;
    }
    setMood(customer, "hesitant");
    result.bargainTries += 1;
    say(`一共 ${yuan(total)}？${yuan(offer)} 我全要了。`);
    bargainResult = await askBargain(customer, { name: "这一单" }, total, offer, rng);
    if (!bargainResult.deal) {
      result.declines += 1;
      customer.patienceNow = Math.max(0, customer.patienceNow - 0.25);
      updatePatience(customer);
      setMood(customer, bargainResult.mood || "disappointed");
      StallAudio.decline();
      say(bargainResult.reply);
      await wait(360);
      return result;
    }
    result.bargains += 1;
    dealTotal = bargainResult.price;
  }

  /* 整单统一抹零，抹掉的零头计入让利，不进入营收 */
  const finalTotal = roundOff(dealTotal);
  const roundLost = dealTotal - finalTotal;
  state.dayRoundOff += roundLost;
  const lineGross = lines.map((line) => line.price * line.qty);
  const grossTotal = lineGross.reduce((sum, value) => sum + value, 0) || 1;
  let allocated = 0;
  let units = 0;
  const orderItems = [];
  lines.forEach((line, idx) => {
    const cogs = takeStock(line.goods.id, line.qty);
    /* 按行金额比例分摊整单营收，末行吃掉舍入差额，保证分类合计等于实收 */
    const revenue = idx === lines.length - 1
      ? finalTotal - allocated
      : Math.round(finalTotal * lineGross[idx] / grossTotal);
    allocated += revenue;
    units += line.qty;
    orderItems.push({
      gid: line.goods.id, name: line.goods.name, cat: line.goods.cat, unit: line.goods.unit,
      qty: line.qty, price: line.price, revenue, cogs,
    });
    state.catRevenue[line.goods.cat] = (state.catRevenue[line.goods.cat] || 0) + revenue;
    state.catCogs[line.goods.cat] = (state.catCogs[line.goods.cat] || 0) + cogs;
    state.dayCogs += cogs;
    state.dayGoodsUnits[line.goods.id] = (state.dayGoodsUnits[line.goods.id] || 0) + line.qty;
    state.dayGoodsRevenue[line.goods.id] = (state.dayGoodsRevenue[line.goods.id] || 0) + revenue;
  });
  state.cash += finalTotal;
  state.dayRevenue += finalTotal;
  state.salesCount += 1;
  state.dayUnits += units;
  state.totalUnits += units;
  result.bought = units;
  result.fairness.push(willingTotal / Math.max(1, finalTotal));
  /* 送葱赠品与单件模式一致：现金支出与成本同步记账 */
  if (bargainResult?.action === "gift") {
    state.cash -= 20;
    state.dayCogs += 20;
    state.dayGiftCost += 20;
    const cat = lines[0].goods.cat;
    state.catCogs[cat] = (state.catCogs[cat] || 0) + 20;
  }
  recordOrder({
    customer: customer.name,
    bargain: bargainResult ? bargainResult.action : null,
    items: orderItems,
    revenue: finalTotal,
    cogs: orderItems.reduce((sum, item) => sum + item.cogs, 0)
      + (bargainResult?.action === "gift" ? 20 : 0),
  });

  setMood(customer, "happy");
  flashSale(finalTotal);
  if (!combo) showWeight(lines[0].goods, units);
  StallAudio.cash();
  logLine(
    `${customer.name} ${combo ? "点单" : "买了"} ${orderText}，合计 ${money(finalTotal)}${roundLost ? `（抹零 −${money(roundLost)}）` : ""}`,
    "sale",
  );
  renderHud();
  ensureShelfShows(lines[0].goods);
  for (const line of lines) updateShelfItem(line.goods.id);
  if (!els.backstage.hidden && state.backView === "goods") renderBackstage();
  await wait(320);
  return result;
}

function computeRating(customer, bought, stockouts, declines, bargains, fairness) {
  let rating = 3.0;
  if (bought) rating += 0.35;
  if (fairness.length) {
    const average = fairness.reduce((a, b) => a + b, 0) / fairness.length;
    rating += clamp(0.9 * (average - 1), -0.9, 0.5);
  }
  if (bargains) rating += 0.1;
  rating += customer.wealth.review + traitTotal(customer.traits, "review");
  rating -= 0.45 * Math.min(2, stockouts);
  rating -= 0.25 * Math.min(2, declines);
  if (customer.patienceNow <= 0.1) rating -= 0.15;
  rating += decorScore() * 0.32;
  /* 卖相整体水平与熟客关系；师傅品控；健谈顾客聊开心了 */
  rating += (avgAppeal() - 75) * 0.004;
  if (customer.isRegular) rating += 0.08;
  rating += 0.05 * dutyPower("chef");
  if (customer.chatted) rating += 0.05;
  return clamp(rating, 1, 5);
}

function avgAppeal() {
  const list = GOODS.filter((goods) => stockOf(goods.id) > 0);
  if (!list.length) return 75;
  return list.reduce((sum, goods) => sum + appealOf(goods.id), 0) / list.length;
}

function reviewLine(rating, rng) {
  if (rating < 2.5) return pick(["不太满意，价格和新鲜度都一般。", "有点失望，东西还不全。"], rng);
  if (rating < 3.5) return pick(["还行吧，中规中矩。", "价格能接受，下次再看。"], rng);
  if (rating < 4.5) return pick(["菜挺新鲜，价格也公道。", "老板会做生意，下次还来。"], rng);
  return pick(["太满意了，新鲜又便宜！", "这家摊子我认了，闭眼买。"], rng);
}

function starsFor(rating) {
  const filled = Math.round(rating);
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

const BARGAIN_OPTIONS = [
  { action: "accept", label: (price, offer) => `接受 ¥${yuan(offer)}`, tip: "直接按对方的价成交，薄利但省事" },
  { action: "meet", label: (price, offer, mid) => `各让一步 ¥${yuan(mid)}`, tip: "报一个中间价，双方都有台阶" },
  { action: "hold", label: (price) => `坚持 ¥${yuan(price)}`, tip: "咬住原价，客人在乎品质时能守住" },
  { action: "gift", label: () => "送把葱", tip: "不降价，搭一把小葱（成本约 ¥0.20），节俭的客人吃这套" },
  { action: "praise", label: () => "夸夸货", tip: "讲新鲜、产地、当天到货，对重品质的客人有效" },
  { action: "story", label: () => "说说难处", tip: "提进价和房租，对节俭的客人有效，阔客会反感" },
  { action: "silent", label: () => "沉默", tip: "不接话，等对方先开口；急性子可能直接走" },
];

/* 托管策略：开启顶栏「托管」后，讲价按这套倾向自动回应。
 * 严肃到底咬住原价，妥协到底优先成交，中庸在成功率与成交价之间权衡。 */
const AUTO_STYLES = [
  {
    id: "strict", name: "严肃到底", icon: "🧊",
    desc: "咬住原价，极少让步；单量少但毛利高",
    lean: { accept: 0.2, meet: 0.4, hold: 1.6, silent: 1.1, gift: 0.9, praise: 1.05, story: 0.75 },
  },
  {
    id: "balanced", name: "中庸", icon: "⚖️",
    desc: "按成功率与成交价权衡，该让就让",
    lean: {},
  },
  {
    id: "yield", name: "妥协到底", icon: "🤝",
    desc: "顾客出价基本都接，快速成交换单量",
    lean: { accept: 2.4, meet: 1.4, hold: 0.35, silent: 0.7, gift: 1.1, praise: 1, story: 1.1 },
  },
];
const AUTO_STYLE_INDEX = Object.fromEntries(AUTO_STYLES.map((style) => [style.id, style]));

function autoStyleOf() {
  return AUTO_STYLE_INDEX[state.autoStyle] || AUTO_STYLES[1];
}

function autoStyleLean(action) {
  return autoStyleOf().lean[action] ?? 1;
}

/* 议价动作的中文名，用于历史订单标签 */
const BARGAIN_LABEL = {
  accept: "接受还价", meet: "各让一步", hold: "坚持原价",
  gift: "送葱成交", praise: "夸货成交", story: "说难处成交", silent: "沉默成交",
};

function bargainChance(customer, action) {
  const p = customer.patienceNow;
  const sens = customer.sens;
  const job = customer.job.id;
  const rich = customer.wealth.id === "rich";
  const tight = customer.wealth.id === "tight";
  const has = (id) => customer.traits.some((trait) => trait.id === id);
  const warmJobs = ["housewife", "regular", "poorElder", "sanitation"];
  /* 爱砍价的顾客嘴更硬，各策略成功率都更低 */
  const hag = (customer.bargain - 0.15) * 0.22;
  /* 熟客讲情面，除了沉默外都更好商量 */
  const reg = customer.isRegular ? 0.08 : 0;
  /* 在岗收银员会帮你接话，讲价成功率随其属性提升 */
  const cashier = cashierBargainBonus();

  if (action === "accept") return 1;
  if (action === "gift") {
    return clamp(0.42 + (tight ? 0.18 : 0) + (has("thrifty") ? 0.14 : 0) + (has("face") ? 0.08 : 0) + reg - (rich ? 0.22 : 0) - hag + cashier, 0.08, 0.9);
  }
  if (action === "hold") {
    return clamp(0.2 + (1 - sens) * 0.32 + p * 0.26 + (has("face") ? 0.07 : 0) - (has("thrifty") ? 0.16 : 0) - (has("impatient") ? 0.05 : 0) + reg - hag + cashier, 0.05, 0.92);
  }
  if (action === "silent") {
    return clamp(0.15 + p * 0.4 + (has("patient") ? 0.1 : 0) + (rich ? 0.07 : 0) - (has("impatient") ? 0.2 : 0) - (has("face") ? 0.12 : 0) - (has("thrifty") ? 0.06 : 0) - hag, 0.03, 0.82);
  }
  if (action === "story") {
    return clamp(0.26 + (tight ? 0.16 : 0) + (warmJobs.includes(job) ? 0.16 : 0) + customer.social * 0.12 - (rich ? 0.34 : 0) - (job === "office" ? 0.1 : 0) - (has("picky") ? 0.08 : 0) + reg - hag + cashier, 0.02, 0.86);
  }
  if (action === "praise") {
    return clamp(0.3 + (1 - sens) * 0.26 + (rich ? 0.08 : 0) + (["blogger", "fitness", "wealthy"].includes(job) ? 0.14 : 0) - (has("thrifty") ? 0.14 : 0) - (tight ? 0.1 : 0) + reg - hag + cashier, 0.05, 0.88);
  }
  return clamp(0.52 + (1 - sens) * 0.18 + p * 0.14 + (has("thrifty") ? 0.1 : 0) + (has("face") ? 0.05 : 0) - (has("impatient") ? 0.06 : 0) + reg - hag + cashier, 0.15, 0.95);
}

function bargainReply(customer, action, win, rng) {
  const has = (id) => customer.traits.some((trait) => trait.id === id);
  const rich = customer.wealth.id === "rich";
  const tight = customer.wealth.id === "tight";
  const job = customer.job.id;

  if (action === "accept") {
    if (tight) return pick(["太好了，谢谢老板！", "就等这句话呢。"], rng);
    if (rich) return pick(["行，给我装好点。", "可以，别缺斤少两。"], rng);
    return pick(["行，成交。", "好嘞，给我称上。", "爽快，就这个价。"], rng);
  }

  if (win) {
    if (action === "hold") {
      if (rich) return pick(["行，不差这几毛，给我称吧。", "就这个价，快点儿。"], rng);
      if (has("face")) return pick(["行行行，按你说的，别让人听见我讲价。"], rng);
      if (has("thrifty")) return pick(["……那好吧，谁让就你家有。"], rng);
      return pick(["行吧，就按原价。", "算了，看你也是实在人。"], rng);
    }
    if (action === "silent") {
      if (rich) return pick(["你这人还真沉得住气，行，按你的价。"], rng);
      if (has("patient")) return pick(["我想了想，还是买你家的吧。"], rng);
      return pick(["……好吧，就原价吧。", "你这老板，一句话不说倒让我不好意思走了。"], rng);
    }
    if (action === "story") {
      if (tight) return pick(["都不容易，那就按中间价吧。"], rng);
      return pick(["听你这么说也挺难，各让一步，我按中间价拿。"], rng);
    }
    if (action === "praise") {
      if (job === "blogger") return pick(["看着确实上镜，那按原价来一份。"], rng);
      if (job === "fitness") return pick(["新鲜度可以，那我按原价拿。"], rng);
      return pick(["看着确实新鲜，行，原价来一份。"], rng);
    }
    if (action === "gift") {
      if (tight) return pick(["送把葱？那行，按原价。", "有小葱搭着，我就不还了。"], rng);
      if (has("face")) return pick(["成，就当交个朋友，装起来吧。"], rng);
      return pick(["行吧，多把葱也不亏。"], rng);
    }
    return pick(["行，各让一步，成交。"], rng);
  }

  if (action === "silent") {
    if (has("impatient")) return pick(["不说话是什么意思？那我走了。"], rng);
    if (has("face")) return pick(["连句话都没有？不买了。"], rng);
    return pick(["那我再看看吧。"], rng);
  }
  if (action === "story") {
    if (rich) return pick(["你跟我说这个？我只看货。"], rng);
    return pick(["难处归难处，价钱还是高了点。"], rng);
  }
  if (action === "praise") {
    if (tight) return pick(["新鲜是新鲜，可我预算就这些。"], rng);
    return pick(["东西是好，可不值这个价。"], rng);
  }
  if (action === "gift") {
    if (rich) return pick(["谁稀罕一把葱，我要的是价格实惠。"], rng);
    if (has("thrifty")) return pick(["葱我有，钱才是真的。"], rng);
    return pick(["别来这套，还是便宜点实在。"], rng);
  }
  if (action === "hold") {
    if (has("impatient")) return pick(["一分不让？算了算了，我去别家。"], rng);
    return pick(["这个价我接受不了，先走了。"], rng);
  }
  return pick(["还是有点贵，我先转转。"], rng);
}

function askBargain(customer, goods, price, offer, rng = Math.random) {
  return new Promise((resolve) => {
    const box = els.stage.querySelector(".bargain-actions");
    if (!box) {
      resolve({ deal: false, price: 0, reply: "……", leave: false });
      return;
    }
    const mid = Math.min(price - 1, Math.max(offer + 1, Math.round((price + offer) / 2)));
    const cashier = bestCashier();
    const cashierWeight = cashier ? Math.round(cashierBargainWeight(cashier) * 100) : 0;
    box.innerHTML = `
      <span class="bargain-title">${goods.name} · 他还价 ¥${yuan(offer)}，你怎么回？</span>
      <div class="bargain-grid">
        ${BARGAIN_OPTIONS.map((option) => `
          <button type="button" data-action="${option.action}" title="${option.tip}" class="${option.action === "silent" ? "silent" : ""}">
            ${option.label(price, offer, mid)}
          </button>`).join("")}
        ${cashier ? `<button type="button" data-action="assistant" class="cashier" title="由在岗收银员根据性格、效率、心情和体力代你谈价">🧾 让收银员谈（倾向 ${cashierWeight}%）</button>` : ""}
      </div>`;
    StallAudio.bargain();

    let done = false;
    let autoTimer = null;

    if (state.autoPilot) {
      const pickAction = autoBargainPick(customer, price, offer, mid, rng);
      const target = box.querySelector(`button[data-action="${pickAction}"]`);
      if (target) {
        target.classList.add("auto-pick");
        const titleEl = box.querySelector(".bargain-title");
        if (titleEl) titleEl.insertAdjacentHTML("beforeend", `<em class="auto-tip">${cashier ? `收银员代谈 · 倾向 ${cashierWeight}%` : "托管 · 自动处理"}</em>`);
        autoTimer = setTimeout(() => target.click(), 560);
      }
    }

    box.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        if (done) return;
        done = true;
        clearTimeout(autoTimer);
        let action = button.dataset.action;
        StallAudio.tap();
        box.querySelectorAll("button").forEach((item) => { item.disabled = true; });

        /* 收银员代谈：按讲价倾向权重挑选动作，再走同一套判定 */
        if (action === "assistant") {
          action = cashierBargainPick(customer, price, offer, mid, rng, cashier);
        }
        const win = action === "accept" || rng() < bargainChance(customer, action);
        const reply = bargainReply(customer, action, win, rng);
        let dealPrice = 0;
        if (action === "accept") dealPrice = offer;
        else if (win) dealPrice = action === "meet" || action === "story" ? mid : price;

        box.innerHTML = "";
        resolve({
          action,
          deal: dealPrice > 0,
          price: dealPrice,
          reply,
          leave: !dealPrice && customer.patienceNow - 0.25 < 0.3,
          mood: dealPrice ? (dealPrice >= price ? "expect" : "happy") : null,
        });
      });
    });
  });
}

/* 托管默认处理讲价：在岗收银员优先代谈，否则按期望收益选最优策略（不沉默） */
function autoBargainPick(customer, price, offer, mid, rng = Math.random) {
  const cashier = bestCashier();
  if (cashier) return cashierBargainPick(customer, price, offer, mid, rng, cashier);
  const choices = BARGAIN_OPTIONS
    .filter((option) => option.action !== "silent")
    .map((option) => {
      const win = option.action === "accept" ? 1 : bargainChance(customer, option.action);
      const deal = option.action === "accept" ? offer
        : option.action === "meet" || option.action === "story" ? mid : price;
      return { action: option.action, win, expected: win * deal * autoStyleLean(option.action) };
    });
  choices.sort((a, b) => b.expected - a.expected);
  return choices[0].action;
}

/* 收银员的讲价倾向：性格、效率、心情与体力共同决定。
 * 圆滑/脾气急的更敢跟顾客磨价，老实/摸鱼的更倾向尽快成交。 */
const CASHIER_BARGAIN_BASE = { smooth: 0.88, grumpy: 0.78, cheerful: 0.7, diligent: 0.6, honest: 0.44, lazy: 0.3 };

function cashierBargainWeight(staff) {
  if (!staff) return 0;
  const persona = staff.persona || {};
  const base = CASHIER_BARGAIN_BASE[persona.id] ?? 0.55;
  const mood = clamp((staff.mood ?? 70) / 100, 0.3, 1);
  const weight = base * 0.55 + clamp(persona.work ?? 1, 0.5, 1.4) * 0.22 + mood * 0.15 + staminaFactor(staff) * 0.08;
  return +clamp(weight, 0.08, 0.96).toFixed(2);
}

/* 在岗收银员里讲价倾向最高的一位 */
function bestCashier() {
  const list = staffActive("cashier");
  if (!list.length) return null;
  return list.reduce((best, staff) => (cashierBargainWeight(staff) > cashierBargainWeight(best) ? staff : best));
}

/* 收银员坐镇收银台带来的讲价成功率加成（也作用于玩家手动讲价） */
function cashierBargainBonus() {
  const cashier = bestCashier();
  return cashier ? +(0.03 + cashierBargainWeight(cashier) * 0.12).toFixed(3) : 0;
}

/* 收银员代谈：倾向高更敢守价/磨价，倾向低更快成交 */
function cashierBargainPick(customer, price, offer, mid, rng = Math.random, cashier = bestCashier()) {
  if (!cashier) return autoBargainPick(customer, price, offer, mid, rng);
  const weight = cashierBargainWeight(cashier);
  /* 托管模式下的收银员代谈也要遵守老板选的托管策略 */
  const styleLean = state.autoPilot ? autoStyleOf().lean : {};
  const lean = {
    accept: 1.2 - weight,
    meet: 1.05,
    hold: 0.35 + weight * 0.9,
    gift: 0.55 + weight * 0.55,
    praise: 0.5 + weight * 0.7,
    story: 0.45 + weight * 0.8,
  };
  let best = { action: "meet", score: -Infinity };
  for (const option of BARGAIN_OPTIONS) {
    /* 收银员代谈时总得开口，不会选择沉默 */
    if (option.action === "silent") continue;
    const win = option.action === "accept" ? 1 : bargainChance(customer, option.action);
    const dealTotal = option.action === "accept" ? offer
      : option.action === "meet" || option.action === "story" ? mid : price;
    const score = win * dealTotal * (lean[option.action] ?? 0.4)
      * (styleLean[option.action] ?? 1) * (0.9 + rng() * 0.2);
    if (score > best.score) best = { action: option.action, score };
  }
  return best.action;
}

/* ---------------- 前台渲染 ---------------- */
function showCustomer(customer) {
  const moods = MOODS[customer.mood] || MOODS.neutral;
  document.body.classList.add("serving");
  els.sceneTip.hidden = true;
  els.stage.innerHTML = `
    <div class="customer-card">
      <div class="customer-figure" data-mood="${customer.mood}">
        <img src="${SPRITE_DIR}${customer.sprite}" alt="${customer.job.label}">
        <span class="mood-tag">${moods.label}</span>
      </div>
      <div class="customer-info">
        <div class="customer-head">
          <div class="face-wrap">
            <span class="face-avatar"><img src="${SPRITE_DIR}${customer.sprite}" alt="${customer.name}的头像"></span>
            <h3>${customer.name}<small>${customer.job.label} · ${customer.age.label} · ${customer.wealth.label}</small></h3>
          </div>
          <span class="mood-chip">神态：${moods.label}</span>
        </div>
        <div class="customer-sub">
          <span>预算 ${money(customer.budget)}</span>
          ${customer.isRegular ? `<span class="trait regular">熟客</span>` : ""}
          ${customer.traits.map((trait) => `<span class="trait">${trait.label}</span>`).join("")}
          <span>${customer.demeanor}</span>
        </div>
        <div class="patience"><i style="width:100%"></i></div>
        <div class="bubble">……</div>
        <div class="bargain-actions"></div>
      </div>
    </div>`;
}

function setMood(customer, key) {
  const mood = MOODS[key] || MOODS.neutral;
  customer.mood = key;
  const figure = els.stage.querySelector(".customer-figure");
  if (figure) {
    figure.dataset.mood = key;
    const tag = figure.querySelector(".mood-tag");
    if (tag) tag.textContent = mood.label;
  }
  const chip = els.stage.querySelector(".mood-chip");
  if (chip) chip.textContent = `神态：${mood.label}`;
}

function updatePatience(customer) {
  const bar = els.stage.querySelector(".patience i");
  if (!bar) return;
  const ratio = customer.patience > 0 ? customer.patienceNow / customer.patience : 0;
  bar.style.width = `${Math.round(clamp(ratio, 0, 1) * 100)}%`;
}

function say(text, stars) {
  const bubble = els.stage.querySelector(".bubble");
  if (!bubble) return;
  bubble.textContent = text;
  if (stars) {
    const span = document.createElement("span");
    span.className = "review-stars";
    span.textContent = stars;
    bubble.appendChild(span);
  }
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";
}

function flashSale(revenue) {
  const card = els.stage.querySelector(".customer-card");
  if (!card) return;
  const tag = document.createElement("span");
  tag.className = "buy-flash";
  tag.textContent = `+${money(revenue)}`;
  card.appendChild(tag);
  setTimeout(() => tag.remove(), 900);

  els.register.classList.add("paying");
  setTimeout(() => els.register.classList.remove("paying"), 520);
}

function showWeight(goods, qty) {
  if (!els.scaleScreen) return;
  const unit = goods.unit === "斤" ? 1 : goods.unit === "个" ? 0.22 : 0.35;
  const weight = (qty * unit * (0.92 + Math.random() * 0.16)).toFixed(3);
  els.scaleScreen.textContent = weight;
  els.scaleScreen.classList.remove("weighing");
  void els.scaleScreen.offsetWidth;
  els.scaleScreen.classList.add("weighing");
  clearTimeout(showWeight.timer);
  showWeight.timer = setTimeout(() => {
    els.scaleScreen.textContent = "0.000";
    els.scaleScreen.classList.remove("weighing");
  }, 900);
}

function hideCustomer() {
  document.body.classList.remove("serving");
  const p = state.phase === "bankrupt" ? "店铺已经停业。" : state.phase === "quit" ? "店铺已经退租。" : state.phase === "open" ? "下一位客人正在进门。" : state.phase === "settle" ? "今天打烊了。" : "店门半开，等第一位客人。";
  const span = state.phase === "bankrupt" ? "资金链断裂，无法继续经营。" : state.phase === "quit" ? "租约已经结清，本局结束。" : state.phase === "open" ? "柜台已经收拾好，接着招呼下一位。" : "先去后台备货定价，再点「开门营业」。";
  els.stage.innerHTML = `<div class="empty-state"><p>${p}</p><span>${span}</span></div>`;
}

/* ---------------- 暂停接待 / 营业中维护 ---------------- */
/* 维护不再要求暂停：营业中随时可维护，但会占用一名空闲员工。
 * 同一员工同一时间只能干一件事，维护期间不计岗位加成、不能收银。 */
function canMaintainNow() {
  return state.phase === "prep" || state.phase === "open";
}

/* 找一名空闲员工去做维护，优先理货/管理；正在收银的员工不抽调 */
function pickMaintainer() {
  if (state.phase !== "open") return null;
  const order = ["stocker", "manager", "chef", "promoter", "buyer", "pricer", "cashier"];
  const free = state.staff.filter((s) => {
    if (s.mood < 30 || s.away || s.busyTurns) return false;
    /* 体力见底的人接不了新活，避免把员工当永动机 */
    if (staminaOf(s) < 15) return false;
    const duty = s.duty || s.role;
    if (state.servingCustomer && duty === "cashier") return false;
    return true;
  });
  free.sort((a, b) => order.indexOf(a.duty || a.role) - order.indexOf(b.duty || b.role));
  return free[0] || null;
}

function occupyMaintainer() {
  const staff = pickMaintainer();
  if (staff) {
    staff.busyTurns = 2;
    staff.busyTask = "maintain";
    spendStamina(staff, STAMINA_MAINTENANCE_COST);
    logLine(`${staff.name} 去理货维护，接下来 2 位顾客暂不收银（体力剩 ${Math.round(staminaOf(staff))}）`, "day");
    return staff;
  }
  if (state.phase === "open" && state.staff.length) {
    const tired = state.staff.some((s) => !s.away && s.mood >= 30 && !s.busyTurns && staminaOf(s) < 15);
    toast(tired ? "员工体力不支，这次你自己上手维护" : "员工都在忙，这次你自己上手维护");
    logLine(tired ? "员工体力不支，这次店主自己上手维护" : "员工都在忙，这次店主自己上手维护", "day");
  }
  return null;
}

function releaseBusyStaff() {
  for (const staff of state.staff) {
    if (!staff.busyTurns) continue;
    staff.busyTurns -= 1;
    if (staff.busyTurns <= 0) {
      staff.busyTurns = 0;
      staff.busyTask = null;
    }
  }
}

function showPauseStage() {
  els.stage.innerHTML = `<div class="empty-state pause-state">
    <p>已暂停接待</p>
    <span>顾客暂不会上柜台；维护也可在营业中直接进行，会占用一名空闲员工。</span>
  </div>`;
}

function syncPauseButton() {
  const show = state.phase === "open";
  els.pauseBtn.hidden = !show;
  if (!show) return;
  els.pauseBtn.textContent = state.servicePaused ? "继续接待" : "暂停接待";
  els.pauseBtn.classList.toggle("on", state.servicePaused);
}

function toggleServicePause() {
  if (state.phase !== "open") return;
  state.servicePaused = !state.servicePaused;
  StallAudio.tap();
  if (state.servicePaused) {
    toast(state.servingCustomer ? "这位顾客接待完就暂停" : "已暂停接待");
  } else {
    toast("继续接待");
    if (!state.servingCustomer) hideCustomer();
  }
  syncPauseButton();
  renderPhase();
  if (state.servicePaused && !state.servingCustomer) showPauseStage();
  saveGame();
}

function updateQueueInfo() {
  const waiting = state.phase === "open" ? state.queue.slice(state.currentIndex + 1) : [];
  if (!waiting.length) {
    els.queueStrip.hidden = true;
    return;
  }
  els.queueStrip.hidden = false;
  const faces = waiting.slice(0, 4).map((entry) =>
    `<img src="${SPRITE_DIR}${entry.customer.sprite}" alt="${entry.customer.name}" title="${entry.customer.name} · ${entry.customer.job.label}">`
  ).join("");
  const more = waiting.length > 4 ? `<span class="queue-more">+${waiting.length - 4}</span>` : "";
  const slotPart = state.clearance ? ` · 清仓${clearanceLabel()}` : state.slot ? ` · ${state.slot.label}` : "";
  els.queueStrip.innerHTML = `<span class="queue-label">待接待 ${waiting.length} 位${slotPart}</span><div class="queue-faces">${faces}${more}</div>`;
}

const renderQueue = updateQueueInfo;

/* ---------------- 货架（前台） ---------------- */
function goodsOfCategory(cat) {
  return GOODS.filter((goods) => goods.cat === cat);
}

function shelfPageGoods() {
  const list = goodsOfCategory(state.shelfCat);
  const start = state.shelfPage * SHELF_PAGE_SIZE;
  return list.slice(start, start + SHELF_PAGE_SIZE);
}

function shelfPageCount() {
  return Math.max(1, Math.ceil(goodsOfCategory(state.shelfCat).length / SHELF_PAGE_SIZE));
}

function shelfItemMarkup(goods) {
  const stock = shelfStockOf(goods.id);
  const back = backStockOf(goods.id);
  const basePrice = state.prices[goods.id] || goods.base;
  const price = effectivePrice(goods);
  const tagClass = state.clearance ? "price-tag clearance" : price > basePrice ? "price-tag rain" : "price-tag";
  const rule = weatherRuleFor(goods);
  const tagTitle = !state.clearance && rule ? `${rule.reason}，售价上浮 ${Math.round((rule.mult - 1) * 100)}%` : "";
  const tagSmall = state.clearance ? `${clearanceLabel()}清仓` : `/${goods.unit}`;
  const stockText = stock > 0
    ? `台面 ${stock} ${goods.unit}${back > 0 ? ` · 后台 ${back}` : ""}`
    : back > 0 ? `台面空 · 后台 ${back}` : "已售罄";
  return `
    <article class="shelf-item ${stock > 0 ? "" : "sold-out"}" data-gid="${goods.id}">
      ${iconMarkup(goods)}
      <div class="shelf-main">
        <div class="shelf-name">${goods.name}</div>
        <div class="shelf-stock">${stockText}</div>
      </div>
      ${stock > 0 ? `<span class="shelf-stock-mini${stock <= 1 ? " low" : ""}" aria-label="台面剩余 ${stock}">${stock}${back > 0 ? `<i>+${back}</i>` : ""}</span>` : ""}
      <div class="${tagClass}" title="${tagTitle}"><b>¥${yuan(price)}</b><small>${tagSmall}</small></div>
    </article>`;
}

function renderShelf() {
  els.shelfTabs.innerHTML = CATEGORIES.map((cat) => {
    const list = goodsOfCategory(cat.name);
    const low = list.filter((goods) => stockOf(goods.id) <= 1).length;
    return `<button type="button" role="tab" class="shelf-tab ${state.shelfCat === cat.name ? "on" : ""}"
      data-cat="${cat.name}" aria-selected="${state.shelfCat === cat.name}">
      <span>${cat.icon}</span>${cat.name}${low ? `<i class="tab-low">${low}</i>` : ""}
    </button>`;
  }).join("");

  const pages = shelfPageCount();
  state.shelfPage = clamp(state.shelfPage, 0, pages - 1);
  els.shelfPager.hidden = pages <= 1;
  els.shelfPageLabel.textContent = `${state.shelfPage + 1} / ${pages}`;
  els.shelfPrev.disabled = state.shelfPage <= 0;
  els.shelfNext.disabled = state.shelfPage >= pages - 1;

  els.shelfWall.innerHTML = shelfPageGoods().map(shelfItemMarkup).join("");
}

function ensureShelfShows(goods) {
  const list = goodsOfCategory(goods.cat);
  const index = list.findIndex((item) => item.id === goods.id);
  if (index < 0) return;
  const page = Math.floor(index / SHELF_PAGE_SIZE);
  if (state.shelfCat === goods.cat && state.shelfPage === page) return;
  state.shelfCat = goods.cat;
  state.shelfPage = page;
  renderShelf();
}

function updateShelfItem(gid) {
  const goods = GOOD_INDEX[gid];
  const el = els.shelfWall.querySelector(`[data-gid="${gid}"]`);
  if (!goods || !el) return;
  const stock = shelfStockOf(gid);
  const back = backStockOf(gid);
  el.classList.toggle("sold-out", stock <= 0);
  const stockEl = el.querySelector(".shelf-stock");
  if (stockEl) {
    stockEl.textContent = stock > 0
      ? `台面 ${stock} ${goods.unit}${back > 0 ? ` · 后台 ${back}` : ""}`
      : back > 0 ? `台面空 · 后台 ${back}` : "已售罄";
  }
  let mini = el.querySelector(".shelf-stock-mini");
  if (stock > 0) {
    if (!mini) {
      mini = document.createElement("span");
      el.insertBefore(mini, el.querySelector(".price-tag"));
    }
    mini.className = `shelf-stock-mini${stock <= 1 ? " low" : ""}`;
    mini.innerHTML = `${stock}${back > 0 ? `<i>+${back}</i>` : ""}`;
  } else if (mini) {
    mini.remove();
  }
  el.classList.remove("stock-flash");
  void el.offsetWidth;
  el.classList.add("stock-flash");
}

function renderHud() {
  els.dayLabel.textContent = `第 ${Math.max(1, state.day)} 天`;
  els.weatherChip.textContent = state.weather ? state.weather.name : "—";
  const season = seasonOf();
  els.seasonChip.textContent = `${season.icon} ${season.name}季 ${seasonDayOf()}/${SEASON_DAYS}`;
  els.seasonChip.title = season.tip;
  els.eventChip.textContent = state.event ? state.event.name : "平常日";
  els.eventChip.className = `chip ${
    state.event?.kind === "festival" ? "festival" : state.event?.kind === "rival" ? "rival" : "ghost"
  }`;
  const assets = assetBreakdown();
  els.cashKpi.textContent = money(assets.cash);
  els.wealthKpi.textContent = money(assets.total);
  els.wealthKpi.title = `资产 = 现金 ${money(assets.cash)} + 货值 ${money(assets.goods)}`
    + (assets.branches ? ` + 分店估值 ${money(assets.branches)}` : "");
  els.repKpi.textContent = state.reputation.toFixed(2);
  els.registerCash.textContent = money(state.cash);
  els.counterSales.textContent = `今日 ${state.salesCount} 单 · 到店 ${state.dayVisitors} 人`;
  els.phaseMini.textContent = state.phase === "open" ? "营业中" : state.phase === "settle" ? "已打烊" : state.phase === "bankrupt" ? "已破产" : state.phase === "quit" ? "已退租" : "准备中";
  const debt = state.overdueDays || 0;
  els.debtChip.hidden = state.bankrupt || state.quit || debt <= 0;
  els.debtChip.textContent = `欠费 ${Math.min(debt, BANKRUPT_GRACE_DAYS)}/${BANKRUPT_GRACE_DAYS} 天`;
  els.debtChip.title = state.lastShortfall ? `今日资金缺口 ${money(state.lastShortfall)}` : "";
  renderLocationChip();
  renderBranchSwitch();
}

/* 顶栏门店切换：总店 + 全部分店，选中分店直接打开后台分店页远程巡店 */
function renderBranchSwitch() {
  if (!els.branchSwitchBtn) return;
  const active = state.branches.find((b) => b.id === state.activeBranchId);
  els.branchSwitchName.textContent = active ? (active.name || active.locName) : "总店";
  els.branchSwitchMeta.textContent = active ? "远程巡店" : "切换门店";
  els.branchSwitchBtn.classList.toggle("remote", !!active);
  els.branchSwitchMenu.innerHTML = `
    <button type="button" role="menuitem" data-branch-switch="main" class="${active ? "" : "on"}">
      <b>总店</b><small>${state.location ? state.location.name : "未选址"}</small>
    </button>
    ${state.branches.map((b) => `
      <button type="button" role="menuitem" data-branch-switch="${b.id}" class="${active && active.id === b.id ? "on" : ""}">
        <b>${b.typeIcon} ${b.name || b.locName}</b><small>${b.typeName} · ${b.sizeName}${b.paused ? " · 歇业" : ""}</small>
      </button>`).join("") || `<p class="branch-menu-empty">还没有分店</p>`}`;
}

/* 切换门店视图：总店恢复店面，分店打开后台并定位到对应卡片 */
function switchBranchView(target) {
  els.branchSwitchMenu.hidden = true;
  els.branchSwitchBtn.setAttribute("aria-expanded", "false");
  if (target === "main") {
    state.activeBranchId = null;
    closeBackstage();
    renderHud();
    toast("已切回总店");
    return;
  }
  const branch = state.branches.find((b) => b.id === Number(target));
  if (!branch) return;
  state.activeBranchId = branch.id;
  state.backView = "branch";
  openBackstage();
  renderHud();
  requestAnimationFrame(() => {
    const card = els.branchPanel.querySelector(`[data-branch-card="${branch.id}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.add("is-focused");
    setTimeout(() => card.classList.remove("is-focused"), 1800);
  });
  toast(`已切到${branch.name || branch.locName}分店，可远程管理配置与数据`);
}

function renderLocationChip() {
  renderBrand();
  if (!state.location) {
    els.locationName.textContent = "选择店面";
    els.locationRent.textContent = "日租 —";
    return;
  }
  els.locationName.textContent = state.location.name;
  els.locationRent.textContent = rentLabel(Math.round(state.location.rent * sizeOf().rentMult));
  els.signSub.textContent = `${state.location.short} · 今日新鲜 · 明码标价`;
}

function renderPhase() {
  const phase = state.phase;
  syncBuildSkip();
  if (!state.booted) {
    els.phaseLabel.textContent = "选址中";
    els.phaseHint.textContent = "先在地图上选一个店面，再开始第 1 天。";
    els.primaryBtn.textContent = "请先选择店面";
    els.primaryBtn.disabled = true;
    els.sceneTip.hidden = false;
    els.sceneTip.textContent = "先在街道地图上选一个店面。";
    els.doorSign.textContent = "准备中";
    els.phaseMini.textContent = "选址中";
    return;
  }
  if (phase === "bankrupt") {
    els.phaseLabel.textContent = "已破产";
    els.phaseHint.textContent = "资金链断裂，店铺已被收回。";
    els.primaryBtn.textContent = "已破产";
    els.primaryBtn.disabled = true;
    els.sceneTip.hidden = false;
    els.sceneTip.textContent = "店铺已停业，点击「重新开业」开始新的一局。";
    els.doorSign.textContent = "停业";
    els.phaseMini.textContent = "已破产";
    return;
  }
  if (phase === "quit") {
    els.phaseLabel.textContent = "已退租";
    els.phaseHint.textContent = "已提前退租并完成清算。";
    els.primaryBtn.textContent = "已退租";
    els.primaryBtn.disabled = true;
    els.sceneTip.hidden = false;
    els.sceneTip.textContent = "本局已结束，点击「重新开业」开始新的一局。";
    els.doorSign.textContent = "已退租";
    els.phaseMini.textContent = "已退租";
    return;
  }
  if (phase === "prep") {
    if (state.build) {
      const item = DECOR_INDEX[state.build.id];
      const label = item ? item.name : "装修";
      const payroll = state.staff.reduce((sum, staff) => sum + staff.wage, 0);
      els.phaseLabel.textContent = "装修施工";
      els.phaseHint.textContent = `${label}进行中，还需 ${state.build.daysLeft} 天，期间不能营业。跳过一天照付租金 ${money(state.dayRent)}、工资 ${money(payroll)}、维护 ${money(decorDaily())}；也可等待 5 分钟自动进入。`;
      els.primaryBtn.textContent = "施工中 · 暂停营业";
      els.primaryBtn.disabled = true;
      els.sceneTip.hidden = false;
      els.sceneTip.textContent = `${label} 施工中，还需 ${state.build.daysLeft} 天。`;
      els.doorSign.textContent = "施工中";
      els.phaseMini.textContent = "施工中";
      return;
    }
    els.phaseLabel.textContent = "准备中";
    els.phaseHint.textContent = "后台进货、上架、定价，然后开门营业。";
    els.primaryBtn.textContent = "开门营业";
    els.primaryBtn.disabled = false;
    els.sceneTip.hidden = false;
    const payroll = state.staff.reduce((sum, staff) => sum + staff.wage, 0);
    let prepTip = `${state.dayRent > 0 ? `今日租金 ${money(state.dayRent)}` : "今日免租"}${payroll ? ` · 员工日薪 ${money(payroll)}` : ""}`;
    if (state.booted) {
      /* 开门前就能看到门店印象，进货和定价会直接改变今日客流系数 */
      const appeal = storeAppealNow();
      prepTip += ` · 门店印象 ×${appeal.factor.toFixed(2)}（货品 ${appeal.quality} · 服务 ${appeal.service} · 价格 ${appeal.value}）`;
    }
    els.sceneTip.textContent = `${prepTip}，先补货定价再营业。`;
    els.doorSign.textContent = "准备中";
  } else if (phase === "open") {
    if (state.servicePaused && !state.servingCustomer) {
      els.phaseLabel.textContent = "暂停接待";
      els.phaseHint.textContent = "营业中也可维护，会占用 1 名空闲员工；整理好后点「继续接待」。";
      els.primaryBtn.textContent = "营业中…";
      els.primaryBtn.disabled = true;
      els.sceneTip.hidden = false;
      els.sceneTip.textContent = "已暂停接待；维护会占用一名空闲员工。";
      els.doorSign.textContent = "暂停接待";
      els.phaseMini.textContent = "暂停接待";
    } else {
      els.phaseLabel.textContent = "营业中";
      els.phaseHint.textContent = "接待顾客，议价时留意对方的神态和耐心。";
      els.primaryBtn.textContent = "营业中…";
      els.primaryBtn.disabled = true;
      els.sceneTip.hidden = true;
      els.doorSign.textContent = "营业中";
      els.phaseMini.textContent = "营业中";
    }
  } else {
    els.phaseLabel.textContent = "已打烊";
    els.phaseHint.textContent = "看看今天的账，再决定明天的价。";
    els.primaryBtn.textContent = "查看结算";
    els.primaryBtn.disabled = false;
    els.sceneTip.hidden = false;
    els.sceneTip.textContent = "打烊了，看看今天的账。";
    els.doorSign.textContent = "已打烊";
  }
  els.phaseMini.textContent = phase === "open" ? "营业中" : phase === "settle" ? "已打烊" : "准备中";
  if (phase === "open" && state.servicePaused && !state.servingCustomer) els.phaseMini.textContent = "暂停接待";
  syncPauseButton();
}

function renderFestival() {
  els.festivalDeco.hidden = !state.festival;
  els.competitorSign.hidden = !state.rival;
  if (state.rival) els.competitorSign.textContent = `${state.rival.name} · 街角`;
}

function renderTraffic() {
  const rng = mulberry32(hashSeed(state.seed, state.day + 777));
  const appeal = state.trafficBreakdown?.appeal || 1;
  const count = clamp(Math.round(5 * state.trafficMult * appeal), 2, 18);
  const colors = ["#8b9a8d", "#b98b8b", "#8f9cbb", "#b9a06d", "#7f8f8a", "#a98b9c"];
  els.trafficLane.innerHTML = Array.from({ length: count }, (_, index) => {
    const duration = 7 + rng() * 8;
    const delay = -rng() * duration;
    const bottom = 3 + rng() * 4;
    const scale = 0.8 + rng() * 0.35;
    return `<span class="ped" style="--ped-color:${colors[index % colors.length]};--ped-scale:${scale.toFixed(2)};animation-duration:${duration.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;bottom:${bottom.toFixed(1)}px"></span>`;
  }).join("");
}

function renderCrates() {
  /* 门口堆头随店型变化 */
  const crates = state.shopType === "fruit"
    ? [
        { src: "atlas_leaf.jpg", cell: 2, name: "青菜" },
        { src: "atlas_root.jpg", cell: 3, name: "土豆" },
        { src: "atlas_fruit_a.jpg", cell: 4, name: "苹果" },
      ]
    : state.shopType === "bbq"
      ? [{ emoji: "🍢", name: "烤串" }, { emoji: "🦐", name: "烤虾" }, { emoji: "🍺", name: "冰啤" }]
      : state.shopType === "cake"
        ? [{ emoji: "🍞", name: "面包" }, { emoji: "🍰", name: "蛋糕" }, { emoji: "☕", name: "咖啡" }]
        : state.shopType === "jade"
          ? [{ emoji: "📿", name: "手串" }, { emoji: "💎", name: "玉件" }, { emoji: "⭕", name: "玉镯" }]
          : state.shopType === "shaxian"
            ? [{ emoji: "🍜", name: "拌面" }, { emoji: "🥟", name: "扁肉" }, { emoji: "🍲", name: "炖汤" }]
            : [{ emoji: "🍫", name: "零食" }, { emoji: "🥤", name: "饮料" }, { emoji: "🧻", name: "日用" }];
  els.floorProps.innerHTML = crates.map((item) => {
    if (item.emoji) {
      return `<div class="produce-crate" title="门口陈列 · ${item.name}">
        <span class="crate-fill crate-emoji">${item.emoji}</span>
      </div>`;
    }
    const col = item.cell % 3;
    const row = Math.floor(item.cell / 3);
    return `<div class="produce-crate" title="门口陈列 · ${item.name}">
      <span class="crate-fill" style="background-image:url('${SPRITE_DIR}${item.src}');background-size:300% 300%;background-position:${(col / 2) * 100}% ${(row / 2) * 100}%;"></span>
    </div>`;
  }).join("");
}

function renderAll() {
  renderHud();
  renderShelf();
  renderPhase();
  renderQueue();
  renderFestival();
  updateCheckPill();
  if (!els.backstage.hidden) renderBackstage();
}

/* ---------------- 商店类型与铺面规格 ---------------- */
function sizeOf() {
  return SHOP_SIZES.find((s) => s.id === state.size) || SHOP_SIZES[1];
}

function capOf(goods) {
  return Math.max(3, Math.round(goods.cap * sizeOf().capMult * shelfCapMult()));
}

/* 后台仓储容量：台面的 2 倍，鼓励先进货再按需上架 */
function backCapOf(goods) {
  return Math.max(6, Math.round(capOf(goods) * 2));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

/* 招牌名：玩家自定义优先，否则用店型默认招牌 */
function shopBrandName() {
  const type = SHOP_TYPES.find((t) => t.id === state.shopType) || SHOP_TYPES[0];
  return String(state.shopName || "").trim() || type.sign;
}

function renderBrand() {
  const name = shopBrandName();
  const sign = document.querySelector(".shop-sign span");
  if (sign) sign.textContent = name;
  const brand = document.querySelector(".brand-mark");
  if (brand) brand.textContent = name;
  document.title = `${name} · 小店模拟器`;
}

function setCatalog(typeId) {
  const type = SHOP_TYPES.find((t) => t.id === typeId);
  if (!type) return;
  state.shopType = typeId;
  const catalog = SHOP_GOODS[typeId];
  GOODS = catalog.goods;
  CATEGORIES = catalog.categories;
  CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
  GOOD_INDEX = Object.fromEntries(GOODS.map((g) => [g.id, g]));
  renderBrand();
  state.shelfCat = CATEGORIES[0].name;
  state.shelfPage = 0;
  state.backCat = "all";
}

/* ---------------- 员工系统 ---------------- */
/* 在岗员工：岗位优先，旧存档回落到角色；正在维护的员工不参与岗位加成 */
function staffActive(dutyId) {
  return state.staff.filter((s) => (s.duty || s.role) === dutyId && s.mood >= 30 && !s.away && !s.busyTurns);
}

/* 体力：每个员工（包括第 1 号员工）每天能干的活有限，越低效率越差 */
function staminaOf(staff) {
  return clamp(staff.stamina ?? STAMINA_MAX, 0, STAMINA_MAX);
}

function staminaFactor(staff) {
  const value = staminaOf(staff);
  if (value >= 60) return 1;
  if (value >= 30) return 0.85;
  if (value >= 10) return 0.6;
  return 0.3;
}

function staminaLabel(value) {
  if (value >= 60) return "充沛";
  if (value >= 30) return "一般";
  if (value >= 10) return "疲惫";
  return "透支";
}

function spendStamina(staff, amount) {
  if (!staff || amount <= 0) return;
  staff.stamina = +clamp(staminaOf(staff) - amount, 0, STAMINA_MAX).toFixed(1);
}

function staffWorkSum(roleId) {
  return staffActive(roleId).reduce((sum, s) => sum + s.persona.work * staminaFactor(s), 0);
}

/* 岗位总效率：性格越勤快加成越高，体力越低打得越狠 */
function dutyPower(dutyId) {
  return staffActive(dutyId).reduce((sum, s) => sum + s.persona.work * staminaFactor(s), 0);
}

/* 每位到店顾客都会消耗在岗员工的体力；正在维护的人已经单独计过消耗 */
function drainCustomerStamina() {
  for (const staff of state.staff) {
    if (staff.away || staff.mood < 30 || staff.busyTurns) continue;
    spendStamina(staff, DUTY_STAMINA_LOAD[staff.duty || staff.role] ?? 0.6);
  }
}

function policyOf(staff) {
  const list = STAFF_POLICIES[staff.duty || staff.role] || [];
  return list.find((p) => p.id === staff.policy) || list[0] || null;
}

/* 叫卖员的策略系数：温和 0.7 / 正常 1 / 卖力 1.3，按效率加权 */
function promoterPolicyMult() {
  const list = staffActive("promoter");
  const power = list.reduce((sum, s) => sum + s.persona.work * staminaFactor(s), 0);
  if (!power) return 1;
  return list.reduce((sum, s) => {
    const policy = policyOf(s);
    return sum + (policy?.mult || 1) * s.persona.work * staminaFactor(s);
  }, 0) / power;
}

/* 百分比展示：0.08 → +8% */
function signedPct(ratio) {
  const pct = Math.round(ratio * 100);
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/* 员工对门店的实时影响：用于面板展示与开门日志 */
function staffImpact() {
  const promoter = dutyPower("promoter") * promoterPolicyMult();
  const manager = dutyPower("manager");
  /* 自动维护要求体力 ≥ 15，和开门任务的实际执行条件保持一致 */
  const autoCare = staffActive("manager")
    .filter((s) => staminaOf(s) >= 15)
    .reduce((sum, s) => sum + Math.round(s.persona.work * 2 * staminaFactor(s)), 0);
  return {
    traffic: 0.08 * promoter + 0.03 * manager,
    willing: 0.05 * promoter,
    spoil: 1 - Math.pow(0.88, dutyPower("stocker")),
    appeal: Math.round(dutyPower("stocker")) + Math.round(dutyPower("chef") * 2),
    complaint: 1 - Math.pow(0.8, dutyPower("cashier") + 0.5 * manager),
    bargain: cashierBargainBonus(),
    autoCare,
  };
}

function hireStaff(roleId) {
  if (state.phase !== "prep") {
    toast("营业中不能招人");
    return;
  }
  const role = STAFF_ROLE_INDEX[roleId];
  if (!role) return;
  if (state.staff.length >= sizeOf().staffCap) {
    StallAudio.decline();
    toast(`${sizeOf().name}最多只能雇 ${sizeOf().staffCap} 人，先升级铺面`);
    return;
  }
  if (state.cash < role.wage) {
    StallAudio.decline();
    toast(`现金不够，今天工资要 ${money(role.wage)}`);
    return;
  }
  const rng = mulberry32(hashSeed(state.seed + state.day + state.staff.length, 5));
  const persona = EMPLOYEE_PERSONALITIES[Math.floor(rng() * EMPLOYEE_PERSONALITIES.length)];
  const name = STAFF_NAMES[Math.floor(rng() * STAFF_NAMES.length)];
  const staff = {
    id: state.day * 100 + state.staff.length + 1,
    name,
    role: roleId,
    duty: roleId,
    policy: (STAFF_POLICIES[roleId] || [])[0]?.id || null,
    persona,
    wage: role.wage,
    mood: 70 + Math.round(rng() * 25),
    stamina: 88 + Math.round(rng() * 12),
    away: false,
    hiredDay: state.day,
  };
  state.cash -= role.wage;
  state.baseWealth -= role.wage;
  state.dayStaffCost += role.wage;
  state.staff.push(staff);
  StallAudio.cash();
  logLine(`雇佣${role.name} ${name}（${persona.label}），日薪 ${money(role.wage)}，今天开始计薪`, "cost");
  toast(`${name} 今天就来上工`);
  checkAchievements();
  renderHud();
  renderBackstage();
  persistPrep();
}

/* 调岗：岗位决定实际加成，策略随岗位重置为默认 */
function assignDuty(id, dutyId) {
  const staff = state.staff.find((s) => s.id === id);
  if (!staff || !STAFF_DUTY_INDEX[dutyId]) return;
  if (state.phase !== "prep") {
    toast("营业中不能调岗");
    return;
  }
  if ((staff.duty || staff.role) === dutyId) return;
  staff.duty = dutyId;
  staff.policy = (STAFF_POLICIES[dutyId] || [])[0]?.id || null;
  StallAudio.tap();
  toast(`${staff.name} 调岗为${STAFF_DUTY_INDEX[dutyId].name}`);
  renderBackstage();
  persistPrep();
}

function setStaffPolicy(id, policyId) {
  const staff = state.staff.find((s) => s.id === id);
  if (!staff || state.phase !== "prep") return;
  const list = STAFF_POLICIES[staff.duty || staff.role] || [];
  const policy = list.find((p) => p.id === policyId);
  if (!policy) return;
  staff.policy = policyId;
  StallAudio.tap();
  toast(`${staff.name} 的工作策略：${policy.name}`);
  renderBackstage();
  persistPrep();
}

/* 开门前的员工自动任务：采购补货、自动定价、店长维护、卖力吆喝。
 * 只跑一次（每天开门时），避免重复扣钱。 */
function runStaffDuties() {
  if (state.staffAutoDay === state.day) return [];
  state.staffAutoDay = state.day;
  const notes = [];

  /* 采购员：按各自策略给低库存商品下单；体力见底的人跑不动 */
  const buyers = staffActive("buyer").filter((s) => staminaOf(s) >= 15);
  if (buyers.length) {
    let spent = 0;
    let kinds = 0;
    let units = 0;
    const budget = Math.floor(state.cash * 0.6);
    for (const buyer of buyers) {
      const policy = policyOf(buyer) || STAFF_POLICIES.buyer[1];
      const power = (0.9 + buyer.persona.work * 0.1) * staminaFactor(buyer);
      let buyerKinds = 0;
      /* 优先补库存比例最低的商品，避免一次性把所有货都囤满 */
      const candidates = GOODS
        .map((goods) => ({ goods, ratio: totalStockOf(goods.id) / capOf(goods) }))
        .filter(({ goods, ratio }) => ratio < policy.below)
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, policy.maxKinds);
      for (const { goods } of candidates) {
        if (spent >= budget) break;
        const cap = capOf(goods);
        const stock = totalStockOf(goods.id);
        const demand = state.goodsDemand[goods.id] || 0;
        const target = Math.min(
          Math.round(cap * 0.9),
          Math.max(3, Math.round((demand || cap * 0.08) * (1.8 + policy.fill) * power)),
        );
        const wanted = Math.min(
          Math.max(0, target - stock),
          Math.round(policy.maxQty * power),
        );
        if (!wanted) continue;
        const before = spent;
        const result = applyRestock(goods, wanted);
        if (result.qty > 0) {
          spent += result.cost;
          kinds += 1;
          buyerKinds += 1;
          units += result.qty;
        }
        if (spent === before) break;
      }
      if (buyerKinds) spendStamina(buyer, 6 + buyerKinds * 2);
    }
    if (kinds) {
      const stocked = autoStockShelf();
      notes.push(`🛒 采购员自动进货 ${kinds} 种 / ${units} 件，支出 ${money(spent)}${stocked ? `，顺手补了 ${stocked} 件到台面` : ""}`);
    }
  }

  /* 定价员：把基准价拉回策略价位；太累就调不动价 */
  const pricers = staffActive("pricer").filter((s) => staminaOf(s) >= 15);
  if (pricers.length) {
    const policy = policyOf(pricers[0]) || STAFF_POLICIES.pricer[1];
    let changed = 0;
    for (const goods of GOODS) {
      const { lower, upper } = priceBounds(goods);
      const target = clamp(Math.round(goods.base * policy.mult), lower, upper);
      if (state.prices[goods.id] !== target) {
        state.prices[goods.id] = target;
        changed += 1;
      }
    }
    if (changed) {
      spendStamina(pricers[0], 10);
      notes.push(`🏷️ 定价员按「${policy.name}」调整了 ${changed} 种商品售价`);
    }
  }

  /* 店长：开门前挑卖相最差的货做一次维护，体力不足接不了这活 */
  const managers = staffActive("manager").filter((s) => staminaOf(s) >= 15);
  const careCount = managers.reduce((sum, s) => sum + Math.round(s.persona.work * 2 * staminaFactor(s)), 0);
  if (careCount > 0) {
    const targets = GOODS
      .filter((goods) => totalStockOf(goods.id) > 0)
      .sort((a, b) => appealOf(a.id) - appealOf(b.id))
      .slice(0, careCount);
    if (targets.length) {
      for (const goods of targets) {
        state.condition[goods.id] = Math.round(clamp(appealOf(goods.id) + 5, 25, 100));
      }
      const cost = Math.round((6 + targets.length * 4) / managers.length);
      for (const manager of managers) spendStamina(manager, cost);
      notes.push(`📋 店长开门前维护了 ${targets.length} 种货，卖相 +5`);
    }
  }

  /* 卖力吆喝：拉客流但掉心情、耗体力 */
  for (const staff of staffActive("promoter")) {
    const policy = policyOf(staff);
    if (policy?.id === "loud") {
      staff.mood = clamp(staff.mood - 3, 0, 100);
      spendStamina(staff, 5);
    }
  }

  return notes;
}

/* 店长离开后自动关闭代管，避免界面显示开启却无人执行 */
function syncManagerAutoState() {
  if (!state.managerAuto || managerOnDuty()) return;
  state.managerAuto = false;
  if (managerAutoTimer) {
    clearTimeout(managerAutoTimer);
    managerAutoTimer = null;
  }
  logLine("店长不在岗，店长代管已自动关闭", "warn");
  toast("店长不在岗，店长代管已自动关闭");
}

function fireStaff(id) {
  const staff = state.staff.find((s) => s.id === id);
  if (!staff) return;
  state.staff = state.staff.filter((s) => s.id !== id);
  StallAudio.tap();
  logLine(`${staff.name}（${STAFF_ROLE_INDEX[staff.role].name}）离职`, "cost");
  toast(`${staff.name} 已经结清工资走了`);
  syncManagerAutoState();
  renderBackstage();
  persistPrep();
}

function raiseStaff(id) {
  adjustStaffWage(id, 1);
}

/* 店长/员工工资调整：每次 ±10%，低于底薪六折或高于三倍时拦截 */
function adjustStaffWage(id, dir) {
  const staff = state.staff.find((s) => s.id === id);
  if (!staff) return;
  if (state.phase !== "prep") {
    toast("营业中不能调薪，打烊后再来");
    return;
  }
  const role = STAFF_ROLE_INDEX[staff.role] || STAFF_ROLES[0];
  const next = Math.round(staff.wage * (dir > 0 ? 1.1 : 0.9));
  const min = Math.round(role.wage * 0.6);
  const max = Math.round(role.wage * 3);
  if (next < min) {
    StallAudio.decline();
    toast(`日薪不能低于 ${money(min)}（底薪六折）`);
    return;
  }
  if (next > max) {
    StallAudio.decline();
    toast(`日薪上限 ${money(max)}（底薪三倍）`);
    return;
  }
  staff.wage = next;
  staff.mood = clamp(staff.mood + (dir > 0 ? 8 : -12), 0, 100);
  StallAudio.cash();
  logLine(`${dir > 0 ? "加薪" : "降薪"}：${staff.name} 日薪 ${money(next)}`, dir > 0 ? "cost" : "good");
  toast(`${staff.name} ${dir > 0 ? "加薪" : "降薪"}到 ${money(next)}，心情${dir > 0 ? "不错" : "有些低落"}`);
  renderBackstage();
  persistPrep();
}

function chatStaff(id) {
  const staff = state.staff.find((s) => s.id === id);
  if (!staff) return;
  staff.mood = clamp(staff.mood + 12, 0, 100);
  StallAudio.tap();
  toast(`你和${staff.name}聊了聊，他心情好多了`);
  renderBackstage();
  persistPrep();
}

/* ---------------- 店长代管 ---------------- */
let managerAutoTimer = null;

function managerOnDuty() {
  return state.staff.find((s) => (s.duty || s.role) === "manager" && s.mood >= 30 && !s.away);
}

/* 店长代管：把开门前该做的事一次做完（进货 → 定价 → 上架） */
function managerAutoPrep() {
  const manager = managerOnDuty();
  if (!manager) return [];
  const notes = [];
  /* 预留两天日租，避免代管把现金花到交不起租 */
  const rentBuffer = (state.location?.rent || 0) * 2;
  const budget = Math.max(0, Math.floor((state.cash - rentBuffer) * 0.35));
  let spent = 0;
  let kinds = 0;
  let units = 0;
  const candidates = GOODS
    .map((goods) => ({ goods, ratio: totalStockOf(goods.id) / capOf(goods) }))
    .filter(({ ratio }) => ratio < 0.35)
    .sort((a, b) => a.ratio - b.ratio);
  for (const { goods } of candidates) {
    if (spent >= budget) break;
    const target = Math.round(capOf(goods) * 0.7);
    const need = target - totalStockOf(goods.id);
    if (need <= 0) continue;
    const result = applyRestock(goods, need);
    if (result.qty > 0) {
      spent += result.cost;
      kinds += 1;
      units += result.qty;
    }
  }
  if (kinds) notes.push(`店长代管进货 ${kinds} 种 / ${units} 件，支出 ${money(spent)}`);
  let priced = 0;
  for (const goods of GOODS) {
    const { lower, upper } = priceBounds(goods);
    const target = clamp(goods.base, lower, upper);
    if (state.prices[goods.id] !== target) {
      state.prices[goods.id] = target;
      priced += 1;
    }
  }
  if (priced) notes.push(`店长按基准价调整了 ${priced} 种商品售价`);
  const stocked = autoStockShelf();
  if (stocked) notes.push(`店长把 ${stocked} 件货补上台面`);
  spendStamina(manager, 14);
  for (const note of notes) logLine(note, "good");
  return notes;
}

/* 店长按岗位缺口自己物色人选，但要等老板审批 */
function maybeCreateHireRequest() {
  if (!state.managerAuto) return;
  const manager = managerOnDuty();
  if (!manager) return;
  if (state.hireRequests.length || state.staff.length >= sizeOf().staffCap) return;
  const missing = ["cashier", "stocker"].find((duty) => !staffActive(duty).length)
    || (state.staff.length < 3 ? "stocker" : null);
  if (!missing) return;
  const role = STAFF_ROLE_INDEX[missing];
  const rng = mulberry32(hashSeed(state.seed + state.day * 13 + state.staff.length, 7));
  const persona = EMPLOYEE_PERSONALITIES[Math.floor(rng() * EMPLOYEE_PERSONALITIES.length)];
  const name = STAFF_NAMES[Math.floor(rng() * STAFF_NAMES.length)];
  state.hireRequests.push({
    id: state.day * 1000 + state.hireRequests.length + 1,
    role: missing,
    name,
    persona: persona.id,
    wage: role.wage,
    day: state.day,
  });
  logLine(`店长推荐招聘：${role.name} ${name}（${persona.label}），等你审批`, "warn");
}

/* 店长代管：安排 4 秒后自动补货、定价、上架并开门 */
function scheduleManagerAutoOpen() {
  if (managerAutoTimer) {
    clearTimeout(managerAutoTimer);
    managerAutoTimer = null;
  }
  if (!state.managerAuto || !managerOnDuty()) return;
  managerAutoTimer = setTimeout(() => {
    managerAutoTimer = null;
    if (!state.managerAuto || state.phase !== "prep" || state.serving || state.build) return;
    managerAutoPrep();
    openDay();
  }, 4000);
}

function setManagerAuto(on) {
  if (on && !managerOnDuty()) {
    StallAudio.decline();
    toast("需要一个在岗店长才能开启代管");
    return;
  }
  state.managerAuto = !!on;
  if (managerAutoTimer) {
    clearTimeout(managerAutoTimer);
    managerAutoTimer = null;
  }
  if (on) {
    managerAutoPrep();
    maybeCreateHireRequest();
    logLine("店长代管已开启：自动进货、定价、上架，4 秒后自动开门", "good");
    toast("店长代管已开启，4 秒后自动开门");
    scheduleManagerAutoOpen();
  } else {
    toast("店长代管已关闭，改由你手动开门");
  }
  renderBackstage();
  persistPrep();
}

/* 审批店长推荐：同意即入职并当天计薪，驳回则店长心情下降 */
function resolveHireRequest(id, approved) {
  const req = state.hireRequests.find((r) => r.id === id);
  if (!req) return;
  state.hireRequests = state.hireRequests.filter((r) => r.id !== id);
  const role = STAFF_ROLE_INDEX[req.role] || STAFF_ROLES[0];
  const manager = managerOnDuty();
  if (!approved) {
    if (manager) manager.mood = clamp(manager.mood - 8, 0, 100);
    logLine(`驳回店长推荐的 ${role.name} ${req.name}`, "warn");
    toast("已驳回这次招聘，店长有点泄气");
    renderBackstage();
    persistPrep();
    return;
  }
  if (state.staff.length >= sizeOf().staffCap) {
    StallAudio.decline();
    toast(`${sizeOf().name}最多只能雇 ${sizeOf().staffCap} 人`);
    renderBackstage();
    return;
  }
  if (state.cash < req.wage) {
    StallAudio.decline();
    toast(`现金不够，今天工资要 ${money(req.wage)}`);
    renderBackstage();
    return;
  }
  const persona = EMPLOYEE_PERSONALITIES.find((p) => p.id === req.persona) || EMPLOYEE_PERSONALITIES[1];
  state.staff.push({
    id: req.id + 500000,
    name: req.name,
    role: req.role,
    duty: req.role,
    policy: (STAFF_POLICIES[req.role] || [])[0]?.id || null,
    persona,
    wage: req.wage,
    mood: 78,
    stamina: 90,
    away: false,
    hiredDay: state.day,
  });
  state.cash -= req.wage;
  state.baseWealth -= req.wage;
  state.dayStaffCost += req.wage;
  StallAudio.cash();
  logLine(`老板批准招聘：${role.name} ${req.name} 入职，日薪 ${money(req.wage)}`, "cost");
  toast(`${req.name} 已入职，店长挑人眼光不错`);
  renderBackstage();
  persistPrep();
}


function renderStaffPanel(locked) {
  const cap = sizeOf().staffCap;
  const impact = staffImpact();
  const payroll = state.staff.reduce((sum, staff) => sum + staff.wage, 0);
  const onDutyList = state.staff.filter((s) => s.mood >= 30 && !s.away && !s.busyTurns);
  const onDuty = onDutyList.length;
  const avgStamina = onDuty ? Math.round(onDutyList.reduce((sum, s) => sum + staminaOf(s), 0) / onDuty) : 0;
  const busyCount = state.staff.filter((s) => s.busyTurns > 0).length;
  const autoJobs = [
    impact.autoCare > 0 ? `店长维护 ${impact.autoCare} 种货` : "",
    staffActive("buyer").length ? `采购员 ${staffActive("buyer").length} 人自动补货` : "",
    staffActive("pricer").length ? `定价员 ${staffActive("pricer").length} 人自动调价` : "",
  ].filter(Boolean);
  const manager = managerOnDuty();
  const hireRequests = state.hireRequests || [];

  els.staffPanel.innerHTML = `
    <section class="strategy-group">
      <h3>📊 员工影响 <small>在岗 ${onDuty} / ${state.staff.length} 人 · 平均体力 ${avgStamina}%${busyCount ? ` · ${busyCount} 人维护中` : ""}</small></h3>
      <div class="staff-impact">
        <div><span>客流</span><b class="${impact.traffic >= 0 ? "ok" : "bad"}">${signedPct(impact.traffic)}</b></div>
        <div><span>顾客愿付</span><b class="ok">+${Math.round(impact.willing * 100)}%</b></div>
        <div><span>腐损</span><b class="ok">-${Math.round(impact.spoil * 100)}%</b></div>
        <div><span>卖相维护</span><b class="ok">+${impact.appeal}/天</b></div>
        <div><span>缺货抱怨</span><b class="ok">-${Math.round(impact.complaint * 100)}%</b></div>
        ${impact.bargain > 0 ? `<div><span>讲价成功率</span><b class="ok">+${Math.round(impact.bargain * 100)}%</b></div>` : ""}
      </div>
      <p class="strategy-note">同一员工只能干一件事：营业中维护会占用一名空闲员工，维护期间不计岗位加成、不能收银。</p>
      <p class="strategy-note">体力有限：接待顾客、开门自动任务与维护都会消耗。体力 ≥60 满效率，30–59 降为 85%，10–29 降为 60%，低于 10 仅 30% 且不能再接维护；隔夜按心情恢复。</p>
      <p class="strategy-note">${autoJobs.length ? `开门自动任务：${autoJobs.join(" · ")}` : "采购、定价、管理岗位会在开门前自动执行任务。"}</p>
    </section>
    <section class="strategy-group">
      <h3>📋 店长代管 <small>${manager ? `${manager.name} 在岗` : "需先招一名店长"}</small></h3>
      <p class="strategy-note">开启后，店长会替你完成开门前的全部动作：按缺口进货、按基准价定价、把货补上台面，并在 4 秒后自动开门。店长还会自己物色人选，但招聘必须经老板审批。</p>
      <button type="button" class="primary manager-auto-btn ${state.managerAuto ? "on" : ""}" data-manager-auto ${manager ? "" : "disabled"}>
        ${state.managerAuto ? "关闭店长代管" : "开启店长代管"}
      </button>
      ${state.managerAuto ? `<p class="strategy-note ok-note">店长代管中：换品类、改价、开门前调整都会由店长按基准执行。</p>` : ""}
      ${hireRequests.length ? `
        <div class="hire-requests">
          <p class="strategy-note">店长推荐的人选，等你拍板：</p>
          ${hireRequests.map((req) => {
            const role = STAFF_ROLE_INDEX[req.role] || STAFF_ROLES[0];
            const persona = EMPLOYEE_PERSONALITIES.find((p) => p.id === req.persona);
            return `<div class="hire-request">
              <div><b>${role.icon} ${req.name}</b><small>${role.name} · ${persona?.label || ""} · 日薪 ${money(req.wage)} · 第 ${req.day} 天推荐</small></div>
              <div class="hire-request-acts">
                <button type="button" data-hire-approve="${req.id}" ${locked ? "disabled" : ""}>同意入职</button>
                <button type="button" data-hire-reject="${req.id}" ${locked ? "disabled" : ""}>驳回</button>
              </div>
            </div>`;
          }).join("")}
        </div>` : ""}
    </section>
    <section class="strategy-group">
      <h3>🧑‍🍳 招人 <small>铺面可容纳 ${state.staff.length} / ${cap} 人</small></h3>
      <p class="strategy-note">员工按天折算工资：当前日薪合计 <b>${money(payroll)} / 天</b>，每天开门前自动结算并计入当日成本。心情差会偷懒甚至走人；性格决定干活效率与幺蛾子多少。</p>
      <div class="staff-hire">
        ${STAFF_ROLES.map((role) => `
          <button type="button" data-hire="${role.id}" ${locked || state.staff.length >= cap ? "disabled" : ""}>
            ${role.icon} ${role.name} <small>日薪 ${money(role.wage)} · ${role.desc}</small>
          </button>`).join("")}
      </div>
    </section>
    <section class="strategy-group">
      <h3>👥 在职员工 <small>岗位决定加成，策略决定自动化力度</small></h3>
      <div class="staff-list">
        ${state.staff.length ? state.staff.map((s) => {
          const role = STAFF_ROLE_INDEX[s.role] || STAFF_ROLES[0];
          const dutyId = s.duty || s.role;
          const duty = STAFF_DUTY_INDEX[dutyId] || { name: role.name, icon: role.icon };
          const policies = STAFF_POLICIES[dutyId] || [];
          const policy = policyOf(s);
          const stamina = staminaOf(s);
          const staminaClass = stamina < 10 ? " empty" : stamina < 30 ? " low" : "";
          const bargainPct = dutyId === "cashier" ? Math.round(cashierBargainWeight(s) * 100) : 0;
          return `
          <div class="staff-card${s.busyTurns ? " is-busy" : ""}" data-staff="${s.id}">
            <span class="staff-avatar">${role.icon}</span>
            <div class="staff-main">
              <b>${s.name} <small>${role.name} · ${s.persona.label}</small></b>
              <div class="staff-vitals">
                <div class="staff-mood" title="心情 ${s.mood}%"><i style="width:${s.mood}%"></i></div>
                <div class="staff-stamina${staminaClass}" title="体力 ${Math.round(stamina)}%"><i style="width:${stamina}%"></i></div>
              </div>
              <span>日薪 ${money(s.wage)} · 效率 ${Math.round(s.persona.work * 100)}% · 岗位 <b>${duty.name}</b>${bargainPct ? ` · 讲价倾向 <b>${bargainPct}%</b>` : ""} · 体力 ${Math.round(stamina)}/100（${staminaLabel(stamina)}）${s.away ? " · 今日请假" : ""}</span>
              ${s.busyTurns ? `<em class="staff-busy">理货维护中 · 剩 ${s.busyTurns} 位顾客，暂不收银</em>` : ""}
              <div class="staff-config">
                <span class="staff-label">岗位</span>
                <div class="staff-chips">
                  ${STAFF_DUTIES.map((d) => `
                    <button type="button" data-duty="${d.id}" data-staff="${s.id}" class="${dutyId === d.id ? "on" : ""}" title="${d.desc}" ${locked ? "disabled" : ""}>
                      ${d.icon} ${d.name}
                    </button>`).join("")}
                </div>
              </div>
              ${policies.length ? `
              <div class="staff-config">
                <span class="staff-label">策略</span>
                <div class="staff-chips">
                  ${policies.map((p) => `
                    <button type="button" data-policy="${p.id}" data-staff="${s.id}" class="${policy?.id === p.id ? "on" : ""}" title="${p.desc}" ${locked ? "disabled" : ""}>
                      ${p.name}
                    </button>`).join("")}
                </div>
              </div>` : ""}
            </div>
            <div class="staff-acts">
              <button type="button" data-act="raise" data-staff="${s.id}" ${locked ? "disabled" : ""} title="日薪 +10%">加薪</button>
              <button type="button" data-act="cut" data-staff="${s.id}" ${locked ? "disabled" : ""} title="日薪 -10%">降薪</button>
              <button type="button" data-act="chat" data-staff="${s.id}" ${locked ? "disabled" : ""}>谈心</button>
              <button type="button" data-act="fire" data-staff="${s.id}" ${locked ? "disabled" : ""}>辞退</button>
            </div>
          </div>`;
        }).join("") : `<p class="strategy-note">还没有员工，招一个帮忙吧。</p>`}
      </div>
    </section>`;
}

/* ---------------- 员工事件 ---------------- */
/* 按性格的事件权重随机事件类型：勤快常做好事，爱摸鱼常被抓，圆滑常要待遇 */
function pickStaffEventType(persona) {
  const bias = persona.bias || { raise: 0.25, leave: 0.15, lazy: 0.1, special: 0.5 };
  const total = Object.values(bias).reduce((sum, w) => sum + w, 0);
  const roll = Math.random() * total;
  let acc = 0;
  for (const [type, weight] of Object.entries(bias)) {
    acc += weight;
    if (roll < acc) return type;
  }
  return "raise";
}

function showEmployeeEvent() {
  const event = state.pendingStaffEvent;
  if (!event) return;
  const staff = state.staff.find((s) => s.id === event.staff);
  if (!staff) {
    state.pendingStaffEvent = null;
    return;
  }
  const role = STAFF_ROLE_INDEX[staff.role];
  const persona = staff.persona;

  if (event.type === "special") {
    const sp = persona.special;
    els.employeeModalBody.innerHTML = `
      <button class="gm-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="gm-ev-title">${staff.name} · ${sp.title}</h3>
      <p class="gm-ev-text">${sp.text}</p>
      <div class="gm-ev-actions">
        ${sp.options.map((option) => `<button type="button" data-ev="${option.key}">${option.label}</button>`).join("")}
      </div>`;
    els.employeeModal.hidden = false;
    return;
  }

  if (event.type === "raise") {
    els.employeeModalBody.innerHTML = `
      <button class="gm-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="gm-ev-title">${staff.name} 想涨薪</h3>
      <p class="gm-ev-text">「老板，我干得也不差，日薪 ${money(staff.wage)} 能不能加点？」${persona.id === "smooth" ? "（他笑得特别诚恳）" : persona.id === "grumpy" ? "（语气有点冲）" : ""}</p>
      <div class="gm-ev-actions">
        <button type="button" data-ev="raise-yes">涨 10%（日薪 ${money(Math.round(staff.wage * 1.1))}）</button>
        <button type="button" data-ev="raise-no">婉拒，画个饼</button>
      </div>`;
  } else if (event.type === "leave") {
    els.employeeModalBody.innerHTML = `
      <button class="gm-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="gm-ev-title">${staff.name} 想请假</h3>
      <p class="gm-ev-text">「老板，家里有点事，今天想请个假……」${persona.id === "lazy" ? "（看起来精神挺好）" : ""}</p>
      <div class="gm-ev-actions">
        <button type="button" data-ev="leave-yes">准假（今天没他帮忙）</button>
        <button type="button" data-ev="leave-no">人手不够，再坚持一天</button>
      </div>`;
  } else {
    els.employeeModalBody.innerHTML = `
      <button class="gm-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="gm-ev-title">${staff.name} 在摸鱼</h3>
      <p class="gm-ev-text">${staff.name} 靠在货架边刷手机，被撞个正着。${role.name}这活他今天没怎么干。</p>
      <div class="gm-ev-actions">
        <button type="button" data-ev="lazy-scold">训一顿（心情 ${persona.react.scold > 0 ? "+" : ""}${persona.react.scold}）</button>
        <button type="button" data-ev="lazy-ignore">睁一只眼闭一只眼（心情 +${persona.react.ignore}，今天效率减半）</button>
      </div>`;
  }
  els.employeeModal.hidden = false;
}

function handleEmployeeEvent(key) {
  const event = state.pendingStaffEvent;
  const staff = state.staff.find((s) => s.id === event?.staff);
  if (!staff) {
    els.employeeModal.hidden = true;
    state.pendingStaffEvent = null;
    return;
  }
  const persona = staff.persona;
  const react = persona.react || { raiseNo: -10, leaveNo: -10, scold: -10, ignore: 5, raiseYes: 10 };

  if (key === "raise-yes") {
    staff.wage = Math.round(staff.wage * 1.1);
    staff.mood = clamp(staff.mood + react.raiseYes, 0, 100);
    toast(`${staff.name} 涨了薪，干劲十足`);
  } else if (key === "raise-no") {
    staff.mood = clamp(staff.mood + react.raiseNo, 0, 100);
    toast(`${staff.name} ${persona.id === "grumpy" ? "脸色很难看" : persona.id === "honest" ? "没说什么，低头干活去了" : "有点失落"}`);
    /* 脾气急被拒薪，可能当场翻脸辞职 */
    const quit = staff.mood < 20 || (persona.quitRisk && Math.random() < persona.quitRisk);
    if (quit) {
      toast(`${staff.name} 心灰意冷，辞职了`);
      fireStaff(staff.id);
    }
  } else if (key === "leave-yes") {
    staff.away = true;
    toast(`准了${staff.name}的假，今天他不在`);
  } else if (key === "leave-no") {
    staff.mood = clamp(staff.mood + react.leaveNo, 0, 100);
    toast(`${staff.name} 不太高兴，但留下来了`);
  } else if (key === "lazy-scold") {
    staff.mood = clamp(staff.mood + react.scold, 0, 100);
    staff.slacking = false;
    toast(`${staff.name} ${persona.id === "honest" ? "低头认错，马上干活" : persona.id === "grumpy" ? "翻了个白眼" : "老实干活去了"}`);
  } else if (key === "lazy-ignore") {
    staff.mood = clamp(staff.mood + react.ignore, 0, 100);
    staff.slacking = true;
    toast(`算了，今天不跟他计较`);
  } else if (key.startsWith("sp-")) {
    handleSpecialEvent(staff, key);
  }
  els.employeeModal.hidden = true;
  state.pendingStaffEvent = null;
  renderBackstage();
  renderHud();
  persistPrep();
}

/* 性格专属事件的处理逻辑 */
function handleSpecialEvent(staff, key) {
  const id = staff.persona.id;
  if (id === "diligent") {
    if (key === "sp-praise") {
      staff.mood = clamp(staff.mood + 10, 0, 100);
      const goods = GOODS.find((g) => totalStockOf(g.id) > 0);
      if (goods) state.condition[goods.id] = Math.round(clamp(appealOf(goods.id) + 2, 25, 100));
      logLine(`${staff.name} 主动挑货，${goods ? goods.name : "货架"}卖相 +2`, "good");
    } else {
      staff.mood = clamp(staff.mood - 5, 0, 100);
    }
  } else if (id === "honest") {
    if (key === "sp-pay") {
      /* 员工自己补回多找的钱，店里不亏，但心情受挫 */
      staff.mood = clamp(staff.mood - 15, 0, 100);
      logLine(`${staff.name} 自掏腰包补回多找的零钱，心情低落`, "cost");
    } else {
      staff.mood = clamp(staff.mood + 5, 0, 100);
      const pay = Math.min(50, state.cash);
      state.cash -= pay;
      state.baseWealth -= pay;
      logLine(`多找顾客 ${money(pay)}，自认倒霉`, "cost");
    }
  } else if (id === "smooth") {
    if (key === "sp-welfare") {
      staff.wage = Math.round(staff.wage * 1.05);
      staff.mood = clamp(staff.mood + 15, 0, 100);
      logLine(`${staff.name} 有了伙食补贴，日薪 ${money(staff.wage)}`, "cost");
    } else {
      staff.mood = clamp(staff.mood - 8, 0, 100);
    }
  } else if (id === "lazy") {
    if (key === "sp-deduct") {
      const back = Math.round(staff.wage / 2);
      state.cash += back;
      state.baseWealth += back;
      state.dayStaffCost -= back;
      staff.mood = clamp(staff.mood - 12, 0, 100);
      logLine(`${staff.name} 迟到扣半天工资 ${money(back)}`, "good");
    } else {
      staff.mood = clamp(staff.mood + 12, 0, 100);
      staff.slacking = true;
    }
  } else if (id === "cheerful") {
    if (key === "sp-adopt") {
      staff.mood = clamp(staff.mood + 12, 0, 100);
      state.promoBoost = 1.05;
      logLine(`${staff.name} 的吆喝让店里热闹起来，今日客流 +5%`, "good");
    } else {
      staff.mood = clamp(staff.mood - 6, 0, 100);
    }
  } else if (id === "grumpy") {
    if (key === "sp-mediate") {
      staff.mood = clamp(staff.mood + 8, 0, 100);
      state.reputation = clamp(state.reputation - 0.03, 1, 5);
      logLine("你安抚了顾客，口碑略降", "cost");
    } else if (key === "sp-scold") {
      staff.mood = clamp(staff.mood - 18, 0, 100);
      if (staff.mood < 20) {
        toast(`${staff.name} 甩手不干了`);
        fireStaff(staff.id);
      }
    } else {
      staff.mood = clamp(staff.mood + 10, 0, 100);
      state.reputation = clamp(state.reputation - 0.08, 1, 5);
      logLine("你护短硬刚顾客，口碑受损", "cost");
    }
  }
}

/* ---------------- 分店 ---------------- */
function branchCost(typeId, locId, sizeId) {
  const type = SHOP_TYPES.find((t) => t.id === typeId);
  const loc = LOCATION_INDEX[locId];
  const size = SHOP_SIZES.find((s) => s.id === sizeId);
  if (!type || !loc || !size) return Infinity;
  const rent = Math.round(loc.rent * size.rentMult);
  return Math.max(20000, rent * 15 + Math.max(0, type.startCash - 200000) / 2);
}

function openBranch(typeId, locId, sizeId) {
  if (state.phase !== "prep") {
    toast("营业中不能开分店");
    return;
  }
  if (stageIndex() < 3) {
    StallAudio.decline();
    toast("进入「精品生鲜」阶段后才能开分店");
    return;
  }
  const cost = branchCost(typeId, locId, sizeId);
  if (!Number.isFinite(cost)) return;
  if (state.cash < cost) {
    StallAudio.decline();
    toast(`开分店需要 ${money(cost)}，现金不够`);
    return;
  }
  const type = SHOP_TYPES.find((t) => t.id === typeId);
  const loc = LOCATION_INDEX[locId];
  const size = SHOP_SIZES.find((s) => s.id === sizeId);
  state.cash -= cost;
  state.baseWealth -= cost;
  state.branches.push({
    id: state.day * 10 + state.branches.length + 1,
    typeId,
    typeName: type.name,
    typeIcon: type.icon,
    locId,
    locName: loc.name,
    sizeId,
    sizeName: size.name,
    rent: Math.round(loc.rent * size.rentMult),
    invested: cost,
    value: cost,
    valueDelta: 0,
    valueHistory: [cost],
    volatility: 1,
    staff: [],
    policy: "standard",
    priceStrategy: "market",
    daily: null,
    history: [],
    level: 0,
    paused: false,
    name: "",
    openedDay: state.day,
    profitTotal: 0,
  });
  StallAudio.cash();
  logLine(`开分店：${loc.name} · ${type.name} · ${size.name}，投入 ${money(cost)}`, "cost");
  toast(`${type.name}分店在${loc.name}开业了！`);
  checkAchievements();
  renderHud();
  renderBackstage();
  persistPrep();
}

/* 分店员工：招人先付 3 天工资作为押金，之后按日结 */
function hireBranchStaff(branchId, roleId) {
  const branch = state.branches.find((b) => b.id === branchId);
  const role = STAFF_ROLE_INDEX[roleId];
  if (!branch || !role) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  if (branch.staff.length >= 6) {
    toast("这家分店最多 6 名员工");
    return;
  }
  const deposit = role.wage * 3;
  if (state.cash < deposit) {
    StallAudio.decline();
    toast(`现金不够，招人要押 3 天工资 ${money(deposit)}`);
    return;
  }
  const rng = mulberry32(hashSeed(branch.id + state.day + branch.staff.length, 9));
  const persona = EMPLOYEE_PERSONALITIES[Math.floor(rng() * EMPLOYEE_PERSONALITIES.length)];
  const name = STAFF_NAMES[Math.floor(rng() * STAFF_NAMES.length)];
  state.cash -= deposit;
  state.baseWealth -= deposit;
  /* prepaid：预付的 3 天工资，日结时逐日抵扣，不再重复发薪 */
  branch.staff.push({ name, role: roleId, persona: persona.id, wage: role.wage, prepaid: 3 });
  logLine(`分店招人：${role.name} ${name}（${persona.label}），预付 3 天工资 ${money(deposit)}`, "cost");
  toast(`${name} 去分店上班了，前 3 天工资已预付`);
  renderBackstage();
  persistPrep();
}

function fireBranchStaff(branchId, index) {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch || !branch.staff[index]) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  const staff = branch.staff[index];
  branch.staff.splice(index, 1);
  /* 退还尚未消耗的预付工资 */
  const refund = (staff.prepaid || 0) * (staff.wage || 0);
  if (refund > 0) {
    state.cash += refund;
    state.baseWealth += refund;
    logLine(`${staff.name} 从分店离职，退还预付工资 ${money(refund)}`, "sale");
    toast(`${staff.name} 离职，退还预付 ${money(refund)}`);
  } else {
    toast(`${staff.name} 从分店离职`);
  }
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

function setBranchPolicy(branchId, policyId) {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch || !BRANCH_POLICIES[policyId]) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  branch.policy = policyId;
  toast(`分店补货策略：${BRANCH_POLICIES[policyId].name}`);
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

/* 分店定价策略：调价与客流反向联动，直接影响日营收 */
function setBranchPrice(branchId, strategyId) {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch || !BRANCH_PRICE_INDEX[strategyId]) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  branch.priceStrategy = strategyId;
  const strat = BRANCH_PRICE_INDEX[strategyId];
  toast(`分店定价：${strat.name}（${strat.mult < 1 ? "降价" : strat.mult > 1 ? "加价" : "平价"} ${Math.round(Math.abs(strat.mult - 1) * 100)}%）`);
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

/* 估值波动权重：老板远程调节，权重越高涨跌越猛 */
function setBranchVolatility(branchId, key) {
  const branch = state.branches.find((b) => b.id === branchId);
  const vol = BRANCH_VOLATILITY_INDEX[key];
  if (!branch || !vol) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  branch.volatility = vol.mult;
  toast(`分店估值权重：${vol.name}（日波动 ${vol.desc}）`);
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

/* 出售分店：按当前估值成交，扣 6% 转让税费 */
function sellBranch(branchId) {
  const index = state.branches.findIndex((b) => b.id === branchId);
  if (index < 0) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  const branch = state.branches[index];
  const value = branch.value || branch.invested;
  const fee = Math.round(value * 0.06);
  const proceeds = value - fee;
  state.branches.splice(index, 1);
  if (state.activeBranchId === branchId) state.activeBranchId = null;
  state.cash += proceeds;
  state.baseWealth += proceeds;
  state.pendingSellBranch = null;
  StallAudio.cash();
  logLine(`出售分店：${branch.locName} · ${branch.typeName}，估值 ${money(value)}，税费 ${money(fee)}，到账 ${money(proceeds)}`, "sale");
  toast(`分店已出售，到账 ${money(proceeds)}`);
  renderHud();
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

function settleBranches() {
  state.dayBranchProfit = 0;
  for (const branch of state.branches) {
    /* 歇业：不发工资、不进货，只付租金 */
    if (branch.paused) {
      let cashDelta = -branch.rent;
      if (state.cash + cashDelta < 0) cashDelta = -state.cash;
      state.cash += cashDelta;
      state.baseWealth += cashDelta;
      branch.daily = {
        day: state.day, paused: true, units: 0, revenue: 0, cogs: 0, spoilage: 0,
        wages: 0, rent: branch.rent, profit: cashDelta, traffic: 0,
      };
      branch.profitTotal += cashDelta;
      state.dayBranchProfit += cashDelta;
      branch.valueDelta = 0;
      branch.valueHistory = [...(branch.valueHistory || []), branch.value].slice(-14);
      branch.history = [...(branch.history || []), { day: state.day, revenue: 0, profit: cashDelta, traffic: 0, units: 0, value: branch.value }].slice(-30);
      logLine(`${branch.name || branch.typeName}分店歇业，仅付租金 ${money(branch.rent)}`, "cost");
      continue;
    }
    const rng = mulberry32(hashSeed(branch.id + state.seed, state.day));
    const loc = LOCATION_INDEX[branch.locId];
    const size = SHOP_SIZES.find((s) => s.id === branch.sizeId) || SHOP_SIZES[1];
    const catalog = SHOP_GOODS[branch.typeId]?.goods || GOODS;
    const policy = BRANCH_POLICIES[branch.policy] || BRANCH_POLICIES.standard;
    const priceMult = (BRANCH_PRICE_INDEX[branch.priceStrategy] || BRANCH_PRICE_STRATEGIES[1]).mult;
    const avgPrice = catalog.reduce((sum, g) => sum + g.base, 0) / catalog.length;
    const avgCost = catalog.reduce((sum, g) => sum + g.cost, 0) / catalog.length;

    /* 客流 = 地段 × 铺面容量 × 员工效率 × 装修等级 × 口碑 */
    const staffFactor = 0.55 + 0.16 * Math.min(6, branch.staff.length);
    const upgrade = 1 + 0.08 * Math.min(3, Number(branch.level) || 0);
    const capacity = 45 * size.capMult * (loc?.traffic || 1) * staffFactor * upgrade;
    /* 定价弹性：涨价劝退客流、降价多卖，价格与销量相互牵制 */
    const priceDemand = 1 - 0.6 * (priceMult - 1);
    const demand = capacity * (0.72 + state.reputation * 0.06) * (0.85 + rng() * 0.3) * priceDemand;
    const supply = capacity * policy.supply;
    const units = Math.max(0, Math.round(Math.min(demand, supply)));
    const revenue = Math.round(units * avgPrice * priceMult * (0.96 + state.reputation * 0.015));
    const cogs = Math.round(units * avgCost);
    const spoilage = Math.round(Math.max(0, supply - units) * avgCost * 0.55 * policy.spoil);
    /* 已预付工资的员工前 3 天不重复计薪，逐日消耗 prepaid */
    let wages = 0;
    for (const s of branch.staff) {
      if ((s.prepaid || 0) > 0) {
        s.prepaid -= 1;
        continue;
      }
      wages += STAFF_ROLE_INDEX[s.role]?.wage || 6000;
    }
    let profit = revenue - cogs - spoilage - wages - branch.rent;

    /* 亏穿现金时按实际可承受金额记账，避免负现金 */
    let cashDelta = profit;
    if (state.cash + cashDelta < 0) cashDelta = -state.cash;
    state.cash += cashDelta;
    state.baseWealth += cashDelta;
    if (cashDelta < profit) {
      logLine(`${branch.typeName}分店亏损 ${money(-profit)}，现金见底`, "cost");
    }

    branch.daily = {
      units, revenue, cogs, spoilage, wages, rent: branch.rent,
      profit: cashDelta, traffic: Math.round(demand),
    };
    branch.profitTotal += cashDelta;
    state.dayBranchProfit += cashDelta;

    /* 门店估值：日利润 + 市场情绪 + 口碑共同驱动，权重越高波动越大 */
    const vol = Number(branch.volatility) || 1;
    const before = branch.value || branch.invested;
    const profitDrift = clamp(cashDelta / Math.max(1, before), -0.03, 0.03);
    const marketNoise = (rng() - 0.5) * 0.06 * vol;
    const repDrift = (state.reputation - 3) * 0.004;
    const change = clamp(profitDrift + marketNoise + repDrift, -0.08 * vol, 0.08 * vol);
    branch.value = Math.max(Math.round(branch.invested * 0.35), Math.round(before * (1 + change)));
    branch.valueDelta = branch.value - before;
    branch.valueHistory = [...(branch.valueHistory || []), branch.value].slice(-14);
    branch.history = [
      ...(branch.history || []),
      { day: state.day, revenue, profit: cashDelta, traffic: Math.round(demand), units, value: branch.value },
    ].slice(-30);
  }
}

/* 分店升级：每级 +8% 承载客流，最多 3 级；费用计入投入与估值 */
const BRANCH_UPGRADE_MAX = 3;
function branchUpgradeCost(branch) {
  return Math.max(30000, Math.round((branch.invested || 0) * 0.12));
}

function upgradeBranch(branchId) {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  const level = Number(branch.level) || 0;
  if (level >= BRANCH_UPGRADE_MAX) {
    toast("这家分店已经升级到顶了");
    return;
  }
  const cost = branchUpgradeCost(branch);
  if (state.cash < cost) {
    StallAudio.decline();
    toast(`升级需要 ${money(cost)}，现金不够`);
    return;
  }
  state.cash -= cost;
  state.baseWealth -= cost;
  branch.level = level + 1;
  branch.invested += cost;
  branch.value += cost;
  StallAudio.cash();
  logLine(`${branch.name || branch.typeName}分店装修升级至 Lv.${branch.level}，投入 ${money(cost)}`, "cost");
  toast(`分店升级到 Lv.${branch.level}，日承载客流 +8%`);
  renderHud();
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

function toggleBranchPause(branchId) {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  branch.paused = !branch.paused;
  StallAudio.tap();
  toast(branch.paused
    ? `${branch.name || branch.typeName}分店歇业：不再进货发工资，只付租金`
    : `${branch.name || branch.typeName}分店恢复营业`);
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

function renameBranch(branchId) {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch) return;
  if (state.phase === "settle") {
    toast("打烊结算时不能操作分店");
    return;
  }
  const fallback = `${branch.typeName}·${branch.locName}`;
  const input = window.prompt("给这家分店起个名字（留空恢复默认）", branch.name || fallback);
  if (input === null) return;
  branch.name = input.trim().slice(0, 12);
  toast(branch.name ? `分店改名为「${branch.name}」` : `已恢复默认店名「${fallback}」`);
  renderHud();
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

/* 分店预估：按 2 名员工、标准补货估算日净利，帮助选址决策 */
function estimateBranch(typeId, locId, sizeId) {
  const loc = LOCATION_INDEX[locId];
  const size = SHOP_SIZES.find((s) => s.id === sizeId);
  const catalog = SHOP_GOODS[typeId]?.goods;
  if (!loc || !size || !catalog) return null;
  const avgPrice = catalog.reduce((sum, g) => sum + g.base, 0) / catalog.length;
  const avgCost = catalog.reduce((sum, g) => sum + g.cost, 0) / catalog.length;
  const policy = BRANCH_POLICIES.standard;
  const priceMult = BRANCH_PRICE_STRATEGIES[1].mult;
  const staffFactor = 0.55 + 0.16 * 2;
  const capacity = 45 * size.capMult * loc.traffic * staffFactor;
  const demand = capacity * (0.72 + state.reputation * 0.06) * (1 - 0.6 * (priceMult - 1));
  const units = Math.round(Math.min(demand, capacity * policy.supply));
  const revenue = units * avgPrice * priceMult * (0.96 + state.reputation * 0.015);
  const cogs = units * avgCost;
  const spoilage = Math.max(0, capacity * policy.supply - units) * avgCost * 0.55;
  const wages = 14000;
  const rent = Math.round(loc.rent * size.rentMult);
  return { units, revenue, profit: Math.round(revenue - cogs - spoilage - wages - rent) };
}

function renderBranchPanel(locked) {
  const stageLocked = stageIndex() < 3;
  const canOpen = state.phase === "prep" && !locked && !stageLocked;
  els.branchPanel.innerHTML = `
    <section class="strategy-group">
      <h3>🏪 分店一览 <small>远程巡店 · 每天自动经营，日结进账</small></h3>
      ${stageLocked ? `<p class="strategy-note">🔒 进入「精品生鲜」阶段后才能开设分店${state.branches.length ? "；已有分店仍可正常管理" : ""}。</p>` : ""}
      <div class="branch-list">
        ${state.branches.length ? state.branches.map((b) => {
          const policy = BRANCH_POLICIES[b.policy] || BRANCH_POLICIES.standard;
          const d = b.daily;
          const value = b.value || b.invested;
          const delta = b.valueDelta || 0;
          const vol = BRANCH_VOLATILITIES.find((v) => v.mult === (Number(b.volatility) || 1)) || BRANCH_VOLATILITIES[1];
          const fee = Math.round(value * 0.06);
          const proceeds = value - fee;
          const confirming = state.pendingSellBranch === b.id;
          const focused = state.activeBranchId === b.id;
          const hist = (b.history || []).slice(-7);
          const maxAbs = Math.max(1, ...hist.map((h) => Math.abs(h.profit)));
          const avgTraffic = hist.length ? Math.round(hist.reduce((sum, h) => sum + h.traffic, 0) / hist.length) : 0;
          const totalRevenue = (b.history || []).reduce((sum, h) => sum + h.revenue, 0);
          const upgradeCost = branchUpgradeCost(b);
          return `
          <div class="branch-card branch-detail${focused ? " is-focused" : ""}" data-branch-card="${b.id}">
            <div class="branch-head">
              <span class="staff-avatar">${b.typeIcon}</span>
              <div class="staff-main">
                <b>${b.name || b.typeName} · ${b.locName} <small>${b.sizeName} · 日租 ${money(b.rent)}</small></b>
                <span>累计净利 <b class="${b.profitTotal >= 0 ? "ok" : "bad"}">${signed(b.profitTotal)}</b> · 投入 ${money(b.invested)}</span>
                ${focused ? `<em class="branch-remote-tag">远程巡店中</em>` : ""}
                ${b.paused ? `<em class="branch-paused">歇业中</em>` : ""}
              </div>
            </div>
            ${focused ? `
            <div class="branch-console">
              <div class="branch-stats">
                <span>近 ${(b.history || []).length} 日营收 <b>${money(totalRevenue)}</b></span>
                <span>累计净利 <b class="${b.profitTotal >= 0 ? "ok" : "bad"}">${signed(b.profitTotal)}</b></span>
                <span>日均客流 <b>${avgTraffic}</b></span>
                <span>营业天数 <b>${Math.max(0, state.day - (b.openedDay || state.day))}</b></span>
              </div>
              <div class="branch-trend" aria-label="近 7 日净利">
                ${hist.length
                  ? hist.map((h) => `<i class="${h.profit >= 0 ? "up" : "down"}" style="height:${Math.max(8, Math.round(Math.abs(h.profit) / maxAbs * 100))}%" title="第 ${h.day} 天 · 净利 ${signed(h.profit)} · 客流 ${h.traffic}"></i>`).join("")
                  : `<small class="branch-empty">还没有经营数据，明天开始记录。</small>`}
              </div>
              <div class="branch-actions">
                <button type="button" data-brename="${b.id}" ${locked ? "disabled" : ""}>✏️ 改名</button>
                <button type="button" data-bupgrade="${b.id}" ${locked || (b.level || 0) >= BRANCH_UPGRADE_MAX ? "disabled" : ""}>🔨 升级 Lv.${b.level || 0}/${BRANCH_UPGRADE_MAX} · ${money(upgradeCost)}</button>
                <button type="button" class="${b.paused ? "primary" : "ghost-btn"}" data-bpause="${b.id}" ${locked ? "disabled" : ""}>${b.paused ? "▶ 恢复营业" : "⏸ 歇业止损"}</button>
              </div>
            </div>` : ""}
            <div class="branch-value">
              <span>门店估值 <b>${money(value)}</b></span>
              <span class="${delta >= 0 ? "ok" : "bad"}">日浮动 ${signed(delta)}</span>
              <span>持有盈亏 <b class="${value >= b.invested ? "ok" : "bad"}">${signed(value - b.invested)}</b></span>
            </div>
            ${d ? (d.paused
              ? `<p class="strategy-note">昨日歇业：只付租金 ${money(d.rent)}，净利 ${signed(d.profit)}。恢复营业后重新进货。</p>`
              : `
            <div class="branch-report">
              <span>客流 <b>${d.traffic}</b></span>
              <span>卖出 <b>${d.units}</b></span>
              <span>营收 <b>${money(d.revenue)}</b></span>
              <span>进货 <b>−${money(d.cogs)}</b></span>
              <span>损耗 <b>−${money(d.spoilage)}</b></span>
              <span>工资 <b>−${money(d.wages)}</b></span>
              <span>租金 <b>−${money(d.rent)}</b></span>
              <span class="branch-net ${d.profit >= 0 ? "ok" : "bad"}">昨日净利 <b>${signed(d.profit)}</b></span>
            </div>`) : `<p class="strategy-note">明天开始结算。</p>`}
            ${focused ? `
            <div class="branch-sub">
              <span>补货策略</span>
              <div class="strategy-cats">
                ${Object.values(BRANCH_POLICIES).map((p) => `
                  <button type="button" data-bpolicy="${b.id}:${p.id}" class="${b.policy === p.id ? "on" : ""}" ${locked ? "disabled" : ""} title="${p.desc}">${p.name}</button>`).join("")}
              </div>
            </div>
            <div class="branch-sub">
              <span>定价策略</span>
              <div class="strategy-cats">
                ${BRANCH_PRICE_STRATEGIES.map((p) => `
                  <button type="button" data-bprice="${b.id}:${p.id}" class="${(b.priceStrategy || "market") === p.id ? "on" : ""}" ${locked ? "disabled" : ""} title="${p.desc}">${p.name}</button>`).join("")}
              </div>
            </div>
            <div class="branch-sub">
              <span>员工 ${b.staff.length}/6</span>
              <div class="branch-staff">
                ${b.staff.map((s, i) => `
                  <span class="branch-staff-chip">
                    ${STAFF_ROLE_INDEX[s.role]?.icon || "🧑"} ${s.name}
                    <em>${EMPLOYEE_PERSONALITIES.find((p) => p.id === s.persona)?.label || ""}</em>
                    <button type="button" data-bstaff-fire="${b.id}:${i}" ${locked ? "disabled" : ""} title="辞退">×</button>
                  </span>`).join("") || `<small class="branch-empty">还没雇人，效率只有 55%</small>`}
              </div>
            </div>
            <div class="branch-sub">
              <span>招人</span>
              <div class="branch-hire">
                ${STAFF_ROLES.map((role) => `
                  <button type="button" data-bstaff-add="${b.id}:${role.id}" ${locked ? "disabled" : ""}>
                    ${role.icon} ${role.name}<small>押 3 天 ${money(role.wage * 3)}</small>
                  </button>`).join("")}
              </div>
            </div>
            <div class="branch-sub">
              <span>估值权重</span>
              <div class="strategy-cats">
                ${BRANCH_VOLATILITIES.map((v) => `
                  <button type="button" data-bvol="${b.id}:${v.id}" class="${vol.id === v.id ? "on" : ""}" ${locked ? "disabled" : ""} title="${v.desc}">${v.name}</button>`).join("")}
              </div>
            </div>
            <div class="branch-trade">
              ${confirming
                ? `<span>按估值 <b>${money(value)}</b> 出售，税费 ${money(fee)}，到账 <b class="ok">${money(proceeds)}</b></span>
                   <button type="button" class="primary" data-bsell-confirm="${b.id}">确认出售</button>
                   <button type="button" data-bsell-cancel="${b.id}">再想想</button>`
                : `<button type="button" class="ghost-btn danger" data-bsell="${b.id}" ${locked ? "disabled" : ""}>出售门店 · 估值 ${money(value)}</button>`}
            </div>` : `
            <div class="branch-quick">
              <span>补货 ${(BRANCH_POLICIES[b.policy] || BRANCH_POLICIES.standard).name} · 员工 ${b.staff.length}/6${b.paused ? " · 歇业中" : ""}</span>
              <button type="button" data-bfocus="${b.id}">切换管理</button>
            </div>`}
          </div>`;
        }).join("") : `<p class="strategy-note">还没有分店。攒够本钱，把生意做到第二条街。</p>`}
      </div>
    </section>
    <section class="strategy-group">
      <h3>➕ 开新分店</h3>
      <p class="strategy-note">分店按类型 × 地段 × 铺面自动经营：员工数量决定效率，补货策略决定断货与损耗。</p>
      <div class="branch-form">
        <div class="branch-row"><span>类型</span><div class="strategy-cats" id="branchTypes">
          ${SHOP_TYPES.map((t) => `<button type="button" data-btype="${t.id}" class="${state.pendingBranchType === t.id ? "on" : ""}" ${stageLocked ? "disabled" : ""}>${t.icon} ${t.name}</button>`).join("")}
        </div></div>
        <div class="branch-row"><span>地段</span><div class="strategy-cats" id="branchLocs">
          ${LOCATIONS.map((l) => `<button type="button" data-bloc="${l.id}" class="${state.pendingBranchLoc === l.id ? "on" : ""}" ${stageLocked ? "disabled" : ""}>${l.icon} ${l.name}</button>`).join("")}
        </div></div>
        <div class="branch-row"><span>铺面</span><div class="strategy-cats" id="branchSizes">
          ${SHOP_SIZES.map((s) => `<button type="button" data-bsize="${s.id}" class="${state.pendingBranchSize === s.id ? "on" : ""}" ${stageLocked ? "disabled" : ""}>${s.icon} ${s.name}</button>`).join("")}
        </div></div>
        <div class="branch-row"><span>投入</span><b class="branch-cost" id="branchCostLabel"></b></div>
        <div class="branch-row"><span>预估</span><b class="branch-cost" id="branchEstimate"></b></div>
        <button type="button" class="primary" data-openbranch ${canOpen ? "" : "disabled"}>${stageLocked ? "进入「精品生鲜」阶段后可开分店" : canOpen ? "开这家分店" : "开门前才能开新店"}</button>
      </div>
    </section>`;
  const cost = branchCost(state.pendingBranchType, state.pendingBranchLoc, state.pendingBranchSize);
  const costEl = els.branchPanel.querySelector("#branchCostLabel");
  if (costEl) costEl.textContent = Number.isFinite(cost) ? `${money(cost)}（约 15 天租金 + 装修开办费）` : "—";
  const est = estimateBranch(state.pendingBranchType, state.pendingBranchLoc, state.pendingBranchSize);
  const estEl = els.branchPanel.querySelector("#branchEstimate");
  if (estEl) {
    estEl.textContent = est
      ? `约 ${est.units} 件/天 · 日净利 ${signed(est.profit)}（按 2 名员工 · 标准补货估算）`
      : "—";
    estEl.className = `branch-cost ${est && est.profit < 0 ? "bad" : "ok"}`;
  }
}

/* ---------------- 成长：目标 / 成就 / 趋势 ---------------- */
function renderGrowthPanel() {
  const history = state.history;
  const last7 = history.slice(-7);
  const bestProfit = history.length ? Math.max(...history.map((h) => h.profit)) : 0;
  const totalRevenue = history.reduce((sum, h) => sum + h.revenue, 0);
  const totalProfit = history.reduce((sum, h) => sum + h.profit, 0);
  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
  const goals = GOALS.map((goal) => {
    const value = goal.value(state);
    const done = value >= goal.target;
    const pct = clamp((value / goal.target) * 100, 0, 100);
    const label = goal.id === "profit"
      ? `${money(Math.min(value, goal.target))} / ${money(goal.target)}`
      : goal.id === "rep"
        ? `${value.toFixed(2)} / ${goal.target}`
        : `${Math.min(value, goal.target)} / ${goal.target}`;
    return { ...goal, done, pct, label };
  });

  /* 7 日趋势：营收柱 + 净利线 */
  const W = 520;
  const H = 150;
  const pad = 26;
  const maxV = Math.max(1, ...last7.map((h) => Math.max(h.revenue, Math.abs(h.profit))));
  const barW = last7.length ? Math.min(44, (W - pad * 2) / last7.length - 10) : 40;
  const xOf = (i) => pad + i * ((W - pad * 2) / Math.max(1, last7.length));
  const yOf = (v) => H - 28 - (v / maxV) * (H - 56);
  const bars = last7.map((h, i) => `
    <rect x="${xOf(i) + 8}" y="${yOf(h.revenue)}" width="${barW}" height="${Math.max(2, H - 28 - yOf(h.revenue))}" rx="3" fill="#d9c39b"></rect>
    <text x="${xOf(i) + 8 + barW / 2}" y="${H - 12}" text-anchor="middle" font-size="9" fill="#7a665c">D${h.day}</text>`).join("");
  const points = last7.map((h, i) => `${xOf(i) + 8 + barW / 2},${yOf(h.profit)}`).join(" ");
  const line = last7.length > 1 ? `<polyline points="${points}" fill="none" stroke="#3f7a5c" stroke-width="2"></polyline>` : "";
  const dots = last7.map((h, i) => `<circle cx="${xOf(i) + 8 + barW / 2}" cy="${yOf(h.profit)}" r="3" fill="${h.profit >= 0 ? "#3f7a5c" : "#b4452f"}"></circle>`).join("");

  els.growthPanel.innerHTML = `
    <section class="strategy-group">
      <h3>🎯 新手目标</h3>
      <div class="goal-list">
        ${goals.map((g) => `
          <div class="goal-row ${g.done ? "done" : ""}">
            <span class="goal-icon">${g.done ? "✅" : g.icon}</span>
            <div class="goal-main">
              <b>${g.name}</b>
              <div class="goal-bar"><i style="width:${g.pct}%"></i></div>
            </div>
            <small>${g.done ? "已完成" : g.label}</small>
          </div>`).join("")}
      </div>
    </section>
    <section class="strategy-group">
      <h3>📈 近 7 天趋势 <small>柱=营收 · 线=净利</small></h3>
      ${last7.length ? `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 7 天营收与净利趋势">${bars}${line}${dots}</svg>` : `<p class="strategy-note">还没有营业数据，先开门做一天生意。</p>`}
      <div class="strategy-market">
        <span>累计营收 ${money(totalRevenue)}</span>
        <span class="${totalProfit >= 0 ? "down" : "up"}">累计净利 ${signed(totalProfit)}</span>
        <span>最佳单日 ${money(bestProfit)}</span>
        <span>累计销量 ${state.totalUnits} 件</span>
      </div>
    </section>
    <section class="strategy-group">
      <h3>🏆 成就 <small>已解锁 ${unlocked} / ${ACHIEVEMENTS.length}</small></h3>
      <div class="ach-grid">
        ${ACHIEVEMENTS.map((a) => {
          const day = state.achievements[a.id];
          return `<div class="ach-card ${day ? "on" : ""}" title="${a.desc}">
            <span>${day ? a.icon : "🔒"}</span>
            <b>${a.name}</b>
            <small>${day ? `第 ${day} 天` : a.desc}</small>
          </div>`;
        }).join("")}
      </div>
    </section>
    ${stageSectionHtml()}
    ${gentleSectionHtml()}`;
}

/* ---------------- 历史订单：汇总 + 最近流水 ---------------- */
function renderOrdersPanel() {
  const allOrders = Array.isArray(state.orders) ? state.orders : [];
  /* 按经营天数分页：1-31、32-62 … 选中区间只看该段订单 */
  const maxDay = Math.max(state.day || 1, ...allOrders.map((order) => Number(order.day) || 1), 1);
  const ranges = [];
  for (let from = 1; from <= maxDay; from += 31) {
    const to = Math.min(from + 30, maxDay);
    ranges.push({ from, to, key: `${from}-${to}` });
  }
  const activeRange = state.orderRange || "all";
  const [rangeFrom, rangeTo] = activeRange.split("-").map(Number);
  const orders = activeRange === "all" || !Number.isFinite(rangeFrom) || !Number.isFinite(rangeTo)
    ? allOrders
    : allOrders.filter((order) => order.day >= rangeFrom && order.day <= rangeTo);
  const totalRevenue = orders.reduce((sum, order) => sum + (order.revenue || 0), 0);
  const totalCogs = orders.reduce((sum, order) => sum + (order.cogs || 0), 0);
  const totalProfit = totalRevenue - totalCogs;
  const avgTicket = orders.length ? Math.round(totalRevenue / orders.length) : 0;

  /* 商品汇总：按销售额排序，最多展示 8 种 */
  const goodsMap = new Map();
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const row = goodsMap.get(item.gid)
        || { gid: item.gid, name: item.name, qty: 0, revenue: 0, cogs: 0 };
      row.qty += item.qty || 0;
      row.revenue += item.revenue || 0;
      row.cogs += item.cogs || 0;
      goodsMap.set(item.gid, row);
    });
  });
  const topGoods = [...goodsMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const recent = orders.slice(-60).reverse();

  els.ordersPanel.innerHTML = `
    <section class="strategy-group">
      <h3>🧾 历史订单汇总 <small>保留最近 ${MAX_ORDER_HISTORY} 单</small></h3>
      <div class="strategy-market">
        <span>本范围订单 ${orders.length} 单</span>
        <span>总收入 ${money(totalRevenue)}</span>
        <span>总成本 ${money(totalCogs)}</span>
        <span class="${totalProfit >= 0 ? "down" : "up"}">总毛利 ${signed(totalProfit)}</span>
        <span>客单价 ${money(avgTicket)}</span>
      </div>
      <div class="order-range" role="group" aria-label="按经营天数筛选">
        <button type="button" data-order-range="all" class="${activeRange === "all" ? "on" : ""}">全部</button>
        ${ranges.map((range) => `
          <button type="button" data-order-range="${range.key}" class="${activeRange === range.key ? "on" : ""}">第 ${range.from}–${range.to} 天</button>`).join("")}
      </div>
      <p class="strategy-note">${orders.length ? "每笔成交按实收金额与进价成本记账，抹零与赠品成本同样计入。" : "还没有成交订单。开门营业后，每笔成交都会记在这里。"}</p>
    </section>
    <section class="strategy-group">
      <h3>🏆 商品汇总 <small>按销售额排序</small></h3>
      ${topGoods.length ? `
        <div class="order-goods">
          ${topGoods.map((row) => `
            <div class="order-goods-row">
              <b>${row.name}</b>
              <span>${row.qty} 件</span>
              <span>${money(row.revenue)}</span>
              <span class="${row.revenue - row.cogs >= 0 ? "ok" : "bad"}">毛利 ${signed(row.revenue - row.cogs)}</span>
            </div>`).join("")}
        </div>` : `<p class="strategy-note">暂无商品成交记录。</p>`}
    </section>
    <section class="strategy-group">
      <h3>📜 最近订单 <small>最新 ${recent.length} 单</small></h3>
      ${recent.length ? `
        <div class="order-list">
          ${recent.map((order) => `
            <div class="order-row">
              <div class="order-head">
                <b>第 ${order.day} 天 · 第 ${order.daySeq} 单</b>
                <span>${order.customer}</span>
                ${order.bargain ? `<em class="order-tag">${BARGAIN_LABEL[order.bargain] || order.bargain}</em>` : ""}
              </div>
              <div class="order-items">${(order.items || []).map((item) => `${item.name}×${item.qty}${item.unit || ""}`).join("、") || "—"}</div>
              <div class="order-meta">
                <span>收入 <b>${money(order.revenue)}</b></span>
                <span>成本 <b>${money(order.cogs)}</b></span>
                <span class="${order.profit >= 0 ? "ok" : "bad"}">毛利 ${signed(order.profit)}</span>
              </div>
            </div>`).join("")}
        </div>` : `<p class="strategy-note">暂无历史订单。</p>`}
    </section>`;
}

/* ---------------- 阶段与日常 ---------------- */
function stageSectionHtml() {
  const current = stageOf();
  const currentIdx = stageIndex();
  const next = STAGES[currentIdx] || null;
  return `
    <section class="strategy-group">
      <h3>🧭 经营阶段 <small>${current.icon} ${current.name}</small></h3>
      <div class="stage-track">
        ${STAGES.map((stage) => {
          const unlocked = currentIdx >= stage.id;
          const active = currentIdx === stage.id;
          return `<div class="stage-node ${unlocked ? "on" : ""} ${active ? "is-current" : ""}">
            <span>${unlocked ? stage.icon : "🔒"}</span>
            <b>${stage.name}</b>
            <small>${unlocked ? (active ? stage.tip : "已解锁") : stageReqText(stage.req)}</small>
          </div>`;
        }).join("")}
      </div>
      <p class="strategy-note">${next ? `下一阶段「${next.name}」：${stageReqText(next.req)}` : "已进入连锁阶段，可以多店托管。"}</p>
    </section>`;
}

function gentleAdvice() {
  const s = state.settlement || state.lastSettlement;
  if (!s) return "今天先把货摆好，价格别低于进价，剩下的交给街坊。";
  if (s.profit < 0) return `昨天亏了 ${money(-s.profit)}，别急着加货，先看看租金和损耗。`;
  if ((s.spoilRate || 0) >= 0.08) return `昨天损耗占到 ${((s.spoilRate || 0) * 100).toFixed(0)}%，台面少摆一点，或者考虑升级货架。`;
  if ((s.stockouts || 0) >= 3) return `昨天有 ${s.stockouts} 次空手而归，今天补货可以稍微大方一点。`;
  return `昨天净赚 ${money(s.profit)}，这个节奏很稳，保持就好。`;
}

function gentleSectionHtml() {
  const days = state.history.length;
  const reached = MILESTONES.filter((m) => days >= m.days);
  const current = reached[reached.length - 1] || MILESTONES[0];
  const next = MILESTONES.find((m) => days < m.days);
  const whisper = DAILY_WHISPERS[(Math.max(1, state.day) - 1) % DAILY_WHISPERS.length];
  return `
    <section class="strategy-group">
      <h3>🌿 小店日常 <small>第 ${days} 天 · ${current.icon} ${current.name}</small></h3>
      <div class="whisper-card">
        <b>${whisper}</b>
        <span>今日手记</span>
      </div>
      <p class="strategy-note">${gentleAdvice()}</p>
      <div class="milestone-track">
        ${MILESTONES.map((m) => `
          <span class="milestone-chip ${days >= m.days ? "on" : ""}" title="${days >= m.days ? "已达成" : `还差 ${m.days - days} 天`}">
            ${days >= m.days ? m.icon : "·"} ${m.name}
          </span>`).join("")}
      </div>
      <p class="strategy-note">${next ? `再经营 ${next.days - days} 天，就是「${next.name}」。` : "你已经把这家小店经营成了街区的老朋友。"}</p>
    </section>`;
}

/* ---------------- 规则手册 ---------------- */
const RULEBOOK = [
  { group: "定价", items: [
    "雨天敏感品类自动上浮（果蔬店叶菜 +30%、烧烤摊海鲜 +25%、蛋糕店面包 +10%、沙县主食 +10%、便利店零食 +8%、玉石店不变）",
    "晚市后半段清仓：果蔬/蛋糕/沙县/便利店可按你设定的 5–9 折清仓直到打烊；烧烤与玉石店不参与清仓",
    "促销「全场 9 折」与天气、清仓叠加计算",
    "后台定的是基准价，实际售价随规则动态变化",
  ]},
  { group: "季节与供应链", items: [
    "每 10 个游戏日为一个季节：春、夏、秋、冬循环，顶栏会显示当前季节进度",
    "季节影响进价、损耗与需求：夏季水果走量但生鲜损耗 +15%，冬季叶菜/海鲜涨价、根茎与炖汤更受欢迎",
    "天气概率也随季节变化：夏季多闷热与暴雨，冬季几乎不会闷热；闷热天水果损耗翻倍",
    "进货可选三类渠道：散户批发进价 -10%、额度 +35%，但损耗 +25% 且每批品质随机；本地农贸均衡；品牌冷链贵 14%、额度 -40%，损耗 -40% 且卖相更好",
    "渠道只影响新进的批次，旧库存按当时的渠道继续衰减",
    "每天每种商品有到货额度，切换渠道会按新渠道额度重新折算",
    "单笔进货 ≥30 件走物流：下单即扣款，10–30 秒后进后台，后台显示在途数量；仓库满时货车会等待",
    "暴雨天物流更慢，且有 15% 概率少发约 20% 货量",
    "每天固定扣除水电杂费，随日租与铺面规模变化；施工日照付",
    "夜市清仓折扣可设 5–9 折，营业中修改会立即生效",
  ]},
  { group: "阶段、货架与日常", items: [
    "经营阶段分四级：路边摊 → 社区小店 → 精品生鲜 → 连锁经营，只升不降",
    "路边摊只能用摊位，可选果蔬店 / 烧烤摊 / 沙县小吃；社区小店解锁小门面、蛋糕店与便利店",
    "精品生鲜解锁大门店、冷藏货架与分店；连锁经营解锁整层物业",
    "货架三档：普通木架 → 精品货架（容量 +15%、购买意愿 +15%）→ 冷藏货架（容量 +30%、生鲜损耗 -50%、购买意愿 +20%）",
    "货架只作用于台面陈列，后台仓库损耗不变；只能逐级升级，不能回退",
    "小店日常只记录营业天数、里程碑与每日手记，不发放现金、不改变损耗与客流",
    "每日手记会根据昨天的亏损、损耗与缺货给出轻提示，只做参考，不影响数值",
  ]},
  { group: "人流", items: [
    "客流按早市/上午/午间/下午/晚市分布，店址决定高峰时段",
    "地铁口早晚通勤旺，菜市场早市旺，大学城午晚旺",
    "地区客流 = 店址基础人流 × 同业竞争分流；周末各店址不同（社区/菜市场上升，写字楼/大学城回落）",
    "门店经营会沉淀为门店印象：卖相、服务、价格、齐全度合成 ×0.80–×1.22 的客流系数，影响次日到店人数",
    "客流自适应：按昨日转化、缺货与冷清程度平滑调整，限制在 ×0.85–×1.15",
    "客单价自适应：价格印象好、有促销时顾客一次多买一点，客单系数限制在 ×0.80–×1.25",
    "缺货、拒绝成交、差评会拉低服务分；好货、好评、高转化会抬高客流",
    "节日、发薪日晚市暴涨；对手开业抢晚市客流",
    "口碑 ≥4 晚市熟客更多；促销与试吃也能拉客",
  ]},
  { group: "卖相", items: [
    "商品卖相 0-100：影响顾客选择、愿付价格与口碑",
    "隔夜自然变蔫，速度按单品损耗率走：苹果慢、水蜜桃和草莓快",
    "挑拣 +8、洒水 +6（次日多保 1 天）、翻堆 +4",
    "每商品每天只能维护 1 次；好装修减缓变蔫",
    "护理会延长保质期；洒水在次日结算腐损时生效，过期损耗按库存成本计并回收约 20% 残值",
    "营业中也能维护，但会占用 1 名空闲员工；同一员工只能干一件事，维护期间不能收银、不计岗位加成",
  ]},
  { group: "售卖风格", items: [
    "果蔬店：散称，单菜品多数量，一次只挑一种、按份数买",
    "烧烤摊 / 沙县小吃：统一点单，2-3 样合成一单，只对整单议一次价",
    "蛋糕店 / 玉石店 / 便利店：单件成交，逐件报价",
    "统一抹零：果蔬、烧烤、沙县抹到整元，蛋糕、便利店抹到整角，玉石不抹",
    "抹掉的零头只减少营收，不计入商品成本，也不影响库存账面",
  ]},
  { group: "损耗", items: [
    "所有商品每天都会损耗，按单品速率与批次年龄扣减；越放越坏",
    "仓储条件不同：烧烤后台冰箱 ×0.25，台面 ×1.6；蛋糕后台 ×0.55，台面 ×1.35",
    "果蔬后台 ×0.7、台面 ×1.15；其他店型后台 ×0.6、台面 ×1.0",
    "理货、品控与装修会降低损耗速度；库存越久，损耗加速越明显",
  ]},
  { group: "议价", items: [
    "7 种回应：接受/折中/坚持/送葱/夸货/诉苦/沉默",
    "成功率看顾客耐心、敏感度、家境、性格与砍价属性",
    "熟客更好商量；爱砍价、手头紧的顾客还价更狠",
    "在岗收银员可以代你讲价：讲价倾向由性格、效率、心情和体力决定，倾向越高越敢守价磨价",
    "收银员坐镇还会提高手动讲价的成功率；托管模式下优先由收银员代谈",
    "托管模式自动按「成功率 × 成交价」选最优策略",
  ]},
  { group: "采购", items: [
    "批发行情每天按品类波动 ±12%，低价日适合囤货",
    "批量折扣：一次 ≥20 件 95 折、≥40 件 9 折",
    "进货先进入后台，必须在后台点「上架」才能摆到台面售卖",
    "台面与后台各有容量上限；后台囤货同样会腐损，别一次压太多",
    "补新货会让该商品卖相回升；到货量每天有限",
    "采购员在开门前按策略自动进货，并顺手把能摆的货补到台面；花费受现金余额限制",
  ]},
  { group: "员工", items: [
    "角色：收银员/店长/理货员/叫卖员/采购员/师傅，各有默认岗位与底薪",
    "收银员除了减少缺货抱怨，还能代你讲价，讲价倾向随性格与状态变化",
    "员工可随时调岗：收银、管理、理货、叫卖、采购、定价、品控，加成按岗位与效率计算",
    "采购岗按策略自动补货下单：少进快销/正常补货/备足货；定价岗按薄利多销/随行就市/精品高价自动调价",
    "管理岗开门前自动维护卖相最差的货；叫卖岗按温和/正常/卖力提升客流与愿付",
    "员工工资按天折算，每天开门前自动结算并计入当日成本；日薪合计可在员工页查看",
    "员工有性格（勤快/老实/圆滑/爱摸鱼/乐观/脾气急），每天可能触发涨薪/请假/摸鱼事件",
    "同一员工同一时间只能干一件事：营业中维护会占用 1 名空闲员工，维护期间不能收银、不计岗位加成",
    "每位员工都有 0–100 体力：接待顾客、开门自动任务、营业中维护都会消耗；体力 ≥60 满效率，30–59 为 85%，10–29 为 60%，低于 10 仅 30% 且不能再接维护",
    "体力隔夜按心情恢复（38 + 心情 × 0.15）；连续加班会累积疲劳，不是请了人就能无限干活",
    "心情低于阈值会辞职；铺面规格决定员工上限",
  ]},
  { group: "装修", items: [
    "装修影响客流、商品损耗、顾客愿付价格、口碑与意外风险，6 项按质量加权评分",
    "不装修（全基础款）：客流约 -10%、商品损耗约 +12%，每天约 24% 概率出意外；装修越差、耗损越重，风险越高",
    "装修损益按累计口径记录：工程款、施工停业照付的租金维护、少做营收、累计维护、意外赔付与装修现值",
    "施工按天占用营业，期间不能开门；可点「跳过施工日」立即进入下一天，或等待 5 分钟自动进入，每天照付租金、工资与装修维护",
    "耗损每日增加，全额付维护可小幅保养，翻新后耗损折半",
    "低价材料有甲醛、滑倒、倾倒等隐患，会在开门前随机变成赔付与口碑损失",
  ]},
  { group: "分店", items: [
    "分店按类型 × 地段 × 铺面自动经营，每天早间结算昨日利润",
    "员工数量决定接客效率，2 人以上才接近满负荷",
    "补货策略：保守（损耗低易断货）/ 标准 / 激进（抢量但损耗高）",
    "开分店约需 15 天租金 + 开办费，开店前会给出预估日净利",
    "门店估值每天随日利润、口碑与市场情绪浮动；老板可自选波动权重：稳健 ±1.5% / 均衡 ±3% / 激进 ±6%",
    "分店可按当前估值出售，扣 6% 转让税费后现金到账；高买低卖会亏，低买高卖能赚差价",
    "分店可远程巡店：营业中也能看日报、调策略、招人、改波动权重与出售，不必等打烊",
  ]},
  { group: "成长与存档", items: [
    "新手目标实时计算进度：首日营业、单日净利、口碑、员工、分店、累计销量",
    "成就解锁后永久记录，可在「成长」页查看已解锁天数",
    "成长页提供近 7 天营收柱状图与净利折线，方便复盘",
    "连续 3 天以上付不起租金/工资/维护，或现金耗尽且无库存可卖，会进入破产清算",
    "后台底部可主动退出经营：按 30 天日租支付违约金，库存按成本 50% 清算",
    "进度实时自动保存：营业中关页会从下一位顾客继续，打烊后会回到结算面板",
    "注册登录后，存档按账号隔离，并记录经营天数、最佳日净利、累计净利与成就数",
    "游客可以直接试玩，但进度只留在本机游客档，不记入账号档案",
  ]},
];

function renderRulebook() {
  els.rulebookBody.innerHTML = RULEBOOK.map((section) => `
    <section class="rb-group">
      <h4>${section.group}</h4>
      <ul>${section.items.map((item) => `<li>${item}</li>`).join("")}</ul>
    </section>`).join("");
}

/* ---------------- 商品维护与详情（成色 / 卖相） ---------------- */
function careGoods(gid, kind, options = {}) {
  if (!canMaintainNow()) {
    toast("现在不能维护");
    return;
  }
  const goods = GOOD_INDEX[gid];
  if (!goods || totalStockOf(gid) <= 0) {
    toast("没有库存，无需维护");
    return;
  }
  if (state.careSet[gid]) {
    toast("这种货今天已经维护过了");
    return;
  }
  /* 营业中维护会占用一名空闲员工；批量维护只占用一次 */
  if (options.occupy !== false) occupyMaintainer();
  state.careSet[gid] = true;
  const appeal = appealOf(gid);
  let note = "";
  if (kind === "trim") {
    state.condition[gid] = clamp(appeal + 8, 25, 100);
    note = "挑拣烂叶，卖相 +8";
    if (Math.random() < 0.05) {
      const loss = takeStock(gid, 1);
      if (loss > 0) {
        state.daySpoilage += loss;
        state.baseWealth -= loss;
        note += "，挑出 1 份烂货";
      }
    }
  } else if (kind === "spray") {
    state.condition[gid] = clamp(appeal + 6, 25, 100);
    state.sprayed[gid] = state.day;
    note = "洒水保鲜，卖相 +6，次日到期时多保 1 天";
  } else {
    state.condition[gid] = clamp(appeal + 4, 25, 100);
    note = "翻堆透气，卖相 +4";
  }
  StallAudio.tap();
  logLine(`${goods.name} ${note}`, "good");
  toast(`${goods.name}：${note}`);
  renderShelf();
  if (currentGoodsModal) renderGoodsModal(currentGoodsModal);
  renderBackstage();
  if (options.save !== false) {
    if (state.phase === "open") saveGame();
    else persistPrep();
  }
}

let currentGoodsModal = null;

function openGoodsModal(gid) {
  const goods = GOOD_INDEX[gid];
  if (!goods) return;
  currentGoodsModal = gid;
  renderGoodsModal(gid);
  els.goodsModal.hidden = false;
}

function closeGoodsModal() {
  currentGoodsModal = null;
  els.goodsModal.hidden = true;
}

function renderGoodsModal(gid) {
  const goods = GOOD_INDEX[gid];
  const appeal = appealOf(gid);
  const shelf = shelfStockOf(gid);
  const back = backStockOf(gid);
  const basePrice = state.prices[gid] || goods.base;
  const price = effectivePrice(goods);
  const shelfLots = state.inventory[gid] || [];
  const backLots = state.backroom[gid] || [];
  const lots = [...shelfLots, ...backLots];
  const daysLeft = lots.length ? Math.max(0, ...lots.map((lot) => lotExpireDay(goods, lot) - state.day)) : 0;
  const cared = !!state.careSet[gid];
  const canCare = canMaintainNow() && shelf + back > 0 && !cared;
  const canStock = state.phase !== "settle" && back > 0 && shelf < capOf(goods);
  const weatherRule = weatherRuleFor(goods);
  const dynNote = state.clearance ? ` · 清仓${clearanceLabel()}`
    : weatherRule ? ` · ${weatherRule.reason} +${Math.round((weatherRule.mult - 1) * 100)}%`
    : price < basePrice && state.promo?.kind === "discount" ? " · 促销9折" : "";
  els.goodsModalBody.innerHTML = `
    <button class="gm-close" type="button" data-close aria-label="关闭">×</button>
    <div class="gm-head">
      <span class="gm-icon">${iconMarkup(goods)}</span>
      <div>
        <h3 id="goodsModalName">${goods.name}<small>${goods.cat} · ${goods.unit} · 保鲜 ${goods.shelf} 天</small></h3>
        <p class="gm-condition">成色 <b>${appeal}</b> · <em>${appealLabel(appeal)}</em></p>
      </div>
    </div>
    <div class="gm-appeal" title="卖相 ${appeal}/100"><i style="width:${appeal}%"></i></div>
    <div class="gm-grid">
      <div class="gm-cell"><span>台面库存</span><b class="${shelf <= 1 ? "low" : ""}">${shelf} / ${capOf(goods)} ${goods.unit}</b></div>
      <div class="gm-cell"><span>后台库存</span><b>${back} / ${backCapOf(goods)} ${goods.unit}</b></div>
      <div class="gm-cell"><span>最早到期</span><b>${daysLeft} 天</b></div>
      <div class="gm-cell"><span>基准价</span><b>¥${yuan(basePrice)}</b></div>
      <div class="gm-cell"><span>今日价</span><b>¥${yuan(price)}${dynNote ? `<small>${dynNote}</small>` : ""}</b></div>
      <div class="gm-cell"><span>今日到货 / 进价</span><b>${supplyLeftOf(gid)} 件 · ¥${yuan(unitCost(goods))}</b></div>
    </div>
    <div class="gm-lots">
      <p>库存批次</p>
      ${lots.length
        ? [
            ...shelfLots.map((lot) => `<span>台面 · 入库第 ${Math.max(0, state.day - lot.dayIn)} 天 · ${lot.qty} 件 · 进价 ¥${yuan(lot.cost)}</span>`),
            ...backLots.map((lot) => `<span>后台 · 入库第 ${Math.max(0, state.day - lot.dayIn)} 天 · ${lot.qty} 件 · 进价 ¥${yuan(lot.cost)}</span>`),
          ].join("")
        : `<span class="gm-empty">暂无库存</span>`}
    </div>
    <div class="gm-care">
      <button type="button" data-care="trim" ${canCare ? "" : "disabled"}>✂️ 挑拣 · 卖相+8</button>
      <button type="button" data-care="spray" ${canCare ? "" : "disabled"}>💧 洒水 · 卖相+6 · 保鲜+1天</button>
      <button type="button" data-care="turn" ${canCare ? "" : "disabled"}>🔄 翻堆 · 卖相+4</button>
      <button type="button" class="shelf-btn" data-stock="fill" ${canStock ? "" : "disabled"}>📤 补满台面</button>
      <span class="gm-cared">${cared ? "今天已维护过" : !canMaintainNow() ? "现在不能维护" : state.phase === "open" ? "营业中维护会占用 1 名空闲员工" : "每天每商品可维护 1 次"}</span>
    </div>
    <p class="gm-tip">卖相影响顾客选择、愿付价格与口碑；隔夜会变蔫，好装修能缓一点。</p>`;
}

/* ---------------- 经营策略面板 ---------------- */
function renderStrategyPanel(locked) {
  const caredCount = Object.keys(state.careSet).length;
  els.strategyPanel.innerHTML = `
    <section class="strategy-group">
      <h3>🤖 托管策略 <small>开启顶栏「托管」后生效</small></h3>
      <p class="strategy-note">当前 <b>${autoStyleOf().icon} ${autoStyleOf().name}</b>：${autoStyleOf().desc}。托管讲价会按这套倾向自动回应，收银员代谈同样遵守。</p>
      <div class="strategy-cats">
        ${AUTO_STYLES.map((style) => `
          <button type="button" data-autostyle="${style.id}" class="${state.autoStyle === style.id ? "on" : ""}" title="${style.desc}">
            ${style.icon} ${style.name}
          </button>`).join("")}
      </div>
    </section>
    <section class="strategy-group">
      <h3>🥇 黄金位陈列</h3>
      <p class="strategy-note">摆到门口最显眼的位置：该品类购买倾向 +15%，其他品类 −5%。</p>
      <div class="strategy-cats">
        ${CATEGORIES.map((cat) => `
          <button type="button" data-golden="${cat.name}" class="${state.goldenCat === cat.name ? "on" : ""}" ${locked ? "disabled" : ""}>
            ${cat.icon} ${cat.name}
          </button>`).join("")}
        <button type="button" data-golden="none" class="${!state.goldenCat ? "on" : ""}" ${locked ? "disabled" : ""}>无</button>
      </div>
    </section>
    <section class="strategy-group">
      <h3>📣 促销策略 <small>营业前启用 · 当天生效</small></h3>
      <div class="strategy-promos">
        <button type="button" data-promo="discount" class="${state.promo?.kind === "discount" ? "on" : ""}" ${locked ? "disabled" : ""}>
          全场 9 折 <small>客流 +15% · 让利换量</small>
        </button>
        <button type="button" data-promo="tasting" class="${state.promo?.kind === "tasting" ? "on" : ""}" ${locked ? "disabled" : ""}>
          水果试吃 <small>花 ¥20 · 客流 +10%</small>
        </button>
        <button type="button" data-promo="none" class="${!state.promo ? "on" : ""}" ${locked ? "disabled" : ""}>不搞促销</button>
      </div>
    </section>
    <section class="strategy-group">
      <h3>🌙 夜市清仓 <small>晚市后半段自动生效</small></h3>
      <p class="strategy-note">折扣越低清得越快，但利润越薄。当前：<b>${clearanceLabel()}</b>${state.phase === "open" ? "，本次营业立即按新折扣执行" : "，今晚打烊前按此折扣清尾货"}。</p>
      <div class="strategy-cats">
        ${[0.5, 0.6, 0.7, 0.8, 0.9].map((rate) => `
          <button type="button" data-clearance="${rate}" class="${(state.clearanceRate || 0.5) === rate ? "on" : ""}" ${state.phase === "settle" ? "disabled" : ""}>
            ${rate * 10} 折
          </button>`).join("")}
      </div>
    </section>
    <section class="strategy-group">
      <h3>🧹 商品维护 <small>每商品每天 1 次</small></h3>
      <p class="strategy-note">隔夜菜会变蔫，卖相影响选择、愿付价格与腐损。已维护 <b>${caredCount}</b> / ${GOODS.length} 种。</p>
      <div class="strategy-care">
        <button type="button" data-careall="trim" ${canMaintainNow() ? "" : "disabled"}>✂️ 有货的全都挑拣一遍</button>
        <button type="button" data-careall="spray" ${canMaintainNow() ? "" : "disabled"}>💧 有货的全都洒一遍水</button>
      </div>
      <p class="strategy-note ${state.phase === "open" ? "warn" : ""}">${state.phase === "open" ? "营业中可维护，会占用 1 名空闲员工；该员工维护期间不能收银。" : "同一员工同一时间只能干一件事。"}</p>
    </section>
    <section class="strategy-group">
      <h3>📈 今日批发行情 <small>每天波动</small></h3>
      <div class="strategy-market">
        ${CATEGORIES.map((cat) => {
          const wave = state.wholesale[cat.name] || 1;
          const pct = Math.round((wave - 1) * 100);
          return `<span class="${pct >= 0 ? "up" : "down"}">${cat.icon} ${cat.name} ${pct >= 0 ? "+" : ""}${pct}%</span>`;
        }).join("")}
      </div>
      <p class="strategy-note">${seasonOf().icon} ${seasonOf().name}季：${seasonOf().tip}</p>
      <p class="strategy-note">批量进货折扣：一次 ≥20 件 95 折、≥40 件 9 折；行情低的日子适合囤货。</p>
    </section>`;
}

/* ---------------- 后台 ---------------- */
/* 批量补货 / 上架只看当前所选标签页，不受搜索与「只看缺货」影响 */
function backTabGoods() {
  return GOODS.filter((goods) => state.backCat === "all" || goods.cat === state.backCat);
}

function backFilteredGoods() {
  const query = state.backQuery.trim().toLowerCase();
  return GOODS.filter((goods) => {
    if (state.backCat !== "all" && goods.cat !== state.backCat) return false;
    if (query && !goods.name.toLowerCase().includes(query) && !goods.id.toLowerCase().includes(query)) return false;
    if (state.backLowOnly && stockOf(goods.id) > 0) return false;
    return true;
  });
}

function renderBackTabs() {
  els.backTabs.innerHTML = [{ id: "all", name: "全部", icon: "🧺" }, ...CATEGORIES.map((cat) => ({
    id: cat.name, name: cat.name, icon: cat.icon,
  }))].map((cat) => {
    const count = cat.id === "all" ? GOODS.length : goodsOfCategory(cat.id).length;
    return `<button type="button" class="back-tab ${state.backCat === cat.id ? "on" : ""}" data-cat="${cat.id}">
      ${cat.icon} ${cat.name}<span>${count}</span>
    </button>`;
  }).join("");
}

/* 后台标签提醒：员工页有招聘待审批时显示红点数字 */
function updateBackViewBadges() {
  const staffBtn = els.backViews.querySelector('[data-view="staff"]');
  if (!staffBtn) return;
  const count = (state.hireRequests || []).length;
  staffBtn.dataset.badge = count ? String(count) : "";
  staffBtn.setAttribute("aria-label", count ? `员工，${count} 条招聘待审批` : "员工");
}

function renderBackstage() {
  if (els.backstage.hidden) return;
  const locked = state.phase !== "prep";
  const loc = state.location;
  els.ledgerSummary.innerHTML = `
    <span>店面 <b>${loc ? loc.name : "未选择"}</b></span>
    <span>今日租金 <b>${rentLabel(state.dayRent || (loc ? Math.round(loc.rent * sizeOf().rentMult) : 0))}</b></span>
    <span>现金 <b>${money(state.cash)}</b></span>
    <span>库存货值 <b>${money(bookValue())}</b></span>
    <span>总资产 <b>${money(totalAssetValue())}</b></span>
    <span>装修评分 <b>${decorQuality().toFixed(1)}</b> <small>${decorStars(decorQuality())}</small></span>
    <span>状态 <b>${state.phase === "prep" ? "营业前 · 可调整" : state.phase === "open" ? "营业中 · 可维护" : "打烊 · 只读"}</b></span>`;

  const decorView = state.backView === "decor";
  const strategyView = state.backView === "strategy";
  const staffView = state.backView === "staff";
  const branchView = state.backView === "branch";
  const growthView = state.backView === "growth";
  const ordersView = state.backView === "orders";
  els.goodsPanel.hidden = decorView || strategyView || staffView || branchView || growthView || ordersView;
  els.decorPanel.hidden = !decorView;
  els.strategyPanel.hidden = !strategyView;
  els.staffPanel.hidden = !staffView;
  els.branchPanel.hidden = !branchView;
  els.growthPanel.hidden = !growthView;
  els.ordersPanel.hidden = !ordersView;
  els.backViews.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("on", button.dataset.view === state.backView);
  });
  updateBackViewBadges();

  if (decorView) {
    renderDecorPanel(locked);
    return;
  }
  if (strategyView) {
    renderStrategyPanel(locked);
    return;
  }
  if (staffView) {
    renderStaffPanel(locked);
    return;
  }
  if (branchView) {
    /* 分店是远程遥控：营业中也能巡店、调策略、买卖，只有打烊结算时只读 */
    renderBranchPanel(state.phase === "settle");
    return;
  }
  if (growthView) {
    renderGrowthPanel();
    return;
  }
  if (ordersView) {
    renderOrdersPanel();
    return;
  }

  renderBackTabs();
  if (els.backSupplier) {
    els.backSupplier.innerHTML = SUPPLIERS.map((supplier) => `
      <option value="${supplier.id}" ${state.supplier === supplier.id ? "selected" : ""}>
        ${supplier.icon} ${supplier.name} ×${supplier.price.toFixed(2)} · 额度 ${supplier.volume.toFixed(2)}×
      </option>`).join("");
    els.backSupplier.title = `${supplierOf().name}：${supplierOf().desc}。大额进货（≥${BULK_SHIPPING_QTY} 件）走物流，下单即扣款，10–30 秒后到货。`;
  }
  const allScope = state.backCat === "all";
  els.backFillCat.textContent = allScope ? "全部补货" : "本类补满";
  els.backStockCat.textContent = allScope ? "全部上架" : "本类上架";
  els.backFillCat.disabled = locked;
  els.backStockCat.disabled = state.phase === "settle";
  const list = backFilteredGoods();

  if (!list.length) {
    els.ledgerList.innerHTML = `<div class="ledger-empty">没有符合条件的商品。</div>`;
    return;
  }

  els.ledgerList.innerHTML = list.map((goods) => {
    const shelf = shelfStockOf(goods.id);
    const back = backStockOf(goods.id);
    const unit = unitCost(goods);
    const left = supplyLeftOf(goods.id);
    const transit = shipmentQtyOf(goods.id);
    const price = state.prices[goods.id] || goods.base;
    const { lower, upper } = priceBounds(goods);
    const margin = price > 0 ? Math.round(((price - unit) / price) * 100) : 0;
    const dynamic = effectivePrice(goods);
    const rule = weatherRuleFor(goods);
    const dynNote = dynamic !== price
      ? (state.clearance ? " · 今日清仓5折" : rule ? ` · ${rule.reason} +${Math.round((rule.mult - 1) * 100)}%` : "")
      : "";
    const unlock = goodsUnlockState(goods);
    const isLocked = !unlock.unlocked;
    const canRestock = !locked && !isLocked && left > 0 && back + transit < backCapOf(goods) && state.cash >= unit;
    const canStock = state.phase !== "settle" && back > 0 && shelf < capOf(goods);
    const canUnshelf = state.phase !== "settle" && shelf > 0 && back + transit < backCapOf(goods);
    const rates = spoilageRates(goods);
    const low = shelf <= 1;
    return `
      <div class="ledger-row ${low ? "is-low" : ""} ${isLocked ? "is-locked" : ""}" data-gid="${goods.id}">
        <div class="ledger-good">
          ${iconMarkup(goods, "ledger-icon")}
          <div>
            <b>${goods.name}<em class="tier-tag tier-${unlock.tier.id}">${unlock.tier.name}</em></b>
            <small>${goods.cat} · ${goods.unit} · 保鲜 ${goods.shelf} 天</small>
            <small class="ledger-decay">损耗速率 台面 ${(rates.shelf * 100).toFixed(1)}%/天 · 后台 ${(rates.back * 100).toFixed(1)}%/天</small>
            <small class="unlock-note">${goodsUnlockText(goods)}</small>
          </div>
        </div>
        <div class="ledger-stock">
          <span>台面 <b class="${low ? "low" : ""}">${shelf}</b> / ${capOf(goods)}</span>
          <span>后台 <b class="${back > 0 ? "has-back" : ""}">${back}</b> / ${backCapOf(goods)}</span>
          <span>到货 <b>${left}</b> · 进价 <b>${money(unit)}</b></span>
          ${transit > 0 ? `<span class="ledger-ship">在途 <b>${transit}</b> · 物流中</span>` : ""}
        </div>
        <div class="ledger-price">
          <div class="stepper">
            <button type="button" data-act="price" data-gid="${goods.id}" data-delta="-10" ${locked || isLocked ? "disabled" : ""}>−</button>
            <input type="number" data-price-input data-gid="${goods.id}" value="${(price / 100).toFixed(2)}"
              min="${(lower / 100).toFixed(2)}" max="${(upper / 100).toFixed(2)}" step="0.1" ${locked || isLocked ? "disabled" : ""}>
            <button type="button" data-act="price" data-gid="${goods.id}" data-delta="10" ${locked || isLocked ? "disabled" : ""}>+</button>
          </div>
          <small>毛利 <b>${margin}%</b>${dynNote}</small>
        </div>
        <div class="ledger-restock">
          <button type="button" data-act="restock" data-gid="${goods.id}" data-qty="4" ${canRestock ? "" : "disabled"}>进 4</button>
          <button type="button" data-act="restock" data-gid="${goods.id}" data-qty="10" ${canRestock ? "" : "disabled"}>进 10</button>
          <button type="button" data-act="restock" data-gid="${goods.id}" data-qty="fill" ${canRestock ? "" : "disabled"}>进满</button>
          <button type="button" class="shelf-btn" data-act="shelf" data-gid="${goods.id}" data-qty="fill" ${canStock ? "" : "disabled"}>上架</button>
          <button type="button" class="shelf-btn unshelf-btn" data-act="unshelf" data-gid="${goods.id}" data-qty="fill" ${canUnshelf ? "" : "disabled"}>下架</button>
        </div>
      </div>`;
  }).join("");
}

function renderDecorPanel(locked) {
  const quality = decorQuality();
  const build = state.build ? DECOR_INDEX[state.build.id] : null;
  const hazards = decorHazards();
  const traffic = decorTrafficMult();
  const goodsMult = decorGoodsMult();
  const risk = decorRiskRate();
  const benefit = decorBenefitEstimate();
  const wearPct = Math.round(clamp(state.decorWear || 0, 0, 0.8) * 100);
  const pct = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;

  els.decorPanel.innerHTML = `
    <div class="decor-summary">
      <div><span>装修评分</span><b>${quality.toFixed(1)}</b><small>${decorStars(quality)}</small></div>
      <div><span>客流系数</span><b>×${traffic.toFixed(2)}</b><small>较毛坯 ${pct((traffic - 0.9) / 0.9)}</small></div>
      <div><span>商品损耗</span><b>×${goodsMult.toFixed(2)}</b><small>较毛坯 ${pct((goodsMult - 1.12) / 1.12)}</small></div>
      <div><span>意外风险</span><b>${Math.round(risk * 1000) / 10}%/天</b><small>毛坯最高约 18%</small></div>
      <div><span>每日维护</span><b>${money(decorDaily())}</b></div>
      <div><span>装修现值</span><b>${money(decorBookValue())}</b><small>耗损 ${wearPct}%</small></div>
      <div><span>施工中</span><b>${build ? `${build.name} · 剩 ${state.build.daysLeft} 天` : "无"}</b></div>
    </div>
    <section class="decor-finance">
      <h3>装修损益 <small>累计口径 · 估算</small></h3>
      <div class="decor-finance-grid">
        <div><span>一次性工程款</span><b>−${money(state.decorSpend)}</b></div>
        <div><span>施工停业</span><b>${state.decorDowntimeDays} 天</b><small>照付租金维护 ${money(state.decorDowntimeRent)}</small></div>
        <div><span>停业少做营收</span><b>−${money(state.decorLostRevenue)}</b><small>按近 7 天日均估算</small></div>
        <div><span>累计维护</span><b>−${money(state.decorMaintainTotal)}</b></div>
        <div><span>意外赔付</span><b>−${money(state.decorRiskCost)}</b><small>${state.decorRiskEvents} 次</small></div>
        <div><span>装修原值 / 现值</span><b>${money(decorReplacementValue())} / ${money(decorBookValue())}</b><small>按耗损折旧</small></div>
      </div>
      <div class="decor-benefit">
        <div><span>客流增益</span><b class="ok">+${money(benefit.trafficGain)}/天</b></div>
        <div><span>溢价增益</span><b class="ok">+${money(benefit.premiumGain)}/天</b></div>
        <div><span>减损收益</span><b class="ok">+${money(benefit.spoilSaving)}/天</b></div>
        <div><span>扣日维护</span><b class="bad">−${money(decorDaily())}/天</b></div>
        <div><span>日净增益</span><b class="${benefit.net >= 0 ? "ok" : "bad"}">${signed(benefit.net)}/天</b></div>
        <div><span>静态回本</span><b>${benefit.payback ? `约 ${benefit.payback} 天` : "短期难回本"}</b></div>
      </div>
    </section>
    <p class="decor-note">不装修（全基础款）：客流约 −10%、商品损耗约 +12%，意外风险最高约 18%/天（精装约 1.5%/天）。装修同时抬客流、抬售价、降损耗、降风险；施工按天停业，租金和维护照付。</p>
    ${shelfSectionHtml()}
    <div class="decor-groups">
      ${DECOR_CATS.map((cat) => `
        <section class="decor-group">
          <h3>${cat.icon} ${cat.name}</h3>
          <div class="decor-list">
            ${DECOR_BY_CAT[cat.id].map((item) => {
              const active = state.decor[cat.id] === item.id;
              const building = state.build && state.build.id === item.id;
              const otherBuilding = state.build && !building;
              const affordable = state.cash >= item.price;
              const label = active ? "使用中"
                : building ? `施工中 · 剩 ${state.build.daysLeft} 天`
                : locked ? "营业中不可施工"
                : otherBuilding ? "有工程在进行"
                : !affordable ? "现金不足"
                : item.price === 0 ? "换回基础款" : "开工";
              const disabled = active || building || locked || otherBuilding || !affordable;
              return `
                <article class="decor-card ${active ? "is-active" : ""} ${building ? "is-building" : ""}">
                  <header>
                    <b>${item.name}</b>
                    <span class="decor-stars">${decorStars(item.quality)}</span>
                  </header>
                  <div class="decor-meta">
                    <span>${item.price ? money(item.price) : "¥0"}</span>
                    <span>工期 ${item.days} 天</span>
                    <span>日维护 ${money(item.daily)}</span>
                  </div>
                  <p class="decor-mat">材料：${item.materials}<br>人工：${item.labor}</p>
                  <ul class="decor-pros">${item.pros.map((pro) => `<li>+ ${pro}</li>`).join("")}</ul>
                  <ul class="decor-cons">${item.cons.map((con) => `<li>− ${con}</li>`).join("")}</ul>
                  <p class="decor-hazard">风险：${item.hazard}</p>
                  <button type="button" data-decor="${item.id}" ${disabled ? "disabled" : ""}>${label}</button>
                </article>`;
            }).join("")}
          </div>
        </section>`).join("")}
    </div>
    <div class="decor-hazards">
      <b>当前使用中的隐患</b>
      <ul>${hazards.map((item) => `<li><span>${item.name}</span>${item.hazard}</li>`).join("")}</ul>
    </div>`;
}

/* 货架升级：台面容量、购买意愿、保鲜三件事一起涨 */
function shelfSectionHtml() {
  const current = shelfTierOf();
  const stage = stageIndex();
  const cards = SHELF_TIERS.map((tier, index) => {
    const active = state.shelfTier === tier.id;
    const locked = stage < tier.stage;
    const downgrade = index < SHELF_TIERS.findIndex((t) => t.id === state.shelfTier);
    const affordable = state.cash >= tier.cost;
    const label = active ? "使用中"
      : locked ? `需${STAGES[tier.stage - 1].name}`
      : downgrade ? "不可回退"
      : !affordable ? "现金不足"
      : `升级 · ${money(tier.cost)}`;
    const disabled = active || locked || downgrade || !affordable || state.phase !== "prep";
    return `
      <article class="shelf-card ${active ? "is-active" : ""}">
        <header><b>${tier.icon} ${tier.name}</b><span>${tier.capMult.toFixed(2)}× 容量</span></header>
        <p>${tier.desc}</p>
        <div class="shelf-meta">
          <span>购买意愿 ×${tier.sellMult.toFixed(2)}</span>
          <span>台面损耗 ×${tier.decayMult.toFixed(2)}</span>
        </div>
        <button type="button" data-shelf="${tier.id}" ${disabled ? "disabled" : ""}>${label}</button>
      </article>`;
  }).join("");
  return `
    <section class="decor-group shelf-group">
      <h3>🧺 货架分级 <small>当前：${current.name} · ${stageOf().name}</small></h3>
      <div class="shelf-list">${cards}</div>
      <p class="decor-note">货架只作用于台面：容量更大、顾客更愿买、生鲜在台面坏得更慢；后台仓库损耗不变。</p>
    </section>`;
}

function buyShelfTier(id) {
  const tier = SHELF_TIER_INDEX[id];
  if (!tier || state.shelfTier === id) return;
  if (state.phase !== "prep") {
    toast("营业中不能换货架");
    return;
  }
  const currentIndex = SHELF_TIERS.findIndex((t) => t.id === state.shelfTier);
  const targetIndex = SHELF_TIERS.findIndex((t) => t.id === id);
  if (targetIndex <= currentIndex) {
    toast("货架只能逐级升级，不能回退");
    return;
  }
  if (stageIndex() < tier.stage) {
    StallAudio.decline();
    toast(`需要先进入「${STAGES[tier.stage - 1].name}」阶段才能换${tier.name}`);
    return;
  }
  if (state.cash < tier.cost) {
    StallAudio.decline();
    toast(`换${tier.name}需要 ${money(tier.cost)}，现金不够`);
    return;
  }
  state.cash -= tier.cost;
  state.baseWealth -= tier.cost;
  state.shelfTier = id;
  StallAudio.cash();
  logLine(`货架升级为${tier.name}：投入 ${money(tier.cost)}`, "cost");
  toast(`${tier.name}已就位：${tier.desc}`);
  renderHud();
  renderBackstage();
  persistPrep();
}

function startRenovation(id) {
  const item = DECOR_INDEX[id];
  if (!item) return;
  if (state.phase !== "prep") {
    toast("营业中不能施工");
    return;
  }
  if (state.build) {
    toast("已有工程在进行");
    return;
  }
  if (state.decor[item.cat] === item.id) return;
  if (state.cash < item.price) {
    StallAudio.decline();
    toast("现金不够，先攒一攒");
    return;
  }

  if (item.price > 0) {
    state.cash -= item.price;
    state.baseWealth -= item.price;
    state.decorSpend += item.price;
  }
  StallAudio.tap();
  logLine(`装修 ${item.name}：工程款 ${money(item.price)}，工期 ${item.days} 天`, "cost");

  if (item.days <= 0) {
    applyDecor(item);
    logLine(`${item.name} 已完工`, "good");
    toast(`${item.name} 已换好`);
  } else {
    state.build = { id: item.id, daysLeft: item.days };
    state.buildAutoNextAt = Date.now() + BUILD_WAIT_MS;
    toast(`${item.name} 已开工，工期 ${item.days} 天`);
  }

  applyDecorTheme();
  renderHud();
  renderPhase();
  renderBackstage();
  persistPrep();
}

/* ---------- 施工停业：快速跳过 / 等待 5 分钟自动进入下一天 ---------- */
function syncBuildSkip() {
  const btn = els.skipBuildBtn;
  if (!btn) return;
  const active = state.booted && state.phase === "prep" && !!state.build;
  btn.hidden = !active;
  if (!active) {
    if (!state.build) state.buildAutoNextAt = null;
    return;
  }
  if (!state.buildAutoNextAt) state.buildAutoNextAt = Date.now() + BUILD_WAIT_MS;
  const remain = Math.max(0, state.buildAutoNextAt - Date.now());
  const m = Math.floor(remain / 60000);
  const sec = Math.floor((remain % 60000) / 1000);
  btn.textContent = `跳过施工日 · 自动 ${m}:${String(sec).padStart(2, "0")}`;
  const payroll = state.staff.reduce((sum, staff) => sum + staff.wage, 0);
  btn.title = `立即进入下一天：照付租金 ${money(state.dayRent)}、工资 ${money(payroll)}、装修维护 ${money(decorDaily())}，并计入停业损失`;
}

/* 跳过当前施工日：和正常营业日一样结算一天成本，只是没有营收 */
function skipBuildDay(auto = false) {
  if (!state.booted || state.bankrupt || state.quit) return;
  if (state.phase !== "prep" || !state.build) return;
  const name = DECOR_INDEX[state.build.id]?.name || "装修";
  startDay();
  const paid = `租金 ${money(state.dayRent)}、工资 ${money(state.dayStaffCost || 0)}、装修维护 ${money(state.dayDecorCost || 0)}`
    + (state.dayRiskCost ? `、意外赔付 ${money(state.dayRiskCost)}` : "");
  if (state.build) {
    toast(`${auto ? "等待结束，自动进入下一天" : "已跳过施工日"}：照付${paid}，${name}还剩 ${state.build.daysLeft} 天`);
  } else {
    toast(`施工完成：${name} 已完工，可以开门营业了（照付${paid}）`);
  }
  logLine(`施工停业 1 天：照付${paid}`, "cost");
  StallAudio.tap();
}

function tickBuildSkip() {
  if (!state.booted) return;
  syncBuildSkip();
  if (state.phase === "prep" && state.build && state.buildAutoNextAt && Date.now() >= state.buildAutoNextAt) {
    skipBuildDay(true);
  }
}

function openBackstage() {
  els.backstage.hidden = false;
  els.backstageMask.hidden = false;
  document.body.classList.add("backstage-open");
  renderBackstage();
}

function closeBackstage() {
  els.backstage.hidden = true;
  els.backstageMask.hidden = true;
  document.body.classList.remove("backstage-open");
}

function applyRestock(goods, wanted) {
  /* 未解锁的菜品不参与进货，自动补货也会跳过 */
  const unlock = goodsUnlockState(goods);
  if (!unlock.unlocked) return { qty: 0, cost: 0, room: 0, left: 0, unit: unitCost(goods), supplier: supplierOf().name, locked: true };
  const supplier = supplierOf();
  const unit = unitCost(goods);
  const left = supplyLeftOf(goods.id);
  /* 进货只占后台仓容：台面库存不计入，在途货物已占用则先扣掉 */
  const room = Math.max(0, backCapOf(goods) - backStockOf(goods.id) - shipmentQtyOf(goods.id));
  const affordable = Math.floor(state.cash / Math.max(1, unit));
  const cap = Math.min(left, room, affordable);
  let qty = wanted === "fill" ? cap : Math.min(Number(wanted) || 0, cap);
  /* 暴雨天货源不稳：有概率少发一部分，模拟物流受阻 */
  let shorted = 0;
  if (qty > 0 && state.weather?.name === "暴雨" && Math.random() < 0.15) {
    shorted = Math.max(1, Math.round(qty * 0.2));
    qty -= shorted;
  }
  if (qty <= 0) return { qty: 0, cost: 0, room, left, unit, supplier: supplier.name, shorted };

  /* 批量折扣：≥20 件 95 折，≥40 件 9 折 */
  let disc = 1;
  if (qty >= 40) disc = 0.9;
  else if (qty >= 20) disc = 0.95;
  /* 先取整单件成本，再乘数量，保证现金减少额与库存账面价值完全一致 */
  const lotCost = Math.round(unit * disc);
  const finalCost = qty * lotCost;
  state.cash -= finalCost;
  /* 进货台账：现金支出必须与入库货值完全相等 */
  state.dayPurchaseCost = (state.dayPurchaseCost || 0) + finalCost;
  state.dayPurchaseValue = (state.dayPurchaseValue || 0) + qty * lotCost;
  state.supplyUsed[goods.id] = (state.supplyUsed[goods.id] || 0) + qty;
  /* 渠道决定这批货的损耗速度：散户批次品质有波动，冷链稳定 */
  const jitter = supplier.id === "street" ? 0.85 + Math.random() * 0.6 : 1;
  const decayMult = clamp(supplier.decay * jitter, 0.35, 2);
  const quality = supplier.id === "street"
    ? Math.max(1, Math.round(supplier.quality * (0.5 + Math.random())))
    : supplier.quality;
  let delayed = false;
  let eta = 0;
  if (qty >= BULK_SHIPPING_QTY) {
    /* 大额进货走物流：先扣款，10–30 秒后到后台 */
    delayed = true;
    eta = shippingDelayMs(qty);
    state.shipments.push({
      gid: goods.id, qty, cost: lotCost, dayIn: state.day,
      decayMult, quality, supplier: supplier.name, arriveAt: Date.now() + eta,
    });
  } else {
    addLot("backroom", goods.id, { qty, cost: lotCost, dayIn: state.day, shelf: goods.shelf, decayMult });
    /* 新货入库，卖相回升；冷链品质更好 */
    state.condition[goods.id] = Math.round(clamp(appealOf(goods.id) + quality, 25, 100));
  }
  return { qty, cost: finalCost, room, left, unit, disc, supplier: supplier.name, delayed, eta, shorted };
}

/* 物流到货：把在途批次搬进后台；仓库满时货车在门口等，不会凭空消失 */
function deliverShipments(silent = false) {
  if (!state.shipments?.length) return { units: 0, kinds: 0 };
  const now = Date.now();
  let units = 0;
  let kinds = 0;
  const waiting = [];
  for (const ship of state.shipments) {
    if ((ship.arriveAt || 0) > now) {
      waiting.push(ship);
      continue;
    }
    const goods = GOOD_INDEX[ship.gid];
    if (!goods) continue;
    const room = Math.max(0, backCapOf(goods) - backStockOf(ship.gid));
    if (room <= 0) {
      waiting.push({ ...ship, arriveAt: now + 5000 });
      continue;
    }
    const qty = Math.min(ship.qty, room);
    addLot("backroom", ship.gid, {
      qty, cost: ship.cost, dayIn: ship.dayIn ?? state.day, shelf: goods.shelf, decayMult: ship.decayMult || 1,
    });
    state.condition[ship.gid] = Math.round(clamp(appealOf(ship.gid) + (ship.quality || 0), 25, 100));
    units += qty;
    kinds += 1;
    if (qty < ship.qty) waiting.push({ ...ship, qty: ship.qty - qty, arriveAt: now + 5000 });
    logLine(`物流到货 ${goods.name} ×${qty}${goods.unit}（${ship.supplier}）`, "good");
  }
  state.shipments = waiting;
  if (!units) return { units, kinds };
  if (silent) {
    logLine(`夜间到货：${kinds} 种 / ${units} 件已入后台`, "good");
    return { units, kinds };
  }
  toast(`物流到货：${kinds} 种 / ${units} 件已入后台，记得上架`);
  renderHud();
  renderShelf();
  renderBackstage();
  return { units, kinds };
}

/* 营业中每秒检查在途物流 */
function tickShipments() {
  if (!state.booted || !state.shipments?.length) return;
  const before = state.shipments.length;
  const beforeQty = state.shipments.reduce((sum, ship) => sum + ship.qty, 0);
  deliverShipments(false);
  const afterQty = state.shipments.reduce((sum, ship) => sum + ship.qty, 0);
  if (state.shipments.length !== before || afterQty !== beforeQty) {
    if (state.phase === "open") saveGame();
    else persistPrep();
  }
}

function restock(goods, wanted) {
  if (state.phase !== "prep") {
    toast("营业中不能进货");
    return;
  }
  const result = applyRestock(goods, wanted);
  if (result.qty <= 0) {
    StallAudio.decline();
    if (result.locked) {
      toast(`${goods.name}尚未解锁：${goodsUnlockText(goods)}`);
      return;
    }
    toast(result.shorted ? "暴雨货源不足，这次没拿到货" : result.room <= 0 ? "后台仓储放不下了" : result.left <= 0 ? "今天的到货量用完了" : "现金不够");
    return;
  }
  StallAudio.tap();
  const discNote = result.disc < 1 ? `，批量${Math.round(result.disc * 100)}折省 ${money(result.qty * result.unit - result.cost)}` : "";
  const shortNote = result.shorted ? `，暴雨少发 ${result.shorted}${goods.unit}` : "";
  const delayNote = result.delayed ? `，走物流约 ${Math.round(result.eta / 1000)} 秒后到后台` : "";
  logLine(`进货 ${goods.name} ×${result.qty}${goods.unit}（${result.supplier}），进价 ${money(result.cost)}${discNote}${delayNote}${shortNote}`, "cost");
  toast(`进货 ${goods.name} ×${result.qty}（${result.supplier}）${result.delayed ? "，在途运输中" : "，记得上架"}${shortNote}`);
  renderHud();
  renderShelf();
  renderBackstage();
  persistPrep();
}

/* 后台 → 台面：补货上架 */
function stockShelf(goods, wanted = "fill") {
  if (state.phase === "settle") {
    toast("已经打烊，明天再上架");
    return;
  }
  const result = moveToShelf(goods.id, wanted);
  if (!result.moved) {
    StallAudio.decline();
    toast(result.room <= 0 ? "台面已经摆满了" : "后台没有可上架的货");
    return;
  }
  StallAudio.tap();
  const leftBack = backStockOf(goods.id);
  const capNote = result.moved >= result.room && leftBack > 0
    ? `，台面最多 ${capOf(goods)}${goods.unit}，余 ${leftBack}${goods.unit}留在后台`
    : "";
  logLine(`上架 ${goods.name} ×${result.moved}${goods.unit}，台面 ${shelfStockOf(goods.id)}/${capOf(goods)}`, "good");
  toast(`上架 ${goods.name} ×${result.moved}${goods.unit}${capNote}`);
  renderHud();
  renderShelf();
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

/* 台面 → 后台：打烊前或临时收仓，降低台面暴露损耗 */
function unshelf(goods, wanted = "fill") {
  if (state.phase === "settle") {
    toast("已经打烊，明天再下架");
    return;
  }
  const result = moveToBackroom(goods.id, wanted);
  if (!result.moved) {
    StallAudio.decline();
    toast(result.room <= 0 ? "后台已经放满了" : "台面没有可下架的货");
    return;
  }
  StallAudio.tap();
  const leftShelf = shelfStockOf(goods.id);
  const capNote = result.moved >= result.room && leftShelf > 0
    ? `，后台最多 ${backCapOf(goods)}${goods.unit}，余 ${leftShelf}${goods.unit}留在台面`
    : "";
  logLine(`下架 ${goods.name} ×${result.moved}${goods.unit}，后台 ${backStockOf(goods.id)}/${backCapOf(goods)}`, "good");
  toast(`下架 ${goods.name} ×${result.moved}${goods.unit}${capNote}`);
  renderHud();
  renderShelf();
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

/* 当前筛选下的商品一键补满台面 */
function stockCategory() {
  if (state.phase === "settle") {
    toast("已经打烊，明天再上架");
    return;
  }
  const list = backTabGoods();
  /* 批量上架：当前标签页内所有商品都补到台面容量上限 */
  let units = 0;
  let count = 0;
  for (const goods of list) {
    const result = moveToShelf(goods.id, "fill");
    if (result.moved > 0) {
      units += result.moved;
      count += 1;
    }
  }
  if (!count) {
    StallAudio.decline();
    toast("后台没有可上架的货");
    return;
  }
  StallAudio.tap();
  const label = state.backCat === "all" ? "全部" : state.backCat;
  logLine(`台面补货 ${label}：${count} 种 / ${units} 件`, "good");
  toast(`已上架 ${count} 种 / ${units} 件`);
  renderHud();
  renderShelf();
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
}

function fillCategory() {
  if (state.phase !== "prep") {
    toast("营业中不能进货");
    return;
  }
  /* 当前标签页内所有商品都补到后台仓容上限：受今日额度、现金与在途占用限制 */
  const targets = backTabGoods()
    .filter((goods) => goodsUnlocked(goods))
    .sort((a, b) => b.pop - a.pop);
  let total = 0;
  let count = 0;
  let delayed = 0;
  let fullOrQuota = 0;
  let lockedSkip = backTabGoods().length - targets.length;
  let poor = 0;
  for (const goods of targets) {
    const result = applyRestock(goods, "fill");
    if (result.qty > 0) {
      total += result.cost;
      count += 1;
      if (result.delayed) delayed += 1;
    } else if (result.room <= 0 || result.left <= 0 || result.shorted) {
      fullOrQuota += 1;
    } else {
      poor += 1;
    }
  }
  const label = state.backCat === "all" ? "全部" : state.backCat;
  if (!count) {
    StallAudio.decline();
    const reason = poor ? "现金不够，先卖货回笼资金"
      : fullOrQuota ? "后台已经补满或今日额度用完"
      : "当前标签没有可补货的商品";
    toast(`${label}：${reason}`);
    return;
  }
  StallAudio.tap();
  const notes = [];
  if (delayed) notes.push(`${delayed} 种大单在途`);
  if (lockedSkip) notes.push(`${lockedSkip} 种未解锁`);
  if (fullOrQuota) notes.push(`${fullOrQuota} 种已满或无额度`);
  if (poor) notes.push(`${poor} 种现金不足`);
  const noteText = notes.length ? `（${notes.join("，")}）` : "";
  logLine(`整类补货 ${label}：${count} 种到后台，支出 ${money(total)}${noteText}`, "cost");
  toast(`已补 ${count} 种，支出 ${money(total)}${noteText}，记得上架`);
  renderHud();
  renderShelf();
  renderBackstage();
  persistPrep();
}

function changePrice(goods, deltaCents) {
  if (state.phase !== "prep") return;
  const { lower, upper } = priceBounds(goods);
  const next = clamp(state.prices[goods.id] + deltaCents, lower, upper);
  if (next === state.prices[goods.id]) return;
  state.prices[goods.id] = next;
  StallAudio.tap();
  renderShelf();
  renderBackstage();
  renderHud();
  persistPrep();
}

function handleLedgerClick(event) {
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const goods = GOOD_INDEX[button.dataset.gid];
  if (!goods) return;
  if (button.dataset.act === "price") {
    changePrice(goods, Number(button.dataset.delta));
  } else if (button.dataset.act === "restock") {
    restock(goods, button.dataset.qty);
  } else if (button.dataset.act === "shelf") {
    stockShelf(goods, button.dataset.qty);
  } else if (button.dataset.act === "unshelf") {
    unshelf(goods, button.dataset.qty);
  }
}

function handleLedgerChange(event) {
  const input = event.target.closest("input[data-price-input]");
  if (!input || state.phase !== "prep") return;
  const goods = GOOD_INDEX[input.dataset.gid];
  if (!goods) return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    renderBackstage();
    return;
  }
  const { lower, upper } = priceBounds(goods);
  state.prices[goods.id] = clamp(Math.round(value * 100), lower, upper);
  StallAudio.tap();
  renderShelf();
  renderBackstage();
  renderHud();
  persistPrep();
}

/* ---------------- 地图选址 ---------------- */
function moveFee(loc) {
  const size = SHOP_SIZES.find((s) => s.id === state.pendingSize) || SHOP_SIZES[1];
  return Math.round(loc.rent * size.rentMult) + MOVE_BASE_FEE;
}

function openMap(mode) {
  if (mode === "relocate" && state.phase !== "prep") {
    toast("营业中不能换店面，打烊后再看");
    return;
  }
  state.mapMode = mode;
  state.pendingLoc = state.location || LOCATIONS[2];
  state.pendingName = state.shopName || "";
  /* 开局时默认选中当前阶段可用的最小铺面，避免默认的小门面被门禁锁住 */
  const starterSize = SHOP_SIZES.find((s) => canUseSize(s.id));
  state.pendingSize = mode === "start"
    ? (starterSize ? starterSize.id : "stall")
    : (canUseSize(state.size) ? state.size : starterSize?.id || "stall");
  els.mapOverlay.hidden = false;
  els.mapClose.hidden = mode !== "relocate";
  renderMap();
}

function closeMap() {
  if (state.mapMode === "start") return;
  els.mapOverlay.hidden = true;
}

function selectLocation(id) {
  const loc = LOCATION_INDEX[id];
  if (!loc) return;
  state.pendingLoc = loc;
  StallAudio.tap();
  renderMap();
}

function renderMap() {
  const selected = state.pendingLoc || state.location || LOCATIONS[2];
  /* 规范铺面选择：旧存档或阶段变化后，pendingSize 可能指向已锁定规格 */
  const legalSize = SHOP_SIZES.find((s) => s.id === state.pendingSize && canUseSize(s.id))
    || SHOP_SIZES.find((s) => canUseSize(s.id))
    || SHOP_SIZES[0];
  state.pendingSize = legalSize.id;
  /* 商店类型条（开局时选择；搬迁时锁定显示当前类型） */
  if (!state.shopType) state.shopType = "fruit";
  const mapType = SHOP_TYPES.find((t) => t.id === state.shopType) || SHOP_TYPES[0];
  const typeLocked = state.mapMode !== "start";
  const stage = stageOf();
  els.shopTypeBar.innerHTML = SHOP_TYPES.map((type) => {
    const lockedByStage = state.mapMode === "start" && !canUseShopType(type.id);
    const needStage = STAGES.find((s) => s.shopTypes.includes(type.id));
    return `
    <button type="button" data-shtype="${type.id}" class="${state.shopType === type.id ? "on" : ""} ${lockedByStage ? "is-locked" : ""}"
      ${typeLocked || lockedByStage ? "disabled" : ""}
      title="${lockedByStage ? `需进入「${needStage ? needStage.name : "更高阶段"}」` : type.tagline}">
      <i>${type.icon}</i><b>${type.name}</b><small>${lockedByStage ? `🔒 ${needStage ? needStage.name : "未解锁"}` : type.tagline}</small>
    </button>`;
  }).join("");

  const pendingRentMult = (SHOP_SIZES.find((s) => s.id === state.pendingSize) || SHOP_SIZES[1]).rentMult;
  els.mapMarkers.innerHTML = LOCATIONS.map((loc) => `
    <button type="button" class="map-marker ${loc.id === selected.id ? "on" : ""}"
      data-loc="${loc.id}" style="left:${(loc.x / 10).toFixed(1)}%;top:${(loc.y / 6.4).toFixed(1)}%"
      aria-label="${loc.name}">
      <span class="marker-pin"><i>${loc.icon}</i></span>
      <span class="marker-label"><b>${loc.name}</b><small>${rentLabel(Math.round(loc.rent * pendingRentMult))}</small></span>
    </button>`).join("");

  const trafficPct = clamp((selected.traffic / 1.8) * 100, 8, 100);
  const wealthPct = clamp(((selected.wealthMult - 0.5) / 1.25) * 100, 8, 100);
  const competitionPct = clamp(((selected.competition - 0.7) / 0.65) * 100, 8, 100);
  const base = BASE_TRAFFIC * locationTrafficFactor(selected) * (0.45 + (state.reputation / 5) * 0.85)
    * (state.weekend ? (selected.weekendTraffic ?? 1.2) : 1);
  const low = Math.max(2, Math.round(base * 0.85));
  const high = Math.max(low + 1, Math.round(base * 1.15));
  const isCurrent = state.location?.id === selected.id;
  const pendSize = SHOP_SIZES.find((s) => s.id === state.pendingSize) || SHOP_SIZES[1];
  const newRent = Math.round(selected.rent * pendSize.rentMult);
  const oldRent = Math.round((state.location?.rent || 0) * sizeOf().rentMult);
  const sizeDiff = Math.max(0, newRent - oldRent);
  const fee = moveFee(selected) + sizeDiff * 2;

  els.mapDetail.innerHTML = `
    <div class="detail-head">
      <span class="detail-icon">${selected.icon}</span>
      <div>
        <p class="eyebrow">${selected.tagline}</p>
        <h3>${selected.name}</h3>
      </div>
      ${isCurrent ? `<span class="detail-current">当前店面</span>` : ""}
    </div>
    <div class="detail-rent">
      <span>日租</span>
      <b>${newRent > 0 ? money(newRent) : "免租"}</b>
      <small>${newRent > 0 ? `按 30 天约 ${money(newRent * 30)}` : `当前铺面「${pendSize.name}」不收租金`}</small>
    </div>
    ${state.mapMode === "start" ? `
    <div class="detail-cash">
      <span>启动资金</span>
      <b>${money(mapType.startCash)}</b>
      <small>全部为现金，不含默认库存；确认开店时即时扣除首日租金</small>
    </div>` : ""}
    <div class="detail-meters">
      <div class="meter"><span>人流</span><i><b style="width:${trafficPct}%"></b></i><em>${selected.traffic.toFixed(2)}×</em></div>
      <div class="meter"><span>消费力</span><i><b style="width:${wealthPct}%"></b></i><em>${selected.wealthMult.toFixed(2)}×</em></div>
      <div class="meter"><span>竞争</span><i><b style="width:${competitionPct}%"></b></i><em>${selected.competition.toFixed(2)}×</em></div>
    </div>
    <p class="detail-desc">${selected.desc}</p>
    <div class="detail-tags">${selected.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    ${state.mapMode === "start" ? `
    <label class="detail-name">
      <span>店铺名称</span>
      <input id="mapShopName" type="text" maxlength="12" autocomplete="off"
        value="${escapeHtml(state.pendingName || "")}" placeholder="${escapeHtml(mapType.sign)}">
      <small>2–12 个字，留空则使用「${escapeHtml(mapType.sign)}」</small>
    </label>` : ""}
    <div class="detail-forecast">
      <span>预计客流</span>
      <b>${low}–${high} 位/天</b>
      <small>按当前口碑 ${state.reputation.toFixed(1)} 估算${state.weekend ? ` · 周末 ×${(selected.weekendTraffic ?? 1.2).toFixed(2)}` : ""}</small>
    </div>`;

  /* 铺面规格放在底部常驻栏，避免小屏需要滚动才能看到 */
  els.mapSizes.innerHTML = SHOP_SIZES.map((size) => {
    const rent = Math.round(selected.rent * size.rentMult);
    const lockedByStage = !canUseSize(size.id);
    const needStage = STAGES.find((s) => s.sizes.includes(size.id));
    return `
      <button type="button" data-size="${size.id}" class="${state.pendingSize === size.id ? "on" : ""} ${lockedByStage ? "is-locked" : ""}"
        ${lockedByStage ? "disabled" : ""}
        title="${lockedByStage ? `需进入「${needStage ? needStage.name : "更高阶段"}」` : size.desc}">
        <i>${size.icon}</i>
        <span><b>${size.name}</b><small>${lockedByStage ? `🔒 ${needStage ? needStage.name : "未解锁"}` : `${rentLabel(rent)} · 员工 ≤${size.staffCap}`}</small></span>
      </button>`;
  }).join("");

  if (state.mapMode === "start") {
    const startRent = Math.round(selected.rent * pendSize.rentMult);
    els.mapFootNote.textContent = `确认开店时立即扣除首日租金 ${startRent > 0 ? money(startRent) : "（免租）"}；铺摊免租，水电与员工工资按日结算。菜品分基础/进阶/精品，按经营天数与累计净利逐步解锁。`;
    els.mapConfirm.textContent = startRent > 0 ? `在这里开店 · ${money(startRent)}` : "在这里开店 · 免租";
  } else if (isCurrent) {
    const size = SHOP_SIZES.find((s) => s.id === state.pendingSize) || sizeOf();
    if (size.id === state.size) {
      els.mapFootNote.textContent = "这是当前店面。换位置需要搬迁费，换铺面只补 3 天租金差额。";
      els.mapConfirm.textContent = "留在当前店面";
    } else {
      const diff = sizeDiff * 3;
      els.mapFootNote.textContent = `同址换成「${pendSize.name}」需补 3 天租金差额 ${money(diff)}。`;
      els.mapConfirm.textContent = `调整为${pendSize.name} · ${money(diff)}`;
    }
  } else {
    els.mapFootNote.textContent = `搬迁费 ${money(fee)}（新店 1 天租金 + ${money(MOVE_BASE_FEE)} + 铺面差额），从现金中扣除。`;
    els.mapConfirm.textContent = `搬迁到这里 · ${money(fee)}`;
  }
}

function confirmLocation() {
  const loc = state.pendingLoc;
  if (!loc) return;
  if (state.mapMode === "start") {
    const type = SHOP_TYPES.find((t) => t.id === state.shopType) || SHOP_TYPES[0];
    const size = SHOP_SIZES.find((s) => s.id === state.pendingSize) || SHOP_SIZES[0];
    if (!canUseShopType(type.id)) {
      StallAudio.decline();
      toast(`${type.name}还没解锁，先从小摊做起`);
      return;
    }
    if (!canUseSize(size.id)) {
      StallAudio.decline();
      toast(`「${size.name}」还没解锁，当前只能选${stageOf().name}可用的铺面`);
      return;
    }
    const shopName = String(state.pendingName || "").trim().slice(0, 12);
    if (shopName && shopName.length < 2) {
      StallAudio.decline();
      toast("店名至少 2 个字，或留空使用默认招牌");
      return;
    }
    /* 新开局：清空历史与经营状态，确保从第 1 天、空历史重新开始 */
    resetRunForNewShop();
    state.shopName = shopName || type.sign;
    state.pendingName = state.shopName;
    setCatalog(type.id);
    state.size = size.id;
    state.location = loc;
    state.booted = true;
    /* 按类型重置启动资金，并即时扣除首日租金 */
    state.cash = type.startCash;
    state.baseWealth = type.startCash;
    const openingRent = Math.round(loc.rent * size.rentMult);
    state.cash -= openingRent;
    state.dayRent = openingRent;
    state.rentPaidDay = 1;
    els.mapOverlay.hidden = true;
    seedInitialStock();
    saveGame();
    StallAudio.openShop();
    startDay();
    toast(openingRent > 0
      ? `${loc.name} · ${state.shopName} · ${size.name} 开业！首日租金 ${money(openingRent)}`
      : `${loc.name} · ${state.shopName} · ${size.name} 开业！`);
    return;
  }

  if (state.phase !== "prep") {
    toast("营业中不能换店面");
    return;
  }
  const size = SHOP_SIZES.find((s) => s.id === state.pendingSize) || sizeOf();
  /* 旧存档可能在低阶段就拥有大门店，搬迁时允许保留当前铺面规格 */
  if (!canUseSize(size.id) && size.id !== state.size) {
    StallAudio.decline();
    toast(`「${size.name}」还没解锁，先经营到更高阶段`);
    return;
  }
  const oldRent = Math.round((state.location?.rent || 0) * sizeOf().rentMult);
  const newRent = Math.round(loc.rent * size.rentMult);
  const sameLoc = state.location?.id === loc.id;

  /* 同址换铺面：只补 3 天租金差额，不收取搬迁费 */
  if (sameLoc) {
    if (size.id === state.size) {
      closeMap();
      return;
    }
    const diff = Math.max(0, newRent - oldRent) * 3;
    if (state.cash < diff) {
      StallAudio.decline();
      toast(`升级铺面需要补 ${money(diff)} 租金差额`);
      return;
    }
    state.cash -= diff;
    state.baseWealth -= diff;
    const oldSizeName = sizeOf().name;
    state.size = size.id;
    state.dayRent = newRent;
    closeMap();
    StallAudio.cash();
    logLine(`铺面从${oldSizeName}调整为${size.name}，补租金差额 ${money(diff)}`, "cost");
    renderAll();
    toast(`铺面已调整为${size.name}，明天起日租 ${money(newRent)}`);
    saveGame();
    return;
  }

  const fee = moveFee(loc) + Math.max(0, newRent - oldRent) * 2;
  if (state.cash < fee) {
    StallAudio.decline();
    toast(`现金不够，搬迁需要 ${money(fee)}`);
    return;
  }
  state.cash -= fee;
  state.baseWealth -= fee;
  const oldName = state.location?.name || "原店面";
  const oldSizeName = sizeOf().name;
  state.location = loc;
  state.size = size.id;
  state.dayRent = newRent;
  closeMap();
  StallAudio.cash();
  logLine(`从${oldName}（${oldSizeName}）搬到${loc.name}（${size.name}），搬迁费 ${money(fee)}`, "cost");
  renderAll();
  saveGame();
  toast(`已搬到${loc.name}`);
}

/* ---------------- 主动退出经营 ---------------- */
function dailyRentDue() {
  return state.location ? Math.round(state.location.rent * sizeOf().rentMult) : 0;
}

function exitQuote() {
  const dailyRent = dailyRentDue();
  const penalty = dailyRent * EXIT_PENALTY_DAYS;
  const inventory = bookValue();
  const liquidation = Math.round(inventory * EXIT_LIQUIDATION_RATE);
  const branchValue = branchAssetValue();
  const branchLiquidation = Math.round(branchValue * EXIT_BRANCH_RATE);
  const available = state.cash + liquidation + branchLiquidation;
  return {
    dailyRent,
    penalty,
    inventory,
    liquidation,
    branchValue,
    branchLiquidation,
    available,
    cashAfter: Math.max(0, available - penalty),
    shortfall: Math.max(0, penalty - available),
  };
}

function openExitModal() {
  if (!state.booted || state.bankrupt || state.quit) return;
  const quote = exitQuote();
  els.quitQuote.innerHTML = [
    ["日租", quote.dailyRent > 0 ? money(quote.dailyRent) : "免租"],
    [`违约金（${EXIT_PENALTY_DAYS} 天租金）`, quote.penalty > 0 ? `−${money(quote.penalty)}` : "¥0.00"],
    [`库存清算（${Math.round(EXIT_LIQUIDATION_RATE * 100)}% 成本）`, `+${money(quote.liquidation)}`],
    ...(quote.branchValue > 0 ? [[`分店清算（${Math.round(EXIT_BRANCH_RATE * 100)}% 估值）`, `+${money(quote.branchLiquidation)}`]] : []),
    ["退出后现金", money(quote.cashAfter)],
  ].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("");
  els.quitWarning.textContent = quote.shortfall > 0
    ? `现有资产不足以覆盖违约金，差额 ${money(quote.shortfall)} 不再追偿。`
    : `结清违约金后可带走 ${money(quote.cashAfter)} 现金。`;
  els.quitWarning.className = `quit-warning${quote.shortfall > 0 ? " warn" : ""}`;
  els.quitOverlay.hidden = false;
}

function confirmExit() {
  if (!state.booted || state.bankrupt || state.quit) return;
  const quote = exitQuote();
  state.cash = quote.cashAfter;
  for (const goods of GOODS) {
    state.inventory[goods.id] = [];
    state.backroom[goods.id] = [];
  }
  state.quit = true;
  state.quitReason = quote.shortfall > 0 ? "资不抵债，提前退租" : "店主主动提前退租";
  state.quitDay = state.day;
  state.quitPenalty = quote.penalty;
  state.quitLiquidation = quote.liquidation;
  state.quitBranchLiquidation = quote.branchLiquidation;
  state.quitShortfall = quote.shortfall;
  state.branches = [];
  state.activeBranchId = null;
  state.phase = "quit";
  state.serving = false;
  state.servicePaused = false;
  state.servingCustomer = false;
  state.queue = [];
  state.currentIndex = -1;
  state.settlement = null;
  els.quitOverlay.hidden = true;
  document.body.classList.remove("serving", "backstage-open");
  els.backstage.hidden = true;
  els.backstageMask.hidden = true;
  els.mapOverlay.hidden = true;
  els.goodsModal.hidden = true;
  els.employeeModal.hidden = true;
  els.rulebookModal.hidden = true;
  els.overlay.hidden = true;
  hideCustomer();
  saveGame();
  recordUserProgress();
  renderPhase();
  renderHud();
  renderQuit();
  StallAudio.setAmbience(false);
  StallAudio.cash();
}

function renderQuit() {
  if (!state.quit) return;
  const stats = [
    ["经营天数", `${state.quitDay || state.day} 天`],
    ["提前退租违约金", money(state.quitPenalty || 0)],
    ["库存清算收入", money(state.quitLiquidation || 0)],
    ...(state.quitBranchLiquidation ? [["分店清算收入", money(state.quitBranchLiquidation)]] : []),
    ["退出后现金", money(state.cash)],
    ["退出后资产", money(state.cash)],
    ["口碑", state.reputation.toFixed(2)],
  ];
  if (state.quitShortfall > 0) {
    stats.push(["未覆盖缺口", money(state.quitShortfall)]);
  }
  els.quitReason.textContent = state.quitShortfall > 0
    ? `${state.quitReason}，违约金差额不再追偿。`
    : `${state.quitReason}，租金违约金与库存已结清。`;
  els.quitStats.innerHTML = stats
    .map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`)
    .join("");
  els.quitOverlay.hidden = true;
  els.quitResultOverlay.hidden = false;
  els.toast.hidden = true;
}

/* ---------------- 破产清算 ---------------- */
function triggerBankruptcy(reason) {
  if (state.bankrupt) return;
  state.bankrupt = true;
  state.bankruptReason = reason;
  state.bankruptDay = state.day;
  state.phase = "bankrupt";
  state.serving = false;
  state.servicePaused = false;
  state.servingCustomer = false;
  state.queue = [];
  state.currentIndex = -1;
  state.settlement = null;
  document.body.classList.remove("serving", "backstage-open");
  els.backstage.hidden = true;
  els.backstageMask.hidden = true;
  els.mapOverlay.hidden = true;
  els.goodsModal.hidden = true;
  els.employeeModal.hidden = true;
  els.rulebookModal.hidden = true;
  els.overlay.hidden = true;
  hideCustomer();
  saveGame();
  recordUserProgress();
  renderPhase();
  renderHud();
  renderBankruptcy();
  StallAudio.setAmbience(false);
  StallAudio.decline();
}

function renderBankruptcy() {
  if (!state.bankrupt) return;
  const days = state.bankruptDay || state.day;
  const stats = [
    ["坚持到", `第 ${days} 天`],
    ["完成营业", `${state.history.length} 天`],
    ["最终现金", money(state.cash)],
    ["库存价值", money(bookValue())],
    ...(state.branches.length ? [["分店估值", money(branchAssetValue())]] : []),
    ["总资产", money(totalAssetValue())],
    ["连续欠费", `${Math.min(state.overdueDays, BANKRUPT_GRACE_DAYS)}/${BANKRUPT_GRACE_DAYS} 天`],
    ["口碑", state.reputation.toFixed(2)],
    ["最后缺口", money(state.lastShortfall || 0)],
  ];
  els.bankruptReason.textContent = state.bankruptReason || "资金链断裂，无法继续经营。";
  els.bankruptStats.innerHTML = stats
    .map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`)
    .join("");
  els.bankruptOverlay.hidden = false;
  els.toast.hidden = true;
}

/* ---------------- 结算与自检 ---------------- */
function settleDay() {
  const revenue = state.dayRevenue;
  const cogs = state.dayCogs;
  const spoil = state.daySpoilage;
  const rent = state.dayRent;
  const utility = state.dayUtility || 0;
  const decorCost = state.dayDecorCost || 0;
  const promoCost = state.dayPromoCost || 0;
  const giftCost = state.dayGiftCost || 0;
  const staffCost = state.dayStaffCost || 0;
  const riskCost = state.dayRiskCost || 0;
  const branchProfit = state.dayBranchProfit || 0;
  const profit = revenue - cogs - spoil - rent - utility - decorCost - promoCost - staffCost - riskCost + branchProfit;

  if (state.ratings.length) {
    const average = state.ratings.reduce((a, b) => a + b, 0) / state.ratings.length;
    state.reputation = clamp(0.85 * state.reputation + 0.15 * average, 1, 5);
  }
  /* 服务质量滚动到次日：今天缺货、拒绝、转化与评价都会影响明天的到店人数 */
  updateServiceScore();

  const result = selfCheck(revenue, cogs);
  state.lastCheck = result;
  state.phase = "settle";
  state.serving = false;
  state.servicePaused = false;
  state.servingCustomer = false;

  state.settlement = {
    day: state.day, revenue, cogs, spoil, spoilRate: state.daySpoilRate, salvage: state.daySalvage, rent, utility, decorCost, promoCost, giftCost,
    spoilDiag: state.daySpoilDiag,
    staffCost, branchProfit, profit, riskCost, stockouts: state.stockoutsToday,
    sales: state.salesCount, units: state.dayUnits,
    visitors: state.dayVisitors, buyers: state.dayBuyers,
    bargainTries: state.dayBargainTries, bargainWins: state.dayBargainWins,
    declines: state.dayDeclines, maxTicket: state.dayMaxTicket,
    roundOff: state.dayRoundOff || 0,
    basketFactor: state.dayBasketFactor || 1,
    adapt: state.trafficAdapt || 1,
    decorWear: state.decorWear || 0,
    slots: { ...state.daySlots }, goodsUnits: { ...state.dayGoodsUnits }, goodsRevenue: { ...state.dayGoodsRevenue },
    traffic: state.trafficBreakdown ? { ...state.trafficBreakdown } : null,
  };
  /* 当天早些时候已解锁的阶段，在结算页补一次展示 */
  if (state.stageUp) state.settlement.stageUp = state.stageUp;
  state.history.push({
    day: state.day,
    revenue,
    profit,
    sales: state.salesCount,
    units: state.dayUnits,
    visitors: state.dayVisitors,
    buyers: state.dayBuyers,
    rep: +state.reputation.toFixed(2),
  });

  /* 滚动需求：用于下一次补货的目标量，避免按货架容量盲目囤货 */
  for (const goods of GOODS) {
    const today = state.dayGoodsUnits[goods.id] || 0;
    const prev = state.goodsDemand[goods.id] || 0;
    state.goodsDemand[goods.id] = +(prev * 0.55 + today * 0.45).toFixed(2);
  }

  /* 日结后资产与历史已更新，补一次阶段判定 */
  stageIndex();

  checkAchievements();
  recordUserProgress();
  renderSettlement();
  saveGame();
}

function renderSettlement() {
  const s = state.settlement;
  if (!s) return;
  /* 旧存档结算数据补齐，避免新指标显示 undefined */
  if (s.visitors == null) s.visitors = s.sales || 0;
  if (s.buyers == null) s.buyers = s.sales || 0;
  if (s.bargainTries == null) s.bargainTries = 0;
  if (s.bargainWins == null) s.bargainWins = 0;
  if (s.maxTicket == null) s.maxTicket = 0;
  if (!s.slots) s.slots = {};
  if (!s.goodsUnits) s.goodsUnits = {};
  if (!s.goodsRevenue) s.goodsRevenue = {};
  if (!s.spoilDiag && state.daySpoilDiag && s.day === state.day) s.spoilDiag = state.daySpoilDiag;
  const avgTicket = s.sales ? Math.round(s.revenue / s.sales) : 0;
  const attach = s.sales ? (s.units / s.sales).toFixed(2) : "0.00";
  const conversion = s.visitors ? Math.round((s.buyers / s.visitors) * 100) : 0;
  const bargainRate = s.bargainTries ? Math.round((s.bargainWins / s.bargainTries) * 100) : 0;
  const tb = s.traffic || state.trafficBreakdown;
  const trafficFactors = tb ? [
    `天气 ×${tb.weather.toFixed(2)}`,
    `事件 ×${tb.event.toFixed(2)}`,
    tb.weekend !== 1 ? `周末 ×${tb.weekend.toFixed(2)}` : "",
    `店址 ×${tb.location.toFixed(2)}`,
    `装修 ${tb.decor >= 1 ? "+" : ""}${Math.round((tb.decor - 1) * 100)}%`,
    `口碑 ×${tb.reputation.toFixed(2)}`,
    tb.adapt ? `客流自适应 ×${tb.adapt.toFixed(2)}` : "",
    tb.appeal ? `经营 ×${tb.appeal.toFixed(2)}` : "",
    tb.promo > 1 ? `促销 +${Math.round((tb.promo - 1) * 100)}%` : "",
    tb.staff > 1 ? `员工 +${Math.round((tb.staff - 1) * 100)}%` : "",
    `随机 ×${tb.jitter.toFixed(2)}`,
  ].filter(Boolean).join(" · ") : "";
  const slotRows = TIME_SLOTS.map((slot) => {
    const data = s.slots?.[slot.id];
    if (!data || !data.visitors) return "";
    return `<div class="settle-row slot"><span>${slot.label} <small>${slot.hour} 点</small></span><b>${data.visitors} 人 · ${data.orders} 单</b><small>${money(data.revenue)}</small></div>`;
  }).join("");
  const topGoods = Object.entries(s.goodsRevenue || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([gid, revenue]) => {
      const goods = GOOD_INDEX[gid];
      const qty = s.goodsUnits?.[gid] || 0;
      return `${goods ? goods.name : gid} ×${qty}（${money(revenue)}）`;
    }).join(" · ");

  /* 损耗归因：品类占比、台面/后台、过期与自然衰减、库龄与保鲜投入 */
  const sd = s.spoilDiag;
  let spoilDiagHtml = "";
  if (sd && sd.total > 0) {
    const cats = Object.entries(sd.byCat || {}).sort((a, b) => b[1].loss - a[1].loss);
    const topCat = cats[0];
    const catShare = topCat ? Math.round((topCat[1].loss / sd.total) * 100) : 0;
    const shelfShare = Math.round((sd.shelfLoss / sd.total) * 100);
    const expiredShare = Math.round((sd.expired / sd.total) * 100);
    const reasons = [];
    if (topCat && catShare >= 30) reasons.push(`${topCat[0]}占 ${catShare}%`);
    reasons.push(shelfShare >= 55
      ? `台面未售出为主（${shelfShare}%，腐损 ×1.6）`
      : shelfShare <= 30
        ? `以后台囤货为主（${100 - shelfShare}%）`
        : "台面与后台各占一半");
    if (sd.expired > 0) reasons.push(`过期批次 ${sd.expiredQty} 件（${expiredShare}%）`);
    else reasons.push("无过期，全是自然衰减");
    if (sd.avgAge >= 2) reasons.push(`平均库龄 ${sd.avgAge} 天，周转偏慢`);
    if (sd.careMult != null) reasons.push(`理货/装修已把腐损压到 ×${sd.careMult}`);
    const high = (s.spoilRate || 0) > 0.05;
    spoilDiagHtml = `<div class="settle-spoil ${high ? "warn" : ""}">
      <p>损耗归因 <small>${high ? "损耗率偏高，建议少进快销、优先上架临期货" : "损耗在可控范围"}</small></p>
      <span>${reasons.join(" · ")}</span>
      <em>TOP：${sd.top.slice(0, 3).map((t) => `${t.name} ${money(t.loss)}（${t.qty}件${t.expiredQty ? ` · 过期${t.expiredQty}` : ""}）`).join(" / ")}</em>
    </div>`;
  }

  els.settleSub.textContent = `第 ${s.day} 天 · ${seasonOf(s.day).name}季 ${seasonDayOf(s.day)}/${SEASON_DAYS} · ${state.location.name} · ${state.weather?.name || ""} · 到店 ${s.visitors} 人 / 成交 ${s.buyers} 人${seasonDayOf(s.day + 1) === 1 ? ` · 明日进入${seasonOf(s.day + 1).name}季` : ""}`;
  els.settleNumbers.innerHTML = [
    s.stageUp ? `<div class="settle-stageup">${s.stageUp.icon}<div><b>进入「${s.stageUp.name}」阶段</b><small>${s.stageUp.tip}</small></div></div>` : "",
    row("营收", s.revenue),
    s.roundOff ? row("　其中抹零让利", null, `−${money(s.roundOff)}`) : "",
    row("商品成本", -s.cogs),
    s.giftCost ? row("　其中赠品成本", null, `−${money(s.giftCost)}`) : "",
    row("毛利", s.revenue - s.cogs),
    `<div class="settle-row"><span>损耗${s.spoilRate ? ` <small class="settle-note">占库存 ${Math.round(s.spoilRate * 100)}%</small>` : ""}</span><b>−${money(s.spoil)}</b></div>`,
    spoilDiagHtml,
    s.salvage ? row("　其中残值回收", s.salvage) : "",
    s.rent > 0 ? row("租金", -s.rent) : row("租金", null, "免租"),
    s.utility ? row("水电杂费", -s.utility) : "",
    row(`装修维护${s.decorWear ? ` <small class="settle-note">耗损 +${Math.round(s.decorWear * 100)}%</small>` : ""}`, -s.decorCost),
    s.riskCost ? row(`意外赔付 <small class="settle-note">装修隐患</small>`, -s.riskCost) : "",
    s.promoCost ? row("促销成本", -s.promoCost) : "",
    s.staffCost ? row("员工工资", -s.staffCost) : "",
    s.branchProfit ? row("分店收入", s.branchProfit) : "",
    `<div class="settle-row total"><span>净利</span><b>${signed(s.profit)}</b></div>`,
    row("期末现金", state.cash),
    row(`库存货值 <small class="settle-note">按进价</small>`, bookValue()),
    state.branches.length ? row("分店估值", branchAssetValue()) : "",
    row("期末资产 <small class=\"settle-note\">现金 + 货值 + 分店</small>", totalAssetValue()),
    row("口碑", null, state.reputation.toFixed(2)),
    row("缺货抱怨", null, `${s.stockouts} 次`),
    `<div class="settle-metrics">
      <div><span>到店客流</span><b>${s.visitors} 人</b><small>成交 ${s.buyers} 人 · 转化 ${conversion}%</small></div>
      <div><span>订单</span><b>${s.sales} 单</b><small>${s.units} 件 · 连带 ${attach}${s.basketFactor ? ` · 客单系数 ×${s.basketFactor.toFixed(2)}` : ""}</small></div>
      <div><span>客单价</span><b>${money(avgTicket)}</b><small>最高 ${money(s.maxTicket || 0)}${s.roundOff ? ` · 抹零 −${money(s.roundOff)}` : ""}</small></div>
      <div><span>议价</span><b>${s.bargainWins}/${s.bargainTries}</b><small>成交率 ${bargainRate}%</small></div>
    </div>
    ${tb ? `<div class="settle-traffic">
      <p>客流构成 <small>预测 ${tb.count} 人 · 实际接待 ${s.visitors} 人</small></p>
      <span>${trafficFactors}</span>
      ${tb.appeal ? `<em>门店经营：货品 ${tb.appealQuality} 分 · 服务 ${tb.appealService} 分 · 价格 ${tb.appealValue} 分 · 齐全度 ${tb.appealVariety}%</em>` : ""}
    </div>` : ""}
    <div class="settle-pairs">
      <div class="settle-slot">
        <p>时段表现</p>
        ${slotRows || `<span class="settle-empty">暂无时段数据</span>`}
      </div>
      <div class="settle-top">
        <p>热销 TOP3</p>
        <span>${topGoods || "暂无成交"}</span>
      </div>
    </div>`,
    `<div class="settle-cats">
      <p>分类毛利</p>
      ${CATEGORIES.map((cat) => {
        const rev = state.catRevenue[cat.name] || 0;
        const cost = state.catCogs[cat.name] || 0;
        return `<div class="settle-row cat"><span>${cat.icon} ${cat.name}</span><b>${signed(rev - cost)}</b><small>收 ${money(rev)} · 本 ${money(cost)}</small></div>`;
      }).join("")}
    </div>`,
  ].filter(Boolean).join("");

  els.checkList.innerHTML = (state.lastCheck.checks || [])
    .map((check) => `<li class="${check.ok ? "pass" : "fail"}"><span class="mark">${check.ok ? "✓" : "!"}</span>${check.text}</li>`)
    .join("");

  els.overlay.hidden = false;
  els.toast.hidden = true;
  StallAudio.setAmbience(false);
  StallAudio.settle();
  updateCheckPill();
  renderAll();
  hideCustomer();
}

/* 成就解锁检查：结算与关键操作后调用 */
function checkAchievements() {
  let unlocked = null;
  for (const item of ACHIEVEMENTS) {
    if (state.achievements[item.id]) continue;
    if (item.test(state)) {
      state.achievements[item.id] = state.day;
      unlocked = item;
    }
  }
  if (unlocked) {
    toast(`成就解锁：${unlocked.icon} ${unlocked.name}`);
    logLine(`成就解锁：${unlocked.icon} ${unlocked.name}`, "good");
  }
  return unlocked;
}

function row(label, cents, raw) {
  const value = raw !== undefined ? raw : money(cents);
  return `<div class="settle-row"><span>${label}</span><b>${value}</b></div>`;
}

function signed(cents) {
  return (cents >= 0 ? "+" : "−") + money(Math.abs(cents)).slice(1);
}

function selfCheck(revenue, cogs) {
  const checks = [];
  const issues = [];

  const cashOk = Number.isFinite(state.cash) && state.cash >= 0 && state.cash < 1e13;
  checks.push({ ok: cashOk, text: cashOk ? "现金非负、未溢出" : `现金异常：${state.cash}` });
  if (!cashOk) issues.push(`现金异常 ${state.cash}`);

  const badLots = [];
  for (const goods of GOODS) {
    for (const area of ["inventory", "backroom"]) {
      for (const lot of state[area][goods.id] || []) {
        if (lot.qty < 0) badLots.push(goods.name);
      }
    }
  }
  const stockOk = badLots.length === 0;
  checks.push({ ok: stockOk, text: stockOk ? "所有批次库存 ≥ 0" : `负库存：${badLots.join("、")}` });
  if (!stockOk) issues.push(`负库存 ${badLots.join("、")}`);

  /* 现金 + 货值构成主店资产；当天只有「卖货收钱、进货存货、非交易收支」三类变动 */
  const wealth = state.cash + bookValue();
  const expected = state.baseWealth + revenue - cogs;
  const ledgerOk = wealth === expected;
  checks.push({
    ok: ledgerOk,
    text: ledgerOk ? "资产守恒对账通过" : `对账不平：${money(wealth)} ≠ ${money(expected)}`,
  });
  if (!ledgerOk) issues.push(`资产对账不平 ${wealth} != ${expected}`);

  /* 售出：现金按实收售价增加（由 revenue 对账），货值按所售批次进价减少 */
  const soldValue = state.daySoldValue || 0;
  const soldOk = soldValue === cogs - (state.dayGiftCost || 0);
  checks.push({
    ok: soldOk,
    text: soldOk ? "售出货值按进价扣减" : `售出成本异常：${money(soldValue)} ≠ ${money(cogs - (state.dayGiftCost || 0))}`,
  });
  if (!soldOk) issues.push(`售出货值异常 ${soldValue} != ${cogs - (state.dayGiftCost || 0)}`);

  /* 进货：现金按进价支出，货值按同额增加 */
  const purchaseOk = (state.dayPurchaseCost || 0) === (state.dayPurchaseValue || 0);
  checks.push({
    ok: purchaseOk,
    text: purchaseOk ? "进货支出与入库货值一致" : `进货对账异常：${money(state.dayPurchaseCost || 0)} ≠ ${money(state.dayPurchaseValue || 0)}`,
  });
  if (!purchaseOk) issues.push(`进货对账异常 ${state.dayPurchaseCost || 0} != ${state.dayPurchaseValue || 0}`);

  const priceOk = GOODS.every((goods) => state.prices[goods.id] > 0);
  checks.push({ ok: priceOk, text: priceOk ? "售价均为正数" : "存在非法售价" });
  if (!priceOk) issues.push("非法售价");

  /* 店长代管必须有店长；招聘推荐必须指向有效岗位与工资 */
  const hasManager = state.staff.some((s) => (s.duty || s.role) === "manager");
  const managerOk = !state.managerAuto || hasManager;
  checks.push({ ok: managerOk, text: managerOk ? "店长代管配置有效" : "代管开启但已无店长" });
  if (!managerOk) issues.push("店长代管缺少店长");

  const hireOk = (state.hireRequests || []).every((req) => STAFF_ROLE_INDEX[req.role] && req.wage > 0);
  checks.push({ ok: hireOk, text: hireOk ? "招聘推荐数据有效" : "招聘推荐数据异常" });
  if (!hireOk) issues.push("招聘推荐数据异常");

  const revenueOk = revenue <= MAX_DAY_REVENUE;
  checks.push({ ok: revenueOk, text: revenueOk ? "单日收入未触发刷钱阈值" : "单日收入异常，疑似刷钱" });
  if (!revenueOk) issues.push("单日收入超阈值");

  return { ok: issues.length === 0, checks, issues };
}

function updateCheckPill() {
  const pill = els.checkPill;
  if (!state.lastCheck.checks.length) {
    pill.textContent = "自检 · 待运行";
    pill.className = "pill";
    return;
  }
  if (state.lastCheck.ok) {
    pill.textContent = "自检 · PASS";
    pill.className = "pill pass";
  } else {
    pill.textContent = `自检 · ${state.lastCheck.issues.length} 项异常`;
    pill.className = "pill fail";
  }
}

/* ---------------- 流水 / 提示 ---------------- */
function logLine(text, kind) {
  const item = document.createElement("li");
  item.textContent = text;
  if (kind) item.className = kind;
  els.receipt.appendChild(item);
  while (els.receipt.children.length > 9) els.receipt.removeChild(els.receipt.firstChild);
  els.receipt.scrollTop = els.receipt.scrollHeight;
}

let toastTimer = null;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1800);
}

function seedInitialStock() {
  for (const goods of GOODS) {
    state.inventory[goods.id] = [];
    state.backroom[goods.id] = [];
    state.prices[goods.id] = goods.base;
  }
  state.goodsDemand = {};
  state.serviceScore = 60;
  state.overdueDays = 0;
  state.lastShortfall = 0;
  state.bankrupt = false;
  state.bankruptReason = "";
  state.bankruptDay = 0;
  state.quit = false;
  state.quitReason = "";
  state.quitDay = 0;
  state.quitPenalty = 0;
  state.quitLiquidation = 0;
  state.quitBranchLiquidation = 0;
  state.quitShortfall = 0;
  /* 开局不配货：启动资金全部为现金，商品库存为空，由店主自行进货 */
}

/* ---------------- 存档（每天开店前自动保存） ---------------- */
const SAVE_KEY_BASE = "shop.sim.save.v1";
const USER_KEY = "shop.users.v1";
const SESSION_KEY = "shop.session.v1";
let saveWarned = false;
/* 每天第一次保存时留一份上一版存档，主档损坏可回退 */
let saveBackupDay = 0;
let saveBackupKey = "";

/* 每个账号一份存档；游客沿用旧版单档，登录后可把游客进度接过来 */
function saveKey() {
  return state.userId ? `${SAVE_KEY_BASE}:${state.userId}` : SAVE_KEY_BASE;
}

function saveGame() {
  if (state.suppressSave) return;
  if (!state.booted || !state.location) return;
  let data = null;
  try {
    data = {
      v: 3,
      day: state.day,
      seed: state.seed,
      phase: state.phase,
      cash: state.cash,
      baseWealth: state.baseWealth,
      reputation: state.reputation,
      serviceScore: state.serviceScore,
      location: state.location.id,
      shopType: state.shopType,
      shopName: state.shopName,
      size: state.size,
      prices: state.prices,
      inventory: state.inventory,
      backroom: state.backroom,
      supplyQuota: state.supplyQuota,
      supplyUsed: state.supplyUsed,
      shipments: state.shipments,
      market: state.market,
      weather: state.weather,
      event: state.event,
      festival: state.festival,
      rival: state.rival,
      weekend: state.weekend,
      trafficMult: state.trafficMult,
      decor: state.decor,
      build: state.build,
      buildAutoNextAt: state.buildAutoNextAt || null,
      condition: state.condition,
      careSet: state.careSet,
      sprayed: state.sprayed,
      wholesale: state.wholesale,
      goldenCat: state.goldenCat,
      promo: state.promo,
      promoBoost: state.promoBoost,
      staff: state.staff.map((s) => ({
        id: s.id, name: s.name, role: s.role, duty: s.duty, policy: s.policy,
        persona: s.persona.id, wage: s.wage, mood: s.mood, stamina: s.stamina ?? STAMINA_MAX, away: false, hiredDay: s.hiredDay,
        busyTurns: s.busyTurns || 0, busyTask: s.busyTask || null,
      })),
      branches: state.branches,
      managerAuto: state.managerAuto,
      hireRequests: state.hireRequests,
      activeBranchId: state.activeBranchId,
      daySpoilDiag: state.daySpoilDiag,
      supplier: state.supplier,
      clearanceRate: state.clearanceRate,
      dayUtility: state.dayUtility,
      stageReached: state.stageReached,
      stageUp: state.stageUp || null,
      lastSettlement: state.lastSettlement || null,
      shelfTier: state.shelfTier,
      autoPilot: state.autoPilot,
      autoStyle: state.autoStyle,
      orders: (state.orders || []).slice(-MAX_ORDER_HISTORY),
      orderSeq: state.orderSeq || 0,
      servicePaused: state.servicePaused,
      /* 营业中进度 */
      queue: state.queue,
      currentIndex: state.currentIndex,
      slot: state.slot,
      clearance: state.clearance,
      ratings: state.ratings,
      dayRent: state.dayRent,
      rentPaidDay: state.rentPaidDay || 0,
      dayDecorCost: state.dayDecorCost,
      daySpoilage: state.daySpoilage,
      daySpoilRate: state.daySpoilRate,
      daySalvage: state.daySalvage,
      overdueDays: state.overdueDays,
      lastShortfall: state.lastShortfall,
      bankrupt: state.bankrupt,
      bankruptReason: state.bankruptReason,
      bankruptDay: state.bankruptDay,
      quit: state.quit,
      quitReason: state.quitReason,
      quitDay: state.quitDay,
      quitPenalty: state.quitPenalty,
      quitLiquidation: state.quitLiquidation,
      quitBranchLiquidation: state.quitBranchLiquidation,
      quitShortfall: state.quitShortfall,
      dayRevenue: state.dayRevenue,
      dayCogs: state.dayCogs,
      daySoldValue: state.daySoldValue,
      dayPurchaseCost: state.dayPurchaseCost,
      dayPurchaseValue: state.dayPurchaseValue,
      salesCount: state.salesCount,
      dayUnits: state.dayUnits,
      dayVisitors: state.dayVisitors,
      dayBuyers: state.dayBuyers,
      dayBargainTries: state.dayBargainTries,
      dayBargainWins: state.dayBargainWins,
      dayDeclines: state.dayDeclines,
      dayMaxTicket: state.dayMaxTicket,
      dayGoodsUnits: state.dayGoodsUnits,
      dayGoodsRevenue: state.dayGoodsRevenue,
      goodsDemand: state.goodsDemand,
      daySlots: state.daySlots,
      trafficBreakdown: state.trafficBreakdown,
      stockoutsToday: state.stockoutsToday,
      dayPromoCost: state.dayPromoCost,
      dayGiftCost: state.dayGiftCost,
      dayStaffCost: state.dayStaffCost,
      dayBranchProfit: state.dayBranchProfit,
      dayRoundOff: state.dayRoundOff,
      dayBasketFactor: state.dayBasketFactor,
      trafficAdapt: state.trafficAdapt,
      decorWear: state.decorWear,
      decorSpend: state.decorSpend,
      decorMaintainTotal: state.decorMaintainTotal,
      decorDowntimeDays: state.decorDowntimeDays,
      decorDowntimeRent: state.decorDowntimeRent,
      decorLostRevenue: state.decorLostRevenue,
      decorRiskCost: state.decorRiskCost,
      decorRiskEvents: state.decorRiskEvents,
      dayRiskCost: state.dayRiskCost,
      catRevenue: state.catRevenue,
      catCogs: state.catCogs,
      /* 长线数据：只保留最近 180 天，控制存档体积 */
      history: state.history.slice(-180),
      achievements: state.achievements,
      totalUnits: state.totalUnits,
      settlement: state.settlement,
      lastCheck: state.lastCheck,
    };
    const key = saveKey();
    if (saveBackupKey !== key || saveBackupDay !== state.day) {
      const previous = localStorage.getItem(key);
      if (previous) {
        try { localStorage.setItem(`${key}:bak`, previous); } catch (err) {}
      }
      saveBackupKey = key;
      saveBackupDay = state.day;
    }
    localStorage.setItem(key, JSON.stringify(data));
    saveWarned = false;
  } catch (err) {
    /* 空间不足：压缩历史后重试一次，仍失败才提示玩家 */
    try {
      if (data) {
        data.history = (data.history || []).slice(-40);
        localStorage.setItem(saveKey(), JSON.stringify(data));
        saveWarned = false;
        return;
      }
    } catch (retryErr) {
      /* 继续走失败提示 */
    }
    if (!saveWarned) {
      saveWarned = true;
      toast("存档失败：浏览器存储空间不足，请清理后重试");
    }
  }
}

function loadGame() {
  let data = null;
  try {
    /* 严格按账号命名空间读取：游客档与账号档互不影响 */
    const raw = localStorage.getItem(saveKey());
    data = JSON.parse(raw || "null");
  } catch (err) {
    data = null;
  }
  /* 主档损坏时回退到当天的备份 */
  if (!data) {
    try {
      data = JSON.parse(localStorage.getItem(`${saveKey()}:bak`) || "null");
    } catch (err) {
      data = null;
    }
  }
  if (!data || (data.v !== 1 && data.v !== 2 && data.v !== 3)) return false;
  const loc = LOCATION_INDEX[data.location];
  const type = SHOP_TYPES.find((t) => t.id === data.shopType);
  if (!loc || !type) return false;

  setCatalog(type.id);
  state.size = SHOP_SIZES.some((s) => s.id === data.size) ? data.size : "small";
  state.location = loc;
  state.shopName = String(data.shopName || "").slice(0, 12);
  renderBrand();
  state.booted = true;
  state.day = data.day || 1;
  state.cash = data.cash || 0;
  state.baseWealth = data.baseWealth || state.cash;
  state.reputation = clamp(data.reputation || INITIAL_REPUTATION, 1, 5);
  state.serviceScore = clamp(data.serviceScore ?? 60, 0, 100);
  state.prices = { ...data.prices };
  state.inventory = { ...data.inventory };
  /* 旧存档没有后台库存：保留台面货，后台从空开始 */
  state.backroom = { ...(data.backroom || {}) };
  /* 旧存档只有剩余到货量，按本地农贸额度折算成基础额度 */
  state.supplyQuota = { ...(data.supplyQuota || data.supplyLeft || {}) };
  state.supplyUsed = { ...(data.supplyUsed || {}) };
  state.shipments = Array.isArray(data.shipments) ? data.shipments : [];
  state.market = data.market || 1;
  state.weather = data.weather || null;
  state.event = data.event || null;
  state.festival = data.festival || null;
  state.rival = data.rival || null;
  state.weekend = !!data.weekend;
  state.trafficMult = data.trafficMult || 1;
  state.decor = { ...DEFAULT_DECOR, ...(data.decor || {}) };
  state.build = data.build || null;
  state.buildAutoNextAt = data.buildAutoNextAt || null;
  state.condition = { ...data.condition };
  state.careSet = { ...data.careSet };
  state.sprayed = { ...data.sprayed };
  state.wholesale = { ...data.wholesale };
  state.goldenCat = data.goldenCat || null;
  state.promo = data.promo || null;
  state.promoBoost = data.promoBoost || 1;
  state.staff = (data.staff || []).map((s) => ({
    ...s,
    duty: s.duty || s.role,
    policy: s.policy || null,
    stamina: s.stamina ?? STAMINA_MAX,
    busyTurns: s.busyTurns || 0,
    busyTask: s.busyTask || null,
    persona: EMPLOYEE_PERSONALITIES.find((p) => p.id === s.persona) || EMPLOYEE_PERSONALITIES[1],
  }));
  state.branches = (data.branches || []).map((b) => ({
    ...b,
    staff: b.staff || [],
    policy: b.policy || "standard",
    priceStrategy: BRANCH_PRICE_INDEX[b.priceStrategy] ? b.priceStrategy : "market",
    daily: b.daily || null,
    value: b.value || b.invested,
    volatility: Number(b.volatility) || 1,
    valueDelta: b.valueDelta || 0,
    valueHistory: b.valueHistory || [b.value || b.invested],
    history: Array.isArray(b.history) ? b.history : [],
    level: Number(b.level) || 0,
    paused: !!b.paused,
    name: b.name || "",
    openedDay: Number(b.openedDay) || 1,
  }));
  state.pendingSellBranch = null;
  const activeBranch = state.branches.find((b) => b.id === data.activeBranchId);
  state.activeBranchId = activeBranch ? activeBranch.id : null;
  state.managerAuto = !!data.managerAuto;
  state.hireRequests = Array.isArray(data.hireRequests) ? data.hireRequests : [];
  state.daySpoilDiag = data.daySpoilDiag || null;
  state.supplier = SUPPLIER_INDEX[data.supplier] ? data.supplier : "market";
  state.clearanceRate = clamp(Number(data.clearanceRate) || 0.5, 0.5, 0.9);
  state.dayUtility = Number(data.dayUtility) || 0;
  state.stageReached = Math.max(1, Number(data.stageReached) || 1);
  state.stageUp = data.stageUp || null;
  state.lastSettlement = data.lastSettlement || null;
  state.shelfTier = SHELF_TIER_INDEX[data.shelfTier] ? data.shelfTier : "wood";
  state.autoPilot = !!data.autoPilot;
  state.autoStyle = AUTO_STYLE_INDEX[data.autoStyle] ? data.autoStyle : "balanced";
  state.orders = Array.isArray(data.orders) ? data.orders.slice(-MAX_ORDER_HISTORY) : [];
  state.orderSeq = Math.max(0, Number(data.orderSeq)
    || (state.orders.length ? state.orders[state.orders.length - 1].id : 0));
  state.servicePaused = !!data.servicePaused;
  state.servingCustomer = false;
  state.queue = data.queue || [];
  state.currentIndex = Number.isFinite(data.currentIndex) ? data.currentIndex : -1;
  state.slot = data.slot || null;
  state.clearance = !!data.clearance;
  state.ratings = data.ratings || [];
  state.history = data.history || [];
  state.achievements = data.achievements || {};
  state.totalUnits = data.totalUnits || 0;
  state.dayUnits = data.dayUnits || 0;
  state.settlement = data.settlement || null;
  state.lastCheck = data.lastCheck || { ok: true, checks: [], issues: [] };
  state.dayRent = data.dayRent || Math.round(loc.rent * sizeOf().rentMult);
  state.rentPaidDay = Number(data.rentPaidDay) || 0;
  state.dayDecorCost = data.dayDecorCost || decorDaily();
  state.daySpoilage = data.daySpoilage || 0;
  state.daySpoilRate = data.daySpoilRate || 0;
  state.daySalvage = data.daySalvage || 0;
  state.overdueDays = data.overdueDays || 0;
  state.lastShortfall = data.lastShortfall || 0;
  state.bankrupt = !!data.bankrupt;
  state.bankruptReason = data.bankruptReason || "";
  state.bankruptDay = data.bankruptDay || 0;
  state.quit = !!data.quit;
  state.quitReason = data.quitReason || "";
  state.quitDay = data.quitDay || 0;
  state.quitPenalty = data.quitPenalty || 0;
  state.quitLiquidation = data.quitLiquidation || 0;
  state.quitBranchLiquidation = data.quitBranchLiquidation || 0;
  state.quitShortfall = data.quitShortfall || 0;
  state.dayRevenue = data.dayRevenue || 0;
  state.dayCogs = data.dayCogs || 0;
  state.daySoldValue = data.daySoldValue || 0;
  state.dayPurchaseCost = data.dayPurchaseCost || 0;
  state.dayPurchaseValue = data.dayPurchaseValue || 0;
  state.salesCount = data.salesCount || 0;
  state.dayVisitors = data.dayVisitors || 0;
  state.dayBuyers = data.dayBuyers || 0;
  state.dayBargainTries = data.dayBargainTries || 0;
  state.dayBargainWins = data.dayBargainWins || 0;
  state.dayDeclines = data.dayDeclines || 0;
  state.dayMaxTicket = data.dayMaxTicket || 0;
  state.dayGoodsUnits = data.dayGoodsUnits || {};
  state.dayGoodsRevenue = data.dayGoodsRevenue || {};
  state.goodsDemand = data.goodsDemand || {};
  state.daySlots = data.daySlots || {};
  state.trafficBreakdown = data.trafficBreakdown || null;
  state.stockoutsToday = data.stockoutsToday || 0;
  state.dayPromoCost = data.dayPromoCost || 0;
  state.dayGiftCost = data.dayGiftCost || 0;
  state.dayStaffCost = data.dayStaffCost || 0;
  state.dayBranchProfit = data.dayBranchProfit || 0;
  state.dayRoundOff = data.dayRoundOff || 0;
  state.dayBasketFactor = data.dayBasketFactor || 1;
  state.trafficAdapt = clamp(data.trafficAdapt || 1, 0.85, 1.15);
  state.decorWear = data.decorWear || 0;
  state.decorSpend = data.decorSpend || 0;
  state.decorMaintainTotal = data.decorMaintainTotal || 0;
  state.decorDowntimeDays = data.decorDowntimeDays || 0;
  state.decorDowntimeRent = data.decorDowntimeRent || 0;
  state.decorLostRevenue = data.decorLostRevenue || 0;
  state.decorRiskCost = data.decorRiskCost || 0;
  state.decorRiskEvents = data.decorRiskEvents || 0;
  state.dayRiskCost = data.dayRiskCost || 0;
  state.catRevenue = data.catRevenue || {};
  state.catCogs = data.catCogs || {};
  state.pendingStaffEvent = null;

  for (const goods of GOODS) {
    if (!state.prices[goods.id]) state.prices[goods.id] = goods.base;
    if (!state.inventory[goods.id]) state.inventory[goods.id] = [];
    if (!state.backroom[goods.id]) state.backroom[goods.id] = [];
    if (state.condition[goods.id] == null) state.condition[goods.id] = 80;
  }

  els.mapOverlay.hidden = true;
  applyDecorTheme();
  syncAutoPilot();
  renderShelf();
  renderHud();
  renderPhase();
  renderTraffic();
  renderFestival();
  renderCrates();
  updateCheckPill();

  /* 主动退租存档：直接恢复退租结果 */
  if (state.quit) {
    state.phase = "quit";
    state.serving = false;
    renderPhase();
    renderHud();
    renderQuit();
    return true;
  }

  /* 破产存档：直接恢复清算面板 */
  if (state.bankrupt) {
    state.phase = "bankrupt";
    state.serving = false;
    renderPhase();
    renderHud();
    renderBankruptcy();
    return true;
  }

  /* 营业中：接着下一位顾客；结算中：直接恢复结算面板 */
  if (data.phase === "open" && state.queue.length) {
    resumeDay();
  } else if (data.phase === "settle" && state.settlement) {
    state.phase = "settle";
    state.serving = false;
    renderPhase();
    renderSettlement();
  } else {
    state.phase = "prep";
    state.serving = false;
    state.currentIndex = -1;
    state.queue = [];
    renderPhase();
    /* 读档回到营业前：店长代管仍然生效，补一次自动开门 */
    scheduleManagerAutoOpen();
  }
  return true;
}

/* 清掉当前账号（或游客）的主档与回退档，避免重置后被旧数据拉回 */
function clearCurrentSave() {
  const key = saveKey();
  localStorage.removeItem(key);
  localStorage.removeItem(`${key}:bak`);
  saveBackupKey = "";
  saveBackupDay = 0;
  if (state.userId) {
    const users = readUsers();
    if (users[state.userId]) {
      users[state.userId].totals = {};
      writeUsers(users);
    }
  }
}

function resetGame() {
  state.suppressSave = true;
  try {
    clearCurrentSave();
  } catch (err) {
    /* ignore */
  }
  window.location.reload();
}

/* ---------------- 用户模块：本地账号 + 按账号存档 ---------------- */
function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "{}") || {};
  } catch (err) {
    return {};
  }
}

function writeUsers(users) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(users));
  } catch (err) {
    /* 隐私模式下静默失败 */
  }
}

/* 轻量密码散列：只用于本机存档，避免明文密码 */
function hashPass(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function currentUser() {
  try {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    return readUsers()[id] || null;
  } catch (err) {
    return null;
  }
}

function setSession(id) {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch (err) {
    /* ignore */
  }
}

function renderUserChip() {
  if (!els.userChip) return;
  const user = state.userId ? readUsers()[state.userId] : null;
  els.userChip.textContent = user ? user.name : "游客";
  els.userChip.title = user ? `${user.name} · 账号存档` : "游客模式 · 本机存档，不与其他账号互通";
}

/* 把本局成长写回账号档案，供下次登录查看。
 * 档案只描述当前存档，避免不同店铺/不同局的数据混在一起。 */
function recordUserProgress() {
  if (!state.userId) return;
  const users = readUsers();
  const user = users[state.userId];
  if (!user) return;
  const history = state.history || [];
  const totals = user.totals || {};
  totals.days = state.day;
  totals.bestProfit = Math.max(
    0,
    ...history.map((item) => item.profit || 0),
    state.settlement?.profit || 0,
  );
  totals.profit = history.reduce((sum, item) => sum + (item.profit || 0), 0);
  totals.achievements = Object.keys(state.achievements || {}).length;
  totals.lastShop = state.shopType;
  totals.lastDay = state.day;
  user.totals = totals;
  user.lastLogin = Date.now();
  writeUsers(users);
  renderUserChip();
}

function showAuth(profileMode = false) {
  if (!els.authOverlay) return;
  const user = state.userId ? readUsers()[state.userId] : null;
  els.authOverlay.hidden = false;
  els.authError.hidden = true;
  if (user) {
    els.authForm.hidden = true;
    els.authProfile.hidden = false;
    els.authTitle.textContent = `店主 · ${user.name}`;
    els.authHint.textContent = user.lastLogin
      ? `上次登录：${new Date(user.lastLogin).toLocaleString("zh-CN")}`
      : "账号已登录";
    const totals = user.totals || {};
    const shop = SHOP_TYPES.find((type) => type.id === totals.lastShop);
    els.authStats.innerHTML = `
      <div><span>经营天数</span><b>${totals.days || 0} 天</b><small>${shop ? shop.name : "尚未开店"}</small></div>
      <div><span>最佳日净利</span><b>${money(totals.bestProfit || 0)}</b><small>单日最高</small></div>
      <div><span>累计净利</span><b>${money(totals.profit || 0)}</b><small>全部经营日合计</small></div>
      <div><span>成就</span><b>${totals.achievements || 0} 个</b><small>已解锁</small></div>`;
  } else {
    els.authForm.hidden = false;
    els.authProfile.hidden = true;
    els.authTitle.textContent = profileMode ? "登录以记忆进度" : "店主账号";
    els.authHint.textContent = "登录后经营数据按账号记忆；游客进度只保存在本机，不记入任何账号。";
  }
}

function hideAuth() {
  if (els.authOverlay) els.authOverlay.hidden = true;
}

function handleAuth(mode) {
  const name = (els.authName.value || "").trim();
  const pass = els.authPass.value || "";
  const fail = (text) => {
    els.authError.textContent = text;
    els.authError.hidden = false;
  };
  if (name.length < 2 || name.length > 12) return fail("用户名需 2-12 个字");
  if (pass.length < 4) return fail("密码至少 4 位");
  const id = name.toLowerCase();
  const users = readUsers();
  if (mode === "register") {
    if (users[id]) return fail("用户名已存在，直接登录吧");
    users[id] = {
      id,
      name,
      pass: hashPass(pass),
      createdAt: Date.now(),
      lastLogin: Date.now(),
      totals: {},
    };
    writeUsers(users);
    setSession(id);
    window.location.reload();
    return;
  }
  const user = users[id];
  if (!user || user.pass !== hashPass(pass)) return fail("用户名或密码不对");
  user.lastLogin = Date.now();
  writeUsers(users);
  setSession(id);
  window.location.reload();
}

function logoutUser() {
  if (!window.confirm("退出登录？当前账号的存档会保留。")) return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
  window.location.reload();
}

/* 列出本机所有与账号/存档相关的键，供后台清理使用 */
function accountStorageKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(SAVE_KEY_BASE) || key === USER_KEY || key === SESSION_KEY || key === "shop.leaderboard.v1") {
        keys.push(key);
      }
    }
  } catch (err) {
    /* 隐私模式下忽略 */
  }
  return keys;
}

/* 后台运维清理：清空本机全部账号、游客档、回退档与档案统计。
 * 不提供个人用户入口，仅在控制台/运维脚本中调用。 */
function wipeAllAccountData() {
  if (!window.confirm("确定清空本机所有账号与存档？所有账号、店铺、分店和历史都会被删除。")) return;
  if (!window.confirm("再次确认：此操作不可恢复，清空后需要重新注册账号。")) return;
  state.suppressSave = true;
  try {
    for (const key of accountStorageKeys()) localStorage.removeItem(key);
    saveBackupKey = "";
    saveBackupDay = 0;
  } catch (err) {
    /* ignore */
  }
  window.location.reload();
}

/* 后台运维入口：仅控制台/运维脚本可用，界面不向个人用户暴露 */
window.shopAdmin = { accountStorageKeys, wipeAllAccountData };

/* 数据换代：启动时清一次历史遗留的账号、会话与存档，之后用标记避免重复清理 */
const DATA_GEN_KEY = "shop.dataGen.v1";
const DATA_GEN = "2";

function purgeStaleAccountData() {
  try {
    if (localStorage.getItem(DATA_GEN_KEY) === DATA_GEN) return false;
    const keys = accountStorageKeys();
    for (const key of keys) localStorage.removeItem(key);
    localStorage.setItem(DATA_GEN_KEY, DATA_GEN);
    return keys.length > 0;
  } catch (err) {
    return false;
  }
}

/* 营业前的任何改动都即时落盘 */
function persistPrep() {
  if (state.phase === "prep" && state.booted) saveGame();
}

/* ---------------- 启动与事件 ---------------- */
els.pauseBtn.addEventListener("click", toggleServicePause);

els.primaryBtn.addEventListener("click", () => {
  if (!state.booted) {
    toast("先在地图上选一个店面");
    return;
  }
  if (state.phase === "prep") openDay();
  else if (state.phase === "settle") els.overlay.hidden = false;
});

els.skipBuildBtn.addEventListener("click", () => skipBuildDay(false));

els.nextDayBtn.addEventListener("click", () => {
  if (state.bankrupt || state.quit) return;
  els.overlay.hidden = true;
  startDay();
});

els.locationChip.addEventListener("click", () => openMap("relocate"));
els.branchSwitchBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  els.branchSwitchMenu.hidden = !els.branchSwitchMenu.hidden;
  els.branchSwitchBtn.setAttribute("aria-expanded", String(!els.branchSwitchMenu.hidden));
});
els.branchSwitchMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-branch-switch]");
  if (button) switchBranchView(button.dataset.branchSwitch);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#branchSwitch")) els.branchSwitchMenu.hidden = true;
});

els.shelfTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-cat]");
  if (!button) return;
  state.shelfCat = button.dataset.cat;
  state.shelfPage = 0;
  StallAudio.tap();
  renderShelf();
});

els.shelfPrev.addEventListener("click", () => {
  if (state.shelfPage <= 0) return;
  state.shelfPage -= 1;
  StallAudio.tap();
  renderShelf();
});

els.shelfNext.addEventListener("click", () => {
  if (state.shelfPage >= shelfPageCount() - 1) return;
  state.shelfPage += 1;
  StallAudio.tap();
  renderShelf();
});

els.backstageBtn.addEventListener("click", openBackstage);
els.backstageClose.addEventListener("click", closeBackstage);
els.backstageMask.addEventListener("click", closeBackstage);
els.ledgerList.addEventListener("click", handleLedgerClick);
els.ledgerList.addEventListener("change", handleLedgerChange);
els.backFillCat.addEventListener("click", fillCategory);
els.backStockCat.addEventListener("click", stockCategory);

els.backTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-cat]");
  if (!button) return;
  state.backCat = button.dataset.cat;
  StallAudio.tap();
  renderBackstage();
});

els.backViews.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  state.backView = button.dataset.view;
  StallAudio.tap();
  renderBackstage();
});

els.ordersPanel.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-range]");
  if (!button) return;
  state.orderRange = button.dataset.orderRange || "all";
  StallAudio.tap();
  renderOrdersPanel();
});

els.strategyPanel.addEventListener("click", (event) => {
  /* 维护在营业中也可用：会占用一名空闲员工，但不再要求暂停接待 */
  const careAll = event.target.closest("[data-careall]");
  if (careAll) {
    if (!canMaintainNow()) {
      toast("现在不能维护");
      return;
    }
    const kind = careAll.dataset.careall === "spray" ? "spray" : "trim";
    let count = 0;
    for (const goods of GOODS) {
      if (totalStockOf(goods.id) <= 0 || state.careSet[goods.id]) continue;
      careGoods(goods.id, kind, { occupy: false, save: false });
      count += 1;
    }
    if (count) {
      occupyMaintainer();
      if (state.phase === "open") saveGame();
      else persistPrep();
    }
    toast(count ? `已维护 ${count} 种商品` : "没有可维护的商品");
    renderBackstage();
    return;
  }
  const clearance = event.target.closest("[data-clearance]");
  if (clearance) {
    if (state.phase === "settle") return;
    state.clearanceRate = clamp(Number(clearance.dataset.clearance) || 0.5, 0.5, 0.9);
    StallAudio.tap();
    toast(`夜市清仓折扣：${clearanceLabel()}`);
    renderHud();
    renderShelf();
    renderBackstage();
    if (state.phase === "open") saveGame();
    else persistPrep();
    return;
  }
  const autoStyle = event.target.closest("[data-autostyle]");
  if (autoStyle) {
    const next = AUTO_STYLE_INDEX[autoStyle.dataset.autostyle];
    if (!next) return;
    state.autoStyle = next.id;
    StallAudio.tap();
    toast(`托管策略：${next.icon} ${next.name}`);
    renderBackstage();
    syncAutoPilot();
    if (state.phase === "open") saveGame();
    else persistPrep();
    return;
  }
  if (state.phase !== "prep") {
    toast("营业中策略锁定");
    return;
  }
  const golden = event.target.closest("[data-golden]");
  if (golden) {
    state.goldenCat = golden.dataset.golden === "none" ? null : golden.dataset.golden;
    StallAudio.tap();
    toast(state.goldenCat ? `黄金位陈列：${state.goldenCat}` : "已撤下黄金位陈列");
    renderBackstage();
    persistPrep();
    return;
  }
  const promo = event.target.closest("[data-promo]");
  if (promo) {
    const kind = promo.dataset.promo === "none" ? null : promo.dataset.promo;
    if (kind === "tasting" && state.promo?.kind !== "tasting" && state.cash < 2000) {
      StallAudio.decline();
      toast("现金不足 ¥20，试吃摆不起来");
      return;
    }
    if (kind === "tasting" && state.promo?.kind !== "tasting") {
      state.cash -= 2000;
      state.baseWealth -= 2000;
      state.dayPromoCost += 2000;
      logLine("水果试吃开摆，支出 ¥20.00", "cost");
    }
    state.promo = kind ? { kind } : null;
    StallAudio.tap();
    toast(kind === "discount" ? "已开启全场 9 折，客流 +15%" : kind === "tasting" ? "水果试吃开摆，客流 +10%" : "已取消促销");
    renderHud();
    renderShelf();
    renderBackstage();
    persistPrep();
    return;
  }
});

/* 点击货架商品查看成色/卖相 */
els.shelfWall.addEventListener("click", (event) => {
  const item = event.target.closest(".shelf-item");
  if (!item) return;
  openGoodsModal(item.dataset.gid);
});

els.goodsModal.addEventListener("click", (event) => {
  if (event.target === els.goodsModal || event.target.closest("[data-close]")) {
    closeGoodsModal();
    return;
  }
  const care = event.target.closest("[data-care]");
  if (care && currentGoodsModal) {
    careGoods(currentGoodsModal, care.dataset.care);
    return;
  }
  const stock = event.target.closest("[data-stock]");
  if (stock && currentGoodsModal) {
    const goods = GOOD_INDEX[currentGoodsModal];
    if (goods) stockShelf(goods, stock.dataset.stock);
    renderGoodsModal(currentGoodsModal);
  }
});

els.decorPanel.addEventListener("click", (event) => {
  const shelfButton = event.target.closest("button[data-shelf]");
  if (shelfButton) {
    buyShelfTier(shelfButton.dataset.shelf);
    return;
  }
  const button = event.target.closest("button[data-decor]");
  if (!button) return;
  startRenovation(button.dataset.decor);
});

els.backSearch.addEventListener("input", () => {
  state.backQuery = els.backSearch.value;
  renderBackstage();
});

els.backLowOnly.addEventListener("change", () => {
  state.backLowOnly = els.backLowOnly.checked;
  renderBackstage();
});

els.backSupplier.addEventListener("change", () => {
  if (!SUPPLIER_INDEX[els.backSupplier.value]) return;
  state.supplier = els.backSupplier.value;
  StallAudio.tap();
  toast(`进货渠道：${supplierOf().name}（${supplierOf().desc}）`);
  renderBackstage();
  if (state.phase === "open") saveGame();
  else persistPrep();
});

els.mapMarkers.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-loc]");
  if (!button) return;
  selectLocation(button.dataset.loc);
});

/* 商店类型条与铺面规格选择 */
els.shopTypeBar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-shtype]");
  if (!button || state.mapMode !== "start") return;
  state.shopType = button.dataset.shtype;
  StallAudio.tap();
  renderMap();
});

els.mapDetail.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-size]");
  if (!button) return;
  state.pendingSize = button.dataset.size;
  StallAudio.tap();
  renderMap();
});

/* 店名输入：只记状态不重绘，避免输入过程中失焦 */
els.mapDetail.addEventListener("input", (event) => {
  if (event.target.id !== "mapShopName") return;
  state.pendingName = event.target.value.slice(0, 12);
});

els.mapSizes.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-size]");
  if (!button) return;
  state.pendingSize = button.dataset.size;
  StallAudio.tap();
  renderMap();
});

/* 员工面板：招人 / 调岗 / 策略 / 涨薪 / 谈心 / 辞退 */
els.staffPanel.addEventListener("click", (event) => {
  const hire = event.target.closest("button[data-hire]");
  if (hire) {
    hireStaff(hire.dataset.hire);
    return;
  }
  const duty = event.target.closest("button[data-duty]");
  if (duty) {
    assignDuty(Number(duty.dataset.staff), duty.dataset.duty);
    return;
  }
  const policy = event.target.closest("button[data-policy]");
  if (policy) {
    setStaffPolicy(Number(policy.dataset.staff), policy.dataset.policy);
    return;
  }
  if (event.target.closest("button[data-manager-auto]")) {
    setManagerAuto(!state.managerAuto);
    return;
  }
  const approve = event.target.closest("button[data-hire-approve]");
  if (approve) {
    resolveHireRequest(Number(approve.dataset.hireApprove), true);
    return;
  }
  const reject = event.target.closest("button[data-hire-reject]");
  if (reject) {
    resolveHireRequest(Number(reject.dataset.hireReject), false);
    return;
  }
  const act = event.target.closest("button[data-act]");
  if (!act) return;
  const id = Number(act.dataset.staff);
  if (act.dataset.act === "raise") raiseStaff(id);
  else if (act.dataset.act === "cut") adjustStaffWage(id, -1);
  else if (act.dataset.act === "chat") chatStaff(id);
  else if (act.dataset.act === "fire") fireStaff(id);
});

/* 员工事件弹层 */
els.employeeModal.addEventListener("click", (event) => {
  if (event.target === els.employeeModal || event.target.closest("[data-close]")) {
    els.employeeModal.hidden = true;
    state.pendingStaffEvent = null;
    return;
  }
  const button = event.target.closest("button[data-ev]");
  if (button) handleEmployeeEvent(button.dataset.ev);
});

/* 分店面板 */els.branchPanel.addEventListener("click", (event) => {
  const typeBtn = event.target.closest("button[data-btype]");
  if (typeBtn) {
    state.pendingBranchType = typeBtn.dataset.btype;
    StallAudio.tap();
    renderBackstage();
    return;
  }
  const locBtn = event.target.closest("button[data-bloc]");
  if (locBtn) {
    state.pendingBranchLoc = locBtn.dataset.bloc;
    StallAudio.tap();
    renderBackstage();
    return;
  }
  const sizeBtn = event.target.closest("button[data-bsize]");
  if (sizeBtn) {
    state.pendingBranchSize = sizeBtn.dataset.bsize;
    StallAudio.tap();
    renderBackstage();
    return;
  }
  if (event.target.closest("button[data-openbranch]")) {
    openBranch(state.pendingBranchType, state.pendingBranchLoc, state.pendingBranchSize);
    return;
  }
  const addStaff = event.target.closest("button[data-bstaff-add]");
  if (addStaff) {
    const [branchId, roleId] = addStaff.dataset.bstaffAdd.split(":");
    hireBranchStaff(Number(branchId), roleId);
    return;
  }
  const fireStaffBtn = event.target.closest("button[data-bstaff-fire]");
  if (fireStaffBtn) {
    const [branchId, index] = fireStaffBtn.dataset.bstaffFire.split(":");
    fireBranchStaff(Number(branchId), Number(index));
    return;
  }
  const policyBtn = event.target.closest("button[data-bpolicy]");
  if (policyBtn) {
    const [branchId, policyId] = policyBtn.dataset.bpolicy.split(":");
    setBranchPolicy(Number(branchId), policyId);
    return;
  }
  const priceBtn = event.target.closest("button[data-bprice]");
  if (priceBtn) {
    const [branchId, strategyId] = priceBtn.dataset.bprice.split(":");
    setBranchPrice(Number(branchId), strategyId);
    return;
  }
  const volBtn = event.target.closest("button[data-bvol]");
  if (volBtn) {
    const [branchId, key] = volBtn.dataset.bvol.split(":");
    setBranchVolatility(Number(branchId), key);
    return;
  }
  const renameBtn = event.target.closest("button[data-brename]");
  if (renameBtn) {
    renameBranch(Number(renameBtn.dataset.brename));
    return;
  }
  const upgradeBtn = event.target.closest("button[data-bupgrade]");
  if (upgradeBtn) {
    upgradeBranch(Number(upgradeBtn.dataset.bupgrade));
    return;
  }
  const pauseBtn = event.target.closest("button[data-bpause]");
  if (pauseBtn) {
    toggleBranchPause(Number(pauseBtn.dataset.bpause));
    return;
  }
  const focusBtn = event.target.closest("button[data-bfocus]");
  if (focusBtn) {
    switchBranchView(Number(focusBtn.dataset.bfocus));
    return;
  }
  const sellBtn = event.target.closest("button[data-bsell]");
  if (sellBtn) {
    state.pendingSellBranch = Number(sellBtn.dataset.bsell);
    StallAudio.tap();
    renderBackstage();
    return;
  }
  const sellConfirm = event.target.closest("button[data-bsell-confirm]");
  if (sellConfirm) {
    sellBranch(Number(sellConfirm.dataset.bsellConfirm));
    return;
  }
  if (event.target.closest("button[data-bsell-cancel]")) {
    state.pendingSellBranch = null;
    renderBackstage();
  }
});

/* 规则手册 */
els.rulebookBtn.addEventListener("click", () => {
  renderRulebook();
  els.rulebookModal.hidden = false;
  StallAudio.tap();
});

els.rulebookModal.addEventListener("click", (event) => {
  if (event.target === els.rulebookModal || event.target.closest("[data-close]")) {
    els.rulebookModal.hidden = true;
  }
});

els.resetGameBtn.addEventListener("click", () => {
  if (!window.confirm("清空存档并重新开业？当前进度会丢失。")) return;
  resetGame();
});

els.bankruptResetBtn.addEventListener("click", () => {
  if (!window.confirm("破产清算后重新开业？当前存档会被清空。")) return;
  resetGame();
});

els.quitBizBtn.addEventListener("click", openExitModal);
els.quitCancelBtn.addEventListener("click", () => {
  els.quitOverlay.hidden = true;
});
els.quitOverlay.addEventListener("click", (event) => {
  if (event.target === els.quitOverlay) els.quitOverlay.hidden = true;
});
els.quitConfirmBtn.addEventListener("click", confirmExit);
els.quitResetBtn.addEventListener("click", () => {
  if (!window.confirm("退出经营后重新开业？当前存档会被清空。")) return;
  resetGame();
});

/* 账号入口 */
els.userChip.addEventListener("click", () => showAuth(true));
els.authLoginBtn.addEventListener("click", () => handleAuth("login"));
els.authRegisterBtn.addEventListener("click", () => handleAuth("register"));
els.authGuestBtn.addEventListener("click", () => {
  hideAuth();
  if (!state.userId) toast("游客模式：进度只保存在本机，不记入账号档案");
});
els.authLogoutBtn.addEventListener("click", logoutUser);
els.authCloseBtn.addEventListener("click", hideAuth);
els.authPass.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAuth("login");
});
els.authName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.authPass.focus();
});
els.authOverlay.addEventListener("click", (event) => {
  if (event.target === els.authOverlay && state.booted) hideAuth();
});

/* 关页前保存：营业中也能恢复到当前进度 */
window.addEventListener("beforeunload", () => {
  if (state.booted && !state.suppressSave) saveGame();
});

els.mapConfirm.addEventListener("click", confirmLocation);
els.mapClose.addEventListener("click", closeMap);

els.speedGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-speed]");
  if (!button) return;
  state.speed = Number(button.dataset.speed) || 2;
  els.speedGroup.querySelectorAll("button").forEach((item) => {
    item.classList.toggle("on", item === button);
  });
});

function syncAutoPilot() {
  const on = state.autoPilot;
  const style = autoStyleOf();
  els.autoPilotToggle.textContent = on ? "托管 · 开" : "托管 · 关";
  els.autoPilotToggle.setAttribute("aria-pressed", on ? "true" : "false");
  els.autoPilotToggle.setAttribute("aria-label", on ? "关闭托管" : "开启托管");
  els.autoPilotToggle.title = `托管策略：${style.icon} ${style.name} —— ${style.desc}`;
}

els.autoPilotToggle.addEventListener("click", () => {
  state.autoPilot = !state.autoPilot;
  syncAutoPilot();
  StallAudio.tap();
  toast(state.autoPilot ? "已开启托管，讲价自动按最优策略处理" : "已关闭托管，讲价由你亲自决定");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.branchSwitchMenu.hidden) {
    els.branchSwitchMenu.hidden = true;
    els.branchSwitchBtn.setAttribute("aria-expanded", "false");
  } else if (!els.goodsModal.hidden) closeGoodsModal();
  else if (!els.rulebookModal.hidden) els.rulebookModal.hidden = true;
  else if (!els.employeeModal.hidden) {
    els.employeeModal.hidden = true;
    state.pendingStaffEvent = null;
  } else if (!els.mapOverlay.hidden && state.mapMode === "relocate") closeMap();
  else if (!els.backstage.hidden) closeBackstage();
});

/* 先清历史存量数据，再恢复账号会话，最后按账号命名空间读档 */
const purgedStaleData = purgeStaleAccountData();
const sessionUser = currentUser();
if (sessionUser) {
  state.userId = sessionUser.id;
  const users = readUsers();
  if (users[sessionUser.id]) {
    users[sessionUser.id].lastLogin = Date.now();
    writeUsers(users);
  }
} else {
  /* 会话指向已不存在的账号时清掉，避免误读游客档或账号档 */
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
}

const resumed = loadGame();
if (!resumed) {
  seedInitialStock();
  applyDecorTheme();
  syncAutoPilot();
  renderShelf();
  renderHud();
  renderPhase();
  renderTraffic();
  renderFestival();
  renderCrates();
  updateCheckPill();
  openMap("start");
} else {
  syncAutoPilot();
  setTimeout(() => toast(`继续上次进度：第 ${state.day} 天 · ${state.location.name}`), 400);
}
renderUserChip();
/* 施工倒计时：每秒刷新按钮；到点自动进入下一天 */
syncBuildSkip();
setInterval(tickBuildSkip, 1000);
/* 在途物流：每秒检查一次，到点自动入库 */
setInterval(tickShipments, 1000);
/* 未登录：提示登录，可直接游客试玩 */
if (!state.userId) showAuth(false);
if (purgedStaleData) setTimeout(() => toast("已清理历史账号与存档，可重新注册或游客试玩"), 300);

// 预热顾客立绘，避免第一位顾客进门时集中解码造成卡顿
JOBS.forEach((job) => {
  const img = new Image();
  img.src = `${SPRITE_DIR}${job.sprite}`;
  if (img.decode) img.decode().catch(() => {});
});
