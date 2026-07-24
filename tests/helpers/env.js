// Minimal browser shim so the extension's content scripts (plain IIFEs) can be
// loaded under node:test. Only what the scripts touch at load time is stubbed.
const messages = [];

globalThis.window = globalThis;
globalThis.location = {
  href: "https://secure.mealpal.com/lunch",
  origin: "https://secure.mealpal.com",
  pathname: "/lunch"
};
globalThis.postMessage = (data) => {
  messages.push(data);
};
globalThis.addEventListener = () => {};
globalThis.document = {
  title: "MealPal",
  body: null,
  documentElement: { classList: { toggle() {} } },
  addEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};
globalThis.XMLHttpRequest = class {
  open() {}
  send() {}
  addEventListener() {}
};
// Keep the map-bounds poller from holding the test process open.
globalThis.setInterval = () => 0;

module.exports = { messages };
