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

  // ── Hotspot icon library (Slice 8 hotspots PR #4) ──
  // Parallel copy — see app/lib/hotspot-icons.ts. Keep in sync with
  // the table in viewer-3d.js as well.
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
  // Parallel of viewer-3d.js mediaHtml/videoEmbedHtml and the
  // classifyVideoUrl helper in app/lib/sdl3d-shared.ts.
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
      parts += '<div class="sdl3d-360-hotspot__media-image"><img src="' + escAttr(image.trim()) + '" alt="" loading="lazy" /></div>';
    }
    if (typeof video === "string" && video.trim()) {
      var v = videoEmbedHtml(video.trim());
      if (v) parts += '<div class="sdl3d-360-hotspot__media-video">' + v + '</div>';
    }
    return parts ? '<div class="sdl3d-360-hotspot__media">' + parts + '</div>' : "";
  }

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
    if (h.animation && h.animation !== "none") b.dataset.sdl3dAnim = h.animation;

    var dot = ce("span", "sdl3d-360-hotspot__dot");
    var iconMarkup = iconHtml(h.icon);
    if (iconMarkup) {
      dot.classList.add("sdl3d-360-hotspot__dot--icon");
      dot.innerHTML = iconMarkup;
    } else {
      dot.textContent = String(i + 1);
    }

    var card = ce("span", "sdl3d-360-hotspot__card");
    var media = mediaHtml(h.mediaImageUrl, h.mediaVideoUrl);
    if (media) {
      var mw = ce("span", "");
      mw.innerHTML = media;
      while (mw.firstChild) card.appendChild(mw.firstChild);
    }
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
