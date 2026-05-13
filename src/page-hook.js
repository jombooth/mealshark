(function () {
  const INSTALLED_KEY = "__mealsharkMenuHookInstalled";
  const PAGE_SOURCE = "mealshark-page-hook";
  const REQUEST_LATEST = "mealshark-request-latest-menu";
  const MAP_ACTION = "mealshark-map-action";

  if (window[INSTALLED_KEY]) {
    return;
  }

  window[INSTALLED_KEY] = true;

  let latestPayload = null;
  let latestMenuBody = null;
  let latestMenuUrl = "";
  let latestDiscounts = new Map();
  let latestCreditUnitPrice = null;
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
      creditUnitPrice: latestCreditUnitPrice,
      meals
    };
  }

  function extractCreditUnitPrice(body) {
    const result = body?.result || {};
    const lunchKits = result.lunchPlanMealKits;

    if (!lunchKits || typeof lunchKits !== "object") {
      return null;
    }

    for (const kit of Object.values(lunchKits)) {
      const price = toNumber(kit?.pricePerMeal);

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

  function parseCurrentUserText(_url, text) {
    try {
      latestCreditUnitPrice = extractCreditUnitPrice(JSON.parse(text));
      postLatestMenu();
    } catch (_error) {
      // Ignore non-JSON or unexpected response shapes.
    }
  }

  function inspectFetchResponse(url, response) {
    const isMenu = isMenuUrl(url);
    const isDiscount = isDiscountUrl(url);
    const isCurrentUser = isCurrentUserUrl(url);

    if (!isMenu && !isDiscount && !isCurrentUser) {
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
          parseCurrentUserText(url, text);
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
        const isCurrentUser = isCurrentUserUrl(url);

        if ((!isMenu && !isDiscount && !isCurrentUser) || typeof this.responseText !== "string") {
          return;
        }

        if (isMenu) {
          parseMenuText(url, this.responseText);
        } else if (isDiscount) {
          parseDiscountText(url, this.responseText);
        } else {
          parseCurrentUserText(url, this.responseText);
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
    }

    if (event.data?.source === "mealshark-content" && event.data?.type === MAP_ACTION) {
      handleMapAction(event.data.payload);
    }
  });
})();
