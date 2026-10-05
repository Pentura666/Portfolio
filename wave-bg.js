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
    rippleStrength: 1.8,   // click ripple height
    rippleSpeed: 9,        // how fast the ring travels outward (units / s)
    rippleWidth: 2.5,      // thickness of the ring
    rippleLife: 3.5,       // seconds until a ripple's height and color have faded out
    rippleMax: 8,          // ripples alive at once (oldest dropped)
    rippleColor: 0.35,     // how much a ripple tints cubes orange (0 = none)
    rippleColorLife: 6,    // seconds the orange stays on the ring (holds, then fades at the end)
    echoes: 0.6,           // trailing echo waves behind the ring (0 = single ring)
    rippleFlip: true,      // each cube flips over once as the ring passes
    colorLow: '#030303',   // glossy black: wave bottoms
    colorHigh: '#161616',  // slightly lifted black: wave tops
    colorCursor: '#ff8400',// --primary: only where the cursor is
    background: '#111111', // --bg
    brightness: 1.0,       // overall light level (lower = calmer behind text)
    roundness: 0.12,       // rounded cube edges (catch highlights)
    gloss: 0.07,           // surface roughness (lower = sharper reflections)
    reflections: 0.6,      // strength of the studio reflections
    glow: 0.25             // how much orange cubes light up
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

  scene.add(new THREE.AmbientLight(0xffffff, 0.08 * CONFIG.brightness));
  var keyLight = new THREE.DirectionalLight(0xffffff, 0.35 * CONFIG.brightness);
  keyLight.position.set(10, 30, 15);
  scene.add(keyLight);

  var N = CONFIG.grid, count = N * N;
  // rounded cube: subdivided box, corners pushed onto small spheres
  function roundedBox(size, radius, seg) {
    var g = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
    var p = g.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3();
    var h = size / 2 - radius;
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      inner.set(Math.max(-h, Math.min(h, v.x)), Math.max(-h, Math.min(h, v.y)), Math.max(-h, Math.min(h, v.z)));
      v.sub(inner).normalize().multiplyScalar(radius).add(inner);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }
  var geometry = roundedBox(CONFIG.cubeSize * 0.94, CONFIG.roundness, 4);

  // studio reflections: a dark room with thin grey light strips, baked into an environment map
  var envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#050505');
  function strip(w, h, color, x, y, z) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0);
    envScene.add(m);
  }
  strip(30, 1.2, '#bdbdbd', 0, 20, -10);    // long thin softbox above, behind
  strip(30, 0.6, '#8a8a8a', 0, 18, 12);     // thin fill above, front
  strip(1.6, 22, '#6b6b6b', 22, 6, 4);      // grey side strip
  var pmrem = new THREE.PMREMGenerator(renderer);
  var envMap = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();

  var material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,               // tinted per cube by instance color (near black)
    metalness: 0.85,
    roughness: CONFIG.gloss,
    clearcoat: 1,                  // lacquer layer on top = extra shine
    clearcoatRoughness: 0.06,
    reflectivity: 0.9,
    envMap: envMap,
    envMapIntensity: CONFIG.reflections
  });
  // orange cubes (cursor, ripples) glow a little; black cubes stay black
  material.onBeforeCompile = function (shader) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += max(vColor - 0.12, 0.0) * ' + CONFIG.glow.toFixed(2) + ';\n#endif');
  };
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

  // Click / tap -> ring ripple travelling out from that point
  var ripples = [], axis = new THREE.Vector3(), q = new THREE.Quaternion();
  window.addEventListener('pointerdown', function (e) {
    if (reduceMotion) return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(ground, hit)) {
      ripples.push({ x: hit.x, z: hit.z, t0: simT });
      if (ripples.length > CONFIG.rippleMax) ripples.shift();
    }
  }, { passive: true });

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

  // own clock: stands still while paused (window.waveBgPaused = true, e.g. under the gallery viewer),
  // so the wave resumes where it stopped instead of jumping
  var simT = 0;

  function frame() {
    var dt = Math.min(clock.getDelta(), 0.1);
    if (window.waveBgPaused) { requestAnimationFrame(frame); return; }
    simT += dt;
    var now = simT;
    var t = reduceMotion ? 0 : now * CONFIG.speed;

    // ripple state for this frame: ring radius + fade
    // height and color fade after rippleLife; the flip keeps rolling to the edge so no cube stops halfway
    while (ripples.length && (now - ripples[0].t0) * CONFIG.rippleSpeed > half * 1.5 + 12) ripples.shift();
    for (var r = 0; r < ripples.length; r++) {
      var age = now - ripples[r].t0;
      ripples[r].front = age * CONFIG.rippleSpeed;
      ripples[r].fade = Math.pow(Math.max(0, 1 - age / CONFIG.rippleLife), 2);
      ripples[r].colorFade = 1 - Math.pow(Math.min(1, age / CONFIG.rippleColorLife), 3); // stays strong, fades late
    }

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

      dummy.quaternion.identity();
      for (var r = 0; r < ripples.length; r++) {
        var rp = ripples[r];
        var rx = x - rp.x, rz = z - rp.z;
        var dist = Math.sqrt(rx * rx + rz * rz) - rp.front; // world units from the ring front
        var off = dist / CONFIG.rippleWidth;
        if (off < -5 || off > 1.6) continue;
        // soft leading crest, then smaller echo waves trailing behind it (feedback trail)
        var crest = off >= 0
          ? Math.exp(-off * off)
          : Math.cos(off * 2) * (Math.exp(-off * off) * (1 - CONFIG.echoes) + Math.exp(off * 0.7) * CONFIG.echoes);
        y += crest * rp.fade * CONFIG.rippleStrength;
        glow += Math.max(0, crest) * rp.colorFade * CONFIG.rippleColor;
        if (CONFIG.rippleFlip && dist > -3 && dist < 3) {
          // one flip (half turn) outward as the ring passes, eased in-out; a cube looks the same after it
          var u2 = 1 - (dist + 3) / 6, turn = Math.PI * u2 * u2 * (3 - 2 * u2);
          if (Math.abs(rx) > Math.abs(rz)) axis.set(0, 0, rx > 0 ? -1 : 1); else axis.set(rz > 0 ? 1 : -1, 0, 0);
          dummy.quaternion.multiply(q.setFromAxisAngle(axis, turn));
        }
      }
      if (glow > 1) glow = 1;

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
