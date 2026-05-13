const STATE_KEY = "mealshark:lastPage";

function formatPageStatus(snapshot) {
  if (!snapshot || !snapshot.href) {
    return "Open a MealPal page to activate Mealshark.";
  }

  try {
    const url = new URL(snapshot.href);
    return `${snapshot.title || "MealPal"} - ${url.pathname || "/"}`;
  } catch (_error) {
    return snapshot.title || "MealPal page detected.";
  }
}

async function renderStatus() {
  const status = document.getElementById("page-status");
  const result = await chrome.storage.local.get(STATE_KEY);

  status.textContent = formatPageStatus(result[STATE_KEY]);
}

renderStatus();
