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

  const state = {
    collapsed: false,
    meals: [],
    menuUrl: "",
    capturedAt: "",
    topN: 50,
    newOnly: false,
    selectedMealKey: ""
  };

  const dom = {};

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
  }

  function saveSettings() {
    chrome.storage.local.set({
      [SETTINGS_KEY]: {
        version: SETTINGS_VERSION,
        collapsed: state.collapsed,
        topN: state.topN,
        newOnly: state.newOnly
      }
    });
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

    const controls = createElement("div", "mealshark-controls");
    const topLabel = createElement("label", "mealshark-top-label");
    const topLabelText = createElement("span", null, "Results displayed");
    dom.topNInput = createElement("input", "mealshark-top-input");
    dom.topNInput.type = "number";
    dom.topNInput.min = "1";
    dom.topNInput.max = "100";
    dom.topNInput.step = "1";
    dom.topNInput.value = String(state.topN);
    topLabel.append(topLabelText, dom.topNInput);

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
    mealSection.append(buildSectionHeader("Best discounts"));
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

    metric.append(metricValue, metricLabel);
    return metric;
  }

  function setMetric(metric, value) {
    const valueElement = metric.querySelector("strong");

    if (valueElement) {
      valueElement.textContent = value;
    }
  }

  function buildSectionHeader(title) {
    const header = createElement("div", "mealshark-section-header");
    const titleElement = createElement("h3", null, title);

    header.append(titleElement);
    return header;
  }

  function handleMenuPayload(payload) {
    if (!payload || !Array.isArray(payload.meals)) {
      return;
    }

    state.meals = payload.meals;
    state.menuUrl = payload.url || "";
    state.capturedAt = payload.capturedAt || new Date().toISOString();
    render();
  }

  function getDiscount(meal) {
    const discount = Number(meal.discountPercentage);
    return Number.isFinite(discount) ? discount : 0;
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

  function formatCreditPrice(meal) {
    const creditPrice = meal.mealCreditPrice;
    const creditText = `${creditPrice} ${creditPrice === 1 ? "credit" : "credits"}`;
    const retailPrice = parseMoney(meal.retailPrice);

    if (retailPrice === null) {
      return creditText;
    }

    const effectivePrice = retailPrice * (1 - getDiscount(meal) / 100);
    const formattedPrice = formatMoney(Math.max(effectivePrice, 0));

    return formattedPrice ? `${creditText} (${formattedPrice})` : creditText;
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
    const filteredDiscounts = listMeals
      .slice()
      .sort((left, right) => getDiscount(right) - getDiscount(left))
      .slice(0, state.topN);

    setMetric(dom.totalMealsMetric, String(state.meals.length));
    setMetric(dom.newMealsMetric, String(newMeals.length));

    dom.topNInput.value = String(state.topN);
    dom.newOnlyInput.checked = state.newOnly;
    dom.emptyState.hidden = state.meals.length > 0;

    renderMealList(
      dom.mealList,
      filteredDiscounts,
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
      render();
      requestLatestMenu();
    });
  }

  init();
})();
