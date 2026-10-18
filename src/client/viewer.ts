import {
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Euler,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bootCenter, PARTS, type Part } from "./binding";
import { contentBox } from "./box";
import {
  baseHeight,
  GAP,
  halfWidth,
  LARGEST,
  stations,
  thickness,
  type Ski,
} from "./ski";
import type { Topsheets } from "./topsheet";

const MM = 0.001;

// Radians a drag turns the pair per canvas height.
const TURN = 4;
// How long a flick keeps spinning, and how slowly it turns when idle.
const COAST_MS = 300;
const AUTO_TURN = 0.095 / 1000;
// The pair at rest: tipped back and turned a little so it reads as 3D.
const TILT = new Quaternion().setFromEuler(new Euler(-0.16, 0, 0.05));

// One ski as a closed solid: topsheet, base and sidewalls each get their own
// vertices so the edges stay crisp. The topsheet UVs are absolute across
// the widest point, so the outline cuts the texture instead of stretching it.
function skiGeometry(ski: Ski) {
  const along = stations(ski, 300);
  const across = 24;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const geometry = new BufferGeometry();

  const surface = (top: boolean) => {
    const start = positions.length / 3;
    for (const s of along) {
      const h = halfWidth(ski, s);
      const z = baseHeight(ski, s) + (top ? thickness(ski, s) : 0);
      for (let j = 0; j < across; j++) {
        const t = (2 * j) / (across - 1) - 1;
        positions.push(t * h * MM, (ski.length / 2 - s) * MM, z * MM);
        uvs.push(
          top ? 0.5 + (t * h) / ski.span : 0.5 - t / 2,
          1 - s / ski.length,
        );
      }
    }
    for (let i = 0; i < along.length - 1; i++) {
      for (let j = 0; j < across - 1; j++) {
        const a = start + i * across + j;
        const [b, c, d] = [a + 1, a + across, a + across + 1];
        if (top) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
    return start;
  };

  const side = (sign: 1 | -1) => {
    const start = positions.length / 3;
    for (const s of along) {
      const x = sign * halfWidth(ski, s) * MM;
      const y = (ski.length / 2 - s) * MM;
      const z = baseHeight(ski, s);
      positions.push(x, y, (z + thickness(ski, s)) * MM, x, y, z * MM);
      uvs.push(0, 1 - s / ski.length, 1, 1 - s / ski.length);
    }
    for (let i = 0; i < along.length - 1; i++) {
      const [a, b, c, d] = [0, 1, 2, 3].map((k) => start + 2 * i + k);
      if (sign > 0) indices.push(a, c, b, c, d, b);
      else indices.push(a, b, c, c, b, d);
    }
  };

  // Closes an end that doesn't taper to a point, like a flat tail.
  const end = (s: number, facing: 1 | -1) => {
    const h = halfWidth(ski, s);
    if (h <= 0) return;
    const start = positions.length / 3;
    const y = (ski.length / 2 - s) * MM;
    const z = baseHeight(ski, s);
    for (let j = 0; j < across; j++) {
      const x = ((2 * j) / (across - 1) - 1) * h * MM;
      positions.push(x, y, (z + thickness(ski, s)) * MM, x, y, z * MM);
      uvs.push(0, 1 - s / ski.length, 1, 1 - s / ski.length);
    }
    for (let j = 0; j < across - 1; j++) {
      const [a, b, c, d] = [0, 1, 2, 3].map((k) => start + 2 * j + k);
      if (facing > 0) indices.push(a, c, b, c, d, b);
      else indices.push(a, b, c, c, b, d);
    }
  };

  const group = (from: number) => indices.length - from;

  let mark = 0;
  surface(true);
  geometry.addGroup(mark, group(mark), 0);
  mark = indices.length;
  surface(false);
  geometry.addGroup(mark, group(mark), 1);
  mark = indices.length;
  side(1);
  side(-1);
  end(along[0], 1);
  end(along.at(-1)!, -1);
  geometry.addGroup(mark, group(mark), 2);

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const BINDING_MATERIALS: Record<Part["kind"], MeshStandardMaterial> = {
  brake: new MeshStandardMaterial({
    color: "#3a3a3d",
    metalness: 0.5,
    roughness: 0.4,
  }),
  housing: new MeshStandardMaterial({ color: "#1d1b1c", roughness: 0.45 }),
  metal: new MeshStandardMaterial({
    color: "#6f7276",
    metalness: 0.6,
    roughness: 0.45,
  }),
  plate: new MeshStandardMaterial({ color: "#2c2a2b", roughness: 0.6 }),
};

// A binding on one ski, built from boxes in the ski's own coordinates.
function binding(ski: Ski) {
  const group = new Group();
  const center = bootCenter(ski);
  for (const part of PARTS) {
    const length = part.along[1] - part.along[0];
    const height = part.up[1] - part.up[0];
    const s = center + (part.along[0] + part.along[1]) / 2;
    const top = baseHeight(ski, s) + thickness(ski, s);
    const radius = Math.min(4, part.across / 4, length / 4, height / 2) * MM;
    const mesh = new Mesh(
      new RoundedBoxGeometry(
        part.across * MM,
        length * MM,
        height * MM,
        3,
        radius,
      ),
      BINDING_MATERIALS[part.kind],
    );
    mesh.position.set(
      0,
      (ski.length / 2 - s) * MM,
      (top + (part.up[0] + part.up[1]) / 2) * MM,
    );
    mesh.rotation.x = part.tilt ?? 0;
    group.add(mesh);
  }
  return group;
}

// Graphite base with steel edges.
function baseTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#161415";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#9a9a9e";
  ctx.fillRect(0, 0, 3, canvas.height);
  ctx.fillRect(canvas.width - 3, 0, 3, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface ViewerOptions {
  autoRotate?: boolean;
}

export class SkiViewer {
  readonly canvas: HTMLCanvasElement;
  onDraw?: () => void;
  private camera = new PerspectiveCamera(26, 1, 0.01, 50);
  private controls: OrbitControls;
  private dirty = true;
  private frame = 0;
  private home = new Vector3();
  private materials: MeshPhysicalMaterial[] = [];
  private pair = new Group();
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private ski?: Ski;
  private idle?: number;
  private zoomed = false;
  private readonly autoRotate: boolean;
  private idling = false;
  private drag?: { id: number; x: number; y: number; time: number };
  private pointers = new Set<number>();
  private raycaster = new Raycaster();
  // Angular velocity in radians per ms, around the screen's up and right.
  private spin = new Vector2();
  private last = 0;
  private visible = true;
  private bindings = false;

  private base = new MeshStandardMaterial({
    map: baseTexture(),
    metalness: 0.2,
    roughness: 0.38,
  });

  private sidewall = new MeshStandardMaterial({
    color: "#2a2426",
    roughness: 0.55,
  });

  constructor(
    private container: HTMLElement,
    options: ViewerOptions = {},
  ) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    // Drawn over the rest of the stage; the container takes the gestures.
    this.canvas.className =
      "pointer-events-none absolute inset-0 z-10 size-full outline-none";
    container.append(this.canvas);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    this.scene.environmentIntensity = 0.9;
    pmrem.dispose();

    const key = new DirectionalLight("#fff", 1.4);
    key.position.set(2, 3, 4);
    this.scene.add(key);

    this.pair.quaternion.copy(TILT);
    this.scene.add(this.pair);

    // Orbit controls only zoom. Dragging turns the pair itself, so it never
    // hits a pole and always follows the pointer, however far it goes round.
    this.controls = new OrbitControls(this.camera, container);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 7;
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.controls.addEventListener("start", () => {
      this.zoomed = true;
      this.pause();
    });
    this.controls.addEventListener("end", () => this.resume());

    this.autoRotate = this.idling = options.autoRotate ?? false;
    container.addEventListener("pointerdown", (event) => this.grab(event));
    container.addEventListener("pointermove", (event) => this.turn(event));
    container.addEventListener("pointerup", (event) => this.release(event));
    container.addEventListener("pointercancel", (event) => this.release(event));

    new ResizeObserver(() => this.resize()).observe(container);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.start();
    }).observe(container);
    document.addEventListener("visibilitychange", () => this.start());
    this.resize();
    this.start();
  }

  setSki(ski: Ski) {
    if (this.ski?.id === ski.id) return;
    this.ski = ski;
    for (const child of [...this.pair.children]) {
      child.traverse((node) => {
        if (node instanceof Mesh) node.geometry.dispose();
      });
      this.pair.remove(child);
    }
    const geometry = skiGeometry(ski);
    [-1, 1].forEach((side, i) => {
      // A glossy topsheet: a smooth base under a clear coat, so the room
      // shows as crisp highlights rather than a grey haze over dark art.
      this.materials[i] ??= new MeshPhysicalMaterial({
        clearcoat: 0.6,
        clearcoatRoughness: 0.08,
        color: "#fff",
        envMapIntensity: 0.75,
        roughness: 0.6,
        specularIntensity: 0.35,
      });
      const mesh = new Mesh(geometry, [
        this.materials[i],
        this.base,
        this.sidewall,
      ]);
      mesh.position.x = ((side * (ski.span + GAP)) / 2) * MM;
      const mount = binding(ski);
      mount.visible = this.bindings;
      mount.name = "binding";
      mesh.add(mount);
      this.pair.add(mesh);
    });
    // Turned and zoomed as it was. Every length is framed alike, so this
    // only frames the first pair.
    this.fit();
    this.dirty = true;
  }

  setBindings(on: boolean) {
    this.bindings = on;
    for (const ski of this.pair.children) {
      const mount = ski.getObjectByName("binding");
      if (mount) mount.visible = on;
    }
    this.dirty = true;
  }

  setTopsheets(sheets: Topsheets) {
    sheets.forEach((sheet, i) => {
      const material = this.materials[i];
      material.map?.dispose();
      const texture = new CanvasTexture(sheet);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      material.map = texture;
      material.needsUpdate = true;
    });
    this.dirty = true;
  }

  // Whether the pair is drawn at a point on the page.
  covers(x: number, y: number) {
    const box = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new Vector2(
        ((x - box.left) / box.width) * 2 - 1,
        1 - ((y - box.top) / box.height) * 2,
      ),
      this.camera,
    );
    return this.raycaster.intersectObject(this.pair).some(({ object }) => {
      for (let o: Object3D | null = object; o; o = o.parent) {
        if (!o.visible) return false;
      }
      return true;
    });
  }

  reset() {
    this.zoomed = false;
    this.pair.quaternion.copy(TILT);
    this.spin.set(0, 0);
    this.fit();
    this.dirty = true;
  }

  private pause() {
    this.idling = false;
    clearTimeout(this.idle);
  }

  private resume() {
    if (!this.autoRotate) return;
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => (this.idling = true), 6000);
  }

  // Turns the pair about the screen's axes, so the side under the pointer
  // moves the way it's dragged.
  private rotate(right: number, down: number) {
    const axis = new Vector3(down, right, 0);
    const angle = axis.length();
    if (!angle) return;
    axis.divideScalar(angle).applyQuaternion(this.camera.quaternion);
    this.pair.quaternion
      .premultiply(new Quaternion().setFromAxisAngle(axis, angle))
      .normalize();
    this.dirty = true;
  }

  private grab(event: PointerEvent) {
    this.pointers.add(event.pointerId);
    // A second finger is a pinch, which the orbit controls handle.
    if (this.pointers.size > 1) {
      this.drag = undefined;
      this.spin.set(0, 0);
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.container.setPointerCapture(event.pointerId);
    this.drag = {
      id: event.pointerId,
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    };
    this.spin.set(0, 0);
    this.pause();
  }

  private turn(event: PointerEvent) {
    const drag = this.drag;
    if (drag?.id !== event.pointerId) return;
    const scale = TURN / (this.container.clientHeight || 1);
    const right = (event.clientX - drag.x) * scale;
    const down = (event.clientY - drag.y) * scale;
    this.rotate(right, down);
    // Smooth the velocity, so a flick coasts at the speed it was going.
    const dt = Math.max(event.timeStamp - drag.time, 1);
    this.spin.lerp(new Vector2(right / dt, down / dt), 0.6);
    Object.assign(drag, {
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    });
  }

  private release(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    if (this.drag?.id !== event.pointerId) return;
    // Held still before letting go, so it stays put.
    if (event.timeStamp - this.drag.time > 80) this.spin.set(0, 0);
    this.drag = undefined;
    this.resume();
  }

  // Coasts after a flick, or turns slowly when left alone.
  private step(dt: number) {
    if (this.drag) return;
    if (this.spin.lengthSq() > 1e-10) {
      this.rotate(this.spin.x * dt, this.spin.y * dt);
      this.spin.multiplyScalar(Math.exp(-dt / COAST_MS));
    } else if (this.idling) {
      this.rotate(AUTO_TURN * dt, 0);
    }
  }

  // Fits the biggest pair to the room inside the container's padding, which
  // keeps clear of what's over it, turned a little so it reads as 3D. Every
  // length is framed the same, so each shows its real size.
  private fit() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!this.ski || !width || !height) return;
    const room = contentBox(this.container);
    // How tall and wide the whole view must be for the pair to fill the room.
    const tall = (LARGEST.length * MM * 1.05 * height) / room.height;
    const wide = (LARGEST.width * MM * 2.2 * width) / room.width;
    const fov = MathUtils.degToRad(this.camera.fov / 2);
    const distance = Math.max(
      tall / 2 / Math.tan(fov),
      wide / 2 / Math.tan(fov) / this.camera.aspect,
    );
    // Centered on the room rather than the whole view.
    this.camera.setViewOffset(
      width,
      height,
      (width - room.width) / 2 - room.left,
      (height - room.height) / 2 - room.top,
      width,
      height,
    );
    this.home.set(0.42, 0, 0.9).normalize().multiplyScalar(distance);
    if (!this.zoomed) {
      this.camera.position.copy(this.home);
      this.controls.update();
    }
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.fit();
    // Resizing clears the canvas. Redraw now, before the browser paints,
    // rather than on the next frame, so it never shows blank.
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
    this.onDraw?.();
  }

  private start() {
    if (this.frame || !this.visible || document.hidden) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.frame = 0;
      if (!this.visible || document.hidden) return;
      // Capped, so coming back to the tab doesn't jump.
      this.step(Math.min(now - this.last, 50));
      this.last = now;
      if (this.controls.update() || this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
        this.onDraw?.();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
