import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./IntroScene.css";

const FLOOR_Y = -2.5;
const FADE_MS = 1000;
const CENTER_X = -2.0; // horizontal centre of drum + pour so the whole thing sits mid-screen
const TAU = Math.PI * 2;

// Real-world scale: 1 unit is roughly 0.3 m, so gravity is ~30 units/s^2 and concrete
// leaves the lip at roughly 1 m/s (~3.2 units/s). This is what makes the pour read as heavy and real.
const G = 30;
const V0 = 3.2;

const MAX = 1400; // splash / crumb particle pool
const LIFE = 5;
const CRUMB_RATE = 55;
const SPLASH_RATE = 90;
const MOUTH_Y = 1.62;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Drum silhouette: closed cone at the back, belly, tapered neck, open mouth at +y. Resampled evenly so textures don't stretch.
const CTRL = [
  [0.0, -1.75], [0.55, -1.72], [0.95, -1.45], [1.3, -0.9], [1.42, -0.2],
  [1.42, 0.3], [1.25, 0.85], [0.98, 1.3], [0.88, 1.55], [0.9, MOUTH_Y],
].map(([r, y]) => new THREE.Vector2(r, y));
const PROFILE = new THREE.SplineCurve(CTRL).getSpacedPoints(70).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
const radiusAt = (y) => {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const a = PROFILE[i], b = PROFILE[i + 1];
    if (y >= a.y && y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1);
  }
  return PROFILE[PROFILE.length - 1].x;
};

/* ------------------------------------------------------------------ textures (all generated, no assets) */

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

function addGrain(g, w, h, amount) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function softSprite() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function radialAlpha() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "#fff");
  gr.addColorStop(0.5, "#fff");
  gr.addColorStop(1, "#000");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// Dusk sky + warm horizon + low sun, used only for reflections on the steel and wet concrete.
function skyTexture() {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H);
  const lin = g.createLinearGradient(0, 0, 0, H);
  lin.addColorStop(0, "#2f4358");
  lin.addColorStop(0.35, "#6e7f8d");
  lin.addColorStop(0.48, "#c8b79a");
  lin.addColorStop(0.5, "#8a8173");
  lin.addColorStop(0.56, "#1d2328");
  lin.addColorStop(1, "#0a0d10");
  g.fillStyle = lin;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`;
    g.beginPath();
    g.ellipse(Math.random() * W, 60 + Math.random() * 130, 80 + Math.random() * 160, 8 + Math.random() * 18, 0, 0, TAU);
    g.fill();
  }
  const sx = W * 0.62, sy = H * 0.3;
  const sg = g.createRadialGradient(sx, sy, 0, sx, sy, 100);
  sg.addColorStop(0, "#fff4d6");
  sg.addColorStop(0.2, "rgba(255,230,170,0.8)");
  sg.addColorStop(1, "rgba(255,220,150,0)");
  g.fillStyle = sg;
  g.fillRect(sx - 100, sy - 100, 200, 200);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Wet cement paste: mottled grey, sand and aggregate specks. Tileable, used for the pour, mound and drum interior.
function concreteTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#74766f";
  g.fillRect(0, 0, S, S);
  const blob = (x, y, r, rgba) => {
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const gx = x + dx, gy = y + dy;
        if (gx < -r || gx > S + r || gy < -r || gy > S + r) continue;
        const gr = g.createRadialGradient(gx, gy, 0, gx, gy, r);
        gr.addColorStop(0, rgba);
        gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, "0)"));
        g.fillStyle = gr;
        g.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
    }
  };
  for (let i = 0; i < 150; i++) {
    const light = Math.random() < 0.5;
    blob(Math.random() * S, Math.random() * S, 20 + Math.random() * 70,
      light ? `rgba(255,255,255,${0.04 + Math.random() * 0.06})` : `rgba(0,0,0,${0.05 + Math.random() * 0.08})`);
  }
  for (let i = 0; i < 6000; i++) {
    const k = Math.random();
    const col = k < 0.5 ? "170,160,138" : k < 0.8 ? "35,37,36" : "195,197,192";
    g.fillStyle = `rgba(${col},${0.25 + Math.random() * 0.5})`;
    const s = 1 + Math.random() * 1.6;
    g.fillRect(Math.random() * S, Math.random() * S, s, s);
  }
  addGrain(g, S, S, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Weathered galvanised drum: colour, height and roughness maps. Top of the canvas is the mouth,
// where concrete crust and drips build up. Lathe seam (u = 0) sits under the longitudinal weld.
function drumTextures() {
  const W = 1024, H = 1024;
  const [cc, gc] = canvas(W, H);
  const [cb, gb] = canvas(W, H);
  const [cr, gr] = canvas(W, H);
  gc.fillStyle = "#7b838a";
  gb.fillStyle = "#808080";
  gr.fillStyle = "#7c7c7c";
  gc.fillRect(0, 0, W, H); gb.fillRect(0, 0, W, H); gr.fillRect(0, 0, W, H);

  const soft = (g, x, y, r, rgba) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba);
    grd.addColorStop(1, rgba.replace(/[\d.]+\)$/, "0)"));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // mottled oxidation and grime
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 30 + Math.random() * 110;
    const light = Math.random() < 0.45;
    soft(gc, x, y, r, light ? `rgba(255,255,255,${0.04 + Math.random() * 0.05})` : `rgba(10,12,14,${0.05 + Math.random() * 0.09})`);
    soft(gr, x, y, r, light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.1)");
  }
  // brushed streaks along the axis
  for (let i = 0; i < 320; i++) {
    const light = Math.random() < 0.5;
    gc.fillStyle = light ? `rgba(255,255,255,${0.025 + Math.random() * 0.05})` : `rgba(0,0,0,${0.04 + Math.random() * 0.07})`;
    gc.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 40 + Math.random() * 260);
  }
  // rust bleed
  for (let i = 0; i < 38; i++) {
    const x = Math.random() * W, y = H * (0.25 + Math.random() * 0.75), r = 14 + Math.random() * 46;
    soft(gc, x, y, r, `rgba(118,66,36,${0.1 + Math.random() * 0.2})`);
    soft(gr, x, y, r, "rgba(255,255,255,0.35)");
  }
  // concrete crust, thickest at the mouth
  for (let i = 0; i < 620; i++) {
    const y = H * 0.66 * Math.pow(Math.random(), 1.9);
    const x = Math.random() * W, r = 2 + Math.random() * 15;
    const v = 142 + Math.random() * 40;
    soft(gc, x, y, r, `rgba(${v},${v + 1},${v - 4},0.92)`);
    soft(gb, x, y, r, "rgba(255,255,255,0.9)");
    soft(gr, x, y, r, "rgba(238,238,238,0.95)");
  }
  // drips running down from the lip
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * W, y0 = Math.random() * H * 0.3, len = 60 + Math.random() * 300, w = 2 + Math.random() * 7;
    const v = 138 + Math.random() * 36;
    gc.fillStyle = `rgba(${v},${v + 1},${v - 4},0.85)`;
    gc.fillRect(x, y0, w, len);
    gb.fillStyle = "rgba(235,235,235,0.85)";
    gb.fillRect(x, y0, w, len);
    gr.fillStyle = "rgba(236,236,236,0.9)";
    gr.fillRect(x, y0, w, len);
  }
  // scratches and wear
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI, l = 10 + Math.random() * 70;
    gc.strokeStyle = `rgba(215,220,225,${0.08 + Math.random() * 0.14})`;
    gc.lineWidth = 0.6 + Math.random();
    gc.beginPath();
    gc.moveTo(x, y);
    gc.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    gc.stroke();
  }
  addGrain(gc, W, H, 22);
  addGrain(gb, W, H, 48);
  addGrain(gr, W, H, 26);

  const wrap = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: wrap(cc, true), bump: wrap(cb, false), rough: wrap(cr, false) };
}

// Dark, damp, blotchy site slab.
function floorTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#1b2127";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${0.03 + Math.random() * 0.05})`;
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 20 + Math.random() * 70, 14 + Math.random() * 50, Math.random() * 3, 0, TAU);
    g.fill();
  }
  addGrain(g, S, S, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Scratched, chipped paint for the stand.
function paintTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#d4d4d4";
  g.fillRect(0, 0, S, S);
  addGrain(g, S, S, 30);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI, l = 8 + Math.random() * 50;
    g.strokeStyle = Math.random() < 0.6 ? `rgba(255,255,255,${0.06 + Math.random() * 0.1})` : `rgba(30,30,32,${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 0.6 + Math.random() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(160,160,165,${0.4 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Box-section tube from a to b. w = width, h = thickness.
function tube(a, b, w, h, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d.length(), h), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ component */

export default function IntroScene({ onLeaveStart, onDone }) {
  const mountRef = useRef(null);
  const leavingRef = useRef(false);
  const leaveAtRef = useRef(0);
  const mountedAt = useRef(performance.now());
  const [leaving, setLeaving] = useState(false);

  const leave = (force = false) => {
    if (leavingRef.current) return;
    if (!force && performance.now() - mountedAt.current < 500) return; // ignore accidental instant input
    leavingRef.current = true;
    leaveAtRef.current = performance.now();
    setLeaving(true);
    onLeaveStart?.();
    setTimeout(() => onDone?.(), force ? 0 : FADE_MS);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // Any activity leaves the intro.
  useEffect(() => {
    const h = () => leaveRef.current();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, h, { passive: true }));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      events.forEach((e) => window.removeEventListener(e, h));
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      leaveRef.current(true); // no WebGL: go straight to the app
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const textures = [];
    const track = (t) => { textures.push(t); return t; };

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0e12, 0.03);

    // image-based light from a generated dusk sky: gives the metal and wet concrete believable reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sky = skyTexture();
    const envTex = pmrem.fromEquirectangular(sky).texture;
    sky.dispose();
    scene.environment = envTex;
    scene.environmentIntensity = 0.6;

    // telephoto-ish lens: flatter perspective reads as photographed
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
    const target = new THREE.Vector3(CENTER_X, 0.4, 0);
    let baseDist = 14;

    // ---- lights
    scene.add(new THREE.HemisphereLight(0x8fa3b5, 0x0b0e11, 0.4));
    const key = new THREE.DirectionalLight(0xffe0a6, 2.6);
    key.position.set(3, 9, 5);
    key.target.position.set(CENTER_X, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.04;
    key.shadow.radius = 4;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x6f98c0, 1.7);
    rim.position.set(-6, 3, -5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9fb4c8, 0.5);
    fill.position.set(-5, 2, 8);
    scene.add(fill);

    // ---- floor
    const floorTex = track(floorTexture());
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);

    // ---- distant building frame (slabs + columns + rebar), softened by fog
    const silMat = new THREE.MeshStandardMaterial({ color: 0x1f2830, roughness: 1 });
    const slabs = 4;
    for (let k = 0; k <= slabs; k++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 7), silMat);
      slab.position.set(CENTER_X + 2, FLOOR_Y + k * 2.7 + 0.15, -14);
      scene.add(slab);
    }
    for (let x = -8; x <= 8; x += 3.5) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, slabs * 2.7, 0.7), silMat);
      col.position.set(CENTER_X + 2 + x, FLOOR_Y + (slabs * 2.7) / 2, -12);
      scene.add(col);
    }
    const rebarPts = [];
    for (let i = 0; i <= 6; i++) {
      const x = CENTER_X + 6 + i * 0.4;
      rebarPts.push(x, FLOOR_Y + slabs * 2.7, -12, x, FLOOR_Y + slabs * 2.7 + 3.4, -12);
    }
    for (let j = 1; j <= 8; j++) {
      const y = FLOOR_Y + slabs * 2.7 + j * 0.42;
      rebarPts.push(CENTER_X + 6, y, -12, CENTER_X + 8.4, y, -12);
    }
    const rebarGeo = new THREE.BufferGeometry();
    rebarGeo.setAttribute("position", new THREE.Float32BufferAttribute(rebarPts, 3));
    scene.add(new THREE.LineSegments(rebarGeo, new THREE.LineBasicMaterial({ color: 0x33414d })));

    // ---- materials
    const concTex = track(concreteTexture());
    concTex.repeat.set(2, 3);
    const wetConcrete = new THREE.MeshPhysicalMaterial({
      map: concTex, bumpMap: concTex, bumpScale: 2.0,
      roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
      side: THREE.DoubleSide,
    });

    const dt_ = drumTextures();
    track(dt_.map); track(dt_.bump); track(dt_.rough);
    const steel = new THREE.MeshStandardMaterial({
      map: dt_.map, bumpMap: dt_.bump, bumpScale: 3, roughnessMap: dt_.rough, roughness: 1,
      metalness: 0.5, side: THREE.DoubleSide,
    });
    const linerTex = track(concTex.clone());
    linerTex.needsUpdate = true;
    linerTex.repeat.set(6, 3);
    const liner = new THREE.MeshStandardMaterial({
      color: 0x8a8d87, map: linerTex, bumpMap: linerTex, bumpScale: 3, roughness: 0.85, side: THREE.DoubleSide,
    });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x24292e, metalness: 0.7, roughness: 0.45 });
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x1c2024, metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide });
    const weldMat = new THREE.MeshStandardMaterial({ color: 0x4a4440, metalness: 0.5, roughness: 0.7 });
    const patchMat = new THREE.MeshStandardMaterial({ color: 0x69727a, metalness: 0.5, roughness: 0.6 });
    const paintTex = track(paintTexture());
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x3b4a59, map: paintTex, bumpMap: paintTex, bumpScale: 0.6, metalness: 0.5, roughness: 0.55,
    });

    // ---- mixer drum
    const drum = new THREE.Group();
    drum.position.set(-3.2, 2.2, 0);
    drum.rotation.z = -Math.PI * 0.62; // mouth points right and slightly down
    scene.add(drum);
    const spinner = new THREE.Group();
    drum.add(spinner);

    const add = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; spinner.add(m); return m; };

    add(new THREE.Mesh(new THREE.LatheGeometry(PROFILE, 128), steel));
    // concrete-coated inside, seen when looking into the mouth
    add(new THREE.Mesh(new THREE.LatheGeometry(PROFILE.map((p) => new THREE.Vector2(p.x * 0.94, p.y * 0.98)), 64), liner), false);

    // weld seams where the drum sections join
    [-0.9, 0.85].forEach((y) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(radiusAt(y) + 0.008, 0.022, 8, 128), weldMat);
      t.rotation.x = Math.PI / 2;
      t.position.y = y;
      add(t, false);
    });
    // longitudinal weld: a visible cue that the drum is turning
    const weldPts = PROFILE.filter((p) => p.y > -1.5 && p.y < 1.55).filter((_, i) => i % 2 === 0)
      .map((p) => new THREE.Vector3(0, p.y, p.x + 0.012));
    add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(weldPts), 90, 0.013, 6), weldMat), false);
    // bolted patch plates
    [[2.2, 0.05], [4.1, -0.45]].forEach(([phi, y]) => {
      const r = radiusAt(y);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.03), patchMat);
      plate.position.set(Math.sin(phi) * (r + 0.015), y, Math.cos(phi) * (r + 0.015));
      plate.rotation.y = phi;
      add(plate, false);
    });

    // ring gear: toothed drive ring
    const gearY = 0.45, gearR = radiusAt(gearY);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(gearR + 0.05, gearR + 0.05, 0.2, 96, 1, true), gearMat);
    band.position.y = gearY;
    add(band);
    const TEETH = 88;
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), gearMat, TEETH);
    const td = new THREE.Object3D();
    for (let i = 0; i < TEETH; i++) {
      const a = (i / TEETH) * TAU;
      td.position.set(Math.sin(a) * (gearR + 0.1), gearY, Math.cos(a) * (gearR + 0.1));
      td.rotation.set(0, a, 0);
      td.updateMatrix();
      teeth.setMatrixAt(i, td.matrix);
    }
    add(teeth);

    // rolled lip at the mouth
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.91, 0.085, 14, 96), darkSteel);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = MOUTH_Y;
    add(lip);

    // rear hub: bearing cap, bolts and stub shaft
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 40), darkSteel);
    hub.position.y = -1.8;
    add(hub);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 6), gearMat);
      bolt.position.set(Math.sin(a) * 0.3, -1.88, Math.cos(a) * 0.3);
      add(bolt, false);
    }
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.4, 24), darkSteel);
    stub.position.y = -2.0;
    add(stub);

    // fixed mixing blades inside, visible through the mouth
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.32), liner);
      blade.rotation.order = "YXZ";
      blade.rotation.y = a;
      blade.rotation.x = 0.45;
      blade.position.set(Math.sin(a) * 0.72, 0.25, Math.cos(a) * 0.72);
      add(blade, false);
    }

    // wet concrete surface inside the mouth, sharing the pour's flowing texture
    const slurry = new THREE.Mesh(new THREE.CircleGeometry(0.78, 48), wetConcrete);
    slurry.rotation.x = -Math.PI / 2;
    slurry.position.y = 1.2;
    spinner.add(slurry);

    // ---- stand: tubular steel A-frames, floor ties, trunnion axle and bearing caps
    const pivot = new THREE.Vector3(-3.2, 2.2, 0);
    const FZ = 2.0; // outer stand frames; the tilt fork runs inboard of them at z = ±1.7
    [-FZ, FZ].forEach((z) => {
      const top = new THREE.Vector3(pivot.x, pivot.y, z);
      const footL = new THREE.Vector3(pivot.x - 1.0, FLOOR_Y + 0.05, z);
      const footR = new THREE.Vector3(pivot.x + 1.0, FLOOR_Y + 0.05, z);
      scene.add(tube(top, footL, 0.14, 0.1, frameMat));
      scene.add(tube(top, footR, 0.14, 0.1, frameMat));
      scene.add(tube(new THREE.Vector3(pivot.x - 0.62, FLOOR_Y + 0.8, z), new THREE.Vector3(pivot.x + 0.62, FLOOR_Y + 0.8, z), 0.09, 0.08, frameMat));
      [footL, footR].forEach((f) => {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.34), darkSteel);
        plate.position.set(f.x, FLOOR_Y + 0.02, z);
        plate.castShadow = true;
        plate.receiveShadow = true;
        scene.add(plate);
      });
      // apex gusset plate, bearing boss and bolts
      const sg = Math.sign(z);
      const gusset = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.06), darkSteel);
      gusset.position.set(pivot.x, pivot.y - 0.2, z);
      gusset.castShadow = true;
      scene.add(gusset);
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 32), gearMat);
      boss.rotation.x = Math.PI / 2;
      boss.position.set(pivot.x, pivot.y, z + sg * 0.07);
      boss.castShadow = true;
      scene.add(boss);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), darkSteel);
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(pivot.x + Math.cos(a) * 0.19, pivot.y + Math.sin(a) * 0.19, z + sg * 0.14);
        scene.add(bolt);
      }
      // spacer sleeve between the fork arm and the frame
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 20), darkSteel);
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.set(pivot.x, pivot.y, sg * 1.86);
      scene.add(sleeve);
    });
    [pivot.x - 1.0, pivot.x + 1.0].forEach((x) => {
      scene.add(tube(new THREE.Vector3(x, FLOOR_Y + 0.1, -FZ), new THREE.Vector3(x, FLOOR_Y + 0.1, FZ), 0.12, 0.1, frameMat));
    });
    scene.add(tube(new THREE.Vector3(pivot.x, FLOOR_Y + 0.8, -FZ), new THREE.Vector3(pivot.x, FLOOR_Y + 0.8, FZ), 0.09, 0.08, frameMat));

    // nuts on the pivot pin, outside the frames
    [-1, 1].forEach((sg) => {
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 6), gearMat);
      nut.rotation.x = Math.PI / 2;
      nut.position.set(pivot.x, pivot.y, sg * (FZ + 0.17));
      nut.castShadow = true;
      scene.add(nut);
    });

    // tilt cradle: a fixed belt hugs the belly on rollers, trunnion pads on it carry pins through the stand,
    // and rails run back round the cone to the rear bearing housing, so the drum is held at both ends
    const HR = 1.55;
    const hoopMat = frameMat.clone();
    hoopMat.side = THREE.DoubleSide;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(HR, HR, 0.18, 96, 1, true), hoopMat);
    belt.castShadow = true;
    belt.receiveShadow = true;
    drum.add(belt);
    [-0.09, 0.09].forEach((y) => {
      const edge = new THREE.Mesh(new THREE.TorusGeometry(HR, 0.026, 8, 96), frameMat);
      edge.rotation.x = Math.PI / 2;
      edge.position.y = y;
      edge.castShadow = true;
      drum.add(edge);
    });
    // support rollers between the belt and the spinning drum
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const roller = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.14), darkSteel);
      roller.position.set(Math.sin(a) * 1.49, 0, Math.cos(a) * 1.49);
      roller.rotation.y = a;
      drum.add(roller);
    }
    [-1, 1].forEach((sg) => {
      const z = sg * 1.62;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.24), frameMat);
      pad.position.set(0, 0, z);
      pad.castShadow = true;
      pad.receiveShadow = true;
      drum.add(pad);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 20), darkSteel);
      pin.rotation.x = Math.PI / 2;
      pin.position.set(0, 0, sg * 1.95);
      pin.castShadow = true;
      drum.add(pin);
      // rails: down the side of the drum, then in to the rear housing
      drum.add(tube(new THREE.Vector3(0, -0.1, z), new THREE.Vector3(0, -1.2, z), 0.14, 0.1, frameMat));
      drum.add(tube(new THREE.Vector3(0, -1.2, z), new THREE.Vector3(0, -2.15, sg * 0.34), 0.14, 0.1, frameMat));
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), frameMat);
      knuckle.position.set(0, -1.2, z);
      knuckle.castShadow = true;
      drum.add(knuckle);
    });
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 1.0), frameMat);
    cross.position.set(0, -2.15, 0);
    cross.castShadow = true;
    drum.add(cross);
    // drive motor on a mounting plate beside the housing
    const mplate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.45), darkSteel);
    mplate.position.set(-0.75, -2.37, 0);
    mplate.castShadow = true;
    drum.add(mplate);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 28), frameMat);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-0.8, -2.15, 0);
    motor.castShadow = true;
    drum.add(motor);
    [-0.55, -0.7, -0.85, -1.0].forEach((x) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.015, 6, 28), gearMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(x, -2.15, 0);
      drum.add(ring);
    });
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 24), darkSteel);
    cowl.rotation.z = Math.PI / 2;
    cowl.position.set(-1.2, -2.15, 0);
    drum.add(cowl);
    // rear bearing / gearbox housing that the drum shaft turns in
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.45, 40), darkSteel);
    housing.position.set(0, -2.22, 0);
    housing.castShadow = true;
    drum.add(housing);
    [-2.1, -2.22, -2.34].forEach((y) => {
      const fin = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.025, 8, 40), gearMat);
      fin.rotation.x = Math.PI / 2;
      fin.position.set(0, y, 0);
      drum.add(fin);
    });
    const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 28), gearMat);
    endCap.position.set(0, -2.48, 0);
    drum.add(endCap);

    // base rails tying the feet together
    [-FZ, FZ].forEach((z) => {
      scene.add(tube(new THREE.Vector3(pivot.x - 1.0, FLOOR_Y + 0.1, z), new THREE.Vector3(pivot.x + 1.0, FLOOR_Y + 0.1, z), 0.1, 0.1, frameMat));
    });

    // transport wheels on the right foot
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.95 });
    const WR = 0.34;
    const wx = pivot.x + 1.0;
    const WZ = FZ + 0.3;
    [-1, 1].forEach((sg) => {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(WR - 0.085, 0.085, 14, 36), rubber);
      tire.position.set(wx, FLOOR_Y + WR, sg * WZ);
      tire.castShadow = true;
      tire.receiveShadow = true;
      scene.add(tire);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 28), patchMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(wx, FLOOR_Y + WR, sg * WZ);
      scene.add(rim);
      const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 16), gearMat);
      hubCap.rotation.x = Math.PI / 2;
      hubCap.position.set(wx, FLOOR_Y + WR, sg * WZ);
      scene.add(hubCap);
    });
    const wheelAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, WZ * 2, 12), darkSteel);
    wheelAxle.rotation.x = Math.PI / 2;
    wheelAxle.position.set(wx, FLOOR_Y + WR, 0);
    wheelAxle.castShadow = true;
    scene.add(wheelAxle);

    // transport handle on the left foot
    [-FZ, FZ].forEach((z) => {
      scene.add(tube(new THREE.Vector3(pivot.x - 1.0, FLOOR_Y + 0.12, z), new THREE.Vector3(pivot.x - 1.85, FLOOR_Y + 1.15, z), 0.1, 0.09, frameMat));
    });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, FZ * 2 + 0.2, 16), rubber);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(pivot.x - 1.85, FLOOR_Y + 1.15, 0);
    grip.castShadow = true;
    scene.add(grip);

    // tilt handwheel on the front frame
    const hwx = pivot.x + 0.6, hwy = FLOOR_Y + 1.9, hz = FZ + 0.5;
    const gbox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.16), darkSteel);
    gbox.position.set(hwx, hwy, FZ + 0.1);
    gbox.castShadow = true;
    scene.add(gbox);
    const hwShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 10), gearMat);
    hwShaft.rotation.x = Math.PI / 2;
    hwShaft.position.set(hwx, hwy, FZ + 0.34);
    scene.add(hwShaft);
    const hwheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 8, 36), darkSteel);
    hwheel.position.set(hwx, hwy, hz);
    hwheel.castShadow = true;
    scene.add(hwheel);
    for (let i = 0; i < 2; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.025, 0.025), darkSteel);
      spoke.rotation.z = (i / 2) * Math.PI;
      spoke.position.set(hwx, hwy, hz);
      scene.add(spoke);
    }
    const hwHub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), gearMat);
    hwHub.rotation.x = Math.PI / 2;
    hwHub.position.set(hwx, hwy, hz);
    scene.add(hwHub);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), rubber);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(hwx + 0.17, hwy + 0.17, hz + 0.05);
    scene.add(knob);

    // ---- mouth centre and pour direction in world space
    drum.updateMatrixWorld(true);
    const axis = new THREE.Vector3(0, 1, 0).transformDirection(drum.matrixWorld).normalize();
    const mouth = new THREE.Vector3(0, MOUTH_Y, 0).applyMatrix4(drum.matrixWorld);
    const down = new THREE.Vector3(-axis.y, axis.x, 0); // perpendicular to axis, pointing downward
    if (down.y > 0) down.negate();

    // ---- pour path: a real ballistic arc from the lip, and where it lands
    const vel0 = axis.clone().multiplyScalar(V0);
    const start = mouth.clone().addScaledVector(down, 0.64); // rides on top of the lip, not through it
    let px = -0.8;
    let T = 0.4;
    for (let k = 0; k < 4; k++) {
      let t = 0;
      for (; t < 1; t += 0.002) {
        const x = start.x + vel0.x * t;
        const y = start.y + vel0.y * t - 0.5 * G * t * t;
        const d2 = (x - px) ** 2;
        if (y <= FLOOR_Y + 0.62 * Math.exp(-d2 / 0.85) + 0.05) break;
      }
      px = start.x + vel0.x * t;
      T = t;
    }

    // mound height (smooth base + lumpy detail), shared by the mesh and the particles
    const lumps = (rx, z) =>
      0.03 * Math.sin(5.3 * rx + 2.1 * Math.sin(3.7 * z)) * Math.sin(4.7 * z + 1.7 * Math.sin(2.9 * rx)) +
      0.012 * Math.sin(13 * rx + 7 * z) * Math.sin(11 * z - 5 * rx);
    const groundAt = (x, z) => {
      const rx = x - px;
      const d2 = rx * rx + z * z;
      const base = 0.62 * Math.exp(-d2 / 0.85) + 0.05 * Math.exp(-d2 / 6);
      return Math.max(0, base + (0.25 + base * 1.2) * lumps(rx, z));
    };

    // ---- the pile: a lumpy wet mound whose surface ripples where the stream lands
    const MG = 90, MS = 7;
    const moundGeo = new THREE.PlaneGeometry(MS, MS, MG, MG);
    moundGeo.rotateX(-Math.PI / 2);
    const mpos = moundGeo.attributes.position;
    const bx = new Float32Array(mpos.count), bz = new Float32Array(mpos.count);
    for (let i = 0; i < mpos.count; i++) { bx[i] = mpos.getX(i); bz[i] = mpos.getZ(i); }
    const moundTex = track(concTex.clone());
    moundTex.needsUpdate = true;
    moundTex.repeat.set(5, 5);
    const alphaTex = track(radialAlpha());
    const mound = new THREE.Mesh(
      moundGeo,
      new THREE.MeshPhysicalMaterial({
        map: moundTex, bumpMap: moundTex, bumpScale: 2.2, roughness: 0.42,
        clearcoat: 0.35, clearcoatRoughness: 0.4, alphaMap: alphaTex, transparent: true,
      })
    );
    mound.position.set(px, FLOOR_Y + 0.003, 0);
    mound.receiveShadow = true;
    scene.add(mound);
    const updateMound = (tt) => {
      const arr = mpos.array;
      for (let i = 0; i < mpos.count; i++) {
        const rx = bx[i], z = bz[i];
        const d2 = rx * rx + z * z;
        const d = Math.sqrt(d2);
        const base = 0.62 * Math.exp(-d2 / 0.85) + 0.05 * Math.exp(-d2 / 6);
        let h = base + (0.25 + base * 1.2) * lumps(rx, z);
        h += 0.012 * Math.sin(16 * d - tt * 8) * Math.exp(-1.3 * d) * smooth(0.25, 0.5, d);
        arr[i * 3 + 1] = Math.max(0.002, h);
      }
      mpos.needsUpdate = true;
      moundGeo.computeVertexNormals();
    };
    updateMound(0);

    // dark wet patch and scattered stones around the pile
    const sprite = track(softSprite());
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 6),
      new THREE.MeshBasicMaterial({ map: sprite, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false })
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(px, FLOOR_Y + 0.002, 0);
    scene.add(decal);

    const STONES = 90;
    const stones = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      STONES
    );
    const sd = new THREE.Object3D();
    const sc = new THREE.Color();
    for (let i = 0; i < STONES; i++) {
      const a = Math.random() * TAU, r = 1.7 + Math.random() * 2.8;
      const s = 0.025 + Math.random() * 0.05;
      sd.position.set(px + Math.cos(a) * r * 1.3, FLOOR_Y + s * 0.4, Math.sin(a) * r * 0.9);
      sd.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sd.scale.set(s * (0.8 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.6));
      sd.updateMatrix();
      stones.setMatrixAt(i, sd.matrix);
      const g = 0.22 + Math.random() * 0.2;
      sc.setRGB(g * 1.05, g, g * 0.9);
      stones.setColorAt(i, sc);
    }
    stones.receiveShadow = true;
    scene.add(stones);

    // ---- the pour: one continuous deformable body, not balls.
    // Cross-section follows continuity (area ~ 1/speed): a wide sheet over the lip that necks down as it accelerates.
    const NS = 72, NR = 22;
    const sampN = NS + 1;
    const t0 = -0.14, t1 = T * 1.06; // starts back at the slurry surface inside the drum
    const Cx = new Float32Array(sampN), Cy = new Float32Array(sampN);
    const Nx = new Float32Array(sampN), Ny = new Float32Array(sampN), spd = new Float32Array(sampN);
    const uvs = new Float32Array(sampN * (NR + 1) * 2);
    let arc = 0;
    for (let i = 0; i < sampN; i++) {
      const t = t0 + ((t1 - t0) * i) / NS;
      Cx[i] = start.x + vel0.x * t;
      Cy[i] = start.y + vel0.y * t - 0.5 * G * t * t;
      const vx = vel0.x, vy = vel0.y - G * t;
      spd[i] = Math.hypot(vx, vy);
      Nx[i] = -vy / spd[i];
      Ny[i] = vx / spd[i];
      if (i > 0) arc += Math.hypot(Cx[i] - Cx[i - 1], Cy[i] - Cy[i - 1]);
      for (let j = 0; j <= NR; j++) {
        uvs[(i * (NR + 1) + j) * 2] = j / NR;
        uvs[(i * (NR + 1) + j) * 2 + 1] = arc / 1.4;
      }
    }
    const spos = new Float32Array(sampN * (NR + 1) * 3);
    const idx = [];
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NR; j++) {
        const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const streamGeo = new THREE.BufferGeometry();
    streamGeo.setAttribute("position", new THREE.BufferAttribute(spos, 3));
    streamGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    streamGeo.setIndex(idx);
    const stream = new THREE.Mesh(streamGeo, wetConcrete);
    stream.frustumCulled = false;
    stream.castShadow = true;
    stream.receiveShadow = true;
    scene.add(stream);

    const A0 = Math.PI * 0.48 * 0.13; // narrow enough to fit inside the lip circle
    const updateStream = (tt, flow) => {
      for (let i = 0; i < sampN; i++) {
        const s = i / NS;
        const A = A0 * flow * (1 + 0.08 * Math.sin(tt * 2.3 + s * 5)) * (V0 / spd[i]);
        const q = 1.25 + 3.75 * (1 - smooth(0.05, 0.55, s));
        let b = Math.sqrt(A / (Math.PI * q));
        let a = q * b;
        a *= 0.4 + 0.6 * smooth(0, 0.1, s); // narrower inside the drum, full width at the lip
        const flare = 1 + 1.4 * smooth(0.9, 1.0, s); // spreads into the mound
        a *= flare; b *= flare;
        const calm = smooth(0.15, 0.4, s); // smooth and steady inside the drum, lumpy once clear of the lip
        const wob = 0.03 * calm * Math.sin(s * 14 - tt * 20) * Math.sin(Math.PI * Math.min(1, s * 1.2));
        for (let j = 0; j <= NR; j++) {
          const th = (j / NR) * TAU;
          const lump =
            1 + calm * (0.06 * Math.sin(s * 22 - tt * 40 + 2 * Math.cos(th)) + 0.03 * Math.sin(s * 57 - tt * 75 + 3 * Math.sin(th * 2)));
          const along = b * lump * Math.cos(th) + wob;
          const o = (i * (NR + 1) + j) * 3;
          spos[o] = Cx[i] + Nx[i] * along;
          spos[o + 1] = Cy[i] + Ny[i] * along;
          spos[o + 2] = a * lump * Math.sin(th);
        }
      }
      streamGeo.attributes.position.needsUpdate = true;
      streamGeo.computeVertexNormals();
      // remove the shading seam where the ring closes
      const nrm = streamGeo.attributes.normal;
      for (let i = 0; i < sampN; i++) {
        const f = i * (NR + 1), l = f + NR;
        const x = nrm.getX(f) + nrm.getX(l), y = nrm.getY(f) + nrm.getY(l), z = nrm.getZ(f) + nrm.getZ(l);
        const len = Math.hypot(x, y, z) || 1;
        nrm.setXYZ(f, x / len, y / len, z / len);
        nrm.setXYZ(l, x / len, y / len, z / len);
      }
      nrm.needsUpdate = true;
    };

    // ---- crumbs (aggregate riding the pour) and splash lumps at the impact
    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
      MAX
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const P = {
      x: new Float32Array(MAX), y: new Float32Array(MAX), z: new Float32Array(MAX),
      vx: new Float32Array(MAX), vy: new Float32Array(MAX), vz: new Float32Array(MAX),
      age: new Float32Array(MAX), r: new Float32Array(MAX), kind: new Uint8Array(MAX),
      rx: new Float32Array(MAX), ry: new Float32Array(MAX), rz: new Float32Array(MAX),
      sx: new Float32Array(MAX), sy: new Float32Array(MAX), sz: new Float32Array(MAX),
      alive: new Uint8Array(MAX), settled: new Uint8Array(MAX),
    };
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < MAX; i++) {
      mesh.setColorAt(i, color.setRGB(0.3, 0.3, 0.3));
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceColor.needsUpdate = true;

    const n0 = new THREE.Vector2(-vel0.y, vel0.x).normalize();
    let cursor = 0;
    const spawn = (kind) => {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      P.kind[i] = kind;
      P.age[i] = 0;
      P.alive[i] = 1;
      P.settled[i] = 0;
      P.rx[i] = Math.random() * 3; P.ry[i] = Math.random() * 3; P.rz[i] = Math.random() * 3;
      P.sx[i] = 0.75 + Math.random() * 0.5; P.sy[i] = 0.6 + Math.random() * 0.5; P.sz[i] = 0.75 + Math.random() * 0.5;
      if (kind === 0) {
        // crumb riding the stream
        const t = Math.random() * 0.04, off = (Math.random() - 0.5) * 0.1;
        P.x[i] = start.x + vel0.x * t + n0.x * off;
        P.y[i] = start.y + vel0.y * t + n0.y * off;
        P.z[i] = (Math.random() - 0.5) * 0.4;
        const k = 0.95 + Math.random() * 0.1;
        P.vx[i] = vel0.x * k + (Math.random() - 0.5) * 0.15;
        P.vy[i] = vel0.y * k + (Math.random() - 0.5) * 0.15;
        P.vz[i] = (Math.random() - 0.5) * 0.1;
        P.r[i] = 0.035 + Math.random() * 0.05;
        const g = 0.3 + Math.random() * 0.22;
        color.setRGB(g * 1.05, g, g * 0.9);
      } else {
        // splash lump thrown up at the impact
        const ang = Math.random() * TAU, sp = 0.6 + Math.random() * 2.2;
        P.x[i] = px + Math.cos(ang) * 0.1;
        P.z[i] = Math.sin(ang) * 0.1;
        P.y[i] = FLOOR_Y + groundAt(px, 0) + 0.05;
        P.vx[i] = Math.cos(ang) * sp;
        P.vz[i] = Math.sin(ang) * sp;
        P.vy[i] = 2 + Math.random() * 4.5;
        P.r[i] = 0.012 + Math.random() * 0.03;
        const g = 0.28 + Math.random() * 0.1;
        color.setRGB(g, g * 1.01, g * 0.98);
      }
      mesh.setColorAt(i, color);
    };

    let eC = 0, eS = 0;
    const step = (dt, mul) => {
      eC += dt * CRUMB_RATE * mul;
      eS += dt * SPLASH_RATE * mul;
      let dirty = false;
      while (eC >= 1) { spawn(0); eC -= 1; dirty = true; }
      while (eS >= 1) { spawn(1); eS -= 1; dirty = true; }
      if (dirty) mesh.instanceColor.needsUpdate = true;

      const damp = Math.exp(-dt * 6);
      for (let i = 0; i < MAX; i++) {
        if (!P.alive[i]) continue;
        P.age[i] += dt;
        if (P.age[i] > LIFE) {
          P.alive[i] = 0;
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        let stretch = 1;
        if (!P.settled[i]) {
          P.vy[i] -= G * dt;
          P.x[i] += P.vx[i] * dt;
          P.y[i] += P.vy[i] * dt;
          P.z[i] += P.vz[i] * dt;
          const gy = FLOOR_Y + groundAt(P.x[i], P.z[i]) + P.r[i] * 0.3;
          if (P.y[i] < gy) {
            P.y[i] = gy;
            if (P.kind[i] === 1) {
              P.settled[i] = 1; // wet cement splats and sticks
            } else if (P.vy[i] < -1.2) {
              P.vy[i] = -P.vy[i] * 0.1;
              P.vx[i] *= 0.4;
              P.vz[i] *= 0.4;
            } else {
              P.vy[i] = 0;
              P.vx[i] *= damp;
              P.vz[i] *= damp;
              if (Math.hypot(P.vx[i], P.vz[i]) < 0.15) P.settled[i] = 1;
            }
          }
          if (P.kind[i] === 1) stretch = Math.min(2, 1 + Math.abs(P.vy[i]) * 0.12);
        }
        const s = P.r[i] * smooth(0, 0.06, P.age[i]) * (1 - smooth(LIFE - 0.7, LIFE, P.age[i]));
        dummy.position.set(P.x[i], P.y[i], P.z[i]);
        dummy.rotation.set(P.rx[i], P.ry[i], P.rz[i]);
        dummy.scale.set(s * P.sx[i], s * P.sy[i] * stretch, s * P.sz[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };

    // ---- dust hanging in the air around the pour
    const DUST = 160;
    const dustPos = new Float32Array(DUST * 3);
    const dustVel = new Float32Array(DUST);
    const resetDust = (i, fresh) => {
      dustPos[i * 3] = px + (Math.random() - 0.5) * 3.4;
      dustPos[i * 3 + 1] = fresh ? FLOOR_Y + Math.random() * 3.5 : FLOOR_Y + 0.2;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 2.6;
      dustVel[i] = 0.08 + Math.random() * 0.2;
    };
    for (let i = 0; i < DUST; i++) resetDust(i, true);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        map: sprite, color: 0xb9bdb8, size: 1.5, transparent: true, opacity: 0.07,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    scene.add(dust);

    // ---- sizing, pointer parallax
    const resize = () => {
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      const halfTan = camera.aspect * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      baseDist = Math.max(14, 5.4 / halfTan);
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);

    // pre-warm so splashes and crumbs already exist on the first frame
    updateStream(0, 1);
    for (let i = 0; i < 240; i++) step(1 / 60, 1);

    let raf;
    const t00 = performance.now();
    let last = t00;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const tt = (now - t00) / 1000;

      const lt = leavingRef.current ? Math.min(1, (now - leaveAtRef.current) / FADE_MS) : 0;
      const ease = lt * lt * (3 - 2 * lt);
      const flow = 1 + ease * 0.6;

      updateStream(tt, flow);
      updateMound(tt);
      step(dt, 1 + ease * 0.8);
      concTex.offset.y -= dt * 4 * flow; // surface of the pour streams downstream
      spinner.rotation.y += dt * (0.55 + ease * 1.0);

      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3 + 1] += dustVel[i] * dt;
        dustPos[i * 3] += Math.sin(now * 0.0004 + i) * 0.1 * dt;
        if (dustPos[i * 3 + 1] > FLOOR_Y + 4) resetDust(i, false);
      }
      dustGeo.attributes.position.needsUpdate = true;

      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      // slight handheld drift keeps the shot from feeling frozen
      const sway = now * 0.0003;
      camera.position.set(
        target.x + mouse.x * 0.8 + Math.sin(sway) * 0.07,
        1.1 - mouse.y * 0.4 + Math.cos(sway * 1.3) * 0.05,
        baseDist - ease * 3
      );
      camera.lookAt(target);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      textures.forEach((t) => t.dispose());
      envTex.dispose();
      pmrem.dispose();
      mesh.dispose();
      teeth.dispose();
      stones.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      className={"intro" + (leaving ? " is-leaving" : "")}
      role="button"
      tabIndex={0}
      aria-label="Enter StructIQ"
    >
      <div className="intro-canvas" ref={mountRef} />
      <div className="intro-vignette" />
      <div className="intro-grain" />
      <div className="intro-copy">
        <h1>StructIQ</h1>
      </div>
      <div className="intro-hint">Click or tap anywhere to begin</div>
    </div>
  );
}
