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
  const APP_TILE_ANNOTATED_CLASS = "mealshark-app-tile-annotated";
  const APP_TILE_PRICE_CLASS = "mealshark-app-price-line";
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
    topN: 50,
    newOnly: false,
    sortMode: SORT_MODES.DISCOUNT,
    selectedMealKey: ""
  };

  const dom = {};
  let tileObserver = null;
  let annotationTimer = 0;

  function getPageSnapshot() {
    return {
      href: window.location.href,
      title: document.title,
      capturedAt: new Date().toISOString()
    };
  }

  function savePageSnapshot() {
    chrome.storage.local.set({ [STATE_KEY]: getPageSnapshot() });
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || {};
    const hasCurrentSettings = settings.version === SETTINGS_VERSION;

    state.collapsed = Boolean(settings.collapsed);
    state.topN = hasCurrentSettings ? clampTopN(settings.topN ?? state.topN) : state.topN;
    state.newOnly = Boolean(settings.newOnly);
    state.sortMode = normalizeSortMode(settings.sortMode);
  }

  function saveSettings() {
    chrome.storage.local.set({
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

    return Math.min(Math.max(nextValue, 1), 100);
  }

  function ready(callback) {
    if (document.body) {
      callback();
      return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
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
    const topLabelStart = createElement("span", null, "Display");
    dom.topNInput = createElement("input", "mealshark-top-input");
    dom.topNInput.type = "number";
    dom.topNInput.min = "1";
    dom.topNInput.max = "100";
    dom.topNInput.step = "1";
    dom.topNInput.value = String(state.topN);
    dom.topNInput.setAttribute("aria-label", "Number of results to display");
    const topLabelEnd = createElement("span", null, "results");
    topLabel.append(topLabelStart, dom.topNInput, topLabelEnd);

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

    state.meals = payload.meals;
    state.mealIndex = buildMealIndex(state.meals);
    state.menuUrl = payload.url || "";
    state.capturedAt = payload.capturedAt || new Date().toISOString();
    state.cityName = safeString(payload.cityName);
    state.creditUnitPrice = toFiniteNumber(payload.creditUnitPrice);
    render();
    scheduleMealPalTileAnnotation();
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
    if (!state.mealIndex.size) {
      return;
    }

    for (const tile of findMealPalTiles()) {
      annotateMealPalTile(tile);
    }
  }

  function scheduleMealPalTileAnnotation() {
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

    document.documentElement.classList.toggle(PAGE_OPEN_CLASS, !state.collapsed);
    document.documentElement.classList.toggle(PAGE_COLLAPSED_CLASS, state.collapsed);
    dom.root.classList.toggle("mealshark-collapsed", state.collapsed);
    dom.bubble.hidden = !state.collapsed;
    dom.bubble.setAttribute("aria-expanded", String(!state.collapsed));
    dom.panel.hidden = state.collapsed;

    const newMeals = state.meals.filter((meal) => meal.isNew);
    const listMeals = state.newOnly ? newMeals : state.meals;
    const sortedMeals = sortMeals(listMeals).slice(0, state.topN);

    setMetric(dom.totalMealsMetric, String(state.meals.length), buildMetricLabel("Meals"));
    setMetric(dom.newMealsMetric, String(newMeals.length), "New");

    dom.topNInput.value = String(state.topN);
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

    renderMealList(
      dom.mealList,
      sortedMeals,
      state.newOnly ? "No new meals in the captured menu." : "No discount data in the captured menu."
    );
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
    window.postMessage({ source: "mealshark-content", type: REQUEST_LATEST }, window.location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) {
      return;
    }

    if (event.data.type === "mealshark-menu") {
      handleMenuPayload(event.data.payload);
    }
  });

  async function init() {
    savePageSnapshot();
    await loadSettings();

    ready(() => {
      ensureRoot();
      startMealPalTileObserver();
      render();
      requestLatestMenu();
    });
  }

  init();
})();
