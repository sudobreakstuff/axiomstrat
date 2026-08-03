/* AxiomStrat site — hero canvas, ticker, mini-charts, counters, reveal. */

(function () {
  "use strict";

  /* ------------------------------------------------------------ ticker */
  var TICKERS = [
    ["XAUUSD", 2432.18, "+0.42%"], ["EURUSD", 1.0842, "-0.11%"],
    ["GBPUSD", 1.2719, "+0.05%"], ["USDJPY", 152.31, "-0.24%"],
    ["AUDUSD", 0.6521, "+0.18%"], ["US30", 41203.5, "+0.63%"],
    ["NAS100", 18754.2, "-0.09%"], ["BTCUSD", 67412, "+1.12%"],
    ["ETHUSD", 3510.4, "-0.38%"], ["SP500", 5730.8, "+0.31%"],
  ];
  var tickerEl = document.getElementById("ticker");
  if (tickerEl) {
    var items = TICKERS.map(function (t) {
      var cls = t[2].charAt(0) === "+" ? "p-up" : (t[2].charAt(0) === "-" ? "p-down" : "p-flat");
      return '<span class="t-item">' + t[0] + ' <span class="' + cls + '">' + t[2] + "</span> &nbsp;" + t[1] + "</span>";
    }).join("");
    tickerEl.innerHTML = items + items;
    tickerEl.style.animation = "marquee 45s linear infinite";
    var st = document.createElement("style");
    st.textContent = "@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }";
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ hero canvas */
  var canvas = document.getElementById("hero-canvas");
  if (canvas) {
    var ctx = canvas.getContext("2d");
    var W, H, candles = [];

    function resize() {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function buildCandles() {
      candles = [];
      var price = 100, n = 150;
      for (var i = 0; i < n; i++) {
        var drift = Math.random() < 0.52 ? 0.9 : -0.9;
        price += drift * (0.5 + Math.random() * 1.6);
        var open = price;
        var close = price + (Math.random() < 0.5 ? -1 : 1) * Math.random() * 2;
        var hi = Math.max(open, close) + Math.random() * 1.2;
        var lo = Math.min(open, close) - Math.random() * 1.2;
        price = close;
        candles.push({ o: open, c: close, h: hi, l: lo });
      }
    }
    buildCandles();

    var t = 0;
    function draw() {
      t += 0.004;
      ctx.clearRect(0, 0, W, H);
      var n = 120, cw = Math.min(14, W / n * 0.62), gap = (W - cw) / n;
      var min = Infinity, max = -Infinity;
      for (var i = 0; i < n; i++) {
        var c = candles[(Math.floor(t * 10) + i) % candles.length];
        if (c.h > max) max = c.h;
        if (c.l < min) min = c.l;
      }
      var pad = 18;
      var scale = (H - pad * 2) / (max - min);
      function y(v) { return pad + (max - v) * scale; }
      var x0 = (W - n * gap) / 2;
      for (var j = 0; j < n; j++) {
        var ci = candles[(Math.floor(t * 10) + j) % candles.length];
        var x = x0 + j * gap + gap / 2;
        var up = ci.c >= ci.o;
        ctx.strokeStyle = up ? "rgba(61,219,209,.8)" : "rgba(248,113,113,.8)";
        ctx.fillStyle = up ? "rgba(61,219,209,.25)" : "rgba(248,113,113,.25)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y(ci.h)); ctx.lineTo(x, y(ci.l)); ctx.stroke();
        var yo = y(ci.o), yc = y(ci.c);
        var top = Math.min(yo, yc), hgt = Math.max(2, Math.abs(yo - yc));
        ctx.fillRect(x - cw / 2, top, cw, hgt);
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ------------------------------------------------------------ mini charts */
  function spark(container, style) {
    var w = container.clientWidth, h = container.clientHeight;
    if (!w) w = 280;
    if (!h) h = 90;
    var cv = document.createElement("canvas");
    cv.width = w * 2; cv.height = h * 2;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    container.appendChild(cv);
    var ctx2 = cv.getContext("2d");
    ctx2.scale(2, 2);

    var n = 60, points = [];
    var p = 100;
    var meanRev = style === "swing" || style === "meanrev";
    var gridMode = style === "grid";
    for (var i = 0; i < n; i++) {
      var band = Math.sin(i / 5.2) * 3.4;
      if (gridMode) {
        p = 100 + Math.sin(i / 3.1) * 6;
      } else if (meanRev) {
        p = 100 + band + (Math.random() - 0.5) * 1.4;
      } else {
        p = p + (Math.random() < 0.53 ? 1 : -1) * (0.7 + Math.random());
        if (style === "trend") p = 80 + i * 0.7 + Math.sin(i / 6) * 2;
        if (style === "compound") p = 100 * Math.pow(1.006, i) + (Math.random() - 0.5) * 2;
      }
      points.push(p);
    }
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    var pad = 8, scale = (h - pad * 2) / (max - min || 1);
    function y(v) { return h - pad - (v - min) * scale; }
    var step = w / (n - 1);
    for (var k = 0; k < n; k++) {
      var upC = k === 0 ? true : points[k] >= points[k - 1];
      var bw = Math.max(2, step * 0.55);
      ctx2.strokeStyle = upC ? "rgba(61,219,209,.75)" : "rgba(248,113,113,.75)";
      ctx2.fillStyle = upC ? "rgba(61,219,209,.28)" : "rgba(248,113,113,.28)";
      ctx2.lineWidth = 1;
      ctx2.beginPath(); ctx2.moveTo(k * step + step / 2, y(points[k] + 1.5)); ctx2.lineTo(k * step + step / 2, y(points[k] - 1.5)); ctx2.stroke();
      var prev = k === 0 ? points[k] : points[k - 1];
      var yo = y(points[k]), yc = y(prev);
      ctx2.fillRect(k * step + step / 2 - bw / 2, Math.min(yo, yc), bw, Math.max(2, Math.abs(yo - yc)));
    }
  }

  document.querySelectorAll(".mini-chart").forEach(function (el) {
    spark(el, el.dataset.style || "trend");
  });
  if ("ResizeObserver" in window) {
    new ResizeObserver(function () {
      document.querySelectorAll(".mini-chart").forEach(function (el) {
        el.innerHTML = "";
        spark(el, el.dataset.style || "trend");
      });
    }).observe(document.getElementById("uses") || document.body);
  }

  /* ------------------------------------------------------------ counters */
  var counted = false;
  function animateCounters() {
    if (counted) return;
    var els = document.querySelectorAll(".hmv");
    if (!els.length) return;
    var rect = els[0].closest(".hero-metrics").getBoundingClientRect();
    if (rect.top > window.innerHeight * 0.95) return;
    counted = true;
    els.forEach(function (el) {
      var target = parseInt(el.dataset.count, 10);
      var suffix = el.dataset.suffix || "";
      var start = null;
      function step(ts) {
        if (!start) start = ts;
        var k = Math.min(1, (ts - start) / 1100);
        el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))) + suffix;
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  window.addEventListener("scroll", animateCounters);
  animateCounters();

  /* ------------------------------------------------------------ reveal */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".section, .use-card, .pf-step, .wsf").forEach(function (el) {
    el.classList.add("reveal");
    io.observe(el);
  });
})();
