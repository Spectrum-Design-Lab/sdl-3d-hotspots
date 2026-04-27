/**
 * SDL 3D Hotspots — 3D Model Viewer
 * Depends on viewer.js (window._sdl3d must be loaded first).
 */
(function () {
  var S = window._sdl3d;
  if (!S) return;
  var ce = S.ce, sa = S.sa, mkFs = S.mkFs, sFb = S.sFb, mkSidebar = S.mkSidebar;

  // ── Viewer settings ──

  function applyS(mv, R, s) {
    var fhl = R.dataset.forceHorizontalLock === "true";
    var fb = R.querySelector("[data-sdl3d-fullscreen]");

    sa(mv, "camera-controls", s?.cameraControls !== false);
    sa(mv, "auto-rotate", s?.autoRotate === true);
    if (s?.cameraOrbit) mv.setAttribute("camera-orbit", s.cameraOrbit);
    if (s?.cameraTarget) mv.setAttribute("camera-target", s.cameraTarget);
    if (s?.fieldOfView) mv.setAttribute("field-of-view", s.fieldOfView);
    if (typeof s?.exposure === "number") mv.setAttribute("exposure", String(s.exposure));
    if (s?.interactionPrompt) mv.setAttribute("interaction-prompt", s.interactionPrompt);

    var hz = fhl || s?.horizontalLock || s?.rotationMode === "horizontal_only";
    if (hz) {
      var pa = s?.lockedPolarAngle
        || (typeof s?.cameraOrbit === "string" ? s.cameraOrbit.trim().split(/\s+/)[1] : null)
        || "75deg";
      var lo = "auto " + pa + " auto";
      mv.setAttribute("min-camera-orbit", lo);
      mv.setAttribute("max-camera-orbit", lo);
    } else {
      s?.minCameraOrbit ? mv.setAttribute("min-camera-orbit", s.minCameraOrbit) : mv.removeAttribute("min-camera-orbit");
      s?.maxCameraOrbit ? mv.setAttribute("max-camera-orbit", s.maxCameraOrbit) : mv.removeAttribute("max-camera-orbit");
    }

    if (s?.backgroundColor) R.style.setProperty("--sdl3d-background", s.backgroundColor);

    if (fb) {
      if (R.dataset.showFullscreen === "true" || s?.showFullscreen === true) {
        fb.hidden = false;
        fb.addEventListener("click", function () { R.requestFullscreen && R.requestFullscreen(); });
      } else {
        fb.hidden = true;
      }
    }
  }

  // ── 3D Hotspots ──

  function mkH(h, i) {
    var l = h.title || "Hotspot " + (i + 1);
    var b = ce("button", "sdl3d-hotspot sdl3d-hotspot--" + (h.style || "card"));
    b.type = "button";
    b.slot = "hotspot-" + (h.id || i + 1);
    b.dataset.position = h.position || "0m 0m 0m";
    if (h.normal) b.dataset.normal = h.normal;
    if (h.color) b.style.setProperty("--sdl3d-hotspot-color", h.color);
    b.dataset.ft = h.focusTarget || h.position || "0m 0m 0m";
    if (h.focusOrbit) b.dataset.fo = h.focusOrbit;
    b.ariaLabel = l;
    b.dataset.hsIndex = String(i);

    var d = ce("span", "sdl3d-hotspot__dot");
    d.textContent = String(i + 1);
    var c = ce("span", "sdl3d-hotspot__card");
    var t = ce("strong", "sdl3d-hotspot__title");
    t.textContent = l;
    c.appendChild(t);
    if (h.body) {
      var bd = ce("span", "sdl3d-hotspot__body");
      bd.textContent = h.body;
      c.appendChild(bd);
    }
    b.appendChild(d);
    b.appendChild(c);

    b.addEventListener("click", function () {
      var mv = b.closest("model-viewer");
      if (!mv) return;
      if (b.dataset.ft) mv.setAttribute("camera-target", b.dataset.ft);
      if (b.dataset.fo) mv.setAttribute("camera-orbit", b.dataset.fo);
      mv.querySelectorAll(".sdl3d-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
      b.classList.add("is-active");
      var root = mv.closest(".sdl3d-viewer") || mv.closest("[data-sdl3d-app-root]");
      if (root && root._sidebar) root._sidebar._selectIndex(parseInt(b.dataset.hsIndex, 10));
    });
    return b;
  }

  function aH(mv, list) {
    mv.querySelectorAll(".sdl3d-hotspot").forEach(function (n) { n.remove(); });
    if (!Array.isArray(list) || !list.length) return;
    list
      .filter(function (h) { return h && h.visible !== false && h.position; })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); })
      .forEach(function (h, i) { mv.appendChild(mkH(h, i)); });
  }

  // ── 3D model init (metafield mode) ──

  function init3d(R) {
    var mv = R.querySelector("[data-sdl3d-model]");
    if (!mv) return;
    mv.addEventListener("error", function () { sFb(R); });
    var vs = S.jd(R, "[data-sdl3d-viewer-settings]", {});
    var hs = S.jd(R, "[data-sdl3d-hotspots]", []);
    applyS(mv, R, vs);

    var filtered = (hs || [])
      .filter(function (h) { return h && h.visible !== false && h.position; })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

    aH(mv, filtered);

    var sb = mkSidebar(filtered, function (h, i) {
      if (h.focusTarget || h.position) mv.setAttribute("camera-target", h.focusTarget || h.position);
      if (h.focusOrbit) mv.setAttribute("camera-orbit", h.focusOrbit);
      mv.querySelectorAll(".sdl3d-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
      var dots = mv.querySelectorAll(".sdl3d-hotspot");
      if (dots[i]) dots[i].classList.add("is-active");
    });
    var old = R.parentNode.querySelector(".sdl3d-sidebar");
    if (old) old.remove();
    R.parentNode.appendChild(sb);
    R._sidebar = sb;

    R.dataset.sdl3dInitialized = "true";
  }

  // ── App proxy mode builders ──

  function aIM(R, c) {
    var mv = ce("model-viewer", "sdl3d-viewer__model");
    mv.dataset.sdl3dModel = "1";
    mv.setAttribute("src", c.modelSourceUrl || "");
    mv.setAttribute("camera-controls", "");
    mv.setAttribute("auto-rotate", "");
    mv.setAttribute("reveal", "auto");
    mv.loading = "eager";
    if (c.posterUrl) mv.setAttribute("poster", c.posterUrl);
    if (c.fallbackImageUrl) R.dataset.fallbackImage = c.fallbackImageUrl;
    mv.addEventListener("error", function () { sFb(R); });
    mv.appendChild(mkFs());
    R.className = "sdl3d-viewer";
    R.appendChild(mv);
    S.loadMV().then(function () {
      applyS(mv, R, c.viewerSettings || {});
      var filtered = (c.hotspots || [])
        .filter(function (h) { return h && h.visible !== false && h.position; })
        .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      aH(mv, filtered);

      var sb = mkSidebar(filtered, function (h, i) {
        if (h.focusTarget || h.position) mv.setAttribute("camera-target", h.focusTarget || h.position);
        if (h.focusOrbit) mv.setAttribute("camera-orbit", h.focusOrbit);
        mv.querySelectorAll(".sdl3d-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
        var dots = mv.querySelectorAll(".sdl3d-hotspot");
        if (dots[i]) dots[i].classList.add("is-active");
      });
      var old = R.parentNode.querySelector(".sdl3d-sidebar");
      if (old) old.remove();
      R.parentNode.appendChild(sb);
      R._sidebar = sb;
    });
  }

  // Register on shared namespace
  S.applyS = applyS;
  S.init3d = init3d;
  S.aIM = aIM;
})();
