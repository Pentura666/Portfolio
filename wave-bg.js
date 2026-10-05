/* Wave cubes background — fixed behind the whole page, reacts to the cursor.
   Needs three.js loaded before this file. */
(function () {
  if (typeof THREE === 'undefined') return;

  // ===== Settings =====
  var CONFIG = {
    grid: 64,              // cubes per side
    spacing: 1.1,
    cubeSize: 1,
    amplitude: 1.1,        // wave height
    frequency: 0.5,        // ripple density
    speed: 0.7,            // animation speed (calm, like the photo wall drift)
    mouseRadius: 7,        // size of the lift under the cursor
    mouseStrength: 3,      // height of the lift
    colorLow: '#1a1a1a',   // --bg-card: wave bottoms
    colorHigh: '#4a4a4a',  // light grey: wave tops (monochrome, like the photo wall)
    colorCursor: '#ff8400',// --primary: only where the cursor is
    background: '#111111', // --bg
    brightness: 1.0       // overall light level (lower = calmer behind text)
  };

  var canvas = document.createElement('canvas');
  canvas.id = 'wave-bg';
  canvas.setAttribute('aria-hidden', 'true');
  // layout inline too, so a cached old style.css can't turn it into a block above the page
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;display:block;pointer-events:none;';
  document.body.insertBefore(canvas, document.body.firstChild);

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) { canvas.remove(); return; } // no WebGL: page keeps plain background
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.background);
  scene.fog = new THREE.Fog(CONFIG.background, 50, 100);

  var camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);

  scene.add(new THREE.AmbientLight(0xffffff, 0.3 * CONFIG.brightness));
  var keyLight = new THREE.DirectionalLight(0xffffff, 0.8 * CONFIG.brightness);
  keyLight.position.set(10, 30, 15);
  scene.add(keyLight);

  var N = CONFIG.grid, count = N * N;
  var geometry = new THREE.BoxGeometry(CONFIG.cubeSize, CONFIG.cubeSize, CONFIG.cubeSize);
  var material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
  var mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  var pos = new Float32Array(count * 2);
  var half = (N - 1) * CONFIG.spacing / 2;
  for (var i = 0; i < N; i++) {
    for (var j = 0; j < N; j++) {
      var k = i * N + j;
      pos[k * 2] = i * CONFIG.spacing - half;
      pos[k * 2 + 1] = j * CONFIG.spacing - half;
    }
  }

  var dummy = new THREE.Object3D();
  var color = new THREE.Color();
  var cLow = new THREE.Color(CONFIG.colorLow);
  var cHigh = new THREE.Color(CONFIG.colorHigh);
  var cCursor = new THREE.Color(CONFIG.colorCursor);
  for (var c = 0; c < count; c++) mesh.setColorAt(c, cLow);

  // Cursor -> point on the cube field (works over any page content)
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var hit = new THREE.Vector3();
  var mouse = { x: 0, z: 0, tx: 0, tz: 0, strength: 0, target: 0 };

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(ground, hit)) {
      mouse.tx = hit.x; mouse.tz = hit.z; mouse.target = 1;
    }
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', function () { mouse.target = 0; });

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    var dist = camera.aspect < 1 ? 1.6 : 1;
    camera.position.set(28 * dist, 40 * dist, 28 * dist); // higher = fills the screen
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clock = new THREE.Clock();
  var A = CONFIG.amplitude;
  var range = A * 3 + CONFIG.mouseStrength;

  function frame() {
    var t = reduceMotion ? 0 : clock.getElapsedTime() * CONFIG.speed;

    // cursor point glides instead of jumping
    mouse.x += (mouse.tx - mouse.x) * 0.12;
    mouse.z += (mouse.tz - mouse.z) * 0.12;
    mouse.strength += (mouse.target - mouse.strength) * 0.06;

    for (var k = 0; k < count; k++) {
      var x = pos[k * 2], z = pos[k * 2 + 1];
      var d = Math.sqrt(x * x + z * z);
      var y = Math.sin(d * CONFIG.frequency - t) * A;
      y += Math.sin(x * 0.15 + t * 0.6) * Math.cos(z * 0.12 - t * 0.4) * A * 0.5;

      var mx = x - mouse.x, mz = z - mouse.z;
      var md = Math.sqrt(mx * mx + mz * mz);
      var glow = 0;
      if (md < CONFIG.mouseRadius) {
        var f = 1 - md / CONFIG.mouseRadius;
        y += f * f * CONFIG.mouseStrength * mouse.strength;
        glow = f * f * mouse.strength;
      }

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);

      // grey by height; orange only under the cursor (like photos gaining color on hover)
      var n = Math.min(Math.max((y + A * 1.5) / range, 0), 1);
      color.copy(cLow).lerp(cHigh, n).lerp(cCursor, glow);
      mesh.setColorAt(k, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
})();
