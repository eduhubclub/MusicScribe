// Lucide icon helpers for MusicScribe (vendored UMD: vendor/lucide.min.js).
// Works in browser helper and Electron (macOS / Windows) with no CDN.
window.MSIcons = (() => {
  const ATTRS = {
    class: "ms-icon",
    width: 20,
    height: 20,
    "stroke-width": 1.75,
  };

  function ready() {
    return typeof lucide !== "undefined" && typeof lucide.createIcons === "function";
  }

  /** Paint every [data-lucide] under root (or the whole document). */
  function paint(root) {
    if (!ready()) return;
    const opts = { attrs: ATTRS };
    if (root && root !== document) opts.root = root;
    lucide.createIcons(opts);
  }

  /** Markup for a Lucide icon (call paint() after inserting into the DOM). */
  function el(name, extraClass = "") {
    const cls = extraClass ? `ms-icon ${extraClass}` : "ms-icon";
    return `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
  }

  /** Replace host contents with one Lucide icon and paint it. */
  function set(host, name, extraClass = "") {
    if (!host) return;
    host.innerHTML = el(name, extraClass);
    paint(host);
  }

  return { el, set, paint, ATTRS };
})();
