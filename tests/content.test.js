// Unit tests for content.js filtering, sorting, pricing display, and bounds.
// All fixture data is synthetic and Bob's Burgers themed — never real MealPal data.
const test = require("node:test");
const assert = require("node:assert/strict");

require("./helpers/env.js");
const content = require("../src/content.js");

const { state } = content;

const meal = (overrides = {}) => ({
  scheduleId: "b0b50000-0000-4000-8000-0000000000s0",
  mealId: "b0b50000-0000-4000-8000-0000000000m0",
  mealName: "Burger of the Day",
  restaurantId: "b0b50000-0000-4000-8000-0000000000r1",
  restaurantName: "Bob's Burgers - Ocean Ave",
  address: "123 Ocean Ave",
  coordinates: { longitude: -73.98, latitude: 40.615 },
  cuisine: "american",
  veg: false,
  description: "beef, bun, existential dread",
  isNew: false,
  soldOut: false,
  discountLabel: "",
  discountPercentage: 30,
  discountComputed: true,
  mealCreditPrice: 10,
  baseCreditPrice: 10,
  retailPrice: "$18.00",
  ...overrides
});

const filter = (overrides = {}) =>
  content.normalizeMealPalFilter({
    capturedAt: "2026-07-24T12:00:00Z",
    source: "test",
    creditMin: null,
    creditMax: null,
    vegetarianOnly: false,
    cuisines: null,
    favoritesOnly: false,
    searchText: "",
    ...overrides
  });

test("credit range filter", () => {
  assert.equal(content.mealMatchesMealPalFilter(meal(), filter({ creditMin: 1, creditMax: 14 })), true);
  assert.equal(content.mealMatchesMealPalFilter(meal(), filter({ creditMax: 9 })), false);
  assert.equal(content.mealMatchesMealPalFilter(meal({ mealCreditPrice: 9 }), filter({ creditMax: 9 })), true);
});

test("vegetarian filter", () => {
  const gene = meal({ mealName: "The Gene-ral Tso Veggie Burger", veg: true });
  assert.equal(content.mealMatchesMealPalFilter(gene, filter({ vegetarianOnly: true })), true);
  assert.equal(content.mealMatchesMealPalFilter(meal(), filter({ vegetarianOnly: true })), false);
});

test("cuisine filter uses normalized bucket values", () => {
  const pesto = meal({ restaurantName: "Jimmy Pesto's Pizzeria", cuisine: "italian" });
  assert.equal(content.mealMatchesMealPalFilter(pesto, filter({ cuisines: ["italian"] })), true);
  assert.equal(content.mealMatchesMealPalFilter(pesto, filter({ cuisines: ["american", "asian"] })), false);
  // null means "no cuisine restriction"
  assert.equal(content.mealMatchesMealPalFilter(pesto, filter({ cuisines: null })), true);
});

test("favorites filter fails open until data arrives", () => {
  state.favoriteRestaurantIds = null;
  assert.equal(content.mealMatchesMealPalFilter(meal(), filter({ favoritesOnly: true })), true);

  state.favoriteRestaurantIds = new Set(["b0b50000-0000-4000-8000-0000000000r1"]);
  assert.equal(content.mealMatchesMealPalFilter(meal(), filter({ favoritesOnly: true })), true);
  const pesto = meal({ restaurantId: "b0b50000-0000-4000-8000-0000000000r2" });
  assert.equal(content.mealMatchesMealPalFilter(pesto, filter({ favoritesOnly: true })), false);
  state.favoriteRestaurantIds = null;
});

test("search matches meal name, restaurant, and description", () => {
  const teddy = meal({
    mealName: "Teddy's Handyman Special",
    restaurantName: "Bob's Burgers - Ocean Ave",
    description: "burger, loose screws, free advice"
  });
  assert.equal(content.mealMatchesMealPalFilter(teddy, filter({ searchText: "handyman" })), true);
  assert.equal(content.mealMatchesMealPalFilter(teddy, filter({ searchText: "ocean ave" })), true);
  assert.equal(content.mealMatchesMealPalFilter(teddy, filter({ searchText: "loose screws" })), true);
  assert.equal(content.mealMatchesMealPalFilter(teddy, filter({ searchText: "jimmy pesto" })), false);
});

test("map bounds filtering", () => {
  const bounds = { west: -73.99, east: -73.97, south: 40.61, north: 40.62 };
  assert.equal(content.mealInMapBounds(meal(), bounds), true);
  const wharf = meal({ coordinates: { longitude: -73.995, latitude: 40.605 } });
  assert.equal(content.mealInMapBounds(wharf, bounds), false);
  const lost = meal({ coordinates: null });
  assert.equal(content.mealInMapBounds(lost, bounds), false);
});

test("discount sort ranks by computed percentage", () => {
  state.sortMode = "discount";
  const low = meal({ mealName: "A", discountPercentage: 20 });
  const high = meal({ mealName: "B", discountPercentage: 51 });
  const mid = meal({ mealName: "C", discountPercentage: 34 });
  assert.deepEqual(
    content.sortMeals([low, high, mid]).map((m) => m.mealName),
    ["B", "C", "A"]
  );
});

test("credit bucket sort groups by effective credits, discount breaks ties", () => {
  state.sortMode = "credit-desc";
  const meals = [
    meal({ mealName: "cheap-good", mealCreditPrice: 8, discountPercentage: 50 }),
    meal({ mealName: "dear-good", mealCreditPrice: 14, discountPercentage: 40 }),
    meal({ mealName: "dear-best", mealCreditPrice: 14, discountPercentage: 60 })
  ];
  assert.deepEqual(
    content.sortMeals(meals).map((m) => m.mealName),
    ["dear-best", "dear-good", "cheap-good"]
  );
  state.sortMode = "credit-asc";
  assert.deepEqual(
    content.sortMeals(meals).map((m) => m.mealName),
    ["cheap-good", "dear-best", "dear-good"]
  );
  state.sortMode = "discount";
});

test("pal pricing display mirrors the app's arrow format", () => {
  state.creditUnitPrice = 1.2;
  const pal = meal({ baseCreditPrice: 12, mealCreditPrice: 10 });
  assert.equal(content.formatCreditPrice(pal), "12 ➞ 10 credits ($12.00)");
  assert.equal(content.formatCreditPrice(meal()), "10 credits ($12.00)");
  state.creditUnitPrice = null;
});

test("formatDiscount prefers the label only when the value was not computed", () => {
  assert.equal(content.formatDiscount(meal({ discountPercentage: 34, discountLabel: "" })), "34%");
  assert.equal(content.formatDiscount(meal({ discountComputed: false, discountLabel: "35%", discountPercentage: 35 })), "35%");
});

test("summary title uses the menu date's weekday", () => {
  state.menuDate = "2026-07-24";
  assert.equal(content.buildSummaryTitle(), "Friday's stats");
  state.menuDate = "";
  assert.equal(content.buildSummaryTitle(), "Stats");
});
