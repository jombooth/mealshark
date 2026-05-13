# Mealshark

Mealshark is a Chrome extension scaffold for adding MealPal-specific browser features on `mealpal.com`.

## Current Feature

On MealPal menu pages, Mealshark adds a collapsible right-side panel that:

- Captures the logged-in `/menu` API response as the page loads.
- Lists meals labeled **New!** by MealPal.
- Shows the top N meals sorted by discount percentage from greatest to least.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository directory.

## Project Structure

- `manifest.json` configures the Manifest V3 extension.
- `src/page-hook.js` runs in the page context and captures MealPal menu responses.
- `src/content.js` runs on MealPal pages.
- `src/content.css` styles the in-page extension UI.
- `src/popup.html`, `src/popup.css`, and `src/popup.js` power the toolbar popup.

## Development Notes

After editing files, reload the extension from `chrome://extensions` and refresh the MealPal tab. The page refresh is required because the menu response is captured when MealPal makes the network request.
