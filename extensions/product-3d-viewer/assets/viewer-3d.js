/**
 * SDL 3D Hotspots — 3D Model Viewer
 * Depends on viewer.js (window._sdl3d must be loaded first).
 */
(function () {
  var S = window._sdl3d;
  if (!S) return;
  var ce = S.ce, sa = S.sa, mkFs = S.mkFs, sFb = S.sFb, mkSidebar = S.mkSidebar;

  // ── Hotspot icon library (Slice 8 hotspots PR #4) ──
  // Parallel copy of app/lib/hotspot-icons.ts — every change here must
  // be mirrored there. GIDs are resolved to URLs at publish time so
  // the storefront only sees preset names or absolute URLs.
  var PRESET_ICONS = {
    "plus": '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    "minus": '<path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    "info": '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 16v-5M12 8h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    "warning": '<path d="M12 3 22 21H2Z M12 10v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "star": '<path d="M12 2.5l2.95 6.4 6.85.5-5.3 4.5 1.9 6.8L12 17.1l-6.4 3.6 1.9-6.8-5.3-4.5 6.85-.5z" fill="currentColor"/>',
    "heart": '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="currentColor"/>',
    "check": '<path d="M5 12l5 5 9-9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "x": '<path d="M6 6l12 12M6 18l12-12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    "arrow-up": '<path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "arrow-down": '<path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "arrow-left": '<path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "arrow-right": '<path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "play": '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    "circle": '<circle cx="12" cy="12" r="9" fill="currentColor"/>'
  };
  function iconHtml(v) {
    if (!v || typeof v !== "string") return "";
    var t = v.trim();
    if (!t) return "";
    if (PRESET_ICONS[t]) return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' + PRESET_ICONS[t] + '</svg>';
    if (t.indexOf("http://") === 0 || t.indexOf("https://") === 0 || t.indexOf("//") === 0) {
      return '<img src="' + t.replace(/"/g, "&quot;") + '" alt="" />';
    }
    return "";
  }

  // ── Hotspot popup media (Slice 8 hotspots PR #5) ──
  // Parallel of app/lib/sdl3d-shared.ts classifyVideoUrl + the
  // mediaHtml builder used in viewer-360.js. mediaImageUrl GIDs are
  // resolved to URLs at publish time so the storefront only sees
  // absolute URLs here.
  function escAttr(s) { return String(s).replace(/"/g, "&quot;"); }
  function classifyVideo(url) {
    if (!url) return "unknown";
    var v = url.trim();
    if (!v) return "unknown";
    if (/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))[\w-]+/i.test(v)) return "youtube";
    if (/vimeo\.com\/\d+/i.test(v)) return "vimeo";
    if (/\.(mp4|webm)(?:[?#].*)?$/i.test(v)) return "file";
    return "unknown";
  }
  function videoEmbedHtml(url) {
    var kind = classifyVideo(url);
    if (kind === "youtube") {
      var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]+)/i);
      return m
        ? '<iframe src="https://www.youtube.com/embed/' + escAttr(m[1]) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>'
        : "";
    }
    if (kind === "vimeo") {
      var vm = url.match(/vimeo\.com\/(\d+)/i);
      return vm
        ? '<iframe src="https://player.vimeo.com/video/' + escAttr(vm[1]) + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>'
        : "";
    }
    if (kind === "file") {
      return '<video src="' + escAttr(url) + '" controls preload="metadata"></video>';
    }
    return "";
  }
  function mediaHtml(image, video) {
    var parts = "";
    if (typeof image === "string" && image.trim()) {
      parts += '<div class="sdl3d-hotspot__media-image"><img src="' + escAttr(image.trim()) + '" alt="" loading="lazy" /></div>';
    }
    if (typeof video === "string" && video.trim()) {
      var v = videoEmbedHtml(video.trim());
      if (v) parts += '<div class="sdl3d-hotspot__media-video">' + v + '</div>';
    }
    return parts ? '<div class="sdl3d-hotspot__media">' + parts + '</div>' : "";
  }

  // ── Viewer settings ──

  function applyS(mv, R, s) {
    var fhl = R.dataset.forceHorizontalLock === "true";
    var fbScope = R.closest(".sdl3d-block") || R;
    var fb = fbScope.querySelector("[data-sdl3d-fullscreen]");

    sa(mv, "camera-controls", s?.cameraControls !== false);
    sa(mv, "auto-rotate", s?.autoRotate === true);
    if (s?.autoRotate === true) {
      var spd = typeof s.autoRotateSpeed === "number" ? s.autoRotateSpeed : 30;
      var sign = s.autoRotateDirection === "reverse" ? "-" : "";
      mv.setAttribute("rotation-per-second", sign + spd + "deg");
    } else {
      mv.removeAttribute("rotation-per-second");
    }
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

    var rb = fbScope.querySelector("[data-sdl3d-reset]");
    if (rb && !rb.dataset.sdl3dResetBound) {
      rb.dataset.sdl3dResetBound = "1";
      rb.addEventListener("click", function () {
        if (s?.cameraOrbit) mv.setAttribute("camera-orbit", s.cameraOrbit);
        if (s?.cameraTarget) mv.setAttribute("camera-target", s.cameraTarget);
        mv.querySelectorAll(".sdl3d-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
        if (R._sidebar && R._sidebar._clearSelection) R._sidebar._clearSelection();
      });
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
    if (h.animation && h.animation !== "none") b.dataset.sdl3dAnim = h.animation;
    b.ariaLabel = l;
    b.dataset.hsIndex = String(i);

    var d = ce("span", "sdl3d-hotspot__dot");
    var iconMarkup = iconHtml(h.icon);
    if (iconMarkup) {
      d.classList.add("sdl3d-hotspot__dot--icon");
      d.innerHTML = iconMarkup;
    } else {
      d.textContent = String(i + 1);
    }
    var c = ce("span", "sdl3d-hotspot__card");
    var media = mediaHtml(h.mediaImageUrl, h.mediaVideoUrl);
    if (media) {
      var mw = ce("span", "");
      mw.innerHTML = media;
      while (mw.firstChild) c.appendChild(mw.firstChild);
    }
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
    var sbHost = R.closest(".sdl3d-block__body") || R.parentNode;
    var old = sbHost.querySelector(":scope > .sdl3d-sidebar");
    if (old) old.remove();
    sbHost.appendChild(sb);
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
    var blk = R.closest(".sdl3d-block");
    if (!blk || !blk.querySelector("[data-sdl3d-fullscreen]")) {
      mv.appendChild(mkFs());
    }
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
      var sbHost = R.closest(".sdl3d-block__body") || R.parentNode;
      var old = sbHost.querySelector(":scope > .sdl3d-sidebar");
      if (old) old.remove();
      sbHost.appendChild(sb);
      R._sidebar = sb;
    });
  }

  // Register on shared namespace
  S.applyS = applyS;
  S.init3d = init3d;
  S.aIM = aIM;
})();
