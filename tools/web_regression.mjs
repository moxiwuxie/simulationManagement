#!/usr/bin/env node
/* Web 端浏览器回归（零依赖）
 *
 * 前置：
 *   1. 静态服务：python3 -m http.server 8787
 *   2. Chrome：   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/shop-chrome
 *
 * 运行：
 *   node tools/web_regression.mjs
 *   node tools/web_regression.mjs --url http://127.0.0.1:8787/web/ --cdp http://127.0.0.1:9222
 *
 * 覆盖：启动、阶段门禁、货架数值、进货额度、物流与在途、阶段资产口径、
 *       温柔建议跨天、阶段升级结算提示、存档字段、手机/桌面横向溢出。
 */
import process from "node:process";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const PAGE_URL = readArg("--url", "http://127.0.0.1:8787/web/");
const CDP_URL = readArg("--cdp", "http://127.0.0.1:9222");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openTarget() {
  const list = await (await fetch(`${CDP_URL}/json`)).json();
  const existing = list.find((item) => item.type === "page" && item.url.includes("127.0.0.1:8787"));
  if (existing) return existing;
  try {
    const created = await fetch(`${CDP_URL}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: "PUT" });
    if (created.ok) return created.json();
  } catch (err) {
    /* 旧版 Chrome 只支持 GET，下方回退 */
  }
  const created = await fetch(`${CDP_URL}/json/new?${encodeURIComponent(PAGE_URL)}`);
  return created.json();
}

async function main() {
  const target = await openTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      return { __error: result.exceptionDetails.exception?.description || result.exceptionDetails.text };
    }
    return result.result.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  await evaluate("localStorage.clear(); location.reload(); true");
  await sleep(2800);

  const data = await evaluate(`
    (() => {
      const checks = {};
      /* 启动即捕获基线：初始资金配置与换代清理标记 */
      checks.startCash = {
        configured: SHOP_TYPES.find((type) => type.id === "fruit")?.startCash,
        baseWealth: state.baseWealth,
        marker: localStorage.getItem("shop.dataGen.v1"),
      };
      state.suppressSave = true;
      setCatalog("fruit");
      state.shopType = "fruit";
      state.size = "stall";
      state.location = LOCATIONS[0];
      state.cash = 500000;
      state.baseWealth = 500000;
      state.booted = true;
      state.phase = "prep";
      state.staff = [];
      state.branches = [];
      state.weather = { name: "晴" };
      state.supplier = "street";
      state.premiumUnlocked = undefined;

      checks.boot = typeof state === "object" && typeof startDay === "function" && GOODS.length > 0;

      /* 1. 阶段门禁：阶段 2 分店锁定，阶段 3 解锁 */
      state.stageReached = 2;
      state.history = [1, 2, 3, 4].map((day) => ({ day, revenue: 90000, profit: 30000, sales: 10 }));
      state.backView = "branch";
      state.phase = "prep";
      openBackstage();
      renderBackstage();
      const openBtn = els.branchPanel.querySelector("[data-openbranch]");
      checks.branchLockedAtStage2 = {
        note: (els.branchPanel.querySelector(".strategy-note")?.textContent || "").includes("精品生鲜"),
        openDisabled: !!openBtn?.disabled,
        formDisabled: !!els.branchPanel.querySelector("#branchTypes button")?.disabled,
      };
      state.stageReached = 3;
      renderBackstage();
      const openBtn3 = els.branchPanel.querySelector("[data-openbranch]");
      checks.branchUnlockedAtStage3 = {
        note: !(els.branchPanel.querySelector(".strategy-note")?.textContent || "").includes("精品生鲜"),
        openEnabled: !openBtn3?.disabled,
      };

      /* 2. 货架：容量与台面损耗 */
      state.stageReached = 4;
      state.shelfTier = "wood";
      const capWood = capOf(GOODS[0]);
      const decayWood = storageDecayMult("shelf");
      state.shelfTier = "premium";
      const capPremium = capOf(GOODS[0]);
      state.shelfTier = "cold";
      const capCold = capOf(GOODS[0]);
      const decayCold = storageDecayMult("shelf");
      const decayBackroom = storageDecayMult("backroom");
      checks.shelf = {
        wood: capWood,
        premium: capPremium,
        cold: capCold,
        premiumUp: capPremium > capWood,
        coldUp: capCold > capPremium,
        coldDecayLower: decayCold < decayWood,
        backroomUntouched: decayBackroom !== decayCold,
      };
      checks.shelfSpec = SHELF_TIERS.map((tier) => ({
        id: tier.id, capMult: tier.capMult, sellMult: tier.sellMult, decayMult: tier.decayMult, stage: tier.stage,
      }));
      checks.stageSpec = STAGES.map((stage) => ({
        id: stage.id, sizes: stage.sizes.length, shopTypes: stage.shopTypes.length, req: stage.req,
      }));

      /* 3. 每日额度：渠道系数与已用额度 */
      state.supplier = "street";
      state.supplyQuota = { [GOODS[0].id]: 100 };
      state.supplyUsed = {};
      const streetQuota = supplyQuotaOf(GOODS[0].id);
      state.supplyUsed = { [GOODS[0].id]: 100 };
      const streetLeft = supplyLeftOf(GOODS[0].id);
      state.supplier = "cold";
      const coldQuota = supplyQuotaOf(GOODS[0].id);
      const coldLeft = supplyLeftOf(GOODS[0].id);
      checks.quota = {
        streetQuota,
        coldQuota,
        streetLeft,
        coldLeft,
        streetBoost: streetQuota > coldQuota,
        usedCapped: streetLeft === streetQuota - 100,
      };

      /* 4. 物流延迟与在途资产 */
      state.weather = { name: "晴" };
      state.supplier = "market";
      const delay30 = shippingDelayMs(30);
      const delay60 = shippingDelayMs(60);
      state.weather = { name: "暴雨" };
      const delayRain = shippingDelayMs(30);
      state.weather = { name: "晴" };
      state.supplier = "cold";
      const delayCold = shippingDelayMs(30);
      state.supplier = "market";
      const before = bookValue();
      state.shipments = [{ gid: GOODS[0].id, qty: 10, cost: 100, eta: Date.now() + 60000 }];
      const after = bookValue();
      state.shipments = [];
      checks.logistics = {
        delay30,
        delay60,
        delayRain,
        delayCold,
        bulkSlower: delay60 > delay30,
        rainSlower: delayRain > delay30,
        coldFaster: delayCold < delay30,
        transitInBookValue: after - before === 1000,
      };

      /* 5. 阶段资产口径：分店估值计入总资产 */
      state.cash = 100000;
      state.stageReached = 1;
      state.branches = [{ value: 50000 }];
      const withBranch = stageStats().asset;
      state.branches = [];
      const withoutBranch = stageStats().asset;
      checks.stageAsset = { withBranch, withoutBranch, counted: withBranch - withoutBranch === 50000 };

      /* 6. 小店日常：里程碑与跨天建议 */
      state.history = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, profit: 20000, revenue: 80000, sales: 8 }));
      state.settlement = null;
      state.lastSettlement = { profit: 20000, spoilRate: 0.1, stockouts: 1, revenue: 80000 };
      state.settlement = null;
      state.backView = "growth";
      renderBackstage();
      checks.gentle = {
        chips: els.growthPanel.querySelectorAll(".milestone-chip").length,
        chipsOn: els.growthPanel.querySelectorAll(".milestone-chip.on").length,
        hasDaily: els.growthPanel.textContent.includes("小店日常"),
        carryAdvice: els.growthPanel.textContent.includes("损耗"),
        noAds: !els.growthPanel.textContent.includes("广告与内购"),
        noRank: !els.growthPanel.textContent.includes("排行榜"),
      };

      /* 7. 分店切换后的配置与数据 */
      state.branches = [{
        id: 999, typeId: "fruit", typeName: "果蔬店", typeIcon: "🥬",
        locId: LOCATIONS[0].id, locName: LOCATIONS[0].name, sizeId: "stall", sizeName: "摆摊",
        rent: 0, invested: 200000, value: 200000, valueDelta: 0, valueHistory: [200000],
        volatility: 1, staff: [], policy: "standard",
        daily: { day: 3, revenue: 50000, profit: 8000, traffic: 20, units: 30, cogs: 30000, spoilage: 1000, wages: 0, rent: 0 },
        history: [
          { day: 2, revenue: 40000, profit: 5000, traffic: 18, units: 25, value: 190000 },
          { day: 3, revenue: 50000, profit: 8000, traffic: 20, units: 30, value: 200000 },
        ],
        level: 0, paused: false, name: "", openedDay: 1, profitTotal: 13000,
      }];
      state.activeBranchId = 999;
      state.backView = "branch";
      state.phase = "prep";
      renderBackstage();
      checks.branchConsole = {
        focused: !!els.branchPanel.querySelector(".branch-console"),
        bars: els.branchPanel.querySelectorAll(".branch-trend i").length,
        stats: els.branchPanel.querySelectorAll(".branch-stats span").length,
        hasRename: !!els.branchPanel.querySelector("button[data-brename]"),
        hasUpgrade: !!els.branchPanel.querySelector("button[data-bupgrade]"),
        hasPause: !!els.branchPanel.querySelector("button[data-bpause]"),
        hasPrice: !!els.branchPanel.querySelector("button[data-bprice]"),
      };

      /* 未选中的分店保持紧凑，只保留切换入口 */
      const twin = { ...state.branches[0], id: 1000, name: "二号店", daily: null, history: [], value: 180000 };
      state.branches.push(twin);
      renderBackstage();
      checks.branchCompact = {
        consoles: els.branchPanel.querySelectorAll(".branch-console").length,
        quickButtons: els.branchPanel.querySelectorAll(".branch-quick [data-bfocus]").length,
      };
      state.branches = [state.branches[0]];

      const promptBackup = window.prompt;
      window.prompt = () => "测试分店";
      renameBranch(999);
      window.prompt = promptBackup;
      const cashBeforeUpgrade = state.cash;
      const valueBeforeUpgrade = state.branches[0].value;
      upgradeBranch(999);
      const branch = state.branches[0];
      checks.branchManage = {
        renamed: branch.name,
        level: branch.level,
        investedUp: branch.invested > 200000,
        valueUp: branch.value > valueBeforeUpgrade,
        cashDown: state.cash < cashBeforeUpgrade,
      };

      state.cash = 100000;
      state.day = 4;
      toggleBranchPause(999);
      settleBranches();
      const pausedBranch = state.branches[0];
      checks.branchPaused = {
        paused: pausedBranch.paused,
        dailyPaused: !!pausedBranch.daily?.paused,
        wages: pausedBranch.daily?.wages,
        historyAdded: pausedBranch.history.length === 3,
      };
      state.branches = [];
      state.activeBranchId = null;
      state.cash = 500000;
      state.baseWealth = 500000;

      /* 8. 分店招人预付工资：前 3 天不重复计薪，离职退还未用部分 */
      state.branches = [{
        id: 777, typeId: "fruit", typeName: "果蔬店", typeIcon: "🥬",
        locId: LOCATIONS[0].id, locName: LOCATIONS[0].name, sizeId: "small", sizeName: "小门面",
        rent: 5000, invested: 150000, value: 150000, valueDelta: 0, valueHistory: [150000],
        volatility: 1, staff: [], policy: "standard",
        daily: null, history: [], level: 0, paused: false, name: "", openedDay: 1, profitTotal: 0,
      }];
      const cashBeforeHire = state.cash;
      hireBranchStaff(777, "cashier");
      const hiredPrepaid = state.branches[0].staff[0].prepaid;
      const cashAfterHire = state.cash;
      const hireDeposit = STAFF_ROLE_INDEX.cashier.wage * 3;
      settleBranches();
      const afterOneDay = state.branches[0].staff[0];
      checks.branchPrepaid = {
        prepaid: hiredPrepaid,
        cashDown: cashAfterHire === cashBeforeHire - hireDeposit,
        prepaidConsumed: afterOneDay.prepaid === 2,
        wagesZero: state.branches[0].daily.wages === 0,
      };
      const cashBeforeFire = state.cash;
      fireBranchStaff(777, 0);
      checks.branchFireRefund = {
        staffGone: state.branches[0].staff.length === 0,
        refund: state.cash === cashBeforeFire + STAFF_ROLE_INDEX.cashier.wage * 2,
      };
      state.branches = [];
      state.cash = 500000;
      state.baseWealth = 500000;

      /* 8.5 分店定价策略：调价与客流反向联动，影响日营收 */
      state.branches = [{
        id: 888, typeId: "fruit", typeName: "果蔬店", typeIcon: "🥬",
        locId: LOCATIONS[0].id, locName: LOCATIONS[0].name, sizeId: "small", sizeName: "小门面",
        rent: 5000, invested: 150000, value: 150000, valueDelta: 0, valueHistory: [150000],
        volatility: 1, staff: [], policy: "standard", priceStrategy: "market",
        daily: null, history: [], level: 0, paused: false, name: "", openedDay: 1, profitTotal: 0,
      }];
      state.day = 5;
      setBranchPrice(888, "premium");
      settleBranches();
      const premiumDaily = { ...state.branches[0].daily };
      setBranchPrice(888, "thin");
      settleBranches();
      const thinDaily = { ...state.branches[0].daily };
      checks.branchPrice = {
        strategy: state.branches[0].priceStrategy,
        unitsDiffer: premiumDaily.units !== thinDaily.units,
        revenueDiffer: premiumDaily.revenue !== thinDaily.revenue,
        thinMoreUnits: thinDaily.units > premiumDaily.units,
      };
      state.branches = [];
      state.cash = 500000;
      state.baseWealth = 500000;

      /* 9. 阶段升级：结算页提示与存档字段 */
      state.suppressSave = true;
      state.day = 4;
      state.phase = "prep";
      state.stageReached = 1;
      state.stageUp = null;
      state.branches = [];
      state.staff = [];
      state.cash = 500000;
      state.baseWealth = 500000;
      state.reputation = 3.6;
      state.history = [1, 2, 3].map((day) => ({ day, revenue: 90000, profit: 60000, sales: 10 }));
      state.size = "stall";
      setCatalog("fruit");
      startDay();
      settleDay();
      const banner = els.settleNumbers.querySelector(".settle-stageup");
      state.suppressSave = false;
      saveGame();
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(saveKey()) || "{}"); } catch (err) {}
      const legacy = ["adQuota", "adBonus", "adFresh", "adShield", "perks"].filter((key) => key in saved);
      checks.stageUp = {
        name: state.stageUp?.name || "",
        reached: state.stageReached,
        banner: !!banner,
        bannerText: banner ? banner.textContent.replace(/\\s+/g, " ").trim() : "",
        savedStage: saved.stageReached,
        legacyFields: legacy,
      };

      /* 8. 主档损坏时回退到备份 */
      const key = saveKey();
      localStorage.setItem(key + ":bak", localStorage.getItem(key) || "{}");
      localStorage.setItem(key, "{broken");
      const recovered = loadGame();
      checks.backup = { recovered, day: state.day, cash: state.cash };

      /* 9. 账号与游客存档严格隔离：账号档缺失时不得回退到游客档 */
      const guestKey = SAVE_KEY_BASE;
      const guestSave = JSON.parse(localStorage.getItem(key + ":bak") || "{}");
      guestSave.day = 77;
      localStorage.setItem(guestKey, JSON.stringify(guestSave));
      const dayBeforeSwitch = state.day;
      state.userId = "alice";
      const accountKey = saveKey();
      const accountLoaded = loadGame();
      const dayAfterSwitch = state.day;
      checks.isolation = {
        namespace: accountKey === SAVE_KEY_BASE + ":alice",
        accountLoaded,
        dayBeforeSwitch,
        dayAfterSwitch,
        guestDay: 77,
      };
      state.userId = null;
      localStorage.removeItem(SAVE_KEY_BASE + ":alice");

      /* 10. 重置必须同时清掉主档与回退档 */
      const resetKey = saveKey();
      localStorage.setItem(resetKey, "{}");
      localStorage.setItem(resetKey + ":bak", "{}");
      clearCurrentSave();
      checks.resetClear = {
        main: localStorage.getItem(resetKey) === null,
        backup: localStorage.getItem(resetKey + ":bak") === null,
      };

      /* 10.5 后台清理能力：命中存档/账号键，保留音频偏好，个人界面无入口 */
      const wipeKey = SAVE_KEY_BASE + ":qa";
      localStorage.setItem(wipeKey, "{}");
      localStorage.setItem(wipeKey + ":bak", "{}");
      localStorage.setItem(USER_KEY, "{}");
      localStorage.setItem("shop.audio.v1", "keep");
      const wipeKeys = accountStorageKeys();
      checks.wipeAll = {
        noEntry: !document.getElementById("authWipeAllBtn"),
        hasApi: typeof wipeAllAccountData === "function",
        hasSave: wipeKeys.includes(wipeKey),
        hasBackup: wipeKeys.includes(wipeKey + ":bak"),
        hasUsers: wipeKeys.includes(USER_KEY),
        keepsAudio: !wipeKeys.includes("shop.audio.v1"),
      };
      localStorage.removeItem(wipeKey);
      localStorage.removeItem(wipeKey + ":bak");
      localStorage.removeItem("shop.audio.v1");

      /* 10.6 换代清理：旧标记下清空账号与存档，保留音频偏好并写入新标记 */
      const genKey = "shop.dataGen.v1";
      localStorage.setItem(genKey, "1");
      localStorage.setItem(SAVE_KEY_BASE + ":old", "{}");
      localStorage.setItem(USER_KEY, "{}");
      localStorage.setItem("shop.audio.v1", "keep");
      const purged = purgeStaleAccountData();
      checks.purgeGen = {
        purged,
        saveGone: localStorage.getItem(SAVE_KEY_BASE + ":old") === null,
        usersGone: localStorage.getItem(USER_KEY) === null,
        marker: localStorage.getItem(genKey),
        keepsAudio: localStorage.getItem("shop.audio.v1") === "keep",
      };
      localStorage.removeItem("shop.audio.v1");

      /* 11. 账号档案只反映当前存档，不混入上一局 */
      const users = readUsers();
      users.tester = {
        id: "tester", name: "测试", pass: "x", createdAt: 1, lastLogin: 1,
        totals: { days: 99, bestProfit: 9999999, profit: 8888888, achievements: 9 },
      };
      writeUsers(users);
      state.userId = "tester";
      state.day = 6;
      state.achievements = {};
      state.history = [
        { day: 5, revenue: 10000, profit: 1000, sales: 1 },
        { day: 6, revenue: 8000, profit: -2000, sales: 1 },
      ];
      state.settlement = { profit: 12345 };
      recordUserProgress();
      const tester = readUsers().tester.totals;
      checks.profileTotals = {
        days: tester.days,
        profit: tester.profit,
        best: tester.bestProfit,
        achievements: tester.achievements,
      };
      state.userId = null;
      delete users.tester;
      writeUsers(users);

      /* 12. 总资产口径包含分店估值 */
      for (const goods of GOODS) {
        state.inventory[goods.id] = [];
        state.backroom[goods.id] = [];
      }
      state.shipments = [];
      state.cash = 100000;
      state.branches = [{ value: 75000 }];
      checks.totalAsset = { total: totalAssetValue(), expected: 175000 };
      state.branches = [];

      /* 12b. 现金 / 资产精确守恒：进货按进价增货值，售出按售价增现金、按进价减货值 */
      for (const goods of GOODS) {
        state.inventory[goods.id] = [];
        state.backroom[goods.id] = [];
        state.supplyQuota[goods.id] = 999;
      }
      state.shipments = [];
      state.branches = [];
      state.supplyUsed = {};
      state.phase = "prep";
      state.size = "large";
      state.location = LOCATIONS[0];
      state.supplier = "market";
      state.cash = 1000000;
      state.daySoldValue = 0;
      state.dayPurchaseCost = 0;
      state.dayPurchaseValue = 0;
      const flowGoods = GOODS.find((goods) => (goods.tier || 1) === 1);
      const cashBeforeBuy = state.cash;
      const goodsBeforeBuy = bookValue();
      const buy = applyRestock(flowGoods, 10);
      const buyCash = cashBeforeBuy - state.cash;
      const buyValue = bookValue() - goodsBeforeBuy;
      moveToShelf(flowGoods.id, "fill");
      const shelfQty = shelfStockOf(flowGoods.id);
      const lotCost = (state.inventory[flowGoods.id][0] || {}).cost || 0;
      const cashBeforeSell = state.cash;
      const goodsBeforeSell = bookValue();
      const soldCost = takeStock(flowGoods.id, 1);
      const salePrice = Math.round(lotCost * 1.5);
      state.cash += salePrice;
      const sellCash = state.cash - cashBeforeSell;
      const sellValue = goodsBeforeSell - bookValue();
      checks.assetFlow = {
        bought: buy.qty,
        buyCash,
        buyValue,
        buyBalanced: buy.qty > 0 && buyCash === buyValue && buyCash === buy.cost,
        shelfQty,
        soldCost,
        lotCost,
        sellCash,
        sellValue,
        salePrice,
        sellBalanced: shelfQty >= 1 && sellCash === salePrice && sellValue === soldCost && soldCost === lotCost,
        total: totalAssetValue(),
        composed: state.cash + bookValue() + branchAssetValue(),
        totalBalanced: totalAssetValue() === state.cash + bookValue() + branchAssetValue(),
      };

      /* 12c. 保质期宽限与意外风险比例合理 */
      const expiryWithinCap = GOODS.every((goods) => {
        const cap = Math.min(3, Math.max(1, Math.round(goods.shelf * 0.25)));
        const extra = shelfLifeOf(goods, { dayIn: 0 }) - goods.shelf;
        return extra >= 0 && extra <= cap;
      });
      state.decor = {};
      state.decorWear = 0;
      const riskClean = decorRiskRate();
      state.decorWear = 0.8;
      const riskWorn = decorRiskRate();
      state.decorWear = 0;
      checks.reasonable = {
        expiryWithinCap,
        riskClean,
        riskWorn,
        riskSane: riskClean >= 0.005 && riskWorn <= 0.18 && riskWorn >= riskClean,
      };

      /* 12d. 下架：台面 → 后台，总量不变；台面损耗速率应高于后台 */
      state.inventory[flowGoods.id] = [];
      state.backroom[flowGoods.id] = [];
      state.shipments = [];
      state.phase = "prep";
      addLot("backroom", flowGoods.id, { qty: 6, cost: 1000, dayIn: state.day, shelf: flowGoods.shelf });
      moveToShelf(flowGoods.id, "fill");
      const shelfBeforeUnshelf = shelfStockOf(flowGoods.id);
      const totalBeforeUnshelf = shelfBeforeUnshelf + backStockOf(flowGoods.id);
      const unshelfResult = moveToBackroom(flowGoods.id, "fill");
      const rates = spoilageRates(flowGoods);
      checks.unshelf = {
        shelfBeforeUnshelf,
        moved: unshelfResult.moved,
        shelfAfter: shelfStockOf(flowGoods.id),
        backAfter: backStockOf(flowGoods.id),
        totalKept: totalBeforeUnshelf === shelfStockOf(flowGoods.id) + backStockOf(flowGoods.id),
        movedAll: unshelfResult.moved === shelfBeforeUnshelf && shelfStockOf(flowGoods.id) === 0,
        shelfRate: rates.shelf,
        backRate: rates.back,
        rateDiff: rates.shelf > 0 && rates.back > 0 && rates.shelf !== rates.back,
      };

      /* 13. 退租时分店按估值一并清算 */
      state.location = LOCATIONS[0];
      state.size = "small";
      state.branches = [{ value: 100000, invested: 100000 }];
      const quitQuote = exitQuote();
      checks.quitBranch = {
        liquidation: quitQuote.branchLiquidation,
        expected: 70000,
        available: quitQuote.available === state.cash + quitQuote.liquidation + quitQuote.branchLiquidation,
      };
      state.branches = [];

      /* 14. 新开局初始化：历史/门店/口碑归零，默认铺面可选 */
      state.history = [{ day: 1, revenue: 100, profit: 50, sales: 1 }];
      state.branches = [{ id: 1, value: 100000 }];
      state.reputation = 4.6;
      state.day = 9;
      state.stageReached = 4;
      state.size = "large";
      state.shopType = "fruit";
      state.pendingSize = "large";
      resetRunForNewShop();
      checks.newRun = {
        history: state.history.length,
        branches: state.branches.length,
        reputation: state.reputation,
        day: state.day,
        stage: state.stageReached,
        size: state.pendingSize,
      };

      state.shopType = "fruit";
      state.size = "small";
      state.location = null;
      state.stageReached = 1;
      state.pendingSize = "small";
      openMap("start");
      checks.startMap = {
        pendingSize: state.pendingSize,
        stallEnabled: !els.mapSizes.querySelector('[data-size="stall"]')?.disabled,
        smallLocked: !!els.mapSizes.querySelector('[data-size="small"]')?.disabled,
      };
      els.mapOverlay.hidden = true;
      state.mapMode = "relocate";

      /* 15. 店名与启动资金展示 / 口碑初始化 */
      state.shopName = "测试小铺";
      setCatalog("fruit");
      checks.brand = {
        sign: document.querySelector(".shop-sign span")?.textContent,
        title: document.title,
        cashText: document.querySelector(".detail-cash b")?.textContent || "",
        namePlaceholder: document.querySelector("#mapShopName")?.placeholder,
      };
      state.reputation = 4.9;
      state.ratings = [{ score: 5 }];
      resetRunForNewShop();
      checks.reputationInit = {
        reputation: state.reputation,
        ratings: (state.ratings || []).length,
        name: state.shopName,
      };

      /* 16. 菜品分级：基础/进阶/精品均有，未达标不能进货，达标后解锁 */
      const tierCount = {};
      GOODS.forEach((goods) => { tierCount[goods.tier] = (tierCount[goods.tier] || 0) + 1; });
      const lockedGoods = GOODS.find((goods) => goods.tier === 3);
      const cashBeforeLocked = state.cash;
      const lockedBuy = applyRestock(lockedGoods, 4);
      const savedHistory = state.history;
      state.history = Array.from({ length: 8 }, (_, index) => ({ day: index + 1, profit: 50000 }));
      const unlockAfterProgress = goodsUnlocked(lockedGoods);
      state.history = savedHistory;
      checks.goodsTiers = {
        tiers: tierCount,
        lockedNow: !goodsUnlocked(lockedGoods),
        blocked: lockedBuy.qty === 0 && lockedBuy.locked === true && state.cash === cashBeforeLocked,
        unlockedAfterProgress: unlockAfterProgress,
      };

      /* 17. 进货只占后台仓容（在途计入）；上架不超过台面容量 */
      const capGoods = GOODS.find((goods) => goods.tier === 1);
      const capGid = capGoods.id;
      const capBack = backCapOf(capGoods);
      const keepStock = {
        back: state.backroom[capGid],
        inv: state.inventory[capGid],
        ships: state.shipments,
        cash: state.cash,
        used: state.supplyUsed[capGid],
        quota: state.supplyQuota[capGid],
      };
      state.backroom[capGid] = [{ qty: capBack - 4, cost: unitCost(capGoods), dayIn: state.day, shelf: capGoods.shelf, decayMult: 1 }];
      state.inventory[capGid] = [];
      state.shipments = [{
        gid: capGid, qty: 4, cost: unitCost(capGoods), dayIn: state.day,
        decayMult: 1, quality: 5, supplier: "本地农贸", arriveAt: Date.now() + 60000,
      }];
      state.cash = 1000000;
      state.supplyQuota[capGid] = 100;
      state.supplyUsed[capGid] = 0;
      const transitOrder = applyRestock(capGoods, 10);
      const transitBlocked = transitOrder.qty === 0 && state.cash === 1000000;
      state.shipments = [];
      state.backroom[capGid] = [{ qty: 50, cost: unitCost(capGoods), dayIn: state.day, shelf: capGoods.shelf, decayMult: 1 }];
      const shelfCap = capOf(capGoods);
      const shelved = moveToShelf(capGid, "fill");
      checks.stockRules = {
        backCap: capBack,
        transitBlocked,
        moved: shelved.moved,
        shelfCap,
        shelfAfter: shelfStockOf(capGid),
        backLeft: backStockOf(capGid),
        capped: shelved.moved === shelfCap && shelfStockOf(capGid) === shelfCap && backStockOf(capGid) === 50 - shelfCap,
      };
      if (keepStock.back === undefined) delete state.backroom[capGid]; else state.backroom[capGid] = keepStock.back;
      if (keepStock.inv === undefined) delete state.inventory[capGid]; else state.inventory[capGid] = keepStock.inv;
      if (keepStock.used === undefined) delete state.supplyUsed[capGid]; else state.supplyUsed[capGid] = keepStock.used;
      if (keepStock.quota === undefined) delete state.supplyQuota[capGid]; else state.supplyQuota[capGid] = keepStock.quota;
      state.shipments = keepStock.ships;
      state.cash = keepStock.cash;

      /* 18. 批量补货 / 上架按当前标签页覆盖全部商品 */
      const tabCat = CATEGORIES.find((cat) => GOODS.some((goods) => goods.cat === cat.name && goods.tier === 1))?.name;
      const tabGoods = GOODS.filter((goods) => goods.cat === tabCat);
      const keepTab = { cash: state.cash, cat: state.backCat, ships: state.shipments, quota: {}, used: {}, back: {}, inv: {} };
      tabGoods.forEach((goods) => {
        keepTab.quota[goods.id] = state.supplyQuota[goods.id];
        keepTab.used[goods.id] = state.supplyUsed[goods.id];
        keepTab.back[goods.id] = state.backroom[goods.id];
        keepTab.inv[goods.id] = state.inventory[goods.id];
        delete state.backroom[goods.id];
        delete state.inventory[goods.id];
        state.supplyQuota[goods.id] = 200;
        state.supplyUsed[goods.id] = 0;
      });
      state.backCat = tabCat;
      state.size = "stall";
      state.shelfTier = "wood";
      state.phase = "prep";
      state.cash = 5000000;
      fillCategory();
      const unlockedTab = tabGoods.filter((goods) => goodsUnlocked(goods));
      const filledAll = unlockedTab.every((goods) => backStockOf(goods.id) + shipmentQtyOf(goods.id) > 0);
      const backBeforeShelf = {};
      tabGoods.forEach((goods) => { backBeforeShelf[goods.id] = backStockOf(goods.id); });
      stockCategory();
      const stockedAll = unlockedTab.every((goods) => shelfStockOf(goods.id) === Math.min(backBeforeShelf[goods.id], capOf(goods)));
      checks.bulkByTab = { cat: tabCat, count: unlockedTab.length, filledAll, stockedAll };
      tabGoods.forEach((goods) => {
        if (keepTab.back[goods.id] === undefined) delete state.backroom[goods.id]; else state.backroom[goods.id] = keepTab.back[goods.id];
        if (keepTab.inv[goods.id] === undefined) delete state.inventory[goods.id]; else state.inventory[goods.id] = keepTab.inv[goods.id];
        if (keepTab.quota[goods.id] === undefined) delete state.supplyQuota[goods.id]; else state.supplyQuota[goods.id] = keepTab.quota[goods.id];
        if (keepTab.used[goods.id] === undefined) delete state.supplyUsed[goods.id]; else state.supplyUsed[goods.id] = keepTab.used[goods.id];
      });
      state.backCat = keepTab.cat;
      state.shipments = keepTab.ships;
      state.cash = keepTab.cash;

      /* 19. 托管策略：三种风格可切换，严肃守价、妥协快成交 */
      const pickCustomer = {
        bargain: 0.5, patienceNow: 0.6, sens: 0.6, social: 0.5,
        job: { id: "office" }, wealth: { id: "mid" }, traits: [], isRegular: false,
        affinity: {},
      };
      state.staff = [];
      state.autoPilot = true;
      state.autoStyle = "strict";
      const strictPick = autoBargainPick(pickCustomer, 1000, 700, 850, mulberry32(11));
      state.autoStyle = "yield";
      const yieldPick = autoBargainPick(pickCustomer, 1000, 700, 850, mulberry32(11));
      checks.autoStyle = {
        styles: AUTO_STYLES.map((style) => style.id),
        strictPick,
        yieldPick,
        strictHolds: strictPick === "hold",
        yieldAccepts: yieldPick === "accept",
      };
      state.autoStyle = "yield";
      state.backView = "strategy";
      state.phase = "prep";
      openBackstage();
      renderBackstage();
      checks.autoStyleUi = {
        buttons: els.strategyPanel.querySelectorAll("[data-autostyle]").length,
        on: els.strategyPanel.querySelector("[data-autostyle].on")?.dataset.autostyle,
        hasSection: els.strategyPanel.textContent.includes("托管策略"),
      };
      state.autoStyle = "balanced";
      state.autoPilot = false;

      /* 20. 历史订单：成交记录、汇总与容量上限 */
      state.orders = [];
      state.orderSeq = 0;
      state.day = 12;
      const og1 = GOODS[0];
      const og2 = GOODS[1];
      recordOrder({
        customer: "测试客", bargain: "hold",
        items: [{ gid: og1.id, name: og1.name, cat: og1.cat, unit: og1.unit, qty: 2, price: 500, revenue: 990, cogs: 600 }],
        revenue: 990, cogs: 600,
      });
      recordOrder({
        customer: "第二位",
        items: [{ gid: og2.id, name: og2.name, cat: og2.cat, unit: og2.unit, qty: 1, price: 300, revenue: 300, cogs: 200 }],
        revenue: 300, cogs: 200,
      });
      state.backView = "orders";
      renderBackstage();
      checks.orderLedger = {
        recorded: state.orders.length,
        daySeq: state.orders[1].daySeq,
        total: state.orders.reduce((sum, order) => sum + order.revenue, 0),
        profit: state.orders.reduce((sum, order) => sum + order.profit, 0),
        rows: els.ordersPanel.querySelectorAll(".order-row").length,
        goodsRows: els.ordersPanel.querySelectorAll(".order-goods-row").length,
        hasSummary: els.ordersPanel.textContent.includes("本范围订单 2 单") && els.ordersPanel.textContent.includes("总毛利"),
      };

      /* 20b. 历史订单按经营天数区间筛选 */
      state.orders = [];
      state.orderSeq = 0;
      state.day = 2;
      recordOrder({
        customer: "区间测试甲", bargain: "hold",
        items: [{ gid: og1.id, name: og1.name, cat: og1.cat, unit: og1.unit, qty: 1, price: 500, revenue: 500, cogs: 300 }],
        revenue: 500, cogs: 300,
      });
      state.day = 40;
      recordOrder({
        customer: "区间测试乙",
        items: [{ gid: og2.id, name: og2.name, cat: og2.cat, unit: og2.unit, qty: 1, price: 400, revenue: 400, cogs: 250 }],
        revenue: 400, cogs: 250,
      });
      state.day = 70;
      state.orderRange = "32-62";
      state.backView = "orders";
      renderBackstage();
      checks.orderRange = {
        rows: els.ordersPanel.querySelectorAll(".order-row").length,
        chips: els.ordersPanel.querySelectorAll("[data-order-range]").length,
        total: els.ordersPanel.textContent.includes("本范围订单 1 单"),
        label: els.ordersPanel.textContent.includes("第 32–62 天"),
      };
      state.orderRange = "all";

      for (let i = 0; i < 310; i += 1) {
        recordOrder({ customer: "压测", items: [], revenue: 100, cogs: 50 });
      }
      checks.orderCap = { size: state.orders.length, cap: MAX_ORDER_HISTORY };

      /* 21. 订单与托管策略写入存档 */
      state.suppressSave = false;
      state.autoStyle = "strict";
      state.booted = true;
      state.location = LOCATIONS[0];
      saveGame();
      const ledgerSave = JSON.parse(localStorage.getItem(saveKey()) || "{}");
      state.suppressSave = true;
      checks.orderPersist = {
        style: ledgerSave.autoStyle,
        orders: (ledgerSave.orders || []).length,
        capped: (ledgerSave.orders || []).length === MAX_ORDER_HISTORY,
      };
      state.orders = [];
      state.autoStyle = "balanced";

      /* 22. 只看有库存筛选、摆台顺序与铺面规格 */
      state.backCat = "all";
      state.backQuery = "";
      state.backLowOnly = false;
      state.inventory = {};
      state.backroom = {};
      state.shipments = [];
      for (const goods of GOODS) {
        state.inventory[goods.id] = [];
        state.backroom[goods.id] = [];
      }
      const ownedGoods = GOODS[0];
      state.inventory[ownedGoods.id] = [{ qty: 3, cost: 100, dayIn: state.day, shelf: 3 }];
      state.backOwnedOnly = false;
      const allBackCount = backFilteredGoods().length;
      state.backOwnedOnly = true;
      const ownedBack = backFilteredGoods();
      state.backOwnedOnly = false;
      checks.ownedFilter = {
        all: allBackCount,
        owned: ownedBack.length,
        only: ownedBack.length === 1 && ownedBack[0].id === ownedGoods.id,
      };

      const catGoods = GOODS.filter((goods) => goods.cat === ownedGoods.cat).slice(0, 2);
      state.inventory[catGoods[0].id] = [{ qty: 2, cost: 100, dayIn: state.day, shelf: 3 }];
      state.inventory[catGoods[1].id] = [{ qty: 2, cost: 100, dayIn: state.day, shelf: 3 }];
      state.shelfOrder = { [ownedGoods.cat]: [catGoods[1].id, catGoods[0].id] };
      const orderedDisplay = displayOrderOf(ownedGoods.cat);
      const frontFactor = shelfPositionFactor(catGoods[1]);
      const backFactor = shelfPositionFactor(catGoods[0]);
      state.backView = "display";
      renderBackstage();
      checks.displayOrder = {
        first: orderedDisplay[0].id === catGoods[1].id,
        frontFactor,
        backFactor,
        effect: frontFactor > backFactor,
        rows: els.displayPanel.querySelectorAll(".display-row").length,
        hasHint: els.displayPanel.textContent.includes("越靠前越好卖"),
      };
      state.shelfOrder = {};

      checks.sizeTraffic = {
        values: SHOP_SIZES.map((size) => size.trafficMult),
        ascending: SHOP_SIZES.every((size, index) => index === 0 || size.trafficMult >= SHOP_SIZES[index - 1].trafficMult),
        stall: (() => { state.size = "stall"; return sizeTrafficMult(); })(),
        floor: (() => { state.size = "floor"; return sizeTrafficMult(); })(),
      };
      renderShelf();
      const floorStyle = els.storeScene.dataset.size;
      state.size = "stall";
      renderShelf();
      const stallStyle = els.storeScene.dataset.size;
      checks.sizeStyle = {
        floor: floorStyle,
        stall: stallStyle,
        distinct: floorStyle === "floor" && stallStyle === "stall",
      };
      state.size = "small";

      /* 23. 解锁状态筛选：未解锁沉底 */
      state.history = [];
      state.backCat = "all";
      state.backQuery = "";
      state.backLowOnly = false;
      state.backOwnedOnly = false;
      state.backUnlock = "all";
      const allBack = backFilteredGoods();
      const unlockedCount = allBack.filter((goods) => goodsUnlocked(goods)).length;
      const lastUnlocked = allBack.map((goods) => goodsUnlocked(goods)).lastIndexOf(true);
      const firstLocked = allBack.findIndex((goods) => !goodsUnlocked(goods));
      state.backUnlock = "unlocked";
      const onlyUnlocked = backFilteredGoods();
      state.backUnlock = "locked";
      const onlyLocked = backFilteredGoods();
      state.backUnlock = "all";
      checks.backUnlock = {
        total: allBack.length,
        unlockedCount,
        lockedCount: allBack.length - unlockedCount,
        sorted: firstLocked === -1 || firstLocked > lastUnlocked,
        onlyUnlocked: onlyUnlocked.length === unlockedCount && onlyUnlocked.every((goods) => goodsUnlocked(goods)),
        onlyLocked: onlyLocked.length === allBack.length - unlockedCount && onlyLocked.every((goods) => !goodsUnlocked(goods)),
      };

      /* 24. 进满按后台容量补满并立即入库，不受当日额度限制 */
      const fillGoods = GOODS.find((goods) => goods.tier === 1);
      const fillGid = fillGoods.id;
      state.size = "small";
      state.cash = 1000000;
      state.backroom[fillGid] = [];
      state.inventory[fillGid] = [];
      state.shipments = [];
      state.supplyQuota[fillGid] = 1;
      state.supplyUsed[fillGid] = 5;
      const fillCap = backCapOf(fillGoods);
      const fillBuy = applyRestock(fillGoods, "fill", { fullBackroom: true, immediate: true });
      checks.fillBackroom = {
        cap: fillCap,
        qty: fillBuy.qty,
        back: backStockOf(fillGid),
        transit: shipmentQtyOf(fillGid),
        delayed: fillBuy.delayed,
        full: fillBuy.qty === fillCap && backStockOf(fillGid) === fillCap && shipmentQtyOf(fillGid) === 0,
      };

      /* 25. 开局空库存：启动资金全部为现金 */
      state.cash = 200000;
      state.inventory = {};
      state.backroom = {};
      state.prices = {};
      state.condition = {};
      seedInitialStock();
      checks.emptyStart = {
        cash: state.cash,
        inventoryEmpty: GOODS.every((goods) => (state.inventory[goods.id] || []).length === 0),
        backroomEmpty: GOODS.every((goods) => (state.backroom[goods.id] || []).length === 0),
        pricesSet: GOODS.every((goods) => state.prices[goods.id] === goods.base),
      };

      /* 25. 选址确认即时扣首日租金，且不再默认配货 */      state.mapMode = "start";
      state.shopType = "fruit";
      state.pendingSize = "stall";
      state.pendingLoc = LOCATIONS[0];
      state.pendingName = "回归测试店";
      state.suppressSave = true;
      confirmLocation();
      const openingRent = Math.round(LOCATIONS[0].rent * sizeOf().rentMult);
      checks.openingCharge = {
        rent: openingRent,
        dayRent: state.dayRent,
        paidDay: state.rentPaidDay,
        charged: state.cash < 200000,
        inventoryEmpty: GOODS.every((goods) =>
          (state.inventory[goods.id] || []).length === 0 && (state.backroom[goods.id] || []).length === 0),
      };

      state.suppressSave = true;
      return checks;
    })()
  `);

  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  if (data.__error) {
    console.error("页面执行失败：\n" + data.__error);
    process.exit(1);
  }
  check("页面启动与脚本可用", data.boot);
  check("阶段 2 分店锁定提示", data.branchLockedAtStage2?.note && data.branchLockedAtStage2?.openDisabled && data.branchLockedAtStage2?.formDisabled, JSON.stringify(data.branchLockedAtStage2));
  check("阶段 3 分店解锁", data.branchUnlockedAtStage3?.note && data.branchUnlockedAtStage3?.openEnabled, JSON.stringify(data.branchUnlockedAtStage3));
  check("货架容量递增", data.shelf?.premiumUp && data.shelf?.coldUp, JSON.stringify(data.shelf));
  check("冷藏只降台面损耗", data.shelf?.coldDecayLower && data.shelf?.backroomUntouched, JSON.stringify(data.shelf));
  const shelfSpec = Object.fromEntries((data.shelfSpec || []).map((tier) => [tier.id, tier]));
  check(
    "货架系数防漂移",
    shelfSpec.wood?.capMult === 1 && shelfSpec.premium?.capMult === 1.15 && shelfSpec.cold?.capMult === 1.3
      && shelfSpec.premium?.sellMult === 1.15 && shelfSpec.cold?.sellMult === 1.2
      && shelfSpec.premium?.decayMult === 0.9 && shelfSpec.cold?.decayMult === 0.5
      && shelfSpec.premium?.stage === 2 && shelfSpec.cold?.stage === 3,
    JSON.stringify(data.shelfSpec)
  );
  const stageSpec = (data.stageSpec || []).reduce((map, stage) => ({ ...map, [stage.id]: stage }), {});
  check(
    "阶段门槛防漂移",
    stageSpec[1]?.req === null && stageSpec[2]?.req?.days === 3 && stageSpec[2]?.req?.profit === 100000
      && stageSpec[3]?.req?.rep === 3.8 && stageSpec[4]?.req?.asset === 2000000
      && stageSpec[1]?.sizes === 1 && stageSpec[2]?.sizes === 2 && stageSpec[3]?.sizes === 3 && stageSpec[4]?.sizes === 4,
    JSON.stringify(data.stageSpec)
  );
  check("渠道额度系数生效", data.quota?.streetBoost && data.quota?.usedCapped, JSON.stringify(data.quota));
  check("大单更慢 / 暴雨延迟 / 冷链更快", data.logistics?.bulkSlower && data.logistics?.rainSlower && data.logistics?.coldFaster, JSON.stringify(data.logistics));
  check("在途货物计入资产", data.logistics?.transitInBookValue, JSON.stringify(data.logistics));
  check("分店估值计入阶段资产", data.stageAsset?.counted, JSON.stringify(data.stageAsset));
  check("里程碑 6 个、7 天点亮 3 个", data.gentle?.chips === 6 && data.gentle?.chipsOn === 3, JSON.stringify(data.gentle));
  check("昨日建议跨天保留", data.gentle?.carryAdvice, JSON.stringify(data.gentle));
  check("广告 / 排行榜已下线", data.gentle?.noAds && data.gentle?.noRank, JSON.stringify(data.gentle));
  check("阶段升级结算提示", data.stageUp?.name === "社区小店" && data.stageUp?.banner, JSON.stringify(data.stageUp));
  check("分店切换后显示控制台", data.branchConsole?.focused && data.branchConsole?.bars === 2 && data.branchConsole?.stats === 4, JSON.stringify(data.branchConsole));
  check("分店配置按钮齐全", data.branchConsole?.hasRename && data.branchConsole?.hasUpgrade && data.branchConsole?.hasPause && data.branchConsole?.hasPrice, JSON.stringify(data.branchConsole));
  check("未选中分店保持紧凑", data.branchCompact?.consoles === 1 && data.branchCompact?.quickButtons === 1, JSON.stringify(data.branchCompact));
  check("分店改名 / 升级生效", data.branchManage?.renamed === "测试分店" && data.branchManage?.level === 1 && data.branchManage?.investedUp && data.branchManage?.valueUp && data.branchManage?.cashDown, JSON.stringify(data.branchManage));
  check("分店歇业只付租金", data.branchPaused?.paused && data.branchPaused?.dailyPaused && data.branchPaused?.wages === 0 && data.branchPaused?.historyAdded, JSON.stringify(data.branchPaused));
  check("招人预付 3 天工资不重复计薪", data.branchPrepaid?.prepaid === 3 && data.branchPrepaid?.cashDown && data.branchPrepaid?.prepaidConsumed && data.branchPrepaid?.wagesZero, JSON.stringify(data.branchPrepaid));
  check("离职退还未用预付工资", data.branchFireRefund?.staffGone && data.branchFireRefund?.refund, JSON.stringify(data.branchFireRefund));
  check("分店定价策略影响客流与营收", data.branchPrice?.strategy === "thin" && data.branchPrice?.unitsDiffer && data.branchPrice?.revenueDiffer && data.branchPrice?.thinMoreUnits, JSON.stringify(data.branchPrice));
  check("存档不再写入外部刺激字段", Array.isArray(data.stageUp?.legacyFields) && data.stageUp.legacyFields.length === 0, JSON.stringify(data.stageUp));
  check("主档损坏回退到备份", data.backup?.recovered === true && data.backup?.day >= 4 && data.backup?.cash > 0, JSON.stringify(data.backup));
  check("账号档缺失不回退游客档", data.isolation?.namespace && data.isolation?.accountLoaded === false && data.isolation?.dayAfterSwitch === data.isolation?.dayBeforeSwitch && data.isolation?.guestDay === 77, JSON.stringify(data.isolation));
  check("重置清掉主档与回退档", data.resetClear?.main && data.resetClear?.backup, JSON.stringify(data.resetClear));
  check("后台清理能力覆盖存档与账号且无个人入口", data.wipeAll?.noEntry && data.wipeAll?.hasApi && data.wipeAll?.hasSave && data.wipeAll?.hasBackup && data.wipeAll?.hasUsers && data.wipeAll?.keepsAudio, JSON.stringify(data.wipeAll));
  check("启动清空存量数据且初始资金 ¥2,000", data.startCash?.configured === 200000 && data.startCash?.baseWealth === 200000 && data.startCash?.marker === "2" && data.purgeGen?.purged && data.purgeGen?.saveGone && data.purgeGen?.usersGone && data.purgeGen?.marker === "2" && data.purgeGen?.keepsAudio, JSON.stringify({ startCash: data.startCash, purgeGen: data.purgeGen }));
  check("店名自定义与启动资金展示", data.brand?.sign === "测试小铺" && String(data.brand?.title || "").includes("测试小铺") && /¥?2,000/.test(data.brand?.cashText || "") && data.brand?.namePlaceholder === "阿福蔬果", JSON.stringify(data.brand));
  check("新开局口碑初始化", data.reputationInit?.reputation === 3.2 && data.reputationInit?.ratings === 0 && data.reputationInit?.name === "" && data.newRun?.reputation === 3.2, JSON.stringify({ reputationInit: data.reputationInit, newRun: data.newRun }));
  check("菜品三级解锁门槛", data.goodsTiers?.tiers?.[1] > 0 && data.goodsTiers?.tiers?.[2] > 0 && data.goodsTiers?.tiers?.[3] > 0 && data.goodsTiers?.lockedNow && data.goodsTiers?.blocked && data.goodsTiers?.unlockedAfterProgress, JSON.stringify(data.goodsTiers));
  check("进货按后台仓容且上架不超台面", data.stockRules?.transitBlocked && data.stockRules?.capped && data.stockRules?.moved === data.stockRules?.shelfCap, JSON.stringify(data.stockRules));
  check("批量补货与上架覆盖所选标签页", data.bulkByTab?.count > 0 && data.bulkByTab?.filledAll && data.bulkByTab?.stockedAll, JSON.stringify(data.bulkByTab));
  check("账号档案只反映当前存档", data.profileTotals?.days === 6 && data.profileTotals?.profit === -1000 && data.profileTotals?.best === 12345 && data.profileTotals?.achievements === 0, JSON.stringify(data.profileTotals));
  check("总资产包含分店估值", data.totalAsset?.total === data.totalAsset?.expected, JSON.stringify(data.totalAsset));
  check("现金与资产精确守恒", data.assetFlow?.buyBalanced && data.assetFlow?.sellBalanced && data.assetFlow?.totalBalanced, JSON.stringify(data.assetFlow));
  check("保质期宽限与意外风险比例合理", data.reasonable?.expiryWithinCap && data.reasonable?.riskSane, JSON.stringify(data.reasonable));
  check("下架回到后台且两端损耗速率不同", data.unshelf?.totalKept && data.unshelf?.movedAll && data.unshelf?.rateDiff, JSON.stringify(data.unshelf));
  check("退租清算分店估值", data.quitBranch?.liquidation === data.quitBranch?.expected && data.quitBranch?.available, JSON.stringify(data.quitBranch));
  check("新开局清空历史与门店数据", data.newRun?.history === 0 && data.newRun?.branches === 0 && data.newRun?.day === 0 && data.newRun?.stage === 1 && data.newRun?.size === "stall", JSON.stringify(data.newRun));
  check("开局地图默认可选铺面", data.startMap?.pendingSize === "stall" && data.startMap?.stallEnabled && data.startMap?.smallLocked, JSON.stringify(data.startMap));
  check("托管策略三档可切换且倾向生效", data.autoStyle?.styles?.join(",") === "strict,balanced,yield" && data.autoStyle?.strictHolds && data.autoStyle?.yieldAccepts, JSON.stringify(data.autoStyle));
  check("托管策略入口在经营策略页", data.autoStyleUi?.buttons === 3 && data.autoStyleUi?.on === "yield" && data.autoStyleUi?.hasSection, JSON.stringify(data.autoStyleUi));
  check("历史订单记录与汇总守恒", data.orderLedger?.recorded === 2 && data.orderLedger?.daySeq === 2 && data.orderLedger?.total === 1290 && data.orderLedger?.profit === 490 && data.orderLedger?.rows === 2 && data.orderLedger?.goodsRows === 2 && data.orderLedger?.hasSummary, JSON.stringify(data.orderLedger));
  check("历史订单按经营天数区间筛选", data.orderRange?.rows === 1 && data.orderRange?.chips >= 3 && data.orderRange?.total && data.orderRange?.label, JSON.stringify(data.orderRange));
  check("历史订单容量上限 300", data.orderCap?.size === data.orderCap?.cap && data.orderCap?.cap === 300, JSON.stringify(data.orderCap));
  check("托管策略与订单写入存档", data.orderPersist?.style === "strict" && data.orderPersist?.capped && data.orderPersist?.orders === 300, JSON.stringify(data.orderPersist));
  check("开局启动资金全为现金且无默认库存", data.emptyStart?.cash === 200000 && data.emptyStart?.inventoryEmpty && data.emptyStart?.backroomEmpty && data.emptyStart?.pricesSet, JSON.stringify(data.emptyStart));
  check("只看有库存商品筛选生效", data.ownedFilter?.owned === 1 && data.ownedFilter?.only && data.ownedFilter?.all > data.ownedFilter?.owned, JSON.stringify(data.ownedFilter));
  check("摆台顺序决定陈列位与售卖加成", data.displayOrder?.first && data.displayOrder?.effect && data.displayOrder?.rows === 2 && data.displayOrder?.hasHint && data.displayOrder?.frontFactor > data.displayOrder?.backFactor, JSON.stringify(data.displayOrder));
  check("铺面越大客流系数越高", data.sizeTraffic?.ascending && data.sizeTraffic?.stall === 0.75 && data.sizeTraffic?.floor === 1.4, JSON.stringify(data.sizeTraffic));
  check("铺面规格切换店面样式", data.sizeStyle?.distinct && data.sizeStyle?.floor === "floor" && data.sizeStyle?.stall === "stall", JSON.stringify(data.sizeStyle));
  check("解锁状态筛选且未解锁沉底", data.backUnlock?.lockedCount > 0 && data.backUnlock?.sorted && data.backUnlock?.onlyUnlocked && data.backUnlock?.onlyLocked, JSON.stringify(data.backUnlock));
  check("进满补满后台并立即入库", data.fillBackroom?.full && data.fillBackroom?.delayed === false && data.fillBackroom?.qty === data.fillBackroom?.cap, JSON.stringify(data.fillBackroom));
  check("选址确认即时扣首日租金且不配货", data.openingCharge?.dayRent === data.openingCharge?.rent && data.openingCharge?.paidDay === 1 && data.openingCharge?.charged && data.openingCharge?.inventoryEmpty, JSON.stringify(data.openingCharge));

  const layouts = {};
  for (const width of [390, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(300);
    layouts[width] = await evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
  }
  await send("Emulation.clearDeviceMetricsOverride");
  check("390px 无横向溢出", layouts[390] === false);
  check("1440px 无横向溢出", layouts[1440] === false);
  check("无 JS 运行时异常", errors.length === 0, errors.join("\n"));

  console.log("Web 端浏览器回归\n");
  for (const item of results) {
    console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.name}${item.pass ? "" : `\n      ${item.detail}`}`);
  }
  const failed = results.filter((item) => !item.pass).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);

  await evaluate("localStorage.clear(); location.reload(); true");
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  console.error("\n请确认静态服务 8787 与 Chrome 调试端口 9222 已启动。");
  process.exit(1);
});
