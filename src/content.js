(function () {
  const ROOT_ID = "mealshark-root";
  const PAGE_OPEN_CLASS = "mealshark-page-open";
  const PAGE_COLLAPSED_CLASS = "mealshark-page-collapsed";
  const STATE_KEY = "mealshark:lastPage";
  const SETTINGS_KEY = "mealshark:settings";
  const SETTINGS_VERSION = 2;
  const PAGE_SOURCE = "mealshark-page-hook";
  const REQUEST_LATEST = "mealshark-request-latest-menu";
  const MAP_ACTION = "mealshark-map-action";
  const NATIVE_FILTER_TYPE = "mealshark-native-filter";
  const FAVORITES_TYPE = "mealshark-favorites";
  const APP_TILE_ANNOTATED_CLASS = "mealshark-app-tile-annotated";
  const APP_TILE_PRICE_CLASS = "mealshark-app-price-line";
  const CREDIT_FILTER_MIN = 1;
  const CREDIT_FILTER_MAX = 14;
  const SORT_MODES = {
    DISCOUNT: "discount",
    CREDIT_DESC: "credit-desc",
    CREDIT_ASC: "credit-asc"
  };

  const state = {
    collapsed: false,
    meals: [],
    mealIndex: new Map(),
    menuUrl: "",
    capturedAt: "",
    cityName: "",
    creditUnitPrice: null,
    mealPalFilter: null,
    favoriteRestaurantIds: null,
    topN: 50,
    newOnly: false,
    sortMode: SORT_MODES.DISCOUNT,
    selectedMealKey: ""
  };

  const dom = {};
  let tileObserver = null;
  let annotationTimer = 0;
  let currentHref = window.location.href;

  function getPageSnapshot() {
    return {
      href: window.location.href,
      title: document.title,
      capturedAt: new Date().toISOString()
    };
  }

  function getStorageLocal() {
    try {
      return chrome?.storage?.local || null;
    } catch (_error) {
      return null;
    }
  }

  async function storageGet(key) {
    const storage = getStorageLocal();

    if (!storage) {
      return {};
    }

    try {
      const result = storage.get(key);
      return typeof result?.then === "function" ? await result : result || {};
    } catch (_error) {
      return {};
    }
  }

  function storageSet(value) {
    const storage = getStorageLocal();

    if (!storage) {
      return;
    }

    try {
      const result = storage.set(value);

      if (typeof result?.catch === "function") {
        result.catch(() => {});
      }
    } catch (_error) {
      // The content script can outlive its extension context after reloads.
    }
  }

  function savePageSnapshot() {
    storageSet({ [STATE_KEY]: getPageSnapshot() });
  }

  async function loadSettings() {
    const result = await storageGet(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || {};
    const hasCurrentSettings = settings.version === SETTINGS_VERSION;

    state.collapsed = Boolean(settings.collapsed);
    state.topN = hasCurrentSettings ? clampTopN(settings.topN ?? state.topN) : state.topN;
    state.newOnly = Boolean(settings.newOnly);
    state.sortMode = normalizeSortMode(settings.sortMode);
  }

  function saveSettings() {
    storageSet({
      [SETTINGS_KEY]: {
        version: SETTINGS_VERSION,
        collapsed: state.collapsed,
        topN: state.topN,
        newOnly: state.newOnly,
        sortMode: state.sortMode
      }
    });
  }

  function normalizeSortMode(value) {
    return Object.values(SORT_MODES).includes(value) ? value : SORT_MODES.DISCOUNT;
  }

  function clampTopN(value) {
    const nextValue = Number.parseInt(value, 10);

    if (!Number.isFinite(nextValue)) {
      return 50;
    }

    return Math.max(nextValue, 1);
  }

  function ready(callback) {
    if (document.body) {
      callback();
      return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function isSupportedPage() {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "");

    return normalizedPath === "/lunch" || normalizedPath === "/dinner";
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (text !== undefined) {
      element.textContent = text;
    }

    return element;
  }

  function safeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeLookupText(value) {
    return safeString(value)
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function buildLookupKey(mealName, restaurantName, address) {
    return [mealName, restaurantName, address].map(normalizeLookupText).join("|");
  }

  function buildMealIndex(meals) {
    const index = new Map();

    for (const meal of meals) {
      const mealName = getMealName(meal);
      const restaurantName = getRestaurantName(meal);
      const address = meal.address || meal.fullAddress || "";
      const keys = [
        buildLookupKey(mealName, restaurantName, address),
        buildLookupKey(mealName, restaurantName, "")
      ];

      for (const key of keys) {
        if (!index.has(key)) {
          index.set(key, []);
        }

        index.get(key).push(meal);
      }
    }

    return index;
  }

  function normalizeMealPalFilter(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return {
      capturedAt: safeString(payload.capturedAt),
      source: safeString(payload.source),
      creditMin: toFiniteNumber(payload.creditMin),
      creditMax: toFiniteNumber(payload.creditMax),
      vegetarianOnly: payload.vegetarianOnly === true,
      cuisines: Array.isArray(payload.cuisines)
        ? payload.cuisines.map(normalizeLookupText).filter(Boolean)
        : null,
      favoritesOnly: payload.favoritesOnly === true,
      searchText: safeString(payload.searchText).toLowerCase()
    };
  }

  function hasActiveMealPalCreditFilter(filters) {
    return Boolean(filters) &&
      (
        (filters.creditMin !== null && filters.creditMin > CREDIT_FILTER_MIN) ||
        (filters.creditMax !== null && filters.creditMax < CREDIT_FILTER_MAX)
      );
  }

  function mealMatchesMealPalCreditFilter(meal, filters) {
    if (!hasActiveMealPalCreditFilter(filters)) {
      return true;
    }

    const min = filters.creditMin;
    const max = filters.creditMax;
    const creditPrice = toFiniteNumber(meal.mealCreditPrice);

    if (creditPrice === null) {
      return false;
    }

    return (min === null || creditPrice >= min) && (max === null || creditPrice <= max);
  }

  function mealMatchesMealPalFilter(meal, filters) {
    if (!filters) {
      return true;
    }

    if (!mealMatchesMealPalCreditFilter(meal, filters)) {
      return false;
    }

    if (filters.vegetarianOnly && meal.veg !== true) {
      return false;
    }

    if (filters.cuisines !== null && !filters.cuisines.includes(normalizeLookupText(meal.cuisine))) {
      return false;
    }

    // Fail open when the favorites list hasn't arrived yet.
    if (filters.favoritesOnly && state.favoriteRestaurantIds && !state.favoriteRestaurantIds.has(meal.restaurantId)) {
      return false;
    }

    if (filters.searchText) {
      const haystack = `${getMealName(meal)} ${getRestaurantName(meal)} ${meal.description || ""}`.toLowerCase();

      if (!haystack.includes(filters.searchText)) {
        return false;
      }
    }

    return true;
  }

  function getMealPalFilteredMeals() {
    return state.meals.filter((meal) => mealMatchesMealPalFilter(meal, state.mealPalFilter));
  }

  function ensureRoot() {
    const existingRoot = document.getElementById(ROOT_ID);

    if (existingRoot) {
      return existingRoot;
    }

    const root = createElement("div");
    root.id = ROOT_ID;

    dom.root = root;
    dom.bubble = createElement("button", "mealshark-bubble", "🦈");
    dom.bubble.type = "button";
    dom.bubble.setAttribute("aria-label", "Open Mealshark");
    dom.bubble.setAttribute("aria-controls", "mealshark-panel");

    dom.panel = createElement("aside", "mealshark-panel");
    dom.panel.id = "mealshark-panel";
    dom.panel.setAttribute("aria-label", "Mealshark meal insights");

    const header = createElement("header", "mealshark-header");
    const titleBlock = createElement("div", "mealshark-title-block");
    const eyebrow = createElement("p", "mealshark-eyebrow", "Mealshark");
    const title = createElement("h2", null, "Meal insights");
    titleBlock.append(eyebrow, title);

    dom.closeButton = createElement("button", "mealshark-close", "×");
    dom.closeButton.type = "button";
    dom.closeButton.setAttribute("aria-label", "Close Mealshark");
    header.append(titleBlock, dom.closeButton);

    const metrics = createElement("div", "mealshark-metrics");
    dom.totalMealsMetric = buildMetric("Meals", "0");
    dom.newMealsMetric = buildMetric("New", "0");
    metrics.append(dom.totalMealsMetric, dom.newMealsMetric);

    dom.modeControl = createElement("div", "mealshark-mode-control");
    dom.modeControl.setAttribute("role", "group");
    dom.modeControl.setAttribute("aria-label", "Sort mode");
    const discountModeButton = buildModeButton(
      SORT_MODES.DISCOUNT,
      "Best discounts",
      "Sort by discount percentage"
    );
    const creditModeButton = buildModeButton(
      SORT_MODES.CREDIT_DESC,
      "Best value for credits",
      "Sort by credit bucket, then discount percentage"
    );
    dom.modeButtons = [
      discountModeButton,
      creditModeButton
    ];
    dom.creditModeGroup = createElement("div", "mealshark-credit-mode-group");
    dom.creditDirectionButton = createElement("button", "mealshark-mode-button mealshark-mode-direction", "⬆️");
    dom.creditDirectionButton.type = "button";
    dom.creditDirectionButton.addEventListener("click", () => {
      state.sortMode =
        state.sortMode === SORT_MODES.CREDIT_DESC ? SORT_MODES.CREDIT_ASC : SORT_MODES.CREDIT_DESC;
      saveSettings();
      render();
    });
    dom.creditModeGroup.append(creditModeButton, dom.creditDirectionButton);
    dom.modeControl.append(discountModeButton, dom.creditModeGroup);

    const controls = createElement("div", "mealshark-controls");
    const topLabel = createElement("label", "mealshark-top-label");
    const topLabelStart = createElement("span", null, "Display up to");
    dom.topNInput = createElement("input", "mealshark-top-input");
    dom.topNInput.type = "number";
    dom.topNInput.min = "1";
    dom.topNInput.step = "1";
    dom.topNInput.value = String(state.topN);
    dom.topNInput.setAttribute("aria-label", "Number of results to display");
    dom.topNResultText = createElement("span", null, "of 0 results");
    topLabel.append(topLabelStart, dom.topNInput, dom.topNResultText);

    const filterLabel = createElement("label", "mealshark-filter-toggle");
    dom.newOnlyInput = createElement("input");
    dom.newOnlyInput.type = "checkbox";
    dom.newOnlyInput.checked = state.newOnly;
    const filterTrack = createElement("span", "mealshark-filter-track");
    filterTrack.setAttribute("aria-hidden", "true");
    const filterText = createElement("span", "mealshark-filter-text", "New only");
    filterLabel.append(dom.newOnlyInput, filterTrack, filterText);

    controls.append(topLabel, filterLabel);

    dom.emptyState = createElement(
      "p",
      "mealshark-empty",
      "Waiting for the MealPal menu response."
    );

    const mealSection = createElement("section", "mealshark-section");
    mealSection.append(dom.modeControl);
    dom.mealList = createElement("div", "mealshark-list");
    mealSection.append(dom.mealList);

    dom.panel.append(header, metrics, controls, dom.emptyState, mealSection);
    root.append(dom.bubble, dom.panel);
    document.body.appendChild(root);

    dom.bubble.addEventListener("click", () => {
      state.collapsed = false;
      saveSettings();
      render();
    });

    dom.closeButton.addEventListener("click", () => {
      state.collapsed = true;
      saveSettings();
      render();
    });

    dom.topNInput.addEventListener("change", () => {
      state.topN = clampTopN(dom.topNInput.value);
      dom.topNInput.value = String(state.topN);
      saveSettings();
      render();
    });

    dom.newOnlyInput.addEventListener("change", () => {
      state.newOnly = dom.newOnlyInput.checked;
      saveSettings();
      render();
    });

    return root;
  }

  function buildMetric(label, value) {
    const metric = createElement("div", "mealshark-metric");
    const metricValue = createElement("strong", null, value);
    const metricLabel = createElement("span", null, label);

    metric.setAttribute("aria-label", `${value} ${label}`);
    metric.append(metricValue, metricLabel);
    return metric;
  }

  function buildModeButton(sortMode, label, ariaLabel) {
    const button = createElement("button", "mealshark-mode-button", label);

    button.type = "button";
    button.dataset.sortMode = sortMode;
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", () => {
      state.sortMode =
        sortMode === SORT_MODES.CREDIT_DESC && isCreditSortMode(state.sortMode)
          ? state.sortMode
          : sortMode;
      saveSettings();
      render();
    });

    return button;
  }

  function setMetric(metric, value, label) {
    const valueElement = metric.querySelector("strong");
    const labelElement = metric.querySelector("span");

    if (valueElement) {
      valueElement.textContent = value;
    }

    if (labelElement && label !== undefined) {
      labelElement.textContent = label;
    }

    metric.setAttribute("aria-label", `${value} ${labelElement?.textContent || ""}`.trim());
  }

  function handleMenuPayload(payload) {
    if (!payload || !Array.isArray(payload.meals)) {
      return;
    }

    if (payload.url && payload.url !== state.menuUrl) {
      state.mealPalFilter = null;
    }

    state.meals = payload.meals;
    state.mealIndex = buildMealIndex(state.meals);
    state.menuUrl = payload.url || "";
    state.capturedAt = payload.capturedAt || new Date().toISOString();
    state.cityName = safeString(payload.cityName);
    state.creditUnitPrice = toFiniteNumber(payload.creditUnitPrice);
    render();
    scheduleMealPalTileAnnotation();
  }

  function handleNativeFilterPayload(payload) {
    const filter = normalizeMealPalFilter(payload);

    if (!filter) {
      return;
    }

    state.mealPalFilter = filter;
    render();
  }

  function handleFavoritesPayload(payload) {
    if (!payload || !Array.isArray(payload.restaurantIds)) {
      return;
    }

    state.favoriteRestaurantIds = new Set(payload.restaurantIds.map(safeString).filter(Boolean));
    render();
  }

  function formatMetricCityName(cityName) {
    return cityName === "New York City" ? "New York" : cityName;
  }

  function buildMetricLabel(label) {
    const cityName = formatMetricCityName(state.cityName);

    return cityName ? `${label} in ${cityName}` : label;
  }

  function getDiscount(meal) {
    const discount = Number(meal.discountPercentage);
    return Number.isFinite(discount) ? discount : 0;
  }

  function getCreditBucket(meal) {
    return toFiniteNumber(meal.mealCreditPrice);
  }

  function isCreditSortMode(sortMode) {
    return sortMode === SORT_MODES.CREDIT_DESC || sortMode === SORT_MODES.CREDIT_ASC;
  }

  function compareByName(left, right) {
    return (
      getRestaurantName(left).localeCompare(getRestaurantName(right)) ||
      getMealName(left).localeCompare(getMealName(right))
    );
  }

  function compareByDiscount(left, right) {
    const discountDifference = getDiscount(right) - getDiscount(left);
    return discountDifference || compareByName(left, right);
  }

  function compareByCreditBucket(left, right, direction) {
    const leftCredit = getCreditBucket(left);
    const rightCredit = getCreditBucket(right);

    if (leftCredit === null && rightCredit === null) {
      return compareByDiscount(left, right);
    }

    if (leftCredit === null) {
      return 1;
    }

    if (rightCredit === null) {
      return -1;
    }

    const creditDifference = direction === "desc" ? rightCredit - leftCredit : leftCredit - rightCredit;
    return creditDifference || compareByDiscount(left, right);
  }

  function sortMeals(meals) {
    const sortedMeals = meals.slice();

    if (state.sortMode === SORT_MODES.CREDIT_DESC) {
      return sortedMeals.sort((left, right) => compareByCreditBucket(left, right, "desc"));
    }

    if (state.sortMode === SORT_MODES.CREDIT_ASC) {
      return sortedMeals.sort((left, right) => compareByCreditBucket(left, right, "asc"));
    }

    return sortedMeals.sort(compareByDiscount);
  }

  function formatDiscount(meal) {
    if (meal.discountLabel) {
      return meal.discountLabel;
    }

    const discount = getDiscount(meal);

    if (!discount) {
      return "0%";
    }

    return `${discount.toFixed(discount % 1 === 0 ? 0 : 1)}%`;
  }

  function parseMoney(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toFiniteNumber(value) {
    const number = typeof value === "number" ? value : Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function getEffectiveMealPrice(meal) {
    const creditPrice = toFiniteNumber(meal.mealCreditPrice);

    if (creditPrice !== null && state.creditUnitPrice !== null) {
      return formatMoney(creditPrice * state.creditUnitPrice);
    }

    const retailPrice = parseMoney(meal.retailPrice);

    if (retailPrice === null) {
      return "";
    }

    return formatMoney(Math.max(retailPrice * (1 - getDiscount(meal) / 100), 0));
  }

  function formatCreditPrice(meal) {
    const creditPrice = meal.mealCreditPrice;
    const creditText = `${creditPrice} ${creditPrice === 1 ? "credit" : "credits"}`;
    const effectivePrice = getEffectiveMealPrice(meal);

    if (!effectivePrice) {
      return creditText;
    }

    return `${creditText} (${effectivePrice})`;
  }

  function formatMealPalTilePrice(meal) {
    const priceParts = [];
    const effectivePrice = getEffectiveMealPrice(meal);

    if (effectivePrice) {
      priceParts.push(effectivePrice);
    }

    if (meal.retailPrice) {
      priceParts.push(`retail ${meal.retailPrice}`);
    }

    return priceParts.join(" | ");
  }

  function getMealName(meal) {
    return meal.mealName || "Unnamed meal";
  }

  function getRestaurantName(meal) {
    return meal.restaurantName || "Unknown restaurant";
  }

  function getMealKey(meal) {
    return meal.scheduleId || meal.mealId || `${meal.restaurantId}:${getMealName(meal)}`;
  }

  function postMapAction(action, meal) {
    window.postMessage(
      {
        source: "mealshark-content",
        type: MAP_ACTION,
        payload: {
          action,
          scheduleId: meal?.scheduleId || "",
          mealId: meal?.mealId || "",
          mealName: getMealName(meal || {}),
          restaurantId: meal?.restaurantId || "",
          restaurantName: getRestaurantName(meal || {}),
          coordinates: meal?.coordinates || null
        }
      },
      window.location.origin
    );
  }

  function findMealPalTiles() {
    return Array.from(document.querySelectorAll("button.bg-white.border.rounded-md")).filter((button) => {
      if (button.closest(`#${ROOT_ID}`)) {
        return false;
      }

      return /\bSAVE\s+\d+(?:\.\d+)?%/i.test(button.innerText || "");
    });
  }

  function getMealPalTileFields(tile) {
    const content = tile.children[1];

    if (!content) {
      return null;
    }

    const fields = Array.from(content.children)
      .filter((child) => !child.classList.contains(APP_TILE_PRICE_CLASS))
      .map((child) => safeString(child.textContent));

    if (fields.length < 2) {
      return null;
    }

    return {
      mealName: fields[0],
      restaurantName: fields[1],
      address: fields[2] || "",
      mealCreditPrice: toFiniteNumber(tile.querySelector(".rounded-meal-credit-price")?.textContent)
    };
  }

  function getMealForTile(tile) {
    const fields = getMealPalTileFields(tile);

    if (!fields) {
      return null;
    }

    const candidates = [
      ...(state.mealIndex.get(buildLookupKey(fields.mealName, fields.restaurantName, fields.address)) || []),
      ...(state.mealIndex.get(buildLookupKey(fields.mealName, fields.restaurantName, "")) || [])
    ];

    if (!candidates.length) {
      return null;
    }

    if (fields.mealCreditPrice !== null) {
      const matchingCreditMeal = candidates.find((meal) => {
        const creditPrice = toFiniteNumber(meal.mealCreditPrice);
        return creditPrice !== null && Math.abs(creditPrice - fields.mealCreditPrice) < 0.01;
      });

      if (matchingCreditMeal) {
        return matchingCreditMeal;
      }
    }

    return candidates[0];
  }

  function annotateMealPalTile(tile) {
    const content = tile.children[1];
    const existingLine = tile.querySelector(`.${APP_TILE_PRICE_CLASS}`);
    const meal = getMealForTile(tile);
    const priceText = meal ? formatMealPalTilePrice(meal) : "";

    if (!content || !priceText) {
      existingLine?.remove();
      tile.classList.remove(APP_TILE_ANNOTATED_CLASS);
      delete tile.dataset.mealsharkPriceKey;
      return;
    }

    const priceKey = `${meal.scheduleId || ""}:${priceText}`;
    let priceLine = existingLine;

    if (!priceLine) {
      priceLine = createElement("div", APP_TILE_PRICE_CLASS);
      const contentChildren = Array.from(content.children).filter(
        (child) => !child.classList.contains(APP_TILE_PRICE_CLASS)
      );
      content.insertBefore(priceLine, contentChildren[3] || null);
    }

    if (tile.dataset.mealsharkPriceKey !== priceKey) {
      priceLine.textContent = priceText;
      tile.dataset.mealsharkPriceKey = priceKey;
    }

    tile.classList.add(APP_TILE_ANNOTATED_CLASS);
  }

  function annotateMealPalTiles() {
    if (!isSupportedPage() || !state.mealIndex.size) {
      return;
    }

    for (const tile of findMealPalTiles()) {
      annotateMealPalTile(tile);
    }
  }

  function scheduleMealPalTileAnnotation() {
    if (!isSupportedPage()) {
      return;
    }

    if (annotationTimer) {
      return;
    }

    annotationTimer = window.setTimeout(() => {
      annotationTimer = 0;
      annotateMealPalTiles();
    }, 100);
  }

  function startMealPalTileObserver() {
    if (tileObserver || !document.body) {
      return;
    }

    tileObserver = new MutationObserver(scheduleMealPalTileAnnotation);
    tileObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener("scroll", scheduleMealPalTileAnnotation, true);
  }

  function render() {
    if (!dom.root) {
      return;
    }

    const supportedPage = isSupportedPage();

    document.documentElement.classList.toggle(PAGE_OPEN_CLASS, supportedPage && !state.collapsed);
    document.documentElement.classList.toggle(PAGE_COLLAPSED_CLASS, supportedPage && state.collapsed);
    dom.root.hidden = !supportedPage;

    if (!supportedPage) {
      dom.bubble.hidden = true;
      dom.panel.hidden = true;
      return;
    }

    dom.root.classList.toggle("mealshark-collapsed", state.collapsed);
    dom.bubble.hidden = !state.collapsed;
    dom.bubble.setAttribute("aria-expanded", String(!state.collapsed));
    dom.panel.hidden = state.collapsed;

    const filteredMeals = getMealPalFilteredMeals();
    const totalNewMeals = state.meals.filter((meal) => meal.isNew);
    const newMeals = filteredMeals.filter((meal) => meal.isNew);
    const listMeals = state.newOnly ? newMeals : filteredMeals;
    const sortedMeals = sortMeals(listMeals).slice(0, state.topN);

    setMetric(dom.totalMealsMetric, String(state.meals.length), buildMetricLabel("Meals"));
    setMetric(dom.newMealsMetric, String(totalNewMeals.length), "New");

    dom.topNInput.value = String(state.topN);
    dom.topNResultText.textContent = `of ${listMeals.length} ${listMeals.length === 1 ? "result" : "results"}`;
    dom.newOnlyInput.checked = state.newOnly;
    dom.emptyState.hidden = state.meals.length > 0;

    for (const button of dom.modeButtons) {
      const sortMode = button.dataset.sortMode;
      const active =
        sortMode === SORT_MODES.CREDIT_DESC ? isCreditSortMode(state.sortMode) : sortMode === state.sortMode;
      button.classList.toggle("mealshark-mode-button-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    const creditModeActive = isCreditSortMode(state.sortMode);
    dom.creditModeGroup.classList.toggle("mealshark-credit-mode-group-active", creditModeActive);
    dom.creditDirectionButton.hidden = !creditModeActive;
    dom.creditDirectionButton.textContent = state.sortMode === SORT_MODES.CREDIT_DESC ? "⬆️" : "⬇️";
    dom.creditDirectionButton.setAttribute(
      "aria-label",
      state.sortMode === SORT_MODES.CREDIT_DESC
        ? "Credit buckets sorted most credits first"
        : "Credit buckets sorted least credits first"
    );
    dom.creditDirectionButton.title =
      state.sortMode === SORT_MODES.CREDIT_DESC ? "Most credits first" : "Least credits first";

    const emptyMessage = !state.meals.length
      ? "No discount data in the captured menu."
      : state.newOnly
        ? "No new meals match the current MealPal filters."
        : "No meals match the current MealPal filters.";

    renderMealList(dom.mealList, sortedMeals, emptyMessage);
  }

  function renderMealList(container, meals, emptyMessage) {
    container.replaceChildren();

    if (!meals.length) {
      container.append(createElement("p", "mealshark-list-empty", emptyMessage));
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const meal of meals) {
      fragment.append(buildMealCard(meal));
    }

    container.append(fragment);
  }

  function buildMealCard(meal) {
    const card = createElement(
      "button",
      meal.imageUrl ? "mealshark-card" : "mealshark-card mealshark-card-no-image"
    );
    const mealKey = getMealKey(meal);

    card.type = "button";
    card.classList.toggle("mealshark-card-active", mealKey === state.selectedMealKey);
    card.setAttribute("aria-label", `${getMealName(meal)} from ${getRestaurantName(meal)}`);

    card.addEventListener("mouseenter", () => {
      postMapAction("highlight", meal);
    });

    card.addEventListener("focus", () => {
      postMapAction("highlight", meal);
    });

    card.addEventListener("mouseleave", () => {
      postMapAction("clear", meal);
    });

    card.addEventListener("blur", () => {
      postMapAction("clear", meal);
    });

    card.addEventListener("click", () => {
      state.selectedMealKey = mealKey;
      postMapAction("select", meal);
      render();
    });

    if (meal.imageUrl) {
      const image = createElement("img", "mealshark-card-image");
      image.src = meal.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);
    }

    const body = createElement("div", "mealshark-card-body");
    const badges = createElement("div", "mealshark-badges");

    if (meal.isNew) {
      badges.append(createElement("span", "mealshark-badge mealshark-badge-new", "New"));
    }

    badges.append(createElement("span", "mealshark-badge mealshark-badge-discount", formatDiscount(meal)));

    const title = createElement("h4", null, getMealName(meal));
    const restaurant = createElement("p", "mealshark-restaurant", getRestaurantName(meal));
    const meta = createElement("p", "mealshark-meta");
    const priceParts = [];

    if (meal.mealCreditPrice !== null && meal.mealCreditPrice !== undefined) {
      priceParts.push(formatCreditPrice(meal));
    }

    if (meal.retailPrice) {
      priceParts.push(`retail ${meal.retailPrice}`);
    }

    meta.textContent = priceParts.join(" | ");
    body.append(badges, title, restaurant);

    if (meta.textContent) {
      body.append(meta);
    }

    if (meal.description) {
      body.append(createElement("p", "mealshark-description", meal.description));
    }

    card.append(body);
    return card;
  }

  function requestLatestMenu() {
    if (!isSupportedPage()) {
      return;
    }

    window.postMessage({ source: "mealshark-content", type: REQUEST_LATEST }, window.location.origin);
  }

  function handleRouteChange() {
    if (window.location.href === currentHref) {
      return;
    }

    currentHref = window.location.href;
    state.mealPalFilter = null;
    savePageSnapshot();
    render();

    if (isSupportedPage()) {
      requestLatestMenu();
      scheduleMealPalTileAnnotation();
    }
  }

  function startRouteObserver() {
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    window.setInterval(handleRouteChange, 500);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) {
      return;
    }

    if (event.data.type === "mealshark-menu") {
      handleMenuPayload(event.data.payload);
    }

    if (event.data.type === NATIVE_FILTER_TYPE) {
      handleNativeFilterPayload(event.data.payload);
    }

    if (event.data.type === FAVORITES_TYPE) {
      handleFavoritesPayload(event.data.payload);
    }
  });

  async function init() {
    savePageSnapshot();
    await loadSettings();

    ready(() => {
      ensureRoot();
      startRouteObserver();
      startMealPalTileObserver();
      render();
      requestLatestMenu();
    });
  }

  init();
})();
