/* SDL 3D Hotspots — 360° Image Sequence Viewer
 *
 * IMPORTANT — parallel of app/lib/sdl3d-shared.ts. Both copies of `interp`
 * and the visibility check need to evolve together. When `wrap` is true
 * and `totalFrames` is supplied, the function blends last → first along
 * the shorter wrap path (Slice 7 PR #6); without those args it behaves
 * identically to the original linear/Catmull-Rom logic.
 */
(function () {
  var S = window._sdl3d;
  if (!S) return;
  var ce = S.ce, jd = S.jd, mkFs = S.mkFs;

  function cr(p0, p1, p2, p3, t) {
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }

  function interp(kf, frame, wrap, totalFrames) {
    if (!kf || !kf.length) return null;
    var sorted = kf.slice().sort(function (a, b) { return a.frame - b.frame; });
    var last = sorted.length - 1;
    var first = sorted[0];
    var lastKf = sorted[last];
    var wrapMode = wrap === true && (totalFrames || 0) > 0;

    if (wrapMode && sorted.length >= 2 && (frame > lastKf.frame || frame < first.frame)) {
      var span = totalFrames - lastKf.frame + first.frame;
      var offset = frame > lastKf.frame
        ? frame - lastKf.frame
        : totalFrames - lastKf.frame + frame;
      var t = span > 0 ? offset / span : 0;
      return {
        x: lastKf.x + (first.x - lastKf.x) * t,
        y: lastKf.y + (first.y - lastKf.y) * t,
      };
    }

    if (frame <= first.frame) return first;
    if (frame >= lastKf.frame) return lastKf;
    for (var j = 0; j < last; j++) {
      var a = sorted[j], b = sorted[j + 1];
      if (frame >= a.frame && frame <= b.frame) {
        var t2 = (frame - a.frame) / (b.frame - a.frame);
        if (sorted.length < 3) return { x: a.x + (b.x - a.x) * t2, y: a.y + (b.y - a.y) * t2 };
        var p0 = sorted[Math.max(j - 1, 0)], p3 = sorted[Math.min(j + 2, last)];
        return { x: cr(p0.x, a.x, b.x, p3.x, t2), y: cr(p0.y, a.y, b.y, p3.y, t2) };
      }
    }
    return null;
  }

  // Responsive sizing: Shopify CDN supports ?width= as a query-string transform,
  // so we right-size frames to the viewport. Other origins (DigitalOcean Spaces,
  // localhost dev server, etc.) don't support this and download full-resolution.
  // Acceptable for the pilot — frames are pre-sized via the platform pipeline's
  // sharp conversion. Revisit if perf becomes a problem on a non-Shopify origin.
  function cdnSize(url, w) {
    if (!url || url.indexOf("cdn.shopify.com") === -1) return url;
    var cw = w <= 600 ? 800 : w <= 1200 ? 1200 : 1800;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "width=" + cw;
  }

  function preloadFrames(urls, onProgress) {
    var imgs = new Array(urls.length);
    var loaded = 0;
    var priority = [], rest = [];
    var step = Math.max(1, Math.ceil(urls.length / 8));
    for (var i = 0; i < urls.length; i++) {
      if (i % step === 0) priority.push(i); else rest.push(i);
    }
    var order = priority.concat(rest);
    var batch = 4, qi = 0;
    function loadNext() {
      while (qi < order.length && batch > 0) {
        batch--;
        (function (idx) {
          var im = new Image();
          im.onload = function () {
            imgs[idx] = im; loaded++; batch++;
            if (onProgress) onProgress(idx);
            loadNext();
          };
          im.onerror = function () { batch++; loadNext(); };
          im.src = urls[idx];
        })(order[qi]);
        qi++;
      }
    }
    loadNext();
    return imgs;
  }

  function mk3H(h, i) {
    var label = h.title || "Hotspot " + (i + 1);
    var b = ce("button", "sdl3d-360-hotspot sdl3d-360-hotspot--" + (h.style || "card"));
    b.type = "button";
    b.ariaLabel = label;
    b.dataset.hsIndex = String(i);
    if (h.color) b.style.setProperty("--sdl3d-hotspot-color", h.color);

    var dot = ce("span", "sdl3d-360-hotspot__dot");
    dot.textContent = String(i + 1);

    var card = ce("span", "sdl3d-360-hotspot__card");
    var title = ce("strong", "sdl3d-360-hotspot__title");
    title.textContent = label;
    card.appendChild(title);
    if (h.body) {
      var bd = ce("span", "sdl3d-360-hotspot__body");
      bd.textContent = h.body;
      card.appendChild(bd);
    }

    b.appendChild(dot);
    b.appendChild(card);
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var p = b.closest("[data-sdl3d-360-root],[data-sdl3d-app-root]");
      if (p) {
        p.querySelectorAll(".sdl3d-360-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
        if (p._sidebar) p._sidebar._selectIndex(parseInt(b.dataset.hsIndex, 10));
      }
      b.classList.add("is-active");
    });
    return b;
  }

  function s360(R, vp, img, seq, hotspots, vs) {
    if (!seq.length) return;
    var fc = seq.length, cf = 0, dragging = false, startX = 0, startFrame = 0;
    var autoRotateTimer = null;
    var hotspotEls = [];
    var vpW = vp.clientWidth || 800;

    if (vs.backgroundColor) R.style.setProperty("--sdl3d-background", vs.backgroundColor);
    var sizedUrls = seq.map(function (f) {
      return f.imageUrl ? cdnSize(f.imageUrl, vpW) : "";
    });
    var frameImgs = preloadFrames(sizedUrls.filter(Boolean).length ? sizedUrls : [], function (idx) {
      if (idx === 0 && frameImgs[0]) drawFrame(0);
    });

    var canvas = ce("canvas", "sdl3d-360-canvas");
    canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain";
    var ctx = canvas.getContext("2d");
    var canvasReady = false;

    function sizeCanvas() {
      var w = vp.clientWidth || 800;
      var h = vp.clientHeight || 600;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawFrame(f) {
      var im = frameImgs[f];
      if (!im) return false;
      if (!canvasReady) {
        sizeCanvas();
        vp.appendChild(canvas);
        img.style.visibility = "hidden";
        canvasReady = true;
      }
      var cw = vp.clientWidth || 800;
      var ch = vp.clientHeight || 600;
      var scale = Math.min(cw / im.naturalWidth, ch / im.naturalHeight);
      var dw = im.naturalWidth * scale;
      var dh = im.naturalHeight * scale;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(im, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      return true;
    }

    function setFrame(f) {
      cf = ((f % fc) + fc) % fc;
      if (!drawFrame(cf)) {
        // Fallback: swap img src if not preloaded yet
        var d = seq[cf];
        if (d && d.imageUrl) img.src = cdnSize(d.imageUrl, vpW);
      }
      updateHotspots();
    }

    function updateHotspots() {
      hotspotEls.forEach(function (item) {
        var wraps = item.h.visibleFrameStart > item.h.visibleFrameEnd;
        var p = interp(item.h.keyframes, cf, wraps, fc);
        var visible = item.h.visible !== false && (
          wraps
            ? (cf >= item.h.visibleFrameStart || cf <= item.h.visibleFrameEnd)
            : (cf >= item.h.visibleFrameStart && cf <= item.h.visibleFrameEnd)
        );
        if (visible && p) {
          item.el.style.display = "";
          item.el.style.left = p.x + "%";
          item.el.style.top = p.y + "%";
        } else {
          item.el.style.display = "none";
        }
      });
    }

    hotspots
      .filter(function (h) { return h && h.keyframes && h.keyframes.length; })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); })
      .forEach(function (h, i) {
        var el = mk3H(h, i);
        el.style.cssText = "position:absolute;transform:translate(-50%,-50%)";
        vp.appendChild(el);
        hotspotEls.push({ h: h, el: el });
      });

    var filteredForSidebar = hotspots
      .filter(function (h) { return h && h.keyframes && h.keyframes.length; })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

    var mkSidebar = S.mkSidebar;
    var sbHost = R.closest(".sdl3d-block__body") || R.parentNode;
    if (mkSidebar) {
      var sb = mkSidebar(filteredForSidebar, function (h, i) {
        // PR #6 — wraparound-aware midpoint. For a wrap range (start > end)
        // the midpoint goes through the seam: half-span past start, wrapped
        // modulo total frames. Linear ranges keep the original average.
        var s = h.visibleFrameStart || 0;
        var e = h.visibleFrameEnd || 0;
        var mid;
        if (s > e && fc > 0) {
          var span = fc - s + e;
          mid = (s + Math.floor(span / 2)) % fc;
        } else {
          mid = Math.round((s + e) / 2);
        }
        setFrame(mid);
        R.querySelectorAll(".sdl3d-360-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
        if (hotspotEls[i]) hotspotEls[i].el.classList.add("is-active");
      });
      var old = sbHost.querySelector(":scope > .sdl3d-sidebar");
      if (old) old.remove();
      sbHost.appendChild(sb);
      R._sidebar = sb;
    }

    var pendingFrame = null;
    vp.addEventListener("pointerdown", function (e) {
      // Don't start drag when clicking a hotspot button
      if (e.target.closest(".sdl3d-360-hotspot")) return;
      dragging = true;
      startX = e.clientX;
      startFrame = cf;
      vp.setPointerCapture(e.pointerId);
      if (autoRotateTimer) { clearInterval(autoRotateTimer); autoRotateTimer = null; }
    });
    vp.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var target = startFrame + Math.round((e.clientX - startX) / (vp.clientWidth || 600) * fc);
      if (pendingFrame !== null) { pendingFrame = target; return; }
      pendingFrame = target;
      requestAnimationFrame(function () {
        setFrame(pendingFrame);
        pendingFrame = null;
      });
    });
    vp.addEventListener("pointerup", function () { dragging = false; });
    vp.addEventListener("lostpointercapture", function () { dragging = false; });

    window.addEventListener("resize", function () {
      if (canvasReady) { sizeCanvas(); drawFrame(cf); }
    });

    if (vs.autoRotate === true) {
      var spd = typeof vs.autoRotateSpeed === "number" ? vs.autoRotateSpeed : 30;
      var step = vs.autoRotateDirection === "reverse" ? -1 : 1;
      var ms = Math.max(20, Math.round((360 / spd) * (1000 / Math.max(1, fc))));
      autoRotateTimer = setInterval(function () { setFrame(cf + step); }, ms);
    }

    var fbScope = R.closest(".sdl3d-block") || R;
    var fb = fbScope.querySelector("[data-sdl3d-fullscreen]");
    if (fb && R.dataset.showFullscreen === "true") {
      fb.hidden = false;
      fb.addEventListener("click", function () { R.requestFullscreen && R.requestFullscreen(); });
    }

    var rb = fbScope.querySelector("[data-sdl3d-reset]");
    if (rb) {
      rb.addEventListener("click", function () {
        setFrame(0);
        R.querySelectorAll(".sdl3d-360-hotspot.is-active").forEach(function (n) { n.classList.remove("is-active"); });
        if (R._sidebar && R._sidebar._clearSelection) R._sidebar._clearSelection();
      });
    }

    setFrame(0);
    R.dataset.sdl3d360Initialized = "true";
  }

  function i360(R) {
    var vp = R.querySelector("[data-sdl3d-360-viewport]");
    var img = R.querySelector("[data-sdl3d-360-image]");
    if (!vp || !img) return;
    s360(R, vp, img,
      jd(R, "[data-sdl3d-image-sequence]", []),
      jd(R, "[data-sdl3d-hotspots-360]", []),
      jd(R, "[data-sdl3d-viewer-settings]", {})
    );
  }

  function aI3(R, c) {
    var vp = ce("div", "sdl3d-360-viewport");
    vp.dataset.sdl3d360Viewport = "1";
    var img = ce("img", "sdl3d-360-image");
    img.dataset.sdl3d360Image = "1";
    img.src = c.posterUrl || "";
    img.alt = "360\u00b0 view";
    img.width = 1200;
    img.height = 900;
    img.draggable = false;
    vp.appendChild(img);
    R.className = "sdl3d-360-viewer";
    R.appendChild(vp);
    var blk = R.closest(".sdl3d-block");
    if (!blk || !blk.querySelector("[data-sdl3d-fullscreen]")) {
      R.appendChild(mkFs());
    }
    s360(R, vp, img, c.imageSequence || [], c.hotspots360 || [], c.viewerSettings || {});
  }

  S.i360 = i360;
  S.aI3 = aI3;
})();
