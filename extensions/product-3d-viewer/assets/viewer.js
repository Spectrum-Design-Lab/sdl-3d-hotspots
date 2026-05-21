/* SDL 3D Hotspots core bootstrap. 3D code: viewer-3d.js. 360: viewer-360.js. */
(function () {
  var mvP = null;
  var MV_CDN = "https://unpkg.com/@google/model-viewer@4.2.0/dist/model-viewer.min.js";

  function ce(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function jd(root, selector, fallback) {
    var node = root.querySelector(selector);
    if (!node) return fallback;
    try { return JSON.parse(node.textContent || ""); }
    catch (e) { return fallback; }
  }

  function sa(el, attr, on) {
    on ? el.setAttribute(attr, "") : el.removeAttribute(attr);
  }

  function loadMV() {
    if (customElements.get("model-viewer")) return Promise.resolve();
    if (mvP) return mvP;
    mvP = new Promise(function (ok, fail) {
      var m = document.querySelector("script[data-sdl3d-mv]");
      if (!m) {
        var el = document.querySelector("[data-sdl3d-mv-src]");
        var url = (el && el.getAttribute("data-sdl3d-mv-src")) || MV_CDN;
        m = ce("script");
        m.type = "module";
        m.src = url;
        m.dataset.sdl3dMv = "1";
        document.head.appendChild(m);
      }
      m.addEventListener("error", fail, { once: true });
      customElements.whenDefined("model-viewer").then(ok);
    });
    return mvP;
  }

  function mkFs() {
    var b = ce("button", "sdl3d-fullscreen-button");
    b.type = "button";
    b.dataset.sdl3dFullscreen = "1";
    b.hidden = true;
    b.textContent = "\u26F6";
    return b;
  }

  function sFb(R) {
    var f = R.dataset.fallbackImage;
    if (!f) return;
    R.innerHTML = "";
    var img = ce("img", "sdl3d-fallback-image");
    img.src = f;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:contain";
    R.appendChild(img);
  }

  function mkSidebar(hotspots, onSelect) {
    var sb = ce("div", "sdl3d-sidebar");
    var menuOpen = false;
    var selectedIndex = -1;

    var hdr = ce("div", "sdl3d-sidebar__header");
    var hdrTitle = ce("span", "sdl3d-sidebar__header-title");
    hdrTitle.textContent = "Product features";
    hdr.appendChild(hdrTitle);

    var burger = ce("button", "sdl3d-sidebar__burger");
    burger.type = "button";
    burger.ariaLabel = "Toggle hotspot list";
    burger.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="2" rx="1" fill="currentColor"/><rect x="2" y="9" width="16" height="2" rx="1" fill="currentColor"/><rect x="2" y="14" width="16" height="2" rx="1" fill="currentColor"/></svg>';
    if (hotspots && hotspots.length) hdr.appendChild(burger);
    sb.appendChild(hdr);

    var content = ce("div", "sdl3d-sidebar__content");

    var prompt = ce("div", "sdl3d-sidebar__prompt");
    var promptIcon = ce("div", "sdl3d-sidebar__prompt-icon");
    promptIcon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    var promptText = ce("div", "sdl3d-sidebar__prompt-text");
    promptText.textContent = "Select a hotspot for feature details";
    prompt.appendChild(promptIcon);
    prompt.appendChild(promptText);
    content.appendChild(prompt);

    var detail = ce("div", "sdl3d-sidebar__detail");
    var dtitle = ce("div", "sdl3d-sidebar__detail-title");
    var dbody = ce("div", "sdl3d-sidebar__detail-body");
    var dcta = ce("a", "sdl3d-sidebar__detail-cta");
    dcta.target = "_blank";
    dcta.rel = "noopener";
    dcta.style.display = "none";
    var dclear = ce("button", "sdl3d-sidebar__clear");
    dclear.type = "button";
    dclear.textContent = "Clear selection";
    detail.appendChild(dtitle);
    detail.appendChild(dbody);
    detail.appendChild(dcta);
    detail.appendChild(dclear);
    content.appendChild(detail);

    var list = ce("div", "sdl3d-sidebar__list");

    if (hotspots && hotspots.length) {
      hotspots.forEach(function (h, i) {
        var item = ce("button", "sdl3d-sidebar__item");
        item.type = "button";
        var num = ce("span", "sdl3d-sidebar__item-number");
        num.textContent = String(i + 1);
        if (h.color) num.style.setProperty("--sdl3d-hotspot-color", h.color);
        var title = ce("span", "sdl3d-sidebar__item-title");
        title.textContent = h.title || "Hotspot " + (i + 1);
        item.appendChild(num);
        item.appendChild(title);
        list.appendChild(item);
        item.addEventListener("click", function () {
          selectHotspot(h, i);
          if (onSelect) onSelect(h, i);
        });
      });
    }
    content.appendChild(list);
    sb.appendChild(content);

    function showView(view) {
      prompt.classList.toggle("is-visible", view === "prompt");
      detail.classList.toggle("is-visible", view === "detail");
      list.classList.toggle("is-visible", view === "list");
      sb.classList.toggle("is-menu-open", view === "list");
    }

    function selectHotspot(h, i) {
      selectedIndex = i;
      menuOpen = false;
      dtitle.textContent = h.title || "Hotspot " + (i + 1);
      dbody.textContent = h.body || "";
      if (h.ctaLabel && h.ctaUrl) {
        dcta.textContent = h.ctaLabel;
        dcta.href = h.ctaUrl;
        dcta.style.display = "";
      } else {
        dcta.style.display = "none";
      }
      list.querySelectorAll(".sdl3d-sidebar__item.is-active")
        .forEach(function (n) { n.classList.remove("is-active"); });
      var items = list.querySelectorAll(".sdl3d-sidebar__item");
      if (items[i]) items[i].classList.add("is-active");
      showView("detail");
    }

    burger.addEventListener("click", function () {
      menuOpen = !menuOpen;
      if (menuOpen) {
        showView("list");
      } else {
        showView(selectedIndex >= 0 ? "detail" : "prompt");
      }
    });

    showView("prompt");

    sb._selectIndex = function (idx) {
      if (!hotspots || !hotspots[idx]) return;
      selectHotspot(hotspots[idx], idx);
    };
    sb._clearSelection = function () {
      selectedIndex = -1;
      menuOpen = false;
      list.querySelectorAll(".sdl3d-sidebar__item.is-active")
        .forEach(function (n) { n.classList.remove("is-active"); });
      showView("prompt");
    };

    dclear.addEventListener("click", function () {
      sb._clearSelection();
      var blk = sb.closest(".sdl3d-block");
      if (blk) {
        blk.querySelectorAll(".sdl3d-hotspot.is-active, .sdl3d-360-hotspot.is-active")
          .forEach(function (n) { n.classList.remove("is-active"); });
      }
    });

    return sb;
  }

  window._sdl3d = {
    ce: ce, jd: jd, sa: sa, mkFs: mkFs, sFb: sFb, mkSidebar: mkSidebar, loadMV: loadMV,
  };

  var _3dP = null;
  function load3d() {
    if (_3dP) return _3dP;
    if (window._sdl3d.init3d) return Promise.resolve();
    var el = document.querySelector("[data-sdl3d-3d-src]");
    var src = el && el.getAttribute("data-sdl3d-3d-src");
    if (!src) return Promise.resolve();
    _3dP = new Promise(function (ok, fail) {
      var s = ce("script");
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return _3dP;
  }

  var _360P = null;
  function load360() {
    if (_360P) return _360P;
    if (window._sdl3d.i360) return Promise.resolve();
    var el = document.querySelector("[data-sdl3d-360-src]");
    var src = el && el.getAttribute("data-sdl3d-360-src");
    if (!src) return Promise.resolve();
    _360P = new Promise(function (ok, fail) {
      var s = ce("script");
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return _360P;
  }

  function iApp(R) {
    if (R.dataset.sdl3dAppInit === "1") return;
    R.dataset.sdl3dAppInit = "1";
    var u = R.dataset.sdl3dProxyUrl;
    if (!u) return;
    fetch(u)
      .then(function (r) { return r.json(); })
      .then(function (c) {
        if (!c || c.error || !c.enabled) {
          R.innerHTML = "<div class=sdl3d-block__message>" + (c && c.error || "N/A") + "</div>";
          return;
        }
        R.innerHTML = "";
        if (c.viewerType === "image_360") {
          load360().then(function () {
            var S = window._sdl3d;
            if (S.aI3) S.aI3(R, c);
          });
        } else {
          load3d().then(function () {
            var S = window._sdl3d;
            if (S.aIM) S.aIM(R, c);
          });
        }
      })
      .catch(function () {
        R.innerHTML = "<div class=sdl3d-block__message>Load error</div>";
      });
  }

  function initAll() {
    var r3d = document.querySelectorAll("[data-sdl3d-root]");
    if (r3d.length) {
      load3d().then(function () {
        var S = window._sdl3d;
        if (!S.init3d) return;
        loadMV()
          .then(function () { r3d.forEach(S.init3d); })
          .catch(function () { r3d.forEach(sFb); });
      });
    }

    load360().then(function () {
      var S = window._sdl3d;
      if (S.i360) {
        document.querySelectorAll("[data-sdl3d-360-root]").forEach(function (r) {
          if (r.dataset.sdl3d360Initialized !== "true") S.i360(r);
        });
      }
    });

    document.querySelectorAll("[data-sdl3d-app-root]").forEach(function (r) { iApp(r); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
  document.addEventListener("shopify:section:load", initAll);
  document.addEventListener("shopify:block:select", initAll);
})();
