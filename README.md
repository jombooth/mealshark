![Mealshark](assets/store/marquee-1400x560.png)

# Mealshark

Mealshark is a Chrome extension that adds meal discovery tools to MealPal.
It runs on MealPal lunch and dinner pages and helps compare available meals
by discount, credit value, newly added status, and prices (retail and
actual, in USD).

Mealshark is independent and is not affiliated with, endorsed by, or sponsored
by MealPal.

## Features

- Adds a Mealshark panel on MealPal `/lunch` and `/dinner` pages.
- Filter for newly added meals.
- Sorts meals by best discount.
- Sorts meals by best discount given credit value, with credit value ascending and descending.
- Shows meal pricing information transparently in USD.
- Respects MealPal's credit filter when the MealPal filter is set.
- Highlights and opens restaurants on the MealPal map when Mealshark cards are hovered or clicked.

## Gallery

| | |
| --- | --- |
| ![Mealshark newly added meals view](assets/store/screenshots/new-only-large.png) | Filter for new meals only |
| ![Transparent prices on MealPal cards](assets/store/screenshots/transparent-prices.png) | Transparent prices on MealPal cards |
| ![Best discounts across all meals](assets/store/screenshots/best-discount-all.png) | Best discounts across all meals |
| ![Best discounts for credits, high to low](assets/store/screenshots/best-discount-for-credits-high-to-low.png) | Best discounts for a given number of credits, high to low |
| ![Best discounts with a credit limit](assets/store/screenshots/best-discount-limit-credits.png) | Best discounts up to a credit limit |
| ![Best discounts for credits, new only](assets/store/screenshots/best-discount-for-credits-new-only.png) | Best discounts for given number of credits, new only |

## Development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository directory.
5. After editing extension files, reload the extension from `chrome://extensions`
   and refresh the MealPal tab.

## Project Structure

- `manifest.json` configures the Manifest V3 extension.
- `src/page-hook.js` runs in the page context and captures MealPal menu responses.
- `src/content.js` runs on MealPal pages and renders the Mealshark UI.
- `src/content.css` styles the in-page extension UI.
- `src/popup.html`, `src/popup.css`, and `src/popup.js` power the toolbar popup.
- `assets/icons/` contains packaged extension icons.
- `assets/store/` contains Chrome Web Store listing images and screenshots.
- `docs/` contains implementation notes and release runbooks.
- `PRIVACY.md` is the public privacy policy for the Chrome Web Store listing.

## Build

Build the Chrome Web Store upload zip with:

```bash
python3 scripts/build-extension-zip.py
```

The script writes:

```text
dist/mealshark-<version>.zip
```

Only runtime extension files are included in the zip: `manifest.json`, `src/`,
and `assets/icons/`. Store listing assets, source images, docs, screenshots,
and repository metadata are intentionally excluded.
