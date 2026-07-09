(function () {
  const INSTALLED_KEY = "__mealsharkMenuHookInstalled";
  const PAGE_SOURCE = "mealshark-page-hook";
  const REQUEST_LATEST = "mealshark-request-latest-menu";
  const MAP_ACTION = "mealshark-map-action";
  const NATIVE_FILTER_TYPE = "mealshark-native-filter";
  const FAVORITES_TYPE = "mealshark-favorites";
  const MAP_BOUNDS_TYPE = "mealshark-map-bounds";

  if (window[INSTALLED_KEY]) {
    return;
  }

  window[INSTALLED_KEY] = true;

  let latestPayload = null;
  let latestMenuBody = null;
  let latestMenuUrl = "";
  let latestDiscounts = new Map();
  let latestInventories = new Map();
  let latestCreditUnitPrice = null;
  const latestCreditUnitPrices = new Map();
  let latestNativeFilter = null;
  let latestNativeFilterSignature = "";
  let latestFavoriteRestaurants = null;
  let searchInputDebounce = 0;
  let mapActionToken = 0;
  let cachedMapController = null;
  let latestMapBoundsSignature = "";

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

  function isInventoriesUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return (
        parsedUrl.hostname.endsWith("mealpal.com") &&
        /^\/api\/v\d+\/cities\/[^/]+\/dates\/[^/]+\/product_offerings\/[^/]+\/spending_strategies\/[^/]+\/menu_inventories\/?$/.test(
          parsedUrl.pathname
        )
      );
    } catch (_error) {
      return false;
    }
  }

  function isFavoritesFunctionUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return (
        parsedUrl.hostname.endsWith("mealpal.com") &&
        /^\/1\/functions\/(updateFavoriteRestaurants|removeRestaurantFromFavorites)$/.test(parsedUrl.pathname)
      );
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

  function parseMoneyString(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeMenuResponse(body, url, discountMap) {
    const restaurants = Array.isArray(body?.restaurants) ? body.restaurants : [];
    const creditUnitPrice = getCreditUnitPriceForMenu(url);
    const meals = [];

    for (const restaurant of restaurants) {
      const schedules = Array.isArray(restaurant?.schedules) ? restaurant.schedules : [];
      // "Pal pricing": a restaurant-level credit discount, shown as e.g. "14 ➞ 12".
      const creditDiscount = toNumber(restaurant?.meal_credit_discount) || 0;

      for (const schedule of schedules) {
        const meal = schedule?.meal || {};
        const discount = discountMap.get(schedule?.id) || discountMap.get(meal?.id);
        const baseCreditPrice = toNumber(schedule?.half_meal_credit_price) ?? toNumber(schedule?.meal_credit_price);
        const mealCreditPrice = baseCreditPrice === null ? null : Math.max(baseCreditPrice - creditDiscount, 0);
        const retailPrice = safeString(meal?.retail_price_display_string);
        const retailAmount = parseMoneyString(retailPrice);
        let discountLabel = discount?.label || "";
        let discountPercentage = discount?.percentage ?? toDiscountPercentage(schedule?.mp_discount_percentage);
        let discountComputed = false;

        // The API's discount figures don't account for pal pricing (and can be
        // plain wrong); prefer the actual credit cost against retail.
        if (mealCreditPrice !== null && creditUnitPrice !== null && retailAmount !== null && retailAmount > 0) {
          discountPercentage = Math.round(Math.max((1 - (mealCreditPrice * creditUnitPrice) / retailAmount) * 100, 0));
          discountLabel = "";
          discountComputed = true;
        }

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
          veg: meal?.veg === true,
          description: safeString(meal?.description),
          imageUrl: safeString(meal?.image),
          isNew: schedule?.is_featured === true,
          soldOut: latestInventories.get(safeString(schedule?.id)) === 0,
          discountLabel,
          discountPercentage,
          discountComputed,
          mealCreditPrice,
          baseCreditPrice,
          retailPrice
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

  function isMealSearchInput(input) {
    if (!(input instanceof HTMLInputElement) || input.closest("#mealshark-root")) {
      return false;
    }

    const labelText = `${input.getAttribute("placeholder") || ""} ${input.getAttribute("aria-label") || ""}`;

    // The location geocoder is also a "Search by..." input; typing an address
    // there must not become a meal filter.
    if (input.closest(".mapboxgl-ctrl-geocoder") || /location/i.test(labelText)) {
      return false;
    }

    return /search/i.test(labelText);
  }

  function findMealPalSearchInput() {
    return (
      Array.from(document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])")).find(
        isMealSearchInput
      ) || null
    );
  }

  function getLiveSearchText() {
    return safeString(findMealPalSearchInput()?.value);
  }

  function createNativeFilter(source = "") {
    return {
      capturedAt: new Date().toISOString(),
      source,
      creditMin: null,
      creditMax: null,
      vegetarianOnly: false,
      cuisines: null,
      favoritesOnly: false,
      searchText: getLiveSearchText()
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

  function extractNativeFilterFromDom(source = "dom") {
    const filter = createNativeFilter(source);
    const creditValues = [];
    let sawControls = false;

    for (const control of document.querySelectorAll("input[type='range']")) {
      if (control.closest("#mealshark-root") || !/credits?/.test(normalizeLookupText(getAncestorText(control)))) {
        continue;
      }

      const value = getControlNumericValue(control);

      if (value !== null) {
        creditValues.push(value);
        sawControls = true;
      }
    }

    setCreditRangeFromValues(filter, creditValues);

    // The MealPal filter bar renders plain checkboxes whose value attributes
    // name what they filter: "vegetarian", "favorite", or a cuisine bucket.
    const checkedCuisines = [];
    let sawUncheckedCuisine = false;

    for (const control of document.querySelectorAll("input[type='checkbox']")) {
      const value = normalizeLookupText(control.value);

      if (control.closest("#mealshark-root") || !value || value === "on") {
        continue;
      }

      sawControls = true;

      if (value === "vegetarian") {
        filter.vegetarianOnly = control.checked;
      } else if (value === "favorite" || value === "favorites") {
        filter.favoritesOnly = control.checked;
      } else if (control.checked) {
        checkedCuisines.push(value);
      } else {
        sawUncheckedCuisine = true;
      }
    }

    if (sawUncheckedCuisine) {
      filter.cuisines = checkedCuisines;
    }

    return sawControls ? filter : null;
  }

  function getNativeFilterSignature(filter) {
    return JSON.stringify({
      creditMin: filter.creditMin,
      creditMax: filter.creditMax,
      vegetarianOnly: filter.vegetarianOnly,
      cuisines: filter.cuisines,
      favoritesOnly: filter.favoritesOnly,
      searchText: filter.searchText
    });
  }

  function getFallbackNativeFilter(source = "default") {
    return {
      ...createNativeFilter(source),
      ...(latestNativeFilter || {}),
      capturedAt: new Date().toISOString(),
      source,
      searchText: getLiveSearchText()
    };
  }

  function postNativeFilter(filter = getFallbackNativeFilter("default"), force = false) {
    const nativeFilter = filter;
    const signature = getNativeFilterSignature(nativeFilter);

    if (!force && signature === latestNativeFilterSignature) {
      return;
    }

    latestNativeFilter = nativeFilter;
    latestNativeFilterSignature = signature;
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: NATIVE_FILTER_TYPE,
        payload: nativeFilter
      },
      window.location.origin
    );
  }

  function postFavorites() {
    if (!Array.isArray(latestFavoriteRestaurants)) {
      return;
    }

    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: FAVORITES_TYPE,
        payload: {
          capturedAt: new Date().toISOString(),
          restaurantIds: latestFavoriteRestaurants
        }
      },
      window.location.origin
    );
  }

  function updateFavoritesFromUserResult(result) {
    if (!Array.isArray(result?.favoriteRestaurants)) {
      return;
    }

    latestFavoriteRestaurants = result.favoriteRestaurants.map(safeString).filter(Boolean);
    postFavorites();
  }

  function parseFavoritesText(_url, text) {
    try {
      updateFavoritesFromUserResult(JSON.parse(text)?.result);
    } catch (_error) {
      // Ignore non-JSON or unexpected response shapes.
    }
  }

  function getValidMapController() {
    if (!document.getElementById("map")) {
      cachedMapController = null;
      return null;
    }

    const container = cachedMapController?.map?.getContainer?.();

    if (!container || !container.isConnected) {
      cachedMapController = findMapController();
    }

    return cachedMapController;
  }

  function postMapBounds(force = false) {
    const map = getValidMapController()?.map;
    const bounds = map?.getBounds?.();

    if (!bounds) {
      return;
    }

    const payload = {
      west: Number(bounds.getWest().toFixed(5)),
      south: Number(bounds.getSouth().toFixed(5)),
      east: Number(bounds.getEast().toFixed(5)),
      north: Number(bounds.getNorth().toFixed(5))
    };
    const signature = JSON.stringify(payload);

    if (!force && signature === latestMapBoundsSignature) {
      return;
    }

    latestMapBoundsSignature = signature;
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: MAP_BOUNDS_TYPE,
        payload: { ...payload, capturedAt: new Date().toISOString() }
      },
      window.location.origin
    );
  }

  function startMapBoundsObserver() {
    window.setInterval(postMapBounds, 700);
  }

  function getInteractiveEventElement(target) {
    const element =
      target instanceof Element ? target : target?.parentElement instanceof Element ? target.parentElement : null;

    return element?.closest?.("button,[role='button']") || null;
  }

  function handleNativeFilterEvent(event) {
    const element = getInteractiveEventElement(event.target);

    if (!element || element.closest("#mealshark-root")) {
      return;
    }

    const elementText = normalizeLookupText(getElementText(element));

    if (event.type === "click" && /\b(reset all|reset|clear all)\b/.test(elementText)) {
      postNativeFilter(createNativeFilter("reset"), true);
      return;
    }

    if (event.type === "click" && /\bapply\b/.test(elementText)) {
      postNativeFilter(extractNativeFilterFromDom("apply") || createNativeFilter("apply"), true);
    }
  }

  function handleSearchInputEvent(event) {
    if (!isMealSearchInput(event.target)) {
      return;
    }

    window.clearTimeout(searchInputDebounce);
    searchInputDebounce = window.setTimeout(() => {
      postNativeFilter(getFallbackNativeFilter("search"));
    }, 250);
  }

  function startNativeFilterListeners() {
    document.addEventListener("click", handleNativeFilterEvent, true);
    document.addEventListener("input", handleSearchInputEvent, true);
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
    const rect = container.getBoundingClientRect();
    const margin = 32;
    const visibleLeft = Math.max(rect.left, 0) + margin;
    const visibleTop = Math.max(rect.top, 0) + margin;
    const visibleRight = Math.min(rect.right, window.innerWidth) - margin;
    const visibleBottom = Math.min(rect.bottom, window.innerHeight) - margin;
    const viewportX = rect.left + point.x;
    const viewportY = rect.top + point.y;

    return (
      viewportX >= visibleLeft &&
      viewportY >= visibleTop &&
      viewportX <= visibleRight &&
      viewportY <= visibleBottom
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

  function findRawRestaurantForPayload(payload) {
    const restaurants = Array.isArray(latestMenuBody?.restaurants) ? latestMenuBody.restaurants : [];
    const restaurantId = safeString(payload?.restaurantId);
    const scheduleId = safeString(payload?.scheduleId);
    const mealId = safeString(payload?.mealId);

    for (const restaurant of restaurants) {
      const schedules = Array.isArray(restaurant?.schedules) ? restaurant.schedules : [];

      if (restaurantId && restaurant?.id === restaurantId) {
        return { restaurant, schedules };
      }

      const matchingSchedules = schedules.filter((schedule) => {
        return (
          (scheduleId && schedule?.id === scheduleId) ||
          (mealId && schedule?.meal?.id === mealId)
        );
      });

      if (matchingSchedules.length) {
        return { restaurant, schedules: matchingSchedules };
      }
    }

    return null;
  }

  function createModelLike(sample, values) {
    return Object.assign(sample ? Object.create(Object.getPrototypeOf(sample)) : {}, values);
  }

  function normalizePopupMeal(rawMeal, sampleMeal) {
    return createModelLike(sampleMeal, {
      id: safeString(rawMeal?.id),
      name: safeString(rawMeal?.name),
      imageUrl: safeString(rawMeal?.image),
      cuisine: safeString(rawMeal?.cuisine),
      description: safeString(rawMeal?.description),
      vegetarian: rawMeal?.veg === true,
      healthy: rawMeal?.healthy === true,
      healthySubtext: safeString(rawMeal?.healthy_subtext),
      retailPriceDisplayString: safeString(rawMeal?.retail_price_display_string),
      mealGroup: safeString(rawMeal?.meal_group),
      portionSizeKey: safeString(rawMeal?.portion_size_key)
    });
  }

  function normalizePopupSchedule(rawSchedule, rawRestaurant, sampleSchedule) {
    const rawMeal = rawSchedule?.meal || {};
    const sampleMeal = sampleSchedule?.meal || null;
    const discount = latestDiscounts.get(rawSchedule?.id) || latestDiscounts.get(rawMeal?.id);
    const schedule = createModelLike(sampleSchedule, {
      id: safeString(rawSchedule?.id),
      meal: normalizePopupMeal(rawMeal, sampleMeal),
      amount: toNumber(rawSchedule?.amount) ?? 100,
      discountPercentageMarkdown: safeString(discount?.markdown),
      mealCreditPrice: toNumber(rawSchedule?.meal_credit_price),
      halfMealCreditPrice: toNumber(rawSchedule?.half_meal_credit_price),
      priority: toNumber(rawSchedule?.priority) ?? 100,
      restaurantId: safeString(rawRestaurant?.id),
      extendedKitchenMealCreditPrice: toNumber(rawSchedule?.extended_kitchen_meal_credit_price),
      classicKitchenSavingsMealCreditPrice: toNumber(rawSchedule?.classic_kitchen_savings_meal_credit_price),
      extendedKitchenHalfMealCreditPrice: toNumber(rawSchedule?.extended_kitchen_half_meal_credit_price),
      classicKitchenSavingsHalfMealCreditPrice: toNumber(rawSchedule?.classic_kitchen_savings_half_meal_credit_price),
      mpDiscountPercentage: toNumber(rawSchedule?.mp_discount_percentage),
      mealRecommendation: rawSchedule?.meal_recommendation || null,
      packaging: rawSchedule?.packaging || null,
      coworkers: []
    });

    [
      "dryTestPackaging",
      "greenPackaging",
      "isRecommended",
      "isSoldOut",
      "packagingAvailableAfterTenThirty",
      "reusableOrReusableDryTestPackaging",
      "singleUseOrReusableOptionsAvailable",
      "singleUseOrReusableOptionsAvailableWithoutDryTest"
    ].forEach((methodName) => {
      if (typeof schedule[methodName] !== "function") {
        schedule[methodName] = () => false;
      }
    });

    return schedule;
  }

  function createFallbackPopupRestaurant(controller, payload) {
    const rawMatch = findRawRestaurantForPayload(payload);
    const rawRestaurant = rawMatch?.restaurant;
    const rawSchedules = rawMatch?.schedules || [];
    const sampleRestaurant = Array.isArray(controller?.restaurants) ? controller.restaurants[0] : null;
    const sampleSchedule = sampleRestaurant?.schedules?.[0] || null;
    const scheduleId = safeString(payload?.scheduleId);
    const mealId = safeString(payload?.mealId);
    const schedules = rawSchedules.filter((schedule) => {
      return (
        (!scheduleId && !mealId) ||
        (scheduleId && schedule?.id === scheduleId) ||
        (mealId && schedule?.meal?.id === mealId)
      );
    });
    const kitchenTime = Array.isArray(rawRestaurant?.kitchen_times) ? rawRestaurant.kitchen_times[0] : null;

    if (!rawRestaurant || !schedules.length) {
      return null;
    }

    return createModelLike(sampleRestaurant, {
      id: safeString(rawRestaurant?.id),
      name: safeString(rawRestaurant?.name),
      address: safeString(rawRestaurant?.address),
      fullAddress: safeString(rawRestaurant?.full_address),
      city: latestMenuBody?.city || null,
      coordinates: normalizeCoordinates(rawRestaurant?.coordinates),
      kitchenOpen: safeString(kitchenTime?.open),
      kitchenClose: safeString(kitchenTime?.close),
      mealCreditDiscount: toNumber(rawRestaurant?.meal_credit_discount),
      pickUpInstructions: safeString(rawRestaurant?.pick_up_instructions),
      priority: toNumber(rawRestaurant?.priority),
      schedules: schedules.map((schedule) => normalizePopupSchedule(schedule, rawRestaurant, sampleSchedule))
    });
  }

  function openFallbackPopup(controller, payload) {
    const restaurant = createFallbackPopupRestaurant(controller, payload);

    if (!restaurant?.coordinates) {
      return false;
    }

    try {
      controller.createPopup(restaurant);
      return true;
    } catch (_error) {
      return false;
    }
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

  function createPopupWhenReady(restaurantId, token, payload, attempt = 0) {
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
        createPopupWhenReady(restaurantId, token, payload, attempt + 1);
      }, 125);
      return;
    }

    openFallbackPopup(controller, payload);
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
      // Hover must never move the camera: panning on hover is jarring, and
      // with map-area scoping it would rebuild the list mid-hover.
      highlightRestaurantWithRetry(restaurantId, token);
      return;
    }

    if (action === "select") {
      const moved = payload?.suppressMove ? false : moveCoordinateIntoView(controller, coordinates);

      highlightRestaurantWithRetry(restaurantId, token);

      if (!moved && restaurant?.coordinates) {
        controller.createPopup(restaurant);
      } else if (!moved && openFallbackPopup(controller, payload)) {
        return;
      } else {
        createPopupWhenReady(restaurantId, token, payload);
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
      postNativeFilter(undefined, true);
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

  function parseInventoriesText(_url, text) {
    try {
      const body = JSON.parse(text);

      if (!Array.isArray(body)) {
        return;
      }

      latestInventories = new Map();

      for (const item of body) {
        const id = safeString(item?.id);
        const amount = toNumber(item?.amount);

        if (id && amount !== null) {
          latestInventories.set(id, amount);
        }
      }

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
        updateFavoritesFromUserResult(body?.result);

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
    const isInventories = isInventoriesUrl(url);
    const isFavorites = isFavoritesFunctionUrl(url);
    const isCreditPricing = isCurrentUserUrl(url) || isProductOfferingUrl(url);

    if (!isMenu && !isDiscount && !isInventories && !isFavorites && !isCreditPricing) {
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
        } else if (isInventories) {
          parseInventoriesText(url, text);
        } else if (isFavorites) {
          parseFavoritesText(url, text);
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
        const isInventories = isInventoriesUrl(url);
        const isFavorites = isFavoritesFunctionUrl(url);
        const isCreditPricing = isCurrentUserUrl(url) || isProductOfferingUrl(url);

        if ((!isMenu && !isDiscount && !isInventories && !isFavorites && !isCreditPricing) || typeof this.responseText !== "string") {
          return;
        }

        if (isMenu) {
          parseMenuText(url, this.responseText);
        } else if (isDiscount) {
          parseDiscountText(url, this.responseText);
        } else if (isInventories) {
          parseInventoriesText(url, this.responseText);
        } else if (isFavorites) {
          parseFavoritesText(url, this.responseText);
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
      postNativeFilter(undefined, true);
      postFavorites();
      postMapBounds(true);
    }

    if (event.data?.source === "mealshark-content" && event.data?.type === MAP_ACTION) {
      handleMapAction(event.data.payload);
    }
  });

  startNativeFilterListeners();
  startMapBoundsObserver();
})();
