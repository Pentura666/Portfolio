/* Phone menu button (style.css "phone menu button"): three dots orbit on the orange ring (CSS, 12 s a turn).
   Opening the menu: the dots leave the ring still moving at orbit speed and ease into a "•••" line in the
   centre - always forward, never more than a third of a turn. Closing: they spiral back out to evenly spaced
   points and reach the ring already moving at orbit speed; the CSS orbit then continues from exactly there.
   Driven frame by frame (a CSS transition always ends at a standstill, which reads as a freeze).
   Watches the menu's "open" class, so it follows every way the menu opens or closes. */
(function () {
  var btn = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.nav-links');
  if (!btn || !menu || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var dots = Array.prototype.slice.call(btn.children);
  var R = 16.25, GAP = 8, MS = 1000;
  var TURN = 12000, SPIN = 360 / TURN * MS;  // degrees the orbit covers during one move (12 s a turn, style.css)
  var raf = 0, wasOpen = false;

  function mod(a) { return ((a % 360) + 360) % 360; }
  function ahead(target, from) { return from + mod(target - from); }     // same angle, reached going forward
  function place(d, a, r) { d.style.transform = 'rotate(' + a + 'deg) translateX(' + r + 'px)'; }
  function read(d) {                                                     // where a dot is drawn right now
    if (d._a != null) return { a: d._a, r: d._r };
    var m = new DOMMatrix(getComputedStyle(d).transform);
    return { a: Math.atan2(m.f, m.e) * 180 / Math.PI, r: Math.hypot(m.e, m.f) };
  }
  // cubic Hermite from p0 (speed v0) to p1 (speed v1); speeds in units per whole move
  function herm(p0, v0, p1, v1, t) {
    var t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * v0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * v1;
  }
  function ease(t) { return t * t * (3 - 2 * t); }

  function run(open) {
    cancelAnimationFrame(raf);
    var s = dots.map(read), moving = dots.some(function (d) { return d._moving; });
    var plan = s.map(function (p) { return { a0: p.a, r0: p.r }; });
    if (open) {
      // left end of the line: the dot closest (going forward) to 180 deg; right end: the closest of the rest to 0 deg
      var idx = [0, 1, 2];
      var L = idx.slice().sort(function (a, b) { return mod(180 - s[a].a) - mod(180 - s[b].a); })[0];
      var rest = idx.filter(function (i) { return i !== L; });
      var Rt = rest.sort(function (a, b) { return mod(0 - s[a].a) - mod(0 - s[b].a); })[0];
      var C = idx.filter(function (i) { return i !== L && i !== Rt; })[0];
      plan[L].a1 = ahead(180, s[L].a);   plan[L].r1 = GAP;
      plan[Rt].a1 = ahead(0, s[Rt].a);   plan[Rt].r1 = GAP;
      plan[C].a1 = s[C].a + SPIN * 0.5;  plan[C].r1 = 0;
      plan.forEach(function (p) { p.v0 = moving ? 0 : SPIN; p.v1 = 0; });
    } else {
      // fan out to three points 120 deg apart, arriving at orbit speed. Pick the spacing and which dot takes
      // which point so the longest forward trip is as short as possible (the centre dot, at radius ~0, can
      // leave at any angle, so it costs nothing). MIN keeps every trip long enough to never step backwards.
      var MIN = SPIN * 0.4, perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]], best = null;
      for (var b = 0; b < 120; b += 2) {
        perms.forEach(function (pm) {
          var cost = 0, a1 = [];
          for (var i = 0; i < 3; i++) {
            var target = b + 120 * pm[i];
            if (s[i].r < 2) { a1[i] = target; continue; }                    // centre dot: free
            a1[i] = ahead(target, s[i].a + MIN);
            cost = Math.max(cost, a1[i] - s[i].a);
          }
          if (!best || cost < best.cost) best = { cost: cost, a1: a1 };
        });
      }
      plan.forEach(function (p, i) {
        p.a1 = best.a1[i]; p.r1 = R; p.v0 = 0; p.v1 = SPIN;
        if (s[i].r < 2) p.a0 = p.a1 - SPIN * 0.6;                             // centre dot leaves heading the right way
      });
    }
    dots.forEach(function (d) { d.style.animation = 'none'; d._moving = true; });
    var t0 = performance.now();
    (function step(now) {
      var t = Math.min(1, (now - t0) / MS);
      dots.forEach(function (d, i) {
        var p = plan[i];
        d._a = herm(p.a0, p.v0, p.a1, p.v1, t);
        d._r = p.r0 + (p.r1 - p.r0) * ease(t);
        place(d, d._a, d._r);
      });
      if (t < 1) { raf = requestAnimationFrame(step); return; }
      dots.forEach(function (d) { d._moving = false; });
      if (!open) {
        // hand back to the CSS orbit, phased so each dot continues from the angle it reached
        dots.forEach(function (d) {
          d.style.transform = ''; d.style.animation = '';             // (clears any old inline delay too)
          d.style.animationDelay = (-mod(d._a) / 360 * TURN) + 'ms';
          d._a = d._r = null;
        });
      }
    })(t0);
  }

  function sync() {
    var open = menu.classList.contains('open');
    if (open === wasOpen) return;
    wasOpen = open;
    if (getComputedStyle(dots[0]).position !== 'absolute') return;   // desktop: the button isn't shown
    run(open);
  }
  new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
})();
