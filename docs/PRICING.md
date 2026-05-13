# Pricing Fields

Mealshark currently sees two different price concepts in MealPal responses:

1. Plan cost per credit: the estimated cost to the user based on their active plan.
2. MealPal discount metadata: the savings percentage shown by MealPal in the UI.

These do not always reconcile exactly.

## Plan Cost Per Credit

MealPal exposes the logged-in user's active plan credit price from:

```text
POST /1/functions/getCurrentUser
```

The relevant response fields include:

```text
result.planType
result.lunchPlanType
result.lunchPlanMealKits.<kit>.pricePerMeal
```

In the observed account this was:

```json
{
  "result": {
    "lunchPlanMealKits": {
      "standard": {
        "pricePerMeal": "1.16",
        "mealCreditsIssued": 120
      }
    }
  }
}
```

Despite the name `pricePerMeal`, this behaves like the user's plan cost per credit. Mealshark's current "real" price uses:

```text
displayed credits * active plan pricePerMeal
```

Example:

```text
8.5 credits * $1.16 = $9.86
```

The same active-plan credit price also appears in:

```text
GET /api/v1/product_offerings/lunch
```

Useful fields observed there include:

```text
cycle.plan.plan_box_title
cycle.plan.plan_id
cycle.plan.price
cycle.plan.price_per_meal
cycle.plan.plan_meal_kits.<kit>.price_per_meal
cycle.next_plan.price_per_meal
cycle.next_plan.plan_meal_kits.<kit>.price_per_meal
```

In the observed account these product-offering fields also resolved to `$1.16` per credit.

## Tier Coverage

The inspected menu-page responses did not include a catalog of all other tier names or prices. They exposed the current user's active plan/tier metadata and active-plan pricing. For the observed account, `planType` and `lunchPlanType` were `classic`, while the `lunchPlanMealKits` map contained a `standard` kit.

Mealshark therefore does not hard-code only `standard`. It first tries the active plan keys from `planType` / `lunchPlanType`, then falls back to `standard`, then scans any kit entries present in the response. This should support users whose active tier appears under a different kit key, as long as MealPal returns that active tier in `getCurrentUser` or `product_offerings/lunch`.

Mealshark also stores the captured credit price by product offering. This matters because the lunch page can request both `product_offerings/lunch` and `product_offerings/dinner`; a dinner pricing response should not overwrite the unit price used for lunch menu tiles.

If MealPal only returns the active plan on the menu page, Mealshark cannot infer prices for unrelated tiers without capturing a separate plan-selection or subscription-management endpoint.

## Displayed Credits

MealPal's menu endpoint is:

```text
GET /api/v6/cities/:city_id/dates/:date/product_offerings/:offering/spending_strategies/credits/menu
```

Each schedule can expose multiple credit fields:

```text
schedules[].meal_credit_price
schedules[].half_meal_credit_price
schedules[].extended_kitchen_meal_credit_price
schedules[].classic_kitchen_savings_meal_credit_price
```

The MealPal tiles observed in the app often display `half_meal_credit_price`, not `meal_credit_price`. Mealshark therefore prefers:

```text
half_meal_credit_price ?? meal_credit_price
```

This is why a row can show `8.5` credits even when `meal_credit_price` is `8`.

## Retail Price

Retail price comes from the menu response:

```text
schedules[].meal.retail_price_display_string
```

Example:

```text
$15.24
```

## Discount Metadata

MealPal's displayed discount label comes from:

```text
GET /api/v1/cities/:city_id/dates/:date/product_offerings/:offering/spending_strategies/credits/menu_meal_discounts
```

The relevant field is:

```text
[].discount_percentage_markdown
```

Example:

```json
{
  "id": "86e1a3cb-b145-4f97-beda-5c09986d47e8",
  "discount_percentage_markdown": "**SAVE 30%**"
}
```

The menu response also contains fields like:

```text
schedules[].mp_discount_percentage
restaurants[].mp_discount_percentage
```

These can differ from the markdown label. In the observed Turkey Meatball Sub example:

```text
half_meal_credit_price: 8.5
retail_price_display_string: $15.24
menu_meal_discounts label: SAVE 30%
schedule mp_discount_percentage: 0.276
```

## Important Mismatch

For the Turkey Meatball Sub:

```text
Plan-cost math:
8.5 credits * $1.16 = $9.86

Badge-implied math:
$15.24 * (1 - 0.30) = $10.67
```

Those values differ. This means the `SAVE 30%` badge should not be assumed to be derived from the logged-in user's exact plan cost. It appears to be MealPal's own discount metadata, while `pricePerMeal` appears to be the account's plan-level credit cost.

## Current Product Decision

Mealshark currently treats `pricePerMeal` as the best estimate of actual cost to the user and uses it for the displayed "real" price. If that value is unavailable, Mealshark can fall back to deriving price from retail and discount:

```text
retail price * (1 - discount percentage / 100)
```

The fallback is useful, but it is not equivalent to the user's plan cost when the fields disagree.
