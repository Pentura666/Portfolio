/* Page transition: "ripple erase".
   Click a link to another page of the site: an orange ring spreads from the click point. Inside the ring
   the new page is already there, outside it the old page stays until the ring passes.
   While photos you can see are still loading, the ring spreads slowly around the click, then runs out
   at full speed once they are ready (max 3 s slow), so nothing pops in after the ripple.
   Jump links inside the same page (Home / Projects / Contact on the home page) get the same ripple:
   the page jumps instantly underneath it instead of smooth-scrolling.

   Uses View Transitions (Chrome / Edge 126+, Safari 18.2+). Other browsers simply navigate / scroll
   normally. Loaded in <head> on every page so it is ready before the new page is shown. */
(function () {
  // Arriving at a section of another page (Press -> Contact = index.html#contact): jump straight there.
  // The site has smooth scrolling on, so otherwise you watch the page scroll down under the ripple.
  if (location.hash) {
    var root = document.documentElement;
    root.style.scrollBehavior = 'auto';
    var jump = function () {
      var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t) t.scrollIntoView({ behavior: 'instant', block: 'start' });
    };
    document.addEventListener('DOMContentLoaded', jump);
    window.addEventListener('load', function () { jump(); setTimeout(function () { root.style.scrollBehavior = ''; }, 100); });
  }

  // ---- ?vtlog : on-phone log of what each page change did (for checking transitions on a real device) ----
  var LOG = [], showLog = false;
  try {
    if (/[?&]vtlog(=|&|$)/.test(location.search)) sessionStorage.setItem('vtlog', '1');
    showLog = sessionStorage.getItem('vtlog') === '1';
    LOG = JSON.parse(sessionStorage.getItem('vtlogData') || '[]');
  } catch (_) {}
  function log(msg) {
    if (!showLog) return;
    LOG.push(new Date().toTimeString().slice(0, 8) + ' ' + location.pathname.split('/').pop() + ': ' + msg);
    LOG = LOG.slice(-12);
    try { sessionStorage.setItem('vtlogData', JSON.stringify(LOG)); } catch (_) {}
    var p = document.getElementById('vtlog');
    if (!p && document.body) {
      p = document.createElement('pre'); p.id = 'vtlog';
      p.style.cssText = 'position:fixed;left:6px;right:6px;bottom:6px;z-index:2147483646;margin:0;padding:8px;max-height:40vh;overflow:auto;font:10px/1.35 ui-monospace,Menlo,monospace;color:#ffb347;background:rgba(0,0,0,.88);border:1px solid #ff8400;border-radius:8px;white-space:pre-wrap;pointer-events:none';
      document.body.appendChild(p);
    }
    if (p) p.textContent = LOG.join(String.fromCharCode(10));
  }
  if (showLog) document.addEventListener('DOMContentLoaded', function () { log('loaded (' + (/iPhone|iPad/.test(navigator.userAgent) ? 'iOS ' : '') + ('onpagereveal' in window ? 'transitions supported' : 'NO transition support') + ')'); });

  if (!('onpagereveal' in window)) return;
  var KEY = 'ptRipple';
  var DURATION = 1900;      // ms at full speed
  var SLOW = 0.12;          // speed while visible photos are still loading
  var SLOW_MAX = 3000;      // never slow for longer than this (ms)
  var RINGS = [0, 70, 150]; // main ring + two echo rings (px behind the main one)
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1) Click: another page -> remember where (the new page runs the ripple); same page -> ripple + jump here
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || e.defaultPrevented || e.button) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;     // new tab / window: leave alone
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;                          // other site
    var x = e.clientX, y = e.clientY;
    if (!x && !y) { var r = a.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; } // keyboard
    if (u.pathname === location.pathname) { samePage(e, u.hash, x, y); return; }
    try { sessionStorage.setItem(KEY, JSON.stringify({ x: x / innerWidth, y: y / innerHeight, t: Date.now() })); } catch (_) {}
  }, true);

  // 2) New page after a cross-page navigation: run the ripple
  window.addEventListener('pagereveal', function (e) {
    var vt = e.viewTransition;
    if (!vt) {
      var tapped = null; try { tapped = JSON.parse(sessionStorage.getItem(KEY)); } catch (_) {}
      log(tapped && Date.now() - tapped.t < 8000 ? 'SKIPPED: link was tapped but the browser started no transition' : 'opened directly (no transition expected)');
      return;
    }
    if (reduce) { log('skipped: reduce-motion is on'); vt.skipTransition(); return; }
    // note: the page body may not exist yet here (WebKit can reveal early) - rings go on <html>, never skip for that
    log('ripple started' + (document.body ? '' : ' (body not ready yet)'));
    vt.finished.then(function () { log('ripple finished'); }, function (err) { log('ripple SKIPPED: ' + (err && (err.name + ' ' + err.message))); });
    var o = null;
    try { o = JSON.parse(sessionStorage.getItem(KEY)); sessionStorage.removeItem(KEY); } catch (_) {}
    var fresh = o && Date.now() - o.t < 8000;                         // back/forward or typed URL: from the centre
    var x = fresh ? o.x * innerWidth : innerWidth / 2, y = fresh ? o.y * innerHeight : innerHeight / 2;
    var rings = makeRings(x, y);
    ripple(vt, x, y, function () { return rings; });
  });

  // 3) Same page (#projects, #contact, #home): jump instantly under the ripple instead of smooth-scrolling
  var running = null;
  function samePage(e, hash, x, y) {
    if (!document.startViewTransition || reduce) return;              // browser default (smooth scroll)
    // only real section links (#projects, #contact...). href="#" buttons (the project cards that open a
    // chooser) are not navigation: leave them alone, or the page would ripple and jump to the top
    if (!hash || hash.length < 2) return;
    var target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    if (running) { try { running.skipTransition(); } catch (_) {} }
    var rings = [];
    var vt = document.startViewTransition(function () {
      // the old view is already captured here: jump, then add the rings so only the new view has them
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      if (hash !== location.hash) history.pushState(null, '', hash);
      rings = makeRings(x, y);
    });
    running = vt;
    vt.finished.finally(function () { if (running === vt) running = null; });
    ripple(vt, x, y, function () { return rings; });
  }

  function farFrom(x, y) {
    return Math.max(Math.hypot(x, y), Math.hypot(innerWidth - x, y), Math.hypot(x, innerHeight - y),
                    Math.hypot(innerWidth - x, innerHeight - y)) + 60;
  }

  // rings: elements on the new page, drawn just inside the edge of the growing circle (the new page is
  // shown live during the transition; they are moved frame by frame in ripple())
  function makeRings(x, y) {
    var far = farFrom(x, y);
    return RINGS.map(function () {
      var d = document.createElement('div');
      d.setAttribute('aria-hidden', 'true');
      d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483000;left:' + (x - far) + 'px;top:' + (y - far) + 'px;width:' + (2 * far) + 'px;height:' + (2 * far) + 'px;' +
        'border-radius:50%;transform:scale(0);will-change:transform,opacity;' +
        'background:radial-gradient(circle closest-side, transparent 97.8%, rgba(255,132,0,.22) 98.6%, #ff8400 99.4%, rgba(255,132,0,.3) 99.8%, transparent 100%);';
      (document.body || document.documentElement).appendChild(d);
      return d;
    });
  }

  // the ripple, for either kind of view transition; getRings() returns the ring elements
  function ripple(vt, x, y, getRings) {
    var far = farFrom(x, y);
    // cube background keeps moving inside the ring (only the old page outside it is a still snapshot)
    var guard = setTimeout(function () { try { vt.skipTransition(); } catch (_) {} }, SLOW_MAX + DURATION * 2); // never hang

    vt.ready.then(function () {
      var anim = document.documentElement.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + far + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: DURATION, easing: 'linear', fill: 'forwards', pseudoElement: '::view-transition-new(root)' });
      // rings follow the circle frame by frame (page animations don't run during a cross-page transition)
      function drawRings() {
        var p = Math.min(1, (anim.currentTime || 0) / DURATION), r = p * far;
        getRings().forEach(function (d, i) {
          var a = i ? 0.45 / i : 1;
          d.style.transform = 'scale(' + Math.max(0, (r - RINGS[i]) / far) + ')';
          d.style.opacity = p > 0.8 ? a * (1 - p) / 0.2 : a;
        });
      }

      // speed: slow around the click until every photo you can see has loaded, then full speed
      function visibleReady() {
        var l = document.getElementById('gallery-loading');                // gallery: photo list not fetched yet
        if (l && l.offsetParent !== null && getComputedStyle(l).display !== 'none') return false;
        var imgs = document.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var b = imgs[i].getBoundingClientRect();
          if (b.bottom > 0 && b.top < innerHeight && b.width && !(imgs[i].complete && imgs[i].naturalWidth)) return false;
        }
        return true;
      }
      var t0 = performance.now(), go = visibleReady(), rate = go ? 1 : SLOW, last = t0, done = false;
      anim.playbackRate = rate;
      vt.finished.then(function () { done = true; }, function () { done = true; });
      (function ctl(now) {
        if (done) return;
        drawRings();
        var dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (!go && (now - t0 > SLOW_MAX || visibleReady())) go = true;
        rate += ((go ? 1 : SLOW) - rate) * (1 - Math.exp(-dt * 4));      // smooth speed-up
        anim.playbackRate = rate;
        requestAnimationFrame(ctl);
      })(t0);
    }).catch(function (err) { log('ripple could not start: ' + (err && (err.name + ' ' + err.message))); });

    vt.finished.catch(function () {}).then(function () {
      clearTimeout(guard);
      getRings().forEach(function (d) { d.remove(); });
    });
  }
})();
