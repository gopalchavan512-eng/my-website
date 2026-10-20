"use strict";
/* FitTrack 3D stage: a procedural barbell (Three.js r128). No external models or textures.
   Falls back to the static SVG when WebGL/Three.js is unavailable. Pauses when off-screen or tab hidden. */
(function () {
  const canvas = document.getElementById("gymStage"), card = canvas && canvas.closest(".stage3d-card");
  if (!canvas || !card) return;
  const api = { setProgress() {}, pulse() {} }; window.FitScene = api;
  const T = window.THREE; if (!T) return;                       // CDN blocked/offline -> SVG fallback stays visible
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let r; try { r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" }); } catch (e) { return; }
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;

  const scene = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 60); cam.position.set(0, 1.5, 10.5); cam.lookAt(0, 0, 0);
  // Image-based lighting from a tiny studio of emissive panels (gives the steel real reflections)
  const env = new T.Scene(); env.background = new T.Color(0x07090c);
  [[0, 7, 0, 14, .3, 14, 0xffffff, 3.2], [-9, 2, 4, .3, 7, 8, 0x00ddf5, 5], [9, 1, -3, .3, 6, 8, 0x8fc4ff, 2.2], [0, -4, 7, 14, .3, 4, 0x2b3442, 1]].forEach(([x, y, z, w, h, d, c, k]) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(k) })); m.position.set(x, y, z); env.add(m);
  });
  const pm = new T.PMREMGenerator(r); scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose();
  const key = new T.DirectionalLight(0xffffff, 0.9); key.position.set(4, 7, 6); scene.add(key);
  const rimLight = new T.PointLight(0x00ddf5, 1.6, 30); rimLight.position.set(-6, 2, -4); scene.add(rimLight);

  const steel = new T.MeshStandardMaterial({ color: 0xc4ccd6, metalness: 1, roughness: 0.26 });
  const knurl = new T.MeshStandardMaterial({ color: 0x8b94a0, metalness: 1, roughness: 0.55 });
  const iron = new T.MeshStandardMaterial({ color: 0x14171c, metalness: 0.65, roughness: 0.42 });
  const glow = new T.MeshStandardMaterial({ color: 0x00ddf5, emissive: 0x00ddf5, emissiveIntensity: 0.5, metalness: 0.2, roughness: 0.3 });
  const rig = new T.Group(); scene.add(rig);
  const cyl = (rad, len, mat, x) => { const m = new T.Mesh(new T.CylinderGeometry(rad, rad, len, 48), mat); m.rotation.z = Math.PI / 2; m.position.x = x; rig.add(m); return m; };
  cyl(0.075, 8, steel, 0); [-1.35, 1.35].forEach(x => cyl(0.082, 1.5, knurl, x));
  [-1, 1].forEach(s => {
    [[1.25, 0.2, 2.15], [1.0, 0.17, 2.4], [0.72, 0.14, 2.62]].forEach(([rad, th, x]) => {
      cyl(rad, th, iron, s * x);
      const ring = new T.Mesh(new T.TorusGeometry(rad - 0.035, 0.014, 12, 96), glow); ring.rotation.y = Math.PI / 2; ring.position.x = s * (x + th / 2 + 0.002); rig.add(ring);
    });
    cyl(0.16, 0.14, steel, s * 2.9); cyl(0.2, 0.05, glow, s * 3.0);
  });
  // soft contact shadow (canvas radial gradient)
  const sc = document.createElement("canvas"); sc.width = sc.height = 128; const g = sc.getContext("2d").createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,.65)"); g.addColorStop(1, "rgba(0,0,0,0)"); const sx = sc.getContext("2d"); sx.fillStyle = g; sx.fillRect(0, 0, 128, 128);
  const shadow = new T.Mesh(new T.PlaneGeometry(9, 3), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.6; scene.add(shadow);

  // interaction: drag to rotate, gentle pointer parallax, idle spin, "pulse" kick when data is logged
  let ry = -0.6, rx = 0.28, vy = still ? 0 : 0.004, dragging = false, lx = 0, ly = 0, px = 0, py = 0, progress = 0, shown = 0, kick = 0, visible = true, raf = 0;
  canvas.style.touchAction = "pan-y"; canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => {
    const b = canvas.getBoundingClientRect(); px = (e.clientX - b.left) / b.width - 0.5; py = (e.clientY - b.top) / b.height - 0.5;
    if (dragging) { ry += (e.clientX - lx) * 0.01; rx = Math.max(-0.5, Math.min(0.9, rx + (e.clientY - ly) * 0.006)); lx = e.clientX; ly = e.clientY; if (still) frame(); }
  });
  const up = () => { dragging = false; canvas.style.cursor = "grab"; }; canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  api.setProgress = p => { progress = Math.max(0, Math.min(1, p)); if (still) frame(); };
  api.pulse = () => { if (!still) kick = 0.25; };

  function resize() { const w = card.clientWidth, h = card.clientHeight; if (!w || !h) return; r.setSize(w, h, false); cam.aspect = w / h; cam.position.z = w < 520 ? 13.5 : 10.5; cam.updateProjectionMatrix(); }
  function frame() {
    if (!dragging) ry += vy + kick; kick *= 0.94; shown += (progress - shown) * 0.06;
    rig.rotation.set(rx + py * 0.15, ry + px * 0.2, -0.08); glow.emissiveIntensity = 0.35 + shown * 2.2; rimLight.intensity = 1.2 + shown * 1.6;
    r.render(scene, cam);
  }
  function loop() { raf = 0; if (!visible || document.hidden) return; frame(); raf = requestAnimationFrame(loop); }
  const kickLoop = () => { if (!raf && !still) raf = requestAnimationFrame(loop); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; kickLoop(); if (still && visible) frame(); }).observe(card);
  document.addEventListener("visibilitychange", kickLoop);
  new ResizeObserver(() => { resize(); if (still) frame(); }).observe(card);
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); card.classList.remove("ready"); cancelAnimationFrame(raf); });
  resize(); frame(); card.classList.add("ready"); kickLoop();
})();
