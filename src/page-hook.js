(function () {
  const INSTALLED_KEY = "__mealsharkMenuHookInstalled";
  const PAGE_SOURCE = "mealshark-page-hook";
  const REQUEST_LATEST = "mealshark-request-latest-menu";
  const MAP_ACTION = "mealshark-map-action";
  const CREDIT_FILTER_TYPE = "mealshark-credit-filter";

  if (window[INSTALLED_KEY]) {
    return;
  }

  window[INSTALLED_KEY] = true;

  let latestPayload = null;
  let latestMenuBody = null;
  let latestMenuUrl = "";
  let latestDiscounts = new Map();
  let latestCreditUnitPrice = null;
  const latestCreditUnitPrices = new Map();
  let latestCreditFilter = null;
  let latestCreditFilterSignature = "";
  let mapActionToken = 0;

  const HOVER_LAYER_IDS = [
    "green-standard-hover-1",
    "standard-hover-1",
    "pals-green-hover-1",
    "pals-standard-hover-1",
    "pals-sold-out-hover-1",
    "green-standard-hover-2",
    "standard-hover-2",
    "pals-green-hover-2",
    "pals-standard-hover-2",
    "pals-sold-out-hover-2",
    "standard-hover",
    "standard-hover-sold-out"
  ];

  const CREDIT_FILTER_MIN = 1;
  const CREDIT_FILTER_MAX = 14;

  function resolveUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.href;
    }

    return input?.url || "";
  }

  function isMenuUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return (
        parsedUrl.hostname.endsWith("mealpal.com") &&
        /^\/api\/v\d+\/cities\/[^/]+\/dates\/[^/]+\/product_offerings\/[^/]+\/spending_strategies\/[^/]+\/menu\/?$/.test(
          parsedUrl.pathname
        )
      );
    } catch (_error) {
      return false;
    }
  }

  function isDiscountUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return (
        parsedUrl.hostname.endsWith("mealpal.com") &&
        /^\/api\/v\d+\/cities\/[^/]+\/dates\/[^/]+\/product_offerings\/[^/]+\/spending_strategies\/[^/]+\/menu_meal_discounts\/?$/.test(
          parsedUrl.pathname
        )
      );
    } catch (_error) {
      return false;
    }
  }

  function isCurrentUserUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return parsedUrl.hostname.endsWith("mealpal.com") && parsedUrl.pathname === "/1/functions/getCurrentUser";
    } catch (_error) {
      return false;
    }
  }

  function isProductOfferingUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return (
        parsedUrl.hostname.endsWith("mealpal.com") &&
        /^\/api\/v\d+\/product_offerings\/[^/]+\/?$/.test(parsedUrl.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  function getProductOfferingFromUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      const match = parsedUrl.pathname.match(/\/product_offerings\/([^/]+)/);

      return match ? decodeURIComponent(match[1]) : "";
    } catch (_error) {
      return "";
    }
  }

  function toNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toDiscountPercentage(value) {
    const parsed = toNumber(value);

    if (parsed === null) {
      return 0;
    }

    return parsed <= 1 ? parsed * 100 : parsed;
  }

  function parseDiscountMarkdown(value) {
    const markdown = safeString(value);
    const percentage = toNumber(markdown);

    return {
      label: percentage === null ? "" : `${percentage}%`,
      percentage: percentage || 0,
      markdown
    };
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

  function normalizeCoordinates(value) {
    const longitude = toNumber(value?.longitude);
    const latitude = toNumber(value?.latitude);

    if (longitude === null || latitude === null) {
      return null;
    }

    return { longitude, latitude };
  }

  function normalizeMenuResponse(body, url, discountMap) {
    const restaurants = Array.isArray(body?.restaurants) ? body.restaurants : [];
    const meals = [];

    for (const restaurant of restaurants) {
      const schedules = Array.isArray(restaurant?.schedules) ? restaurant.schedules : [];

      for (const schedule of schedules) {
        const meal = schedule?.meal || {};
        const discount = discountMap.get(schedule?.id) || discountMap.get(meal?.id);

        meals.push({
          scheduleId: safeString(schedule?.id),
          mealId: safeString(meal?.id),
          mealName: safeString(meal?.name),
          restaurantId: safeString(restaurant?.id),
          restaurantName: safeString(restaurant?.name),
          address: safeString(restaurant?.address),
          fullAddress: safeString(restaurant?.full_address),
          coordinates: normalizeCoordinates(restaurant?.coordinates),
          neighborhood: safeString(restaurant?.neighborhood),
          cuisine: safeString(meal?.cuisine),
          description: safeString(meal?.description),
          imageUrl: safeString(meal?.image),
          isNew: schedule?.is_featured === true,
          discountLabel: discount?.label || "",
          discountPercentage: discount?.percentage ?? toDiscountPercentage(schedule?.mp_discount_percentage),
          mealCreditPrice: toNumber(schedule?.half_meal_credit_price) ?? toNumber(schedule?.meal_credit_price),
          retailPrice: safeString(meal?.retail_price_display_string)
        });
      }
    }

    return {
      url,
      capturedAt: new Date().toISOString(),
      generatedAt: safeString(body?.generated_at),
      date: safeString(body?.date),
      cityName: safeString(body?.city?.name),
      creditUnitPrice: getCreditUnitPriceForMenu(url),
      meals
    };
  }

  function extractPriceFromKitMap(kitMap, preferredKeys = []) {
    if (!kitMap || typeof kitMap !== "object") {
      return null;
    }

    const orderedKeys = [
      ...preferredKeys.map((key) => safeString(key)),
      ...Object.keys(kitMap)
    ].filter(Boolean);
    const seen = new Set();

    for (const key of orderedKeys) {
      const normalizedKey = key.toLowerCase();

      if (seen.has(normalizedKey)) {
        continue;
      }

      seen.add(normalizedKey);

      const kit = kitMap[key] || kitMap[normalizedKey];
      const price = toNumber(kit?.pricePerMeal ?? kit?.price_per_meal);

      if (price !== null) {
        return price;
      }
    }

    return null;
  }

  function getCreditUnitPriceForMenu(url) {
    const offering = getProductOfferingFromUrl(url);

    if (offering) {
      return latestCreditUnitPrices.get(offering) ?? null;
    }

    return latestCreditUnitPrice;
  }

  function extractUserCreditUnitPrices(body) {
    const result = body?.result || {};
    const preferredPlanKeys = [
      result.lunchPlanType,
      result.planType,
      "standard"
    ];
    const prices = new Map();
    const lunchPrice = extractPriceFromKitMap(result.lunchPlanMealKits, preferredPlanKeys);
    const dinnerPrice = extractPriceFromKitMap(result.dinnerPlanMealKits, [
      result.dinnerPlanType,
      result.planType,
      "standard"
    ]);

    if (lunchPrice !== null) {
      prices.set("lunch", lunchPrice);
    }

    if (dinnerPrice !== null) {
      prices.set("dinner", dinnerPrice);
    }

    return prices;
  }

  function extractProductOfferingCreditUnitPrice(body) {
    const plans = [body?.cycle?.plan, body?.cycle?.next_plan].filter(Boolean);

    for (const plan of plans) {
      const kitPrice = extractPriceFromKitMap(plan?.plan_meal_kits, [plan?.plan_type, plan?.type, "standard"]);

      if (kitPrice !== null) {
        return kitPrice;
      }

      const price = toNumber(plan?.price_per_meal);

      if (price !== null) {
        return price;
      }
    }

    return null;
  }

  function getReactFiber(element, prefix) {
    if (!element) {
      return null;
    }

    const key = Object.keys(element).find((name) => name.startsWith(prefix));
    return key ? element[key] : null;
  }

  function getReactRootFiber() {
    const rootElement = document.getElementById("root");

    return getReactFiber(rootElement, "__reactContainer$") || rootElement?._reactRootContainer?._internalRoot?.current || null;
  }

  function findMapController() {
    const mapElement = document.getElementById("map");
    let fiber = getReactFiber(mapElement, "__reactFiber$");
    const seen = new Set();

    function isMapController(value) {
      return (
        value &&
        typeof value === "object" &&
        typeof value.highlightRestaurant === "function" &&
        typeof value.clearHighlights === "function" &&
        typeof value.createPopup === "function"
      );
    }

    function scanHooks(currentFiber) {
      let hook = currentFiber?.memoizedState;

      for (let index = 0; hook && index < 30; index += 1, hook = hook.next) {
        const value = hook.memoizedState;
        const currentValue = value?.current;

        if (isMapController(value)) {
          return value;
        }

        if (isMapController(currentValue)) {
          return currentValue;
        }
      }

      return null;
    }

    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);

      const controller = scanHooks(fiber);

      if (controller) {
        return controller;
      }

      fiber = fiber.return;
    }

    const stack = [getReactRootFiber()];

    while (stack.length) {
      const currentFiber = stack.pop();

      if (!currentFiber || seen.has(currentFiber)) {
        continue;
      }

      seen.add(currentFiber);

      const controller = scanHooks(currentFiber);

      if (controller) {
        return controller;
      }

      if (currentFiber.sibling) {
        stack.push(currentFiber.sibling);
      }

      if (currentFiber.child) {
        stack.push(currentFiber.child);
      }
    }

    return null;
  }

  function findRestaurant(controller, restaurantId) {
    if (!controller || !Array.isArray(controller.restaurants) || !restaurantId) {
      return null;
    }

    return controller.restaurants.find((restaurant) => restaurant?.id === restaurantId) || null;
  }

  function createCreditFilter(source = "") {
    return {
      capturedAt: new Date().toISOString(),
      source,
      creditMin: null,
      creditMax: null
    };
  }

  function setCreditRangeFromValues(filter, values) {
    const creditValues = values.filter((value) => value !== null && value >= CREDIT_FILTER_MIN && value <= CREDIT_FILTER_MAX);

    if (creditValues.length >= 2) {
      filter.creditMin = Math.min(...creditValues);
      filter.creditMax = Math.max(...creditValues);
    } else if (creditValues.length === 1) {
      filter.creditMin = CREDIT_FILTER_MIN;
      filter.creditMax = creditValues[0];
    }
  }

  function getElementText(element) {
    if (!element) {
      return "";
    }

    const label = element.closest("label");
    const textParts = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.textContent,
      label && label !== element ? label.textContent : ""
    ];

    return textParts.map(safeString).filter(Boolean).join(" ");
  }

  function getAncestorText(element, maxDepth = 4) {
    const textParts = [];
    let current = element;

    for (let depth = 0; current && depth < maxDepth; depth += 1) {
      textParts.push(getElementText(current));
      current = current.parentElement;
    }

    return textParts.join(" ");
  }

  function getControlNumericValue(control) {
    const rawValues = [
      control.getAttribute("aria-valuenow"),
      control.getAttribute("data-value"),
      control.value
    ];

    for (const rawValue of rawValues) {
      const value = toNumber(rawValue);

      if (value !== null) {
        return value;
      }
    }

    return null;
  }

  function extractCreditFilterFromDom(source = "dom") {
    const filter = createCreditFilter(source);
    const creditValues = [];
    const creditControls = document.querySelectorAll("input[type='range']");

    for (const control of creditControls) {
      if (control.closest("#mealshark-root") || !/credits?/.test(normalizeLookupText(getAncestorText(control)))) {
        continue;
      }

      const value = getControlNumericValue(control);

      if (value !== null) {
        creditValues.push(value);
      }
    }

    setCreditRangeFromValues(filter, creditValues);

    return creditValues.length ? filter : null;
  }

  function getCreditFilterSignature(filter) {
    return JSON.stringify({
      creditMin: filter.creditMin,
      creditMax: filter.creditMax
    });
  }

  function getFallbackCreditFilter(source = "default") {
    return {
      ...(latestCreditFilter || createCreditFilter(source)),
      capturedAt: new Date().toISOString(),
      source
    };
  }

  function postCreditFilter(filter = getFallbackCreditFilter("default"), force = false) {
    const creditFilter = filter;
    const signature = getCreditFilterSignature(creditFilter);

    if (!force && signature === latestCreditFilterSignature) {
      return;
    }

    latestCreditFilter = creditFilter;
    latestCreditFilterSignature = signature;
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: CREDIT_FILTER_TYPE,
        payload: creditFilter
      },
      window.location.origin
    );
  }

  function getInteractiveEventElement(target) {
    const element =
      target instanceof Element ? target : target?.parentElement instanceof Element ? target.parentElement : null;

    return element?.closest?.("button,[role='button']") || null;
  }

  function handleCreditFilterEvent(event) {
    const element = getInteractiveEventElement(event.target);

    if (!element || element.closest("#mealshark-root")) {
      return;
    }

    const elementText = normalizeLookupText(getElementText(element));

    if (event.type === "click" && /\b(reset all|reset|clear all)\b/.test(elementText)) {
      postCreditFilter(createCreditFilter("reset"), true);
      return;
    }

    if (event.type === "click" && /\bapply\b/.test(elementText)) {
      postCreditFilter(extractCreditFilterFromDom("apply") || createCreditFilter("apply"), true);
    }
  }

  function startCreditFilterListeners() {
    document.addEventListener("click", handleCreditFilterEvent, true);
  }

  function getActionCoordinates(payload, restaurant) {
    return normalizeCoordinates(payload?.coordinates) || normalizeCoordinates(restaurant?.coordinates);
  }

  function isCoordinateVisible(controller, coordinates) {
    const map = controller?.map;
    const container = map?.getContainer?.();

    if (!map || !container || !coordinates) {
      return true;
    }

    const point = map.project([coordinates.longitude, coordinates.latitude]);
    const margin = 32;

    return (
      point.x >= margin &&
      point.y >= margin &&
      point.x <= container.clientWidth - margin &&
      point.y <= container.clientHeight - margin
    );
  }

  function moveCoordinateIntoView(controller, coordinates) {
    if (!coordinates || isCoordinateVisible(controller, coordinates)) {
      return false;
    }

    const zoom = controller.map?.getZoom?.() || 12;
    controller.moveTo(coordinates, zoom);
    controller.onDragendEventHandler?.();
    return true;
  }

  function isRestaurantHighlighted(controller, restaurantId) {
    const map = controller?.map;

    if (!map || !restaurantId) {
      return false;
    }

    return HOVER_LAYER_IDS.some((layerId) => {
      if (!map.getLayer?.(layerId)) {
        return false;
      }

      return JSON.stringify(map.getFilter(layerId)).includes(restaurantId);
    });
  }

  function highlightRestaurantWithRetry(restaurantId, token, attempt = 0) {
    const controller = findMapController();

    if (!controller || !controller.isInitialized || token !== mapActionToken) {
      return;
    }

    controller.clearHighlights();
    controller.highlightRestaurant(restaurantId);

    if (!isRestaurantHighlighted(controller, restaurantId) && attempt < 8) {
      window.setTimeout(() => {
        highlightRestaurantWithRetry(restaurantId, token, attempt + 1);
      }, 125);
    }
  }

  function createPopupWhenReady(restaurantId, token, attempt = 0) {
    const controller = findMapController();
    const restaurant = findRestaurant(controller, restaurantId);

    if (!controller || !controller.isInitialized || token !== mapActionToken) {
      return;
    }

    if (restaurant?.coordinates) {
      controller.createPopup(restaurant);
      return;
    }

    if (attempt < 8) {
      window.setTimeout(() => {
        createPopupWhenReady(restaurantId, token, attempt + 1);
      }, 125);
    }
  }

  function handleMapAction(payload) {
    const action = payload?.action;
    const restaurantId = safeString(payload?.restaurantId);
    const controller = findMapController();

    if (!controller || !controller.isInitialized) {
      return;
    }

    if (action === "clear") {
      mapActionToken += 1;
      controller.clearHighlights();
      return;
    }

    if (!restaurantId) {
      return;
    }

    const token = (mapActionToken += 1);
    const restaurant = findRestaurant(controller, restaurantId);
    const coordinates = getActionCoordinates(payload, restaurant);

    if (action === "highlight") {
      moveCoordinateIntoView(controller, coordinates);
      highlightRestaurantWithRetry(restaurantId, token);
      return;
    }

    if (action === "select") {
      const moved = moveCoordinateIntoView(controller, coordinates);

      highlightRestaurantWithRetry(restaurantId, token);

      if (!moved && restaurant?.coordinates) {
        controller.createPopup(restaurant);
      } else {
        createPopupWhenReady(restaurantId, token);
      }
    }
  }

  function normalizeDiscountResponse(body) {
    const discounts = new Map();

    if (!Array.isArray(body)) {
      return discounts;
    }

    for (const item of body) {
      const id = safeString(item?.id);

      if (!id) {
        continue;
      }

      discounts.set(id, parseDiscountMarkdown(item?.discount_percentage_markdown));
    }

    return discounts;
  }

  function postLatestMenu() {
    if (!latestMenuBody) {
      return;
    }

    postPayload(normalizeMenuResponse(latestMenuBody, latestMenuUrl, latestDiscounts));
  }

  function postPayload(payload) {
    latestPayload = payload;
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: "mealshark-menu",
        payload
      },
      window.location.origin
    );
  }

  function parseMenuText(url, text) {
    try {
      latestMenuBody = JSON.parse(text);
      latestMenuUrl = url;
      postLatestMenu();
      postCreditFilter(undefined, true);
    } catch (_error) {
      // Ignore non-JSON or malformed responses. The original page request is untouched.
    }
  }

  function parseDiscountText(_url, text) {
    try {
      latestDiscounts = normalizeDiscountResponse(JSON.parse(text));
      postLatestMenu();
    } catch (_error) {
      // Ignore non-JSON or malformed responses. The original page request is untouched.
    }
  }

  function parseCreditPricingText(_url, text) {
    try {
      const body = JSON.parse(text);
      let updated = false;

      if (isCurrentUserUrl(_url)) {
        const prices = extractUserCreditUnitPrices(body);

        for (const [offering, price] of prices) {
          latestCreditUnitPrices.set(offering, price);
          updated = true;
        }

        latestCreditUnitPrice = prices.get("lunch") ?? prices.values().next().value ?? latestCreditUnitPrice;
      } else {
        const offering = getProductOfferingFromUrl(_url);
        const creditUnitPrice = extractProductOfferingCreditUnitPrice(body);

        if (creditUnitPrice !== null) {
          if (offering) {
            latestCreditUnitPrices.set(offering, creditUnitPrice);
          }

          if (!latestMenuUrl || getProductOfferingFromUrl(latestMenuUrl) === offering) {
            latestCreditUnitPrice = creditUnitPrice;
          }

          updated = true;
        }
      }

      if (updated) {
        postLatestMenu();
      }
    } catch (_error) {
      // Ignore non-JSON or unexpected response shapes.
    }
  }

  function inspectFetchResponse(url, response) {
    const isMenu = isMenuUrl(url);
    const isDiscount = isDiscountUrl(url);
    const isCreditPricing = isCurrentUserUrl(url) || isProductOfferingUrl(url);

    if (!isMenu && !isDiscount && !isCreditPricing) {
      return;
    }

    response
      .clone()
      .text()
      .then((text) => {
        if (isMenu) {
          parseMenuText(url, text);
        } else if (isDiscount) {
          parseDiscountText(url, text);
        } else {
          parseCreditPricingText(url, text);
        }
      })
      .catch(() => {});
  }

  const originalFetch = window.fetch;

  if (typeof originalFetch === "function") {
    window.fetch = function mealsharkFetch(input, init) {
      const url = resolveUrl(input);

      return originalFetch.apply(this, arguments).then((response) => {
        inspectFetchResponse(url || response.url, response);
        return response;
      });
    };
  }

  const originalOpen = window.XMLHttpRequest?.prototype?.open;
  const originalSend = window.XMLHttpRequest?.prototype?.send;

  if (originalOpen && originalSend) {
    window.XMLHttpRequest.prototype.open = function mealsharkOpen(method, url) {
      this.__mealsharkUrl = resolveUrl(url);
      return originalOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function mealsharkSend() {
      this.addEventListener("load", function mealsharkLoad() {
        const url = this.__mealsharkUrl || this.responseURL || "";
        const isMenu = isMenuUrl(url);
        const isDiscount = isDiscountUrl(url);
        const isCreditPricing = isCurrentUserUrl(url) || isProductOfferingUrl(url);

        if ((!isMenu && !isDiscount && !isCreditPricing) || typeof this.responseText !== "string") {
          return;
        }

        if (isMenu) {
          parseMenuText(url, this.responseText);
        } else if (isDiscount) {
          parseDiscountText(url, this.responseText);
        } else {
          parseCreditPricingText(url, this.responseText);
        }
      });

      return originalSend.apply(this, arguments);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    if (event.data?.type === REQUEST_LATEST && latestPayload) {
      window.postMessage(
        {
          source: PAGE_SOURCE,
          type: "mealshark-menu",
          payload: latestPayload
        },
        window.location.origin
      );
      postCreditFilter(undefined, true);
    }

    if (event.data?.source === "mealshark-content" && event.data?.type === MAP_ACTION) {
      handleMapAction(event.data.payload);
    }
  });

  startCreditFilterListeners();
})();
