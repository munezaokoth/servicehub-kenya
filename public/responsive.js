/* ServiceHub Kenya - responsive helpers
   - Measures the real header height (it changes with the screen) so the page and drawer sit under it.
   - Switches to the ☰ menu whenever the full menu doesn't fit (any width, any font size).
   - Re-checks when a foldable is folded/unfolded, the phone rotates, or the window resizes.
   - Closes the drawer after a menu tap, on a tap outside it, and when the screen gets wide again. */
(function () {
  "use strict";
  const root = document.documentElement;
  const header = document.querySelector("header");
  const container = document.querySelector(".header-container");
  const nav = document.querySelector(".nav-menu");
  const logo = document.querySelector(".logo");
  if (!header || !container || !nav) return;

  const drawerMQ = window.matchMedia("(max-width: 1180px)");
  const backdrop = document.createElement("div");
  backdrop.className = "sh-nav-backdrop";
  document.body.appendChild(backdrop);

  function closeDrawer() { nav.classList.remove("active"); }

  function navFits() {
    // Measure the full horizontal menu: logo + every visible link must fit in the header row.
    const visible = Array.from(nav.querySelectorAll(".nav-link")).filter((a) => getComputedStyle(a).display !== "none");
    let need = (logo ? logo.scrollWidth : 0) + 40;
    visible.forEach((a) => {
      const cs = getComputedStyle(a);
      // Links stretch to fill the row, so measure their text (what they really need), not their box.
      need += measureText(a, cs) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    });
    return need <= container.clientWidth;
  }

  const canvas = document.createElement("canvas");
  function measureText(a, cs) {
    const ctx = canvas.getContext("2d");
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText((a.textContent || "").trim()).width;
  }

  let raf = 0;
  function update() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (drawerMQ.matches) {
        root.classList.remove("nav-collapsed");
      } else {
        root.classList.remove("nav-collapsed");
        if (!navFits()) root.classList.add("nav-collapsed");
      }
      const collapsed = drawerMQ.matches || root.classList.contains("nav-collapsed");
      if (!collapsed) closeDrawer();
      root.style.setProperty("--sh-header-h", Math.round(header.getBoundingClientRect().height) + "px");
      backdrop.classList.toggle("show", collapsed && nav.classList.contains("active"));
    });
  }

  // Drawer open/close state → backdrop
  new MutationObserver(update).observe(nav, { attributes: true, attributeFilter: ["class"] });
  // Logged in/out changes which links show (Dashboard / Login)
  nav.querySelectorAll(".nav-link").forEach((a) => new MutationObserver(update).observe(a, { attributes: true, attributeFilter: ["style", "class"] }));
  if (window.ResizeObserver) new ResizeObserver(update).observe(header);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", update);
  if (drawerMQ.addEventListener) drawerMQ.addEventListener("change", update);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
  window.addEventListener("load", update);

  nav.addEventListener("click", (e) => { if (e.target.closest(".nav-link")) closeDrawer(); });
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  update();
})();
