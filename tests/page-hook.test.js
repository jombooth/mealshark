// Unit tests for page-hook.js response normalization, fed in the same order
// the browser receives responses: user -> inventories -> discounts -> menu.
// All fixture data is synthetic and Bob's Burgers themed — never real MealPal data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { messages } = require("./helpers/env.js");
const hook = require("../src/page-hook.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

const CITY = "b0b50000-0000-4000-8000-0000000000c1";
const MENU_URL = `https://secure.mealpal.com/api/v6/cities/${CITY}/dates/2026-07-24/product_offerings/lunch/spending_strategies/credits/menu`;
const DISCOUNTS_URL = `https://secure.mealpal.com/api/v1/cities/${CITY}/dates/2026-07-24/product_offerings/lunch/spending_strategies/credits/menu_meal_discounts`;
const INVENTORIES_URL = `https://secure.mealpal.com/api/v1/cities/${CITY}/dates/2026-07-24/product_offerings/lunch/spending_strategies/credits/menu_inventories`;
const USER_URL = "https://secure.mealpal.com/1/functions/getCurrentUser";

hook.parseCreditPricingText(USER_URL, fixture("get_current_user.json"));
hook.parseInventoriesText(INVENTORIES_URL, fixture("menu_inventories.json"));
hook.parseDiscountText(DISCOUNTS_URL, fixture("menu_meal_discounts.json"));
hook.parseMenuText(MENU_URL, fixture("menu.json"));

const payload = hook.getLatestPayload();
const byName = (name) => payload.meals.find((meal) => meal.mealName === name);

test("menu payload basics", () => {
  assert.equal(payload.cityName, "Seymour's Bay");
  assert.equal(payload.date, "2026-07-24");
  assert.equal(payload.creditUnitPrice, 1.2);
  assert.equal(payload.meals.length, 7);
});

test("pal pricing subtracts the restaurant credit discount", () => {
  const burger = byName("New Bacon-ings Burger");
  assert.equal(burger.baseCreditPrice, 12);
  assert.equal(burger.mealCreditPrice, 10);

  // Non-pal restaurants keep base === effective.
  const pizza = byName("You Wanna Pizza Me? Pie");
  assert.equal(pizza.baseCreditPrice, 12);
  assert.equal(pizza.mealCreditPrice, 12);
});

test("discount is computed from credit cost vs retail", () => {
  // 10 credits x $1.20 = $12.00 against $18.10 retail -> 33.7% -> 34
  const burger = byName("New Bacon-ings Burger");
  assert.equal(burger.discountPercentage, 34);
  assert.equal(burger.discountComputed, true);
  assert.equal(burger.discountLabel, "");

  // Pal pricing applies restaurant-wide: 8 x 1.2 = 9.6 vs 15 -> 36
  assert.equal(byName("Sweaty Palms Hearts of Palm Burger").discountPercentage, 36);
  // 12 x 1.2 = 14.4 vs 24 -> 40
  assert.equal(byName("Poutine on the Ritz Burger").discountPercentage, 40);
  // 11.5 x 1.2 = 13.8 vs 19 -> 27.4 -> 27
  assert.equal(byName("Kuchi Kopi Nightlight Roll").discountPercentage, 27);
  // 9 x 1.2 = 10.8 vs 13.5 -> 20
  assert.equal(byName("The Falafel Waffle").discountPercentage, 20);
});

test("computed discount overrides the API markdown when retail is known", () => {
  const pizza = byName("You Wanna Pizza Me? Pie");
  // markdown says 35, but 12 x 1.2 = 14.4 vs $20 -> 28
  assert.equal(pizza.discountPercentage, 28);
  assert.equal(pizza.discountComputed, true);
});

test("markdown discount survives when retail is missing", () => {
  const mystery = byName("Mort's Mystery Casket Combo");
  assert.equal(mystery.discountComputed, false);
  assert.equal(mystery.discountLabel, "35%");
  assert.equal(mystery.discountPercentage, 35);
});

test("inventories flag sold-out meals", () => {
  assert.equal(byName("Poutine on the Ritz Burger").soldOut, true);
  assert.equal(byName("New Bacon-ings Burger").soldOut, false);
});

test("veg and isNew flags flow through", () => {
  assert.equal(byName("Sweaty Palms Hearts of Palm Burger").veg, true);
  assert.equal(byName("New Bacon-ings Burger").veg, false);
  assert.equal(byName("New Bacon-ings Burger").isNew, true);
  assert.equal(byName("Poutine on the Ritz Burger").isNew, false);
});

test("favorites from getCurrentUser are posted", () => {
  const favorites = messages.filter((m) => m.type === "mealshark-favorites").pop();
  assert.ok(favorites, "expected a mealshark-favorites message");
  assert.deepEqual(favorites.payload.restaurantIds, [
    "b0b50000-0000-4000-8000-0000000000r1",
    "b0b50000-0000-4000-8000-0000000000r4"
  ]);
});

test("coordinates are normalized to numbers", () => {
  const burger = byName("New Bacon-ings Burger");
  assert.deepEqual(burger.coordinates, { longitude: -73.98, latitude: 40.615 });
});
