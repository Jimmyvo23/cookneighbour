"use client";
// The 3D pot on the home page (T-126). Loaded only by HeroStage, through next/dynamic, after the
// first paint and only when WebGL works, so three.js stays out of every other page's JavaScript.
// The scene is ported from the approved prototype (docs/design/t126-prototype/index.html): a
// gingham cloth in perspective, a plate, an enamel pot, a lid that comes off and goes back with a
// clink, a wooden spoon that stirs the broth, a steam plume, and a pot that turns toward the
// pointer. It runs 2 cycles and then rests. Colours are read from the CSS tokens (--hero,
// --gingham, --art-*), so light and dark mode match the page. All of it is decoration: the canvas is
// aria-hidden, and HeroStage owns the Pause button.
import { useEffect, useRef } from "react";
import {
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  STIR_END,
  STIR_END_THETA,
  STIR_START,
  clock,
  lidPose,
  mulberry32,
  spoonArcLift,
  spoonPhase,
  steamRate,
  stirPosition,
} from "./pot-timeline";

export interface PotSceneProps {
  /** The hero box: the canvas fills it. */
  hero: HTMLElement;
  /** The box the pot should sit in (the SVG picture's box, which already holds the space). */
  anchor: HTMLElement;
  paused: boolean;
  reduced: boolean;
  /** Test mode only: freeze the scene at this many seconds into the animation. */
  fixedT: number | null;
  /** Bumped by the Play button after the animation has rested, to run it again. */
  replayToken: number;
  onReady: () => void;
  onFail: () => void;
  onRest: (resting: boolean) => void;
}

/** Width of the scene (cloth items the eye sees: pot, lid and spoon) in scene units. */
const SCENE_W = 6.6;
const SCENE_CENTER_X = 0.5;
const MAX_PUFFS = 90;
/** Direction from the point the camera looks at back to the camera (as in the prototype). */
const VIEW_DIR = new Vector3(0, 3.1, 15).normalize();

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Turns "rgb(255 255 255 / 10%)" or "rgba(...)" into a string every canvas understands. */
function canvasColour(css: string, fallback: string): string {
  const m = css.match(
    /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)/,
  );
  if (!m) return css.startsWith("#") ? css : fallback;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[5] === "%") a /= 100;
  return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
}

export default function PotScene(props: PotSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });
  const replayRef = useRef<(() => void) | null>(null);
  const kickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    replayRef.current?.();
  }, [props.replayToken]);
  // Play pressed after a pause: start drawing again.
  useEffect(() => {
    kickRef.current?.();
  }, [props.paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { hero, anchor, fixedT } = live.current;
    const reduced = live.current.reduced;
    const rand = mulberry32(2026);
    const disposables: { dispose(): void }[] = [];
    const own = <T extends { dispose(): void }>(x: T): T => {
      disposables.push(x);
      return x;
    };

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true });
    } catch {
      live.current.onFail();
      return;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 0.9;

    const heroColour = cssVar(hero, "--hero", "#9e1f2a");
    const col = {
      red: cssVar(hero, "--art-red", "#c8333b"),
      redDark: cssVar(hero, "--art-red-dark", "#7a1620"),
      gold: cssVar(hero, "--art-gold", "#e2a829"),
      wood: cssVar(hero, "--art-wood", "#d9a066"),
      plate: cssVar(hero, "--art-plate", "#fff1cf"),
    };
    const gingham = canvasColour(
      cssVar(hero, "--gingham", "rgb(255 255 255 / 10%)"),
      "rgba(255,255,255,0.1)",
    );

    const scene = new Scene();
    scene.background = new Color(heroColour);
    scene.fog = new Fog(heroColour, 18, 34);
    const pmrem = own(new PMREMGenerator(renderer));
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    disposables.push(envTarget);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.45;
    const camera = new PerspectiveCamera(32, 1, 0.1, 100);

    const canvasTex = (
      size: number,
      draw: (g: CanvasRenderingContext2D) => void,
    ) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      if (g) draw(g);
      const t = own(new CanvasTexture(c));
      t.colorSpace = SRGBColorSpace;
      return t;
    };

    /* Gingham cloth: the same weave as the CSS hero, now a real surface in perspective. */
    const clothTex = canvasTex(256, (g) => {
      g.fillStyle = heroColour;
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = gingham;
      for (let i = 0; i < 256; i += 64) {
        g.fillRect(i, 0, 32, 256);
        g.fillRect(0, i, 256, 32);
      }
      g.fillStyle = "rgba(0,0,0,0.05)";
      for (let y = 0; y < 256; y += 2) g.fillRect(0, y, 256, 1);
    });
    clothTex.wrapS = clothTex.wrapT = RepeatWrapping;
    clothTex.repeat.set(14, 14);
    clothTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const clothGeo = own(new PlaneGeometry(44, 44, 110, 110));
    {
      const p = clothGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        p.setZ(
          i,
          0.05 * Math.sin(x * 0.9 + y * 0.35) +
            0.035 * Math.sin(y * 1.7 - x * 0.4) +
            0.12 *
              Math.exp(-((x + 6) ** 2 + (y - 2) ** 2) / 6) *
              Math.sin(x * 2.2),
        );
      }
      clothGeo.computeVertexNormals();
    }
    const cloth = new Mesh(
      clothGeo,
      own(new MeshStandardMaterial({ map: clothTex, roughness: 0.92 })),
    );
    cloth.rotation.x = -Math.PI / 2;
    cloth.receiveShadow = true;
    scene.add(cloth);

    /* Plate */
    const table = new Group();
    scene.add(table);
    const plate = new Mesh(
      own(new CylinderGeometry(2.45, 2.2, 0.16, 72)),
      own(
        new MeshPhysicalMaterial({
          color: col.plate,
          roughness: 0.35,
          clearcoat: 0.6,
        }),
      ),
    );
    plate.position.y = 0.08;
    plate.castShadow = plate.receiveShadow = true;
    table.add(plate);
    const goldMat = own(
      new MeshStandardMaterial({
        color: col.gold,
        metalness: 0.9,
        roughness: 0.25,
      }),
    );
    const plateRim = new Mesh(
      own(new TorusGeometry(2.37, 0.05, 12, 96)),
      goldMat,
    );
    plateRim.rotation.x = Math.PI / 2;
    plateRim.position.y = 0.165;
    table.add(plateRim);

    /* Enamel pot */
    const enamel = own(
      new MeshPhysicalMaterial({
        color: col.red,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        side: DoubleSide,
      }),
    );
    const darkEnamel = own(
      new MeshPhysicalMaterial({
        color: col.redDark,
        roughness: 0.4,
        clearcoat: 0.6,
      }),
    );
    const pot = new Group();
    pot.position.y = 0.16;
    table.add(pot);
    const bodyProfile = [
      [0, 0],
      [1.25, 0],
      [1.55, 0.12],
      [1.72, 0.45],
      [1.78, 0.95],
      [1.76, 1.45],
      [1.7, 1.62],
      [1.64, 1.66],
    ].map(([r, y]) => new Vector2(r, y));
    const body = new Mesh(own(new LatheGeometry(bodyProfile, 72)), enamel);
    body.castShadow = body.receiveShadow = true;
    pot.add(body);
    const brothTex = canvasTex(512, (g) => {
      const base = g.createRadialGradient(256, 256, 20, 256, 256, 256);
      base.addColorStop(0, "#d9862f");
      base.addColorStop(1, "#8f4615");
      g.fillStyle = base;
      g.fillRect(0, 0, 512, 512);
      g.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = `rgba(255,214,140,${0.35 - i * 0.04})`;
        g.lineWidth = 7 - i;
        g.beginPath();
        for (let a = 0; a < Math.PI * 3.2; a += 0.05) {
          const r = 30 + a * 22 + i * 9;
          g.lineTo(
            256 + Math.cos(a + i * 1.3) * r,
            256 + Math.sin(a + i * 1.3) * r,
          );
        }
        g.stroke();
      }
      for (let i = 0; i < 70; i++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * 220;
        g.fillStyle = i % 3 ? "#5f9c3c" : "#9fcb6a";
        g.save();
        g.translate(256 + Math.cos(a) * r, 256 + Math.sin(a) * r);
        g.rotate(rand() * 3);
        g.fillRect(-6, -3, 12, 6);
        g.restore();
      }
    });
    const broth = new Mesh(
      own(new CircleGeometry(1.66, 64)),
      own(
        new MeshPhysicalMaterial({
          map: brothTex,
          roughness: 0.15,
          clearcoat: 0.8,
        }),
      ),
    );
    broth.rotation.x = -Math.PI / 2;
    broth.position.y = 1.32;
    pot.add(broth);
    const band = new Mesh(own(new TorusGeometry(1.7, 0.07, 16, 96)), goldMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.62;
    pot.add(band);
    const handleGeo = own(new TorusGeometry(0.3, 0.085, 16, 40, Math.PI));
    for (const s of [-1, 1]) {
      const h = new Mesh(handleGeo, darkEnamel);
      h.position.set(s * 1.82, 1.25, 0);
      h.rotation.set(
        0,
        s > 0 ? -Math.PI / 2 : Math.PI / 2,
        ((s * Math.PI) / 2) * -1,
      );
      h.castShadow = true;
      pot.add(h);
    }

    /* Lid: comes off, leans behind the pot, goes back on */
    const lid = new Group();
    lid.position.set(0, 1.66, 0);
    pot.add(lid);
    const lidProfile = [
      [0, 0.48],
      [0.5, 0.46],
      [1.05, 0.36],
      [1.5, 0.16],
      [1.74, 0.03],
      [1.76, 0],
    ].map(([r, y]) => new Vector2(r, y));
    const lidMesh = new Mesh(own(new LatheGeometry(lidProfile, 72)), enamel);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    const knob = new Mesh(own(new SphereGeometry(0.2, 24, 16)), goldMat);
    knob.position.y = 0.62;
    knob.castShadow = true;
    lid.add(knob);
    const knobStem = new Mesh(
      own(new CylinderGeometry(0.08, 0.1, 0.16, 16)),
      goldMat,
    );
    knobStem.position.y = 0.5;
    lid.add(knobStem);

    /* Wooden spoon: origin is the centre of the bowl, the handle points up */
    const woodMat = own(
      new MeshStandardMaterial({ color: col.wood, roughness: 0.7 }),
    );
    const spoon = new Group();
    const handle = new Mesh(
      own(new CapsuleGeometry(0.075, 3.4, 6, 16)),
      woodMat,
    );
    handle.position.y = 2.05;
    handle.castShadow = true;
    spoon.add(handle);
    const bowl = new Mesh(own(new SphereGeometry(0.42, 24, 16)), woodMat);
    bowl.scale.set(0.85, 1.25, 0.28);
    bowl.castShadow = true;
    spoon.add(bowl);
    pot.add(spoon);
    const restPos = new Vector3(-0.6, -0.04, 3.1);
    const restQuat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(1, 0.02, 0.45).normalize(),
    );
    const stirQuat = new Quaternion().setFromEuler(new Euler(0.18, 0, -0.32));
    const stirVec = (theta: number) => new Vector3(...stirPosition(theta));

    /* Steam: soft sprites that rise, swell and fade */
    const puffTex = canvasTex(128, (g) => {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(255,250,240,0.9)");
      grd.addColorStop(0.4, "rgba(255,248,236,0.35)");
      grd.addColorStop(1, "rgba(255,248,236,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    });
    interface Puff {
      life: number;
      max: number;
      vx: number;
      vy: number;
      size: number;
      peak: number;
    }
    const puffs: { sprite: Sprite; p: Puff }[] = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
      const sprite = new Sprite(
        own(
          new SpriteMaterial({
            map: puffTex,
            transparent: true,
            depthWrite: false,
            opacity: 0,
          }),
        ),
      );
      sprite.visible = false;
      pot.add(sprite);
      puffs.push({
        sprite,
        p: { life: -1, max: 0, vx: 0, vy: 0, size: 0, peak: 0 },
      });
    }
    const emit = (strength: number) => {
      const slot = puffs.find((x) => x.p.life < 0);
      if (!slot) return;
      const a = rand() * Math.PI * 2;
      const r = rand() * 1.3;
      slot.sprite.position.set(
        Math.cos(a) * r,
        1.4 + rand() * 0.3,
        Math.sin(a) * r,
      );
      slot.sprite.visible = true;
      slot.p = {
        life: 0,
        max: 2.4 + rand() * 1.8,
        vx: (rand() - 0.4) * 0.3,
        vy: 1.0 + rand() * 0.8 * strength,
        size: 0.5 + rand() * 0.6,
        peak: 0.2 * strength,
      };
    };
    const updatePuffs = (dt: number) => {
      for (const { sprite, p } of puffs) {
        if (p.life < 0) continue;
        p.life += dt;
        const k = p.life / p.max;
        if (k >= 1) {
          p.life = -1;
          sprite.visible = false;
          (sprite.material as SpriteMaterial).opacity = 0;
          continue;
        }
        sprite.position.x += p.vx * dt;
        sprite.position.y += p.vy * dt * (1 - k * 0.5);
        const sz = p.size * (1 + k * 3.4);
        sprite.scale.set(sz, sz, 1);
        (sprite.material as SpriteMaterial).opacity =
          p.peak * Math.sin(Math.PI * Math.min(1, k * 1.15));
      }
    };

    /* Light: a warm kitchen window from the upper left */
    scene.add(new HemisphereLight(0xfff1dd, 0x5a1a1a, 0.35));
    const key = new DirectionalLight(0xffe2bd, 1.9);
    key.position.set(-7, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, {
      left: -8,
      right: 8,
      top: 8,
      bottom: -8,
      near: 1,
      far: 30,
    });
    scene.add(key);
    const rimLight = new DirectionalLight(0xffc98a, 0.9);
    rimLight.position.set(6, 5, -7);
    scene.add(rimLight);
    disposables.push({ dispose: () => key.shadow.map?.dispose() });

    /* Layout: the pot sits in the anchor box (the SVG picture's box), so nothing moves when the
       canvas swaps in and nothing is clipped on a phone. */
    const lookAt = new Vector3(SCENE_CENTER_X, 2.1, 0);
    const layout = () => {
      const w = hero.clientWidth;
      const h = hero.clientHeight;
      if (!w || !h) return;
      const narrow = w < 700;
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, narrow ? 1.5 : 2),
      );
      renderer.setSize(w, h, false);
      const hr = hero.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      const cx = ar.left - hr.left + ar.width / 2;
      const cy = ar.top - hr.top + ar.height / 2 + (narrow ? 20 : 0);
      const pxPerUnit = (ar.width * (narrow ? 1.15 : 1.18)) / SCENE_W;
      // A fixed lens; the camera backs away or comes closer until the pot is the right size.
      camera.fov = narrow ? 34 : 30;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.min(70, Math.max(10, h / (2 * pxPerUnit * tanHalf)));
      camera.position.copy(lookAt).addScaledVector(VIEW_DIR, dist);
      if (scene.fog instanceof Fog) {
        scene.fog.near = dist + 2.6;
        scene.fog.far = dist + 18.6;
      }
      camera.aspect = w / h;
      camera.lookAt(lookAt);
      camera.setViewOffset(w, h, -(cx - w / 2), -(cy - h / 2), w, h);
      camera.updateProjectionMatrix();
    };

    /* State */
    const pointer = { x: 0, y: 0 };
    const spin = { y: 0, x: 0 };
    let elapsed = 0;
    let steamDebt = 0;
    let lastCycle = -1;
    let visible = true;
    let raf = 0;
    let last = 0;
    let resting = false;
    let disposed = false;
    const testMode = process.env.NODE_ENV !== "production";

    const advance = (dt: number) => {
      elapsed += dt;
      const c = clock(elapsed, reduced);
      const lid3 = lidPose(c.active ? c.cycleT : 0);
      lid.position.set(lid3.x, lid3.y, 0);
      lid.rotation.z = lid3.rotZ;
      const sp = spoonPhase(c.active ? c.cycleT : 0);
      if (sp.phase === "rest") {
        spoon.position.copy(restPos);
        spoon.quaternion.copy(restQuat);
      } else if (sp.phase === "in") {
        spoon.position.lerpVectors(restPos, stirVec(0), sp.k);
        spoon.position.y += spoonArcLift(sp.k);
        spoon.quaternion.slerpQuaternions(restQuat, stirQuat, sp.k);
      } else if (sp.phase === "stir") {
        spoon.position.copy(stirVec(sp.theta));
        spoon.quaternion.copy(stirQuat);
        broth.rotation.z = -sp.theta * 0.35;
      } else {
        spoon.position.lerpVectors(stirVec(STIR_END_THETA), restPos, sp.k);
        spoon.position.y += spoonArcLift(sp.k);
        spoon.quaternion.slerpQuaternions(stirQuat, restQuat, sp.k);
      }
      if (c.active && c.cycle !== lastCycle && c.cycleT > 1.0) {
        lastCycle = c.cycle;
        for (let i = 0; i < 8; i++) emit(1);
      }
      const rate = steamRate(c.cycleT, c.active);
      steamDebt += rate * dt;
      const stirring = c.cycleT > STIR_START && c.cycleT < STIR_END;
      while (steamDebt >= 1) {
        emit(stirring ? 1.15 : 0.8);
        steamDebt -= 1;
      }
      updatePuffs(dt);
      const ty = reduced
        ? 0
        : pointer.x * 0.55 + (c.active ? Math.sin(elapsed * 0.6) * 0.06 : 0);
      const tx = reduced ? 0 : pointer.y * 0.08;
      const before = Math.abs(ty - spin.y) + Math.abs(tx - spin.x);
      spin.y += (ty - spin.y) * Math.min(1, dt * 3);
      spin.x += (tx - spin.x) * Math.min(1, dt * 3);
      pot.rotation.y = spin.y - 0.35;
      pot.rotation.x = spin.x;
      const puffing = puffs.some((x) => x.p.life >= 0);
      // keep drawing while anything moves
      return c.active || puffing || before > 0.001;
    };
    // Test mode only: the on-screen boxes (px, relative to the hero) of the plate, lid and spoon,
    // so an e2e test can prove nothing is clipped and the spoon stays off the buttons.
    const corner = new Vector3();
    const screenBox = (obj: Group | Mesh) => {
      obj.updateWorldMatrix(true, true);
      const w = hero.clientWidth;
      const h = hero.clientHeight;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      obj.traverse((o) => {
        const m = o as Mesh;
        const pos = m.geometry?.attributes?.position;
        if (!pos || (o as Sprite).isSprite) return;
        for (let i = 0; i < pos.count; i++) {
          corner
            .fromBufferAttribute(pos, i)
            .applyMatrix4(m.matrixWorld)
            .project(camera);
          const px = (corner.x * 0.5 + 0.5) * w;
          const py = (0.5 - corner.y * 0.5) * h;
          x0 = Math.min(x0, px);
          y0 = Math.min(y0, py);
          x1 = Math.max(x1, px);
          y1 = Math.max(y1, py);
        }
      });
      return [x0, y0, x1, y1].map((n) => Math.round(n)).join(",");
    };
    const draw = () => {
      renderer.render(scene, camera);
      if (testMode) {
        canvas.dataset.t = elapsed.toFixed(2);
        canvas.dataset.plateBox = screenBox(plate);
        canvas.dataset.lidBox = screenBox(lid);
        canvas.dataset.spoonBox = screenBox(spoon);
      }
    };
    // Test mode: jump to a moment, with the steam built up as if it had been running.
    const seek = (to: number) => {
      for (const { sprite, p } of puffs) {
        p.life = -1;
        sprite.visible = false;
      }
      steamDebt = 0;
      lastCycle = -1;
      const lead = Math.max(0, to - 4);
      elapsed = lead;
      for (let t = lead; t < to; t += 1 / 30) advance(Math.min(1 / 30, to - t));
      draw();
    };
    const setResting = (r: boolean) => {
      if (r !== resting) {
        resting = r;
        live.current.onRest(r);
      }
    };

    const canRun = () =>
      !live.current.paused && visible && !document.hidden && fixedT === null;
    const tick = (now: number) => {
      raf = 0;
      if (disposed || !canRun()) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const more = advance(dt);
      draw();
      setResting(!clock(elapsed, reduced).active);
      if (more) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (raf || disposed || !canRun()) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    kickRef.current = kick;
    replayRef.current = () => {
      if (!resting) return;
      elapsed = 0;
      lastCycle = -1;
      setResting(false);
      kick();
    };

    layout();
    if (fixedT !== null) seek(fixedT);
    else {
      advance(0);
      draw();
    }
    live.current.onReady();
    if (fixedT === null && !reduced) kick();
    else if (fixedT === null) setResting(true);

    const onPointer = (e: PointerEvent) => {
      if (reduced || fixedT !== null) return;
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
      kick();
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) kick();
    });
    io.observe(hero);
    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(hero);
    ro.observe(anchor);
    const onVisibility = () => {
      if (!document.hidden) kick();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      live.current.onFail();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onLost);
    const onSeek = (e: Event) => seek((e as CustomEvent<number>).detail);
    if (testMode && fixedT !== null)
      canvas.addEventListener("pot:seek", onSeek);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pot:seek", onSeek);
      replayRef.current = null;
      kickRef.current = null;
      scene.traverse((o) => {
        const m = o as Mesh;
        const g = m.geometry as BufferGeometry | undefined;
        const mat = m.material as Material | Material[] | undefined;
        g?.dispose();
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      roomEnv.traverse((o) => {
        const m = o as Mesh;
        (m.geometry as BufferGeometry | undefined)?.dispose();
        const mat = m.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      // Free the GPU context only when the canvas has really left the page. React's development
      // StrictMode runs this cleanup and then mounts again on the same canvas, which still needs
      // its context.
      window.setTimeout(() => {
        if (!canvas.isConnected) renderer.forceContextLoss();
      }, 0);
    };
    // The scene is built once per mount; live values come through `live`.
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pot-canvas"
      data-testid="pot-canvas"
    />
  );
}
