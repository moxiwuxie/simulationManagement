/* 商品与店面数据层
 * 商品按品类组织，图标来自 AI 生成的 3×3 图集，按格子裁切。
 * 店面地点决定日租、基础人流、客群消费力与竞争压力。
 */

let CATEGORIES = [
  { id: "leaf", name: "叶菜", icon: "🥬" },
  { id: "root", name: "根茎", icon: "🥕" },
  { id: "solanum", name: "茄果", icon: "🍅" },
  { id: "mushroom", name: "菌菇豆类", icon: "🍄" },
  { id: "fruit", name: "水果", icon: "🍎" },
  { id: "herb", name: "葱姜调味", icon: "🧄" },
];

const cell = (src, index) => ({ src, cols: 3, rows: 3, cell: index });
const pic = (src) => ({ src });

let GOODS = [
  /* ---------- 叶菜 ---------- */
  { id: "cabbage", name: "小白菜", cat: "叶菜", unit: "把", cost: 260, base: 430, shelf: 5, cap: 45, pop: 1.45, icon: pic("cabbage.jpg") },
  { id: "spinach", name: "菠菜", cat: "叶菜", unit: "把", cost: 320, base: 540, shelf: 4, cap: 40, pop: 1.2, icon: pic("spinach.jpg") },
  { id: "lettuce", name: "生菜", cat: "叶菜", unit: "颗", cost: 280, base: 460, shelf: 4, cap: 40, pop: 1.2, icon: cell("atlas_leaf.jpg", 0) },
  { id: "achoy", name: "油麦菜", cat: "叶菜", unit: "把", cost: 280, base: 470, shelf: 3, cap: 35, pop: 1.05, icon: cell("atlas_leaf.jpg", 1) },
  { id: "water-spinach", name: "空心菜", cat: "叶菜", unit: "把", cost: 260, base: 450, shelf: 3, cap: 35, pop: 1.0, icon: cell("atlas_leaf.jpg", 2) },
  { id: "chives", name: "韭菜", cat: "叶菜", unit: "把", cost: 300, base: 520, shelf: 4, cap: 30, pop: 0.95, icon: cell("atlas_leaf.jpg", 3) },
  { id: "celery", name: "芹菜", cat: "叶菜", unit: "把", cost: 280, base: 480, shelf: 5, cap: 30, pop: 1.0, icon: cell("atlas_leaf.jpg", 4) },
  { id: "garland", name: "茼蒿", cat: "叶菜", unit: "把", cost: 320, base: 560, shelf: 3, cap: 25, pop: 0.85, icon: cell("atlas_leaf.jpg", 5) },
  { id: "gailan", name: "芥蓝", cat: "叶菜", unit: "把", cost: 360, base: 620, shelf: 4, cap: 25, pop: 0.75, icon: cell("atlas_leaf.jpg", 6) },
  { id: "amaranth", name: "苋菜", cat: "叶菜", unit: "把", cost: 300, base: 520, shelf: 3, cap: 25, pop: 0.75, icon: cell("atlas_leaf.jpg", 7) },
  { id: "baby-napa", name: "娃娃菜", cat: "叶菜", unit: "颗", cost: 350, base: 600, shelf: 5, cap: 30, pop: 0.95, icon: cell("atlas_leaf.jpg", 8) },

  /* ---------- 根茎 ---------- */
  { id: "potato", name: "土豆", cat: "根茎", unit: "斤", cost: 220, base: 390, shelf: 14, cap: 60, pop: 1.55, icon: pic("potato.jpg") },
  { id: "carrot", name: "胡萝卜", cat: "根茎", unit: "斤", cost: 300, base: 500, shelf: 12, cap: 55, pop: 1.35, icon: pic("carrot.jpg") },
  { id: "daikon", name: "白萝卜", cat: "根茎", unit: "根", cost: 200, base: 360, shelf: 10, cap: 50, pop: 1.0, icon: cell("atlas_root.jpg", 0) },
  { id: "sweet-potato", name: "红薯", cat: "根茎", unit: "斤", cost: 320, base: 560, shelf: 14, cap: 50, pop: 1.1, icon: cell("atlas_root.jpg", 1) },
  { id: "yam", name: "山药", cat: "根茎", unit: "根", cost: 520, base: 880, shelf: 10, cap: 30, pop: 0.85, icon: cell("atlas_root.jpg", 2) },
  { id: "lotus-root", name: "莲藕", cat: "根茎", unit: "节", cost: 480, base: 820, shelf: 6, cap: 25, pop: 0.85, icon: cell("atlas_root.jpg", 3) },
  { id: "onion", name: "洋葱", cat: "根茎", unit: "斤", cost: 240, base: 420, shelf: 12, cap: 50, pop: 1.1, icon: cell("atlas_root.jpg", 4) },
  { id: "taro", name: "芋头", cat: "根茎", unit: "斤", cost: 380, base: 650, shelf: 9, cap: 30, pop: 0.85, icon: cell("atlas_root.jpg", 5) },
  { id: "water-chestnut", name: "荸荠", cat: "根茎", unit: "斤", cost: 520, base: 880, shelf: 8, cap: 25, pop: 0.65, icon: cell("atlas_root.jpg", 6) },
  { id: "corn", name: "甜玉米", cat: "根茎", unit: "根", cost: 300, base: 520, shelf: 6, cap: 40, pop: 1.15, icon: cell("atlas_root.jpg", 7) },
  { id: "purple-potato", name: "紫薯", cat: "根茎", unit: "斤", cost: 360, base: 620, shelf: 14, cap: 35, pop: 0.85, icon: cell("atlas_root.jpg", 8) },

  /* ---------- 茄果 ---------- */
  { id: "tomato", name: "番茄", cat: "茄果", unit: "斤", cost: 380, base: 620, shelf: 4, cap: 50, pop: 1.5, icon: pic("tomato.jpg") },
  { id: "cucumber", name: "黄瓜", cat: "茄果", unit: "斤", cost: 350, base: 580, shelf: 3, cap: 45, pop: 1.3, icon: pic("cucumber.jpg") },
  { id: "eggplant", name: "茄子", cat: "茄果", unit: "斤", cost: 320, base: 560, shelf: 4, cap: 35, pop: 1.05, icon: cell("atlas_solanum.jpg", 0) },
  { id: "green-pepper", name: "青椒", cat: "茄果", unit: "斤", cost: 340, base: 600, shelf: 5, cap: 35, pop: 1.05, icon: cell("atlas_solanum.jpg", 1) },
  { id: "hot-pepper", name: "尖椒", cat: "茄果", unit: "斤", cost: 380, base: 680, shelf: 5, cap: 30, pop: 0.9, icon: cell("atlas_solanum.jpg", 2) },
  { id: "zucchini", name: "西葫芦", cat: "茄果", unit: "斤", cost: 280, base: 500, shelf: 5, cap: 30, pop: 0.9, icon: cell("atlas_solanum.jpg", 3) },
  { id: "bitter-melon", name: "苦瓜", cat: "茄果", unit: "斤", cost: 360, base: 640, shelf: 4, cap: 25, pop: 0.75, icon: cell("atlas_solanum.jpg", 4) },
  { id: "loofah", name: "丝瓜", cat: "茄果", unit: "斤", cost: 340, base: 600, shelf: 4, cap: 25, pop: 0.8, icon: cell("atlas_solanum.jpg", 5) },
  { id: "okra", name: "秋葵", cat: "茄果", unit: "斤", cost: 520, base: 900, shelf: 4, cap: 20, pop: 0.65, icon: cell("atlas_solanum.jpg", 6) },
  { id: "winter-melon", name: "冬瓜", cat: "茄果", unit: "斤", cost: 200, base: 360, shelf: 8, cap: 40, pop: 0.9, icon: cell("atlas_solanum.jpg", 7) },
  { id: "pumpkin", name: "南瓜", cat: "茄果", unit: "斤", cost: 240, base: 430, shelf: 10, cap: 40, pop: 0.95, icon: cell("atlas_solanum.jpg", 8) },

  /* ---------- 菌菇豆类 ---------- */
  { id: "shiitake", name: "香菇", cat: "菌菇豆类", unit: "斤", cost: 620, base: 1080, shelf: 6, cap: 25, pop: 1.05, icon: cell("atlas_mushroom.jpg", 0) },
  { id: "enoki", name: "金针菇", cat: "菌菇豆类", unit: "包", cost: 280, base: 480, shelf: 5, cap: 35, pop: 1.05, icon: cell("atlas_mushroom.jpg", 1) },
  { id: "king-oyster", name: "杏鲍菇", cat: "菌菇豆类", unit: "斤", cost: 420, base: 720, shelf: 5, cap: 30, pop: 0.85, icon: cell("atlas_mushroom.jpg", 2) },
  { id: "wood-ear", name: "木耳", cat: "菌菇豆类", unit: "斤", cost: 560, base: 980, shelf: 10, cap: 25, pop: 0.75, icon: cell("atlas_mushroom.jpg", 3) },
  { id: "long-bean", name: "豆角", cat: "菌菇豆类", unit: "斤", cost: 380, base: 660, shelf: 4, cap: 30, pop: 1.05, icon: cell("atlas_mushroom.jpg", 4) },
  { id: "peas", name: "豌豆", cat: "菌菇豆类", unit: "斤", cost: 480, base: 820, shelf: 4, cap: 20, pop: 0.65, icon: cell("atlas_mushroom.jpg", 5) },
  { id: "edamame", name: "毛豆", cat: "菌菇豆类", unit: "斤", cost: 360, base: 620, shelf: 4, cap: 25, pop: 0.9, icon: cell("atlas_mushroom.jpg", 6) },
  { id: "snow-peas", name: "荷兰豆", cat: "菌菇豆类", unit: "斤", cost: 520, base: 900, shelf: 3, cap: 20, pop: 0.65, icon: cell("atlas_mushroom.jpg", 7) },
  { id: "oyster-mushroom", name: "平菇", cat: "菌菇豆类", unit: "斤", cost: 320, base: 560, shelf: 5, cap: 25, pop: 0.85, icon: cell("atlas_mushroom.jpg", 8) },

  /* ---------- 水果 ---------- */
  { id: "apple", name: "苹果", cat: "水果", unit: "个", cost: 550, base: 900, shelf: 12, cap: 50, pop: 1.4, decay: 0.015, icon: pic("apple.jpg") },
  { id: "strawberry", name: "草莓", cat: "水果", unit: "盒", cost: 900, base: 1580, shelf: 2, cap: 18, pop: 1.15, decay: 0.3, icon: pic("strawberry.jpg") },
  { id: "banana", name: "香蕉", cat: "水果", unit: "斤", cost: 280, base: 480, shelf: 5, cap: 40, pop: 1.45, icon: cell("atlas_fruit_a.jpg", 0) },
  { id: "orange", name: "橙子", cat: "水果", unit: "个", cost: 480, base: 820, shelf: 10, cap: 40, pop: 1.2, icon: cell("atlas_fruit_a.jpg", 1) },
  { id: "pear", name: "梨", cat: "水果", unit: "个", cost: 420, base: 720, shelf: 12, cap: 40, pop: 1.05, icon: cell("atlas_fruit_a.jpg", 2) },
  { id: "grape", name: "葡萄", cat: "水果", unit: "串", cost: 780, base: 1380, shelf: 4, cap: 20, pop: 1.05, icon: cell("atlas_fruit_a.jpg", 3) },
  { id: "watermelon", name: "西瓜", cat: "水果", unit: "斤", cost: 220, base: 380, shelf: 8, cap: 40, pop: 1.2, icon: cell("atlas_fruit_a.jpg", 4) },
  { id: "peach", name: "水蜜桃", cat: "水果", unit: "斤", cost: 520, base: 900, shelf: 4, cap: 25, pop: 0.95, decay: 0.09, icon: cell("atlas_fruit_a.jpg", 5) },
  { id: "kiwi", name: "猕猴桃", cat: "水果", unit: "个", cost: 620, base: 1080, shelf: 8, cap: 25, pop: 0.85, icon: cell("atlas_fruit_a.jpg", 6) },
  { id: "dragon-fruit", name: "火龙果", cat: "水果", unit: "个", cost: 680, base: 1180, shelf: 7, cap: 20, pop: 0.75, icon: cell("atlas_fruit_a.jpg", 7) },
  { id: "mango", name: "芒果", cat: "水果", unit: "斤", cost: 720, base: 1280, shelf: 6, cap: 20, pop: 0.8, icon: cell("atlas_fruit_a.jpg", 8) },
  { id: "pineapple", name: "菠萝", cat: "水果", unit: "个", cost: 560, base: 980, shelf: 7, cap: 20, pop: 0.8, icon: cell("atlas_fruit_b.jpg", 0) },
  { id: "lemon", name: "柠檬", cat: "水果", unit: "个", cost: 400, base: 700, shelf: 8, cap: 20, pop: 0.55, icon: cell("atlas_fruit_b.jpg", 1) },
  { id: "cherry", name: "樱桃", cat: "水果", unit: "盒", cost: 1200, base: 1980, shelf: 3, cap: 15, pop: 0.55, icon: cell("atlas_fruit_b.jpg", 2) },
  { id: "blueberry", name: "蓝莓", cat: "水果", unit: "盒", cost: 900, base: 1580, shelf: 4, cap: 15, pop: 0.55, icon: cell("atlas_fruit_b.jpg", 3) },
  { id: "pomelo", name: "柚子", cat: "水果", unit: "个", cost: 600, base: 1050, shelf: 8, cap: 20, pop: 0.65, icon: cell("atlas_fruit_b.jpg", 4) },
  { id: "pomegranate", name: "石榴", cat: "水果", unit: "个", cost: 580, base: 1000, shelf: 8, cap: 20, pop: 0.65, icon: cell("atlas_fruit_b.jpg", 5) },
  { id: "cantaloupe", name: "哈密瓜", cat: "水果", unit: "个", cost: 480, base: 820, shelf: 7, cap: 20, pop: 0.75, icon: cell("atlas_fruit_b.jpg", 6) },
  { id: "plum", name: "李子", cat: "水果", unit: "斤", cost: 420, base: 720, shelf: 5, cap: 20, pop: 0.65, icon: cell("atlas_fruit_b.jpg", 7) },
  { id: "apricot", name: "杏", cat: "水果", unit: "斤", cost: 400, base: 680, shelf: 5, cap: 20, pop: 0.6, icon: cell("atlas_fruit_b.jpg", 8) },

  /* ---------- 葱姜调味 ---------- */
  { id: "scallion", name: "小葱", cat: "葱姜调味", unit: "把", cost: 120, base: 220, shelf: 4, cap: 40, pop: 1.3, icon: cell("atlas_herb.jpg", 0) },
  { id: "cilantro", name: "香菜", cat: "葱姜调味", unit: "把", cost: 160, base: 300, shelf: 3, cap: 30, pop: 1.05, icon: cell("atlas_herb.jpg", 1) },
  { id: "garlic", name: "大蒜", cat: "葱姜调味", unit: "斤", cost: 380, base: 650, shelf: 14, cap: 40, pop: 1.2, icon: cell("atlas_herb.jpg", 2) },
  { id: "ginger", name: "生姜", cat: "葱姜调味", unit: "斤", cost: 520, base: 880, shelf: 14, cap: 40, pop: 1.15, icon: cell("atlas_herb.jpg", 3) },
  { id: "bird-chili", name: "小米辣", cat: "葱姜调味", unit: "两", cost: 260, base: 480, shelf: 8, cap: 25, pop: 0.8, icon: cell("atlas_herb.jpg", 4) },
  { id: "garlic-sprout", name: "蒜苗", cat: "葱姜调味", unit: "把", cost: 320, base: 560, shelf: 4, cap: 25, pop: 0.8, icon: cell("atlas_herb.jpg", 5) },
  { id: "perilla", name: "紫苏", cat: "葱姜调味", unit: "把", cost: 360, base: 640, shelf: 3, cap: 20, pop: 0.5, icon: cell("atlas_herb.jpg", 6) },
  { id: "mint", name: "薄荷", cat: "葱姜调味", unit: "把", cost: 300, base: 540, shelf: 3, cap: 20, pop: 0.5, icon: cell("atlas_herb.jpg", 7) },
  { id: "leek", name: "大葱", cat: "葱姜调味", unit: "斤", cost: 200, base: 360, shelf: 6, cap: 35, pop: 0.95, icon: cell("atlas_herb.jpg", 8) },
];

let CATEGORY_NAMES = CATEGORIES.map((item) => item.name);
let GOOD_INDEX = Object.fromEntries(GOODS.map((goods) => [goods.id, goods]));

/* 店面地点：坐标用于地图定位（viewBox 1000 × 640） */
const LOCATIONS = [
  {
    id: "alley", name: "老社区巷口", short: "老社区", icon: "🏘️",
    rent: 3000, traffic: 0.85, wealthMult: 0.86, competition: 0.85, weekendTraffic: 1.25,
    x: 150, y: 205,
    tagline: "低租金 · 街坊熟客",
    desc: "巷口的老铺面，租金便宜，街坊邻居都认人。客流不大，但回头客多，适合稳扎稳打。",
    jobBias: { regular: 2.4, housewife: 1.9, poorElder: 1.8, sanitation: 1.3, office: 0.5 },
    tags: ["租金最低", "熟客复购", "客流有限"],
  },
  {
    id: "hospital", name: "医院门口", short: "医院", icon: "🏥",
    rent: 6000, traffic: 1.2, wealthMult: 0.95, competition: 0.8, weekendTraffic: 0.92,
    x: 185, y: 500,
    tagline: "探病人群 · 水果好卖",
    desc: "医院门口人来人往，探病的人爱买水果和好处理的菜。竞争不算激烈，客单价中等。",
    jobBias: { sanitation: 2.0, poorElder: 1.8, regular: 1.6, housewife: 1.3, office: 0.7 },
    tags: ["水果需求高", "竞争较小", "客流稳定"],
  },
  {
    id: "market", name: "农贸市场", short: "菜市场", icon: "🧺",
    rent: 6500, traffic: 1.55, wealthMult: 0.9, competition: 1.3, weekendTraffic: 1.18,
    x: 330, y: 410,
    tagline: "人流最旺 · 竞争激烈",
    desc: "菜市场入口的摊位，人流最旺，但周围全是同行。价格战频繁，走量才能赚钱。",
    jobBias: { housewife: 2.4, regular: 1.8, sanitation: 1.4, poorElder: 1.3, office: 0.4 },
    tags: ["人流最旺", "同行竞争", "适合走量"],
  },
  {
    id: "metro", name: "地铁口", short: "地铁口", icon: "🚇",
    rent: 12000, traffic: 1.75, wealthMult: 1.0, competition: 1.15, weekendTraffic: 0.88,
    x: 545, y: 295,
    tagline: "人流最高 · 租金最贵",
    desc: "地铁口旁的小门面，上下班人流不断。租金最贵，顾客来去匆匆，最看重速度。",
    jobBias: { office: 2.2, student: 1.4, teen: 1.3, housewife: 0.7 },
    tags: ["人流最高", "租金最高", "顾客赶时间"],
  },
  {
    id: "university", name: "大学城", short: "大学城", icon: "🎓",
    rent: 4500, traffic: 1.15, wealthMult: 0.7, competition: 1.0, weekendTraffic: 0.72,
    x: 385, y: 120,
    tagline: "学生客群 · 预算有限",
    desc: "大学城后街，学生多、预算紧，水果和小份菜好卖。假期客流会明显变少。",
    jobBias: { student: 2.6, teen: 2.0, fitness: 1.6, housewife: 0.4 },
    tags: ["学生为主", "客单价低", "租金适中"],
  },
  {
    id: "office", name: "写字楼商圈", short: "写字楼", icon: "🏢",
    rent: 8500, traffic: 1.35, wealthMult: 1.2, competition: 1.1, weekendTraffic: 0.66,
    x: 725, y: 175,
    tagline: "白领客群 · 注重效率",
    desc: "写字楼下的临街铺面，白领多、消费力不错，但午休时间集中，动作要快。",
    jobBias: { office: 2.3, blogger: 1.5, fitness: 1.4, housewife: 0.8 },
    tags: ["消费力较好", "午间高峰", "租金偏高"],
  },
  {
    id: "luxury", name: "高档小区", short: "高档小区", icon: "🏙️",
    rent: 11000, traffic: 1.1, wealthMult: 1.7, competition: 0.95, weekendTraffic: 1.15,
    x: 835, y: 420,
    tagline: "高消费 · 看重品相",
    desc: "高档小区门口的精品蔬果店，客群宽裕，愿意为品相和新鲜度买单。租金不低。",
    jobBias: { wealthy: 2.6, blogger: 1.7, regular: 1.2, office: 1.2, sanitation: 0.4 },
    tags: ["客单价最高", "看重品相", "租金较高"],
  },
];

const LOCATION_INDEX = Object.fromEntries(LOCATIONS.map((item) => [item.id, item]));

/* ---------------- 装修 ---------------- */
/* price 为一次性工程款（分），days 为工期（占用营业日），daily 为每天的电费/维护（分）
 * quality 1-5：影响客流、顾客愿付溢价、口碑评价
 * appeal：对基础人流的加成分；spoil：腐损系数（1 = 不改善）
 * hazard：施工或使用中的真实风险，会体现在结算与事件里 */
const DECOR_CATS = [
  { id: "floor", name: "地面", icon: "🧱" },
  { id: "wall", name: "墙面", icon: "🎨" },
  { id: "shelf", name: "货架", icon: "🗄️" },
  { id: "light", name: "灯光", icon: "💡" },
  { id: "fresh", name: "保鲜", icon: "❄️" },
  { id: "sign", name: "门头", icon: "🪧" },
];

const DECOR = [
  /* 地面 */
  { id: "floor_cement", cat: "floor", name: "水泥自流平", quality: 1, price: 0, days: 0, materials: "原地面找平", labor: "自己动手", appeal: 0, spoil: 1, daily: 0,
    pros: ["不花钱", "耐压好打理"], cons: ["灰大显脏", "遇水打滑"], hazard: "雨天客人滑倒，可能赔医药费" },
  { id: "floor_tile", cat: "floor", name: "防滑地砖", quality: 3, price: 120000, days: 1, materials: "300×300 防滑砖 18 箱", labor: "瓦工 1 人 · 1 天", appeal: 0.04, spoil: 1, daily: 0,
    pros: ["防滑系数高", "冲水即净"], cons: ["接缝藏泥", "重物砸出坑"], hazard: "施工 1 天不能营业" },
  { id: "floor_terrazzo", cat: "floor", name: "水磨石地面", quality: 4, price: 260000, days: 2, materials: "水磨石骨料 + 铜条", labor: "瓦工 2 人 · 2 天", appeal: 0.07, spoil: 1, daily: 0,
    pros: ["显干净、有档次", "耐磨 10 年以上"], cons: ["造价高", "施工灰尘大"], hazard: "施工期 2 天停业，粉尘需闭店" },

  /* 墙面 */
  { id: "wall_plain", cat: "wall", name: "白灰墙", quality: 1, price: 0, days: 0, materials: "原有墙面", labor: "无", appeal: 0, spoil: 1, daily: 0,
    pros: ["零成本"], cons: ["掉粉、发霉", "看着旧"], hazard: "潮气重时墙面起霉，影响观感" },
  { id: "wall_paint", cat: "wall", name: "乳胶漆墙面", quality: 3, price: 80000, days: 1, materials: "净味乳胶漆 2 桶", labor: "油工 1 人 · 1 天", appeal: 0.03, spoil: 1, daily: 0,
    pros: ["亮堂显大", "颜色可选"], cons: ["怕水怕磕"], hazard: "劣质漆有甲醛味，开业初期顾客会皱眉" },
  { id: "wall_tile", cat: "wall", name: "瓷砖墙裙", quality: 4, price: 220000, days: 2, materials: "小白砖 + 美缝剂", labor: "瓦工 1 人 · 2 天", appeal: 0.06, spoil: 1, daily: 0,
    pros: ["一擦就净", "生鲜店显专业"], cons: ["冬天显冷", "缝多"], hazard: "施工 2 天，湿作业期间不能摆货" },

  /* 货架 */
  { id: "shelf_wood", cat: "shelf", name: "简易木架", quality: 1, price: 0, days: 0, materials: "旧木板钉制", labor: "自己钉", appeal: 0, spoil: 1, daily: 0,
    pros: ["不花钱"], cons: ["层数少、摆不多", "受潮变形"], hazard: "钉子外露，可能划伤顾客" },
  { id: "shelf_multi", cat: "shelf", name: "多层木货架", quality: 3, price: 150000, days: 1, materials: "松木多层架 6 组", labor: "木工 2 人 · 1 天", appeal: 0.06, spoil: 1, daily: 0,
    pros: ["陈列翻倍", "取放顺手"], cons: ["占过道", "木面怕水"], hazard: "层高超 1.6m 需固定，否则有倾倒风险" },
  { id: "shelf_steel", cat: "shelf", name: "不锈钢果蔬架", quality: 5, price: 360000, days: 2, materials: "304 不锈钢 + 斜口筐", labor: "安装队 2 人 · 2 天", appeal: 0.11, spoil: 0.94, daily: 200,
    pros: ["耐水抗菌", "斜口陈列显新鲜"], cons: ["造价高", "金属显冷硬"], hazard: "边角需包胶，否则磕碰" },

  /* 灯光 */
  { id: "light_bulb", cat: "light", name: "白炽灯泡", quality: 1, price: 0, days: 0, materials: "原有灯座", labor: "无", appeal: 0, spoil: 1, daily: 300,
    pros: ["现成可用"], cons: ["显色差，菜发暗", "费电"], hazard: "灯泡裸露易碰碎" },
  { id: "light_strip", cat: "light", name: "暖光灯带", quality: 3, price: 60000, days: 1, materials: "LED 灯带 30m", labor: "电工 1 人 · 半天", appeal: 0.05, spoil: 1, daily: 400,
    pros: ["菜色更暖", "氛围好"], cons: ["易积灰", "接头怕水"], hazard: "灯带接头受潮有漏电风险，需做防水" },
  { id: "light_spot", cat: "light", name: "生鲜射灯", quality: 4, price: 180000, days: 1, materials: "高显色射灯 12 只", labor: "电工 1 人 · 1 天", appeal: 0.09, spoil: 1, daily: 900,
    pros: ["显色 95+，菜显水灵", "拍照好看"], cons: ["电费明显上升", "灯下温度高"], hazard: "长时间照射会加速叶菜失水，腐损略增" },

  /* 保鲜 */
  { id: "fresh_box", cat: "fresh", name: "泡沫箱 + 冰袋", quality: 1, price: 0, days: 0, materials: "旧泡沫箱", labor: "无", appeal: 0, spoil: 1, daily: 0,
    pros: ["零成本"], cons: ["温度不稳", "占地方"], hazard: "冷凝水积在箱底，底层菜易烂" },
  { id: "fresh_mist", cat: "fresh", name: "喷雾保鲜柜", quality: 4, price: 280000, days: 2, materials: "风冷柜 + 超声波雾化", labor: "厂家安装 1 天", appeal: 0.05, spoil: 0.78, daily: 800,
    pros: ["叶菜少蔫", "腐损降两成"], cons: ["要接上下水", "噪声"], hazard: "雾化水需勤换，否则滋生细菌" },
  { id: "fresh_fridge", cat: "fresh", name: "风幕冷藏柜", quality: 5, price: 520000, days: 3, materials: "3m 风幕柜 + 备用机组", labor: "厂家 2 人 · 2 天", appeal: 0.08, spoil: 0.62, daily: 1600,
    pros: ["腐损降四成", "水果品相稳"], cons: ["电费高", "占地"], hazard: "停电 2 小时以上会集中变质，需备电" },

  /* 门头 */
  { id: "sign_board", cat: "sign", name: "手写木牌", quality: 1, price: 0, days: 0, materials: "旧木板手写", labor: "自己写", appeal: 0, spoil: 1, daily: 0,
    pros: ["有烟火气", "零成本"], cons: ["雨天糊字", "远处看不清"], hazard: "大风天木牌可能掉落" },
  { id: "sign_acrylic", cat: "sign", name: "亚克力灯箱", quality: 3, price: 90000, days: 1, materials: "亚克力灯箱 2.4m", labor: "广告店安装", appeal: 0.04, spoil: 1, daily: 200,
    pros: ["夜里看得清", "干净正规"], cons: ["样式普通"], hazard: "安装打孔破坏门梁防水" },
  { id: "sign_neon", cat: "sign", name: "霓虹招牌", quality: 4, price: 260000, days: 2, materials: "柔性霓虹 + 金属字", labor: "广告店 2 人 · 2 天", appeal: 0.09, spoil: 1, daily: 300,
    pros: ["辨识度高", "适合拍照传播"], cons: ["审批麻烦", "耗电"], hazard: "光污染可能被邻居投诉" },
];

const DECOR_INDEX = Object.fromEntries(DECOR.map((item) => [item.id, item]));
const DECOR_BY_CAT = Object.fromEntries(DECOR_CATS.map((cat) => [cat.id, DECOR.filter((item) => item.cat === cat.id)]));
const DEFAULT_DECOR = Object.fromEntries(DECOR.filter((item) => item.price === 0).map((item) => [item.cat, item.id]));

/* ================ 创业类型 / 铺面规格 ================ */
const emoji = (ch) => ({ emoji: ch });

/* 商店类型：每类有自己的商品目录（图标用 emoji，果蔬店沿用图集） */
/* salesStyle：售卖方式
 * unit = 单件成交（玉石/便利店/蛋糕，逐件报价）
 * bulk = 单菜品多数量（果蔬散称，一次只挑一种、按份数买）
 * combo = 统一点单（烧烤/沙县，2-3 样合成一单，只议一次价）
 * roundStyle：统一抹零，yuan = 抹到整元，jiao = 抹到整角，none = 不抹 */
/* clearance：是否支持晚市八点清仓；烧烤现点现烤、玉石非生鲜，都不做清仓 */
const SHOP_TYPES = [
  { id: "fruit", name: "果蔬店", icon: "🥬", sign: "阿福蔬果", tagline: "散称多份 · 统一抹零", startCash: 200000, salesStyle: "bulk", roundStyle: "yuan", clearance: true },
  { id: "bbq", name: "烧烤摊", icon: "🍢", sign: "阿福烧烤", tagline: "统一点单 · 整单抹零", startCash: 220000, salesStyle: "combo", roundStyle: "yuan", clearance: false },
  { id: "cake", name: "蛋糕店", icon: "🍰", sign: "阿福烘焙", tagline: "单件零售 · 抹角", startCash: 260000, salesStyle: "unit", roundStyle: "jiao", clearance: true },
  { id: "jade", name: "玉石店", icon: "💎", sign: "阿福玉器", tagline: "单件利润高 · 客流少", startCash: 350000, salesStyle: "unit", roundStyle: "none", clearance: false },
  { id: "shaxian", name: "沙县小吃", icon: "🥟", sign: "阿福沙县", tagline: "一碗一单 · 拼单抹零", startCash: 180000, salesStyle: "combo", roundStyle: "yuan", clearance: true },
  { id: "store", name: "便利店", icon: "🏪", sign: "阿福便利店", tagline: "营业时间长 · 周转快", startCash: 240000, salesStyle: "unit", roundStyle: "jiao", clearance: true },
];

const SHOP_GOODS = {
  fruit: { categories: CATEGORIES, goods: GOODS },
  bbq: {
    categories: [
      { id: "meat", name: "肉串", icon: "🍖" },
      { id: "veg", name: "素串", icon: "🌽" },
      { id: "seafood", name: "海鲜", icon: "🦐" },
      { id: "fish", name: "烤鱼", icon: "🐟" },
      { id: "staple", name: "主食", icon: "🍜" },
      { id: "cold", name: "凉菜", icon: "🥒" },
      { id: "snack", name: "小吃", icon: "🍡" },
      { id: "drink", name: "酒水", icon: "🍺" },
    ],
    goods: [
      /* 肉串：羊肉串走量，五花肉、掌中宝是夜宵常点 */
      { id: "lamb", name: "羊肉串", cat: "肉串", unit: "串", cost: 220, base: 500, shelf: 2, cap: 120, pop: 1.5, icon: emoji("🍖") },
      { id: "beef", name: "牛肉串", cat: "肉串", unit: "串", cost: 320, base: 700, shelf: 2, cap: 100, pop: 1.3, icon: emoji("🥩") },
      { id: "pork-belly", name: "烤五花肉", cat: "肉串", unit: "串", cost: 260, base: 620, shelf: 2, cap: 100, pop: 1.4, icon: emoji("🥓") },
      { id: "wing", name: "烤翅", cat: "肉串", unit: "个", cost: 350, base: 800, shelf: 2, cap: 60, pop: 1.2, icon: emoji("🍗") },
      { id: "chicken-crisp", name: "掌中宝", cat: "肉串", unit: "串", cost: 300, base: 700, shelf: 2, cap: 60, pop: 1.1, icon: emoji("🍗") },
      { id: "chicken-heart", name: "烤鸡心", cat: "肉串", unit: "串", cost: 160, base: 420, shelf: 2, cap: 70, pop: 0.95, icon: emoji("🍢") },
      { id: "sausage", name: "烤香肠", cat: "肉串", unit: "根", cost: 150, base: 380, shelf: 3, cap: 80, pop: 1.25, icon: emoji("🌭") },
      { id: "ribs", name: "蜜汁排骨", cat: "肉串", unit: "份", cost: 420, base: 950, shelf: 2, cap: 40, pop: 1.15, icon: emoji("🍖") },
      { id: "chicken-gizzard", name: "烤鸡胗", cat: "肉串", unit: "串", cost: 180, base: 460, shelf: 2, cap: 70, pop: 1.0, icon: emoji("🍢") },
      { id: "chicken-feet", name: "烤鸡爪", cat: "肉串", unit: "个", cost: 200, base: 520, shelf: 2, cap: 50, pop: 1.05, icon: emoji("🍗") },
      { id: "lamb-kidney", name: "烤羊腰", cat: "肉串", unit: "串", cost: 280, base: 680, shelf: 2, cap: 40, pop: 0.95, icon: emoji("🍖") },
      { id: "beef-tendon", name: "牛板筋", cat: "肉串", unit: "串", cost: 260, base: 620, shelf: 2, cap: 50, pop: 1.0, icon: emoji("🥩") },
      { id: "bacon-enoki", name: "培根金针菇卷", cat: "肉串", unit: "串", cost: 240, base: 580, shelf: 2, cap: 50, pop: 1.05, icon: emoji("🥓") },
      { id: "duck-intestine", name: "烤鸭肠", cat: "肉串", unit: "串", cost: 170, base: 440, shelf: 2, cap: 50, pop: 0.9, icon: emoji("🍢") },
      { id: "chicken-skin", name: "烤鸡皮", cat: "肉串", unit: "串", cost: 140, base: 380, shelf: 2, cap: 50, pop: 0.85, icon: emoji("🍢") },
      /* 素串：解腻刚需，价格低、复购高 */
      { id: "corn", name: "烤玉米", cat: "素串", unit: "根", cost: 120, base: 350, shelf: 3, cap: 50, pop: 1.1, icon: emoji("🌽") },
      { id: "leek2", name: "烤韭菜", cat: "素串", unit: "份", cost: 100, base: 300, shelf: 2, cap: 50, pop: 0.9, icon: emoji("🥬") },
      { id: "tofu", name: "烤豆腐", cat: "素串", unit: "份", cost: 90, base: 280, shelf: 2, cap: 50, pop: 0.95, icon: emoji("🧈") },
      { id: "eggplant", name: "烤茄子", cat: "素串", unit: "个", cost: 160, base: 450, shelf: 2, cap: 40, pop: 1.1, icon: emoji("🍆") },
      { id: "mushroom-skewer", name: "烤香菇", cat: "素串", unit: "串", cost: 110, base: 320, shelf: 2, cap: 60, pop: 1.0, icon: emoji("🍄") },
      { id: "enoki", name: "烤金针菇", cat: "素串", unit: "份", cost: 90, base: 290, shelf: 2, cap: 60, pop: 1.05, icon: emoji("🍄") },
      { id: "potato-slice", name: "烤土豆片", cat: "素串", unit: "串", cost: 80, base: 260, shelf: 2, cap: 60, pop: 1.05, icon: emoji("🥔") },
      { id: "pepper", name: "烤青椒", cat: "素串", unit: "串", cost: 90, base: 300, shelf: 2, cap: 50, pop: 0.85, icon: emoji("🌶️") },
      { id: "lotus-slice", name: "烤藕片", cat: "素串", unit: "串", cost: 110, base: 300, shelf: 2, cap: 50, pop: 0.85, icon: emoji("🍥") },
      { id: "cauliflower", name: "烤花菜", cat: "素串", unit: "份", cost: 100, base: 290, shelf: 2, cap: 50, pop: 0.9, icon: emoji("🥦") },
      { id: "okra-skewer", name: "烤秋葵", cat: "素串", unit: "串", cost: 160, base: 430, shelf: 2, cap: 40, pop: 0.7, icon: emoji("🌿") },
      { id: "gluten", name: "烤面筋", cat: "素串", unit: "串", cost: 120, base: 340, shelf: 2, cap: 60, pop: 1.15, icon: emoji("🍡") },
      { id: "garlic-skewer", name: "烤大蒜", cat: "素串", unit: "串", cost: 70, base: 220, shelf: 3, cap: 50, pop: 0.8, icon: emoji("🧄") },
      { id: "baby-napa-skewer", name: "烤娃娃菜", cat: "素串", unit: "份", cost: 100, base: 300, shelf: 2, cap: 40, pop: 0.85, icon: emoji("🥬") },
      /* 海鲜：雨天渔船不出海，售价上浮 25% */
      { id: "shrimp", name: "烤虾", cat: "海鲜", unit: "串", cost: 400, base: 900, shelf: 2, cap: 40, pop: 1.0, icon: emoji("🦐") },
      { id: "oyster", name: "烤生蚝", cat: "海鲜", unit: "个", cost: 300, base: 700, shelf: 2, cap: 30, pop: 1.1, icon: emoji("🦪") },
      { id: "squid", name: "烤鱿鱼", cat: "海鲜", unit: "串", cost: 450, base: 1000, shelf: 2, cap: 40, pop: 1.35, icon: emoji("🦑") },
      { id: "scallop", name: "蒜蓉扇贝", cat: "海鲜", unit: "个", cost: 350, base: 800, shelf: 2, cap: 35, pop: 1.05, icon: emoji("🐚") },
      { id: "saury", name: "烤秋刀鱼", cat: "海鲜", unit: "条", cost: 380, base: 850, shelf: 2, cap: 30, pop: 0.9, icon: emoji("🐟") },
      { id: "clam", name: "辣炒花蛤", cat: "海鲜", unit: "份", cost: 280, base: 680, shelf: 2, cap: 40, pop: 1.1, icon: emoji("🐚") },
      { id: "smelt", name: "烤多春鱼", cat: "海鲜", unit: "条", cost: 300, base: 720, shelf: 2, cap: 40, pop: 0.9, icon: emoji("🐟") },
      { id: "razor-clam", name: "烤蛏子", cat: "海鲜", unit: "份", cost: 320, base: 760, shelf: 2, cap: 30, pop: 0.9, icon: emoji("🦪") },
      { id: "scallop-shell", name: "烤带子", cat: "海鲜", unit: "个", cost: 380, base: 880, shelf: 2, cap: 30, pop: 0.95, icon: emoji("🐚") },
      /* 烤鱼：一桌一条，客单价最高的大菜 */
      { id: "spicy-fish", name: "麻辣烤鱼", cat: "烤鱼", unit: "份", cost: 1800, base: 3800, shelf: 1, cap: 15, pop: 1.3, icon: emoji("🐟") },
      { id: "garlic-fish", name: "蒜香烤鱼", cat: "烤鱼", unit: "份", cost: 1900, base: 4000, shelf: 1, cap: 15, pop: 1.2, icon: emoji("🐟") },
      { id: "paper-fish", name: "纸包鱼", cat: "烤鱼", unit: "份", cost: 2100, base: 4400, shelf: 1, cap: 12, pop: 1.1, icon: emoji("🐠") },
      { id: "grilled-bass", name: "烤鲈鱼", cat: "烤鱼", unit: "条", cost: 2200, base: 4600, shelf: 1, cap: 12, pop: 1.0, icon: emoji("🐟") },
      /* 主食：垫肚子、拉高连带率 */
      { id: "cold-noodle", name: "烤冷面", cat: "主食", unit: "份", cost: 250, base: 650, shelf: 2, cap: 40, pop: 1.3, icon: emoji("🍜") },
      { id: "grill-rice", name: "铁板炒饭", cat: "主食", unit: "份", cost: 300, base: 750, shelf: 1, cap: 50, pop: 1.15, icon: emoji("🍚") },
      { id: "bun-slice", name: "烤馒头片", cat: "主食", unit: "串", cost: 60, base: 220, shelf: 3, cap: 60, pop: 1.1, icon: emoji("🍞") },
      { id: "grilled-pancake", name: "烤饼", cat: "主食", unit: "个", cost: 100, base: 260, shelf: 2, cap: 50, pop: 1.0, icon: emoji("🫓") },
      { id: "fried-noodle", name: "炒面", cat: "主食", unit: "份", cost: 320, base: 780, shelf: 1, cap: 40, pop: 1.15, icon: emoji("🍝") },
      { id: "dough-drop-soup", name: "疙瘩汤", cat: "主食", unit: "碗", cost: 260, base: 620, shelf: 1, cap: 30, pop: 0.95, icon: emoji("🍲") },
      /* 凉菜：等串时的下酒小碟，出餐快、毛利高 */
      { id: "cucumber-salad", name: "拍黄瓜", cat: "凉菜", unit: "份", cost: 120, base: 320, shelf: 1, cap: 40, pop: 1.25, icon: emoji("🥒") },
      { id: "boiled-edamame", name: "煮毛豆", cat: "凉菜", unit: "份", cost: 150, base: 380, shelf: 1, cap: 40, pop: 1.2, icon: emoji("🌿") },
      { id: "peanuts", name: "油炸花生米", cat: "凉菜", unit: "碟", cost: 120, base: 300, shelf: 2, cap: 40, pop: 1.1, icon: emoji("🥜") },
      { id: "wood-ear-salad", name: "凉拌木耳", cat: "凉菜", unit: "份", cost: 160, base: 380, shelf: 1, cap: 30, pop: 0.9, icon: emoji("🍄") },
      { id: "century-egg-tofu", name: "皮蛋豆腐", cat: "凉菜", unit: "份", cost: 180, base: 420, shelf: 1, cap: 30, pop: 0.95, icon: emoji("🥚") },
      { id: "three-shreds", name: "凉拌三丝", cat: "凉菜", unit: "份", cost: 150, base: 360, shelf: 1, cap: 30, pop: 0.85, icon: emoji("🥗") },
      /* 小吃：甜口收尾与等位零嘴 */
      { id: "condensed-bun", name: "炼乳小馒头", cat: "小吃", unit: "份", cost: 120, base: 320, shelf: 2, cap: 40, pop: 1.1, icon: emoji("🍞") },
      { id: "grilled-marshmallow", name: "烤棉花糖", cat: "小吃", unit: "串", cost: 100, base: 280, shelf: 2, cap: 40, pop: 0.85, icon: emoji("🍡") },
      { id: "ice-jelly", name: "红糖冰粉", cat: "小吃", unit: "碗", cost: 140, base: 360, shelf: 1, cap: 30, pop: 1.15, icon: emoji("🍧") },
      { id: "tomato-sugar", name: "糖拌西红柿", cat: "小吃", unit: "份", cost: 120, base: 300, shelf: 1, cap: 30, pop: 0.9, icon: emoji("🍅") },
      { id: "grilled-rice-cake", name: "烤年糕", cat: "小吃", unit: "串", cost: 130, base: 340, shelf: 2, cap: 40, pop: 1.0, icon: emoji("🍡") },
      /* 酒水：夜宵毛利担当，保质期长、不易腐损 */
      { id: "beer", name: "冰啤酒", cat: "酒水", unit: "瓶", cost: 260, base: 600, shelf: 7, cap: 60, pop: 1.2, icon: emoji("🍺") },
      { id: "draft-beer", name: "扎啤", cat: "酒水", unit: "扎", cost: 300, base: 700, shelf: 3, cap: 60, pop: 1.25, icon: emoji("🍻") },
      { id: "soda", name: "汽水", cat: "酒水", unit: "瓶", cost: 180, base: 400, shelf: 7, cap: 60, pop: 1.0, icon: emoji("🥤") },
      { id: "cola", name: "冰可乐", cat: "酒水", unit: "瓶", cost: 200, base: 450, shelf: 7, cap: 60, pop: 1.1, icon: emoji("🥤") },
      { id: "plum-drink", name: "酸梅汤", cat: "酒水", unit: "杯", cost: 150, base: 400, shelf: 5, cap: 60, pop: 1.0, icon: emoji("🧃") },
      { id: "craft-beer", name: "精酿啤酒", cat: "酒水", unit: "瓶", cost: 400, base: 900, shelf: 7, cap: 40, pop: 1.05, icon: emoji("🍺") },
      { id: "wusu", name: "乌苏啤酒", cat: "酒水", unit: "瓶", cost: 320, base: 720, shelf: 7, cap: 50, pop: 1.15, icon: emoji("🍻") },
      { id: "water", name: "矿泉水", cat: "酒水", unit: "瓶", cost: 100, base: 250, shelf: 10, cap: 60, pop: 0.8, icon: emoji("💧") },
      { id: "beibingyang", name: "北冰洋", cat: "酒水", unit: "瓶", cost: 220, base: 500, shelf: 7, cap: 50, pop: 0.95, icon: emoji("🥤") },
    ],
  },
  cake: {
    categories: [
      { id: "bread", name: "面包", icon: "🍞" },
      { id: "cake2", name: "蛋糕", icon: "🍰" },
      { id: "dessert", name: "甜点", icon: "🍮" },
      { id: "drink", name: "饮品", icon: "☕" },
    ],
    goods: [
      { id: "toast", name: "吐司", cat: "面包", unit: "袋", cost: 380, base: 800, shelf: 3, cap: 40, pop: 1.3, icon: emoji("🍞") },
      { id: "croissant", name: "牛角包", cat: "面包", unit: "个", cost: 320, base: 750, shelf: 3, cap: 50, pop: 1.2, icon: emoji("🥐") },
      { id: "bagel", name: "贝果", cat: "面包", unit: "个", cost: 300, base: 700, shelf: 3, cap: 40, pop: 1.0, icon: emoji("🥯") },
      { id: "butter-bread", name: "黄油餐包", cat: "面包", unit: "袋", cost: 260, base: 600, shelf: 3, cap: 40, pop: 1.1, icon: emoji("🥖") },
      { id: "cream-cake", name: "奶油蛋糕", cat: "蛋糕", unit: "个", cost: 1200, base: 2800, shelf: 2, cap: 15, pop: 1.3, icon: emoji("🍰") },
      { id: "cheesecake", name: "芝士蛋糕", cat: "蛋糕", unit: "块", cost: 800, base: 1800, shelf: 2, cap: 20, pop: 1.2, icon: emoji("🍰") },
      { id: "mousse", name: "慕斯", cat: "甜点", unit: "杯", cost: 500, base: 1200, shelf: 2, cap: 30, pop: 1.1, icon: emoji("🍮") },
      { id: "cookie", name: "曲奇", cat: "甜点", unit: "盒", cost: 450, base: 1100, shelf: 5, cap: 40, pop: 1.0, icon: emoji("🍪") },
      { id: "macaron", name: "马卡龙", cat: "甜点", unit: "盒", cost: 900, base: 2200, shelf: 3, cap: 20, pop: 0.9, icon: emoji("🌈") },
      { id: "coffee", name: "拿铁", cat: "饮品", unit: "杯", cost: 350, base: 900, shelf: 1, cap: 60, pop: 1.3, icon: emoji("☕") },
      { id: "milk-tea", name: "奶茶", cat: "饮品", unit: "杯", cost: 280, base: 750, shelf: 1, cap: 60, pop: 1.2, icon: emoji("🧋") },
    ],
  },
  jade: {
    categories: [
      { id: "pendant", name: "吊坠", icon: "📿" },
      { id: "bracelet", name: "手镯", icon: "⭕" },
      { id: "ornament", name: "摆件", icon: "🐉" },
    ],
    goods: [
      { id: "peace-buckle", name: "平安扣", cat: "吊坠", unit: "件", cost: 12000, base: 26000, shelf: 30, cap: 20, pop: 1.3, icon: emoji("📿") },
      { id: "buddha", name: "玉佛", cat: "吊坠", unit: "件", cost: 18000, base: 42000, shelf: 30, cap: 15, pop: 1.1, icon: emoji("🧘") },
      { id: "guanyin", name: "观音牌", cat: "吊坠", unit: "件", cost: 22000, base: 52000, shelf: 30, cap: 12, pop: 1.0, icon: emoji("🙏") },
      { id: "leaf-jade", name: "玉叶", cat: "吊坠", unit: "件", cost: 8000, base: 18000, shelf: 30, cap: 20, pop: 1.0, icon: emoji("🍃") },
      { id: "jade-bangle", name: "玉手镯", cat: "手镯", unit: "只", cost: 30000, base: 88000, shelf: 30, cap: 10, pop: 1.2, icon: emoji("⭕") },
      { id: "bead-string", name: "珠串", cat: "手镯", unit: "串", cost: 9000, base: 22000, shelf: 30, cap: 25, pop: 1.1, icon: emoji("🧿") },
      { id: "pi-xiu", name: "貔貅", cat: "摆件", unit: "件", cost: 25000, base: 68000, shelf: 30, cap: 8, pop: 0.9, icon: emoji("🦁") },
      { id: "ruyi", name: "如意", cat: "摆件", unit: "件", cost: 35000, base: 98000, shelf: 30, cap: 6, pop: 0.8, icon: emoji("✨") },
    ],
  },
  shaxian: {
    categories: [
      { id: "main", name: "主食", icon: "🍜" },
      { id: "side", name: "小菜", icon: "🥟" },
      { id: "soup", name: "炖汤", icon: "🍲" },
      { id: "drink", name: "饮料", icon: "🧃" },
    ],
    goods: [
      { id: "noodle", name: "拌面", cat: "主食", unit: "碗", cost: 280, base: 600, shelf: 1, cap: 100, pop: 1.4, icon: emoji("🍜") },
      { id: "wonton", name: "扁肉", cat: "主食", unit: "碗", cost: 300, base: 650, shelf: 1, cap: 100, pop: 1.2, icon: emoji("🥟") },
      { id: "rice", name: "蒸饺饭", cat: "主食", unit: "份", cost: 350, base: 800, shelf: 1, cap: 80, pop: 1.0, icon: emoji("🍚") },
      { id: "fried-rice", name: "炒饭", cat: "主食", unit: "份", cost: 320, base: 750, shelf: 1, cap: 80, pop: 1.1, icon: emoji("🍛") },
      { id: "duck-leg", name: "卤鸭腿", cat: "小菜", unit: "个", cost: 400, base: 900, shelf: 2, cap: 40, pop: 1.2, icon: emoji("🍗") },
      { id: "tofu2", name: "卤豆干", cat: "小菜", unit: "份", cost: 150, base: 350, shelf: 2, cap: 50, pop: 1.0, icon: emoji("🧈") },
      { id: "egg2", name: "卤蛋", cat: "小菜", unit: "个", cost: 100, base: 250, shelf: 2, cap: 60, pop: 1.2, icon: emoji("🥚") },
      { id: "rib-soup", name: "排骨汤", cat: "炖汤", unit: "盅", cost: 420, base: 950, shelf: 1, cap: 50, pop: 1.2, icon: emoji("🍲") },
      { id: "duck-soup", name: "老鸭汤", cat: "炖汤", unit: "盅", cost: 500, base: 1100, shelf: 1, cap: 40, pop: 1.0, icon: emoji("🦆") },
      { id: "plum-juice", name: "酸梅汤", cat: "饮料", unit: "杯", cost: 120, base: 300, shelf: 2, cap: 60, pop: 1.1, icon: emoji("🧃") },
      { id: "tea", name: "凉茶", cat: "饮料", unit: "瓶", cost: 150, base: 350, shelf: 3, cap: 60, pop: 0.9, icon: emoji("🍵") },
    ],
  },
  store: {
    categories: [
      { id: "snack", name: "零食", icon: "🍫" },
      { id: "drink", name: "饮料", icon: "🥤" },
      { id: "daily", name: "日用品", icon: "🧻" },
    ],
    goods: [
      { id: "chips", name: "薯片", cat: "零食", unit: "包", cost: 320, base: 550, shelf: 20, cap: 80, pop: 1.3, icon: emoji("🍟") },
      { id: "chocolate", name: "巧克力", cat: "零食", unit: "盒", cost: 600, base: 1100, shelf: 20, cap: 50, pop: 1.1, icon: emoji("🍫") },
      { id: "candy", name: "糖果", cat: "零食", unit: "袋", cost: 280, base: 500, shelf: 20, cap: 60, pop: 1.0, icon: emoji("🍬") },
      { id: "instant-noodle", name: "方便面", cat: "零食", unit: "桶", cost: 300, base: 550, shelf: 20, cap: 80, pop: 1.3, icon: emoji("🍜") },
      { id: "cola", name: "可乐", cat: "饮料", unit: "瓶", cost: 180, base: 350, shelf: 20, cap: 100, pop: 1.4, icon: emoji("🥤") },
      { id: "water", name: "矿泉水", cat: "饮料", unit: "瓶", cost: 80, base: 200, shelf: 20, cap: 120, pop: 1.4, icon: emoji("💧") },
      { id: "energy", name: "功能饮料", cat: "饮料", unit: "罐", cost: 320, base: 600, shelf: 20, cap: 50, pop: 1.0, icon: emoji("⚡") },
      { id: "tissue", name: "抽纸", cat: "日用品", unit: "包", cost: 260, base: 500, shelf: 30, cap: 50, pop: 1.1, icon: emoji("🧻") },
      { id: "toothpaste", name: "牙膏", cat: "日用品", unit: "支", cost: 400, base: 800, shelf: 30, cap: 40, pop: 0.9, icon: emoji("🪥") },
      { id: "battery", name: "电池", cat: "日用品", unit: "板", cost: 350, base: 700, shelf: 30, cap: 40, pop: 0.9, icon: emoji("🔋") },
    ],
  },
};

/* 菜品分级：同一品类内按进价从低到高分为三级，约 50% 基础、30% 进阶、20% 精品。
 * 解锁门槛由 app.js 的 GOOD_TIERS 决定（经营天数 + 累计净利）。 */
function assignGoodTiers(catalog) {
  const byCat = {};
  catalog.goods.forEach((goods) => {
    (byCat[goods.cat] = byCat[goods.cat] || []).push(goods);
  });
  Object.values(byCat).forEach((items) => {
    items.slice().sort((a, b) => a.cost - b.cost).forEach((goods, index) => {
      const pct = (index + 0.5) / items.length;
      goods.tier = pct <= 0.5 ? 1 : pct <= 0.8 ? 2 : 3;
    });
  });
}
Object.values(SHOP_GOODS).forEach(assignGoodTiers);

/* 铺面规格：决定容量、租金与员工上限 */
const SHOP_SIZES = [
  { id: "stall", name: "摆摊", icon: "🧺", rentMult: 0, capMult: 0.35, staffCap: 1, desc: "推车地摊，免租金，货量小，最多 1 名帮手" },
  { id: "small", name: "小门面", icon: "🏪", rentMult: 1, capMult: 1, staffCap: 2, desc: "标准小铺，起步首选" },
  { id: "large", name: "大门店", icon: "🏬", rentMult: 2.2, capMult: 2.2, staffCap: 4, desc: "宽敞大店，容量翻倍，能请更多人" },
  { id: "floor", name: "一整层", icon: "🏢", rentMult: 5, capMult: 5, staffCap: 8, desc: "整层物业，容量巨大，适合做总部" },
];
