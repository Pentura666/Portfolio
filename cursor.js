/* Custom cursor — whole site. Small orange dot on the pointer + an orange ring that trails it.
   Over links/buttons the ring grows; over zoomable photos it becomes a big soft ring with a label:
   VIEW (gallery thumbnails), ZOOM (on the open photo), DRAG (open photo while zoomed),
   CLOSE (dark area around the open photo — a click there closes it).
   Mouse / trackpad only — touch screens keep their normal behaviour. Styles: "custom cursor" in style.css. */
(function () {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  var LAG = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : 10; // ring follow speed (higher = tighter)

  var html = document.documentElement;
  var dot = document.createElement('div');
  var ring = document.createElement('div');
  var inner = document.createElement('div');
  var label = document.createElement('span');
  dot.className = 'fx-cursor-dot';
  ring.className = 'fx-cursor-ring';
  inner.className = 'fx-cursor-inner';
  label.className = 'fx-cursor-label';
  dot.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  inner.appendChild(label);
  ring.appendChild(inner);
  document.body.appendChild(ring);
  document.body.appendChild(dot);
  html.classList.add('fx-cursor');

  var mx = 0, my = 0, rx = 0, ry = 0, last = 0, shown = false, target = null, mode = '';
  var LABELS = { view: 'VIEW', zoom: 'ZOOM', drag: 'DRAG', close: 'CLOSE' };

  function detect(el) {
    if (!el || !el.closest) return '';
    var stage = el.closest('#lightbox-stage');
    if (stage) {
      if (stage.classList.contains('zoomed')) return 'drag';
      return el.id === 'lightbox-img' ? 'zoom' : 'close';
    }
    if (el.closest('.gallery-masonry-item')) return 'view';
    if (el.closest('a, button, [role="button"], label, select, summary, .icon-btn')) return 'link';
    return '';
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    ring.className = 'fx-cursor-ring' + (m ? ' is-' + (LABELS[m] ? 'photo' : m) : '');
    dot.classList.toggle('is-hidden', !!LABELS[m]);
    if (LABELS[m]) label.textContent = LABELS[m];
  }

  function show(on) {
    shown = on;
    dot.classList.toggle('is-off', !on);
    ring.classList.toggle('is-off', !on);
  }
  show(false);

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    mx = e.clientX; my = e.clientY;
    if (!shown) { rx = mx; ry = my; show(true); }
    target = e.target;
    setMode(detect(target));
    dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
  }, { passive: true });

  // pointer left the window, or went into an embedded video (iframes hide their events from the page)
  document.addEventListener('mouseleave', function () { show(false); });
  document.addEventListener('pointerover', function (e) { if (e.target.tagName === 'IFRAME') show(false); });

  window.addEventListener('pointerdown', function () { ring.classList.add('is-down'); });
  window.addEventListener('pointerup', function () { ring.classList.remove('is-down'); });

  (function tick(now) {
    var dt = Math.min((now - last) / 1000 || 0, 0.05); last = now;
    var k = 1 - Math.exp(-dt * LAG);
    rx += (mx - rx) * k; ry += (my - ry) * k;
    ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
    if (shown) setMode(detect(target)); // re-checked every frame: zooming changes ZOOM -> DRAG without a move
    requestAnimationFrame(tick);
  })(0);
})();
