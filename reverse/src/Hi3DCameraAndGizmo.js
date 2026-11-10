import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

/**
 * Perspective / Orthographic camera & zoom percent controller reverse-engineered
 * from Hi3D (R9nHKQeM20npTpqR.js).
 */
export class Hi3DCameraController {
  constructor(options) {
    this.minDistance = options.minDistance ?? 0.4;
    this.maxDistance = options.maxDistance ?? 10.0;
    this.perspectiveFov = options.perspectiveFov ?? 45.0;
    this.frustumBaseDistance = options.frustumBaseDistance ?? 1.7;
    this.isApplyingZoomFromModel = false;
    this.controlsChangeHandler = null;

    this.getCamera = options.getCamera;
    this.getControls = options.getControls;
    this.setCamera = options.setCamera;
    this.onZoomPercent = options.onZoomPercent;
    this.onAfterPerspectiveSwitch = options.onAfterPerspectiveSwitch;
  }

  percentFromDistance(dist) {
    const clamped = Math.min(this.maxDistance, Math.max(this.minDistance, dist));
    return Math.round(
      ((this.maxDistance - clamped) / (this.maxDistance - this.minDistance)) * 100
    );
  }

  distanceFromPercent(pct) {
    const clamped = Math.min(100, Math.max(0, pct));
    return this.maxDistance - (clamped / 100) * (this.maxDistance - this.minDistance);
  }

  getCameraDistance() {
    const cam = this.getCamera();
    const controls = this.getControls();
    if (!controls || !cam) return this.frustumBaseDistance;
    if (cam instanceof THREE.OrthographicCamera) {
      return this.frustumBaseDistance / Math.max(cam.zoom, 1e-6);
    }
    return cam.position.distanceTo(controls.target);
  }

  emitZoomPercentFromCamera() {
    const cam = this.getCamera();
    const controls = this.getControls();
    if (!controls || !cam || !this.onZoomPercent) return;
    this.onZoomPercent(this.percentFromDistance(this.getCameraDistance()));
  }

  applyZoomPercent(pct) {
    const cam = this.getCamera();
    const controls = this.getControls();
    if (!controls || !cam) return;
    const dist = this.distanceFromPercent(pct);

    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = this.frustumBaseDistance / Math.max(dist, 1e-6);
      cam.updateProjectionMatrix();
      controls.update();
      return;
    }

    const dir = cam.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.normalize();
    cam.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  applyZoomPercentFromModel(pct, nextTick = (cb) => requestAnimationFrame(cb)) {
    this.isApplyingZoomFromModel = true;
    this.applyZoomPercent(pct);
    nextTick(() => {
      this.isApplyingZoomFromModel = false;
    });
  }

  updateOrthographicFrustum(cam, width, height, distance) {
    const aspect = width / Math.max(height, 1);
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.perspectiveFov / 2)) * distance;
    const halfW = halfH * aspect;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
  }

  createInitialCamera(width, height, { perspective = true, near = 0.01, far = 20, distance = 1.7 }) {
    this.frustumBaseDistance = distance;
    let cam;
    if (perspective) {
      cam = new THREE.PerspectiveCamera(
        this.perspectiveFov,
        width / Math.max(height, 1),
        near,
        far
      );
    } else {
      cam = new THREE.OrthographicCamera(-1, 1, 1, -1, near, far);
      cam.zoom = 1;
      this.updateOrthographicFrustum(cam, width, height, distance);
    }
    cam.position.set(0, 0, distance);
    return cam;
  }

  applyControlsZoomLimits(controls) {
    controls.minDistance = this.minDistance;
    controls.maxDistance = this.maxDistance;
    if (this.getCamera() instanceof THREE.OrthographicCamera) {
      controls.minZoom = this.frustumBaseDistance / this.maxDistance;
      controls.maxZoom = this.frustumBaseDistance / this.minDistance;
    }
  }

  resizeOrthographicIfNeeded(width, height) {
    const cam = this.getCamera();
    if (cam instanceof THREE.OrthographicCamera) {
      this.updateOrthographicFrustum(cam, width, height, this.frustumBaseDistance);
    }
  }

  applyPerspectiveMode(perspective, width, height) {
    const cam = this.getCamera();
    const controls = this.getControls();
    if (!cam || !controls) return;
    const isPersp = cam instanceof THREE.PerspectiveCamera;
    if (Boolean(perspective) === isPersp) return;

    const target = controls.target.clone();
    const pos = cam.position.clone();
    const up = cam.up.clone();
    const dist = Math.max(this.getCameraDistance(), 1e-6);
    const near = cam.near;
    const far = cam.far;

    let nextCam;
    if (perspective) {
      nextCam = new THREE.PerspectiveCamera(
        this.perspectiveFov,
        width / Math.max(height, 1),
        near,
        far
      );
      const dir = pos.clone().sub(target);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      dir.normalize();
      nextCam.position.copy(target).addScaledVector(dir, dist);
    } else {
      this.frustumBaseDistance = dist;
      nextCam = new THREE.OrthographicCamera(-1, 1, 1, -1, near, far);
      nextCam.position.copy(pos);
      nextCam.zoom = 1;
      this.updateOrthographicFrustum(nextCam, width, height, dist);
      controls.minZoom = this.frustumBaseDistance / this.maxDistance;
      controls.maxZoom = this.frustumBaseDistance / this.minDistance;
    }

    nextCam.up.copy(up);
    nextCam.lookAt(target);
    this.setCamera(nextCam);
    controls.object = nextCam;
    controls.update();
    this.emitZoomPercentFromCamera();
    this.onAfterPerspectiveSwitch?.();
  }

  bindControlsZoomSync(controls) {
    this.unbindControlsZoomSync(controls);
    this.controlsChangeHandler = () => {
      if (!this.isApplyingZoomFromModel) {
        this.emitZoomPercentFromCamera();
      }
    };
    controls.addEventListener('change', this.controlsChangeHandler);
    this.emitZoomPercentFromCamera();
  }

  unbindControlsZoomSync(controls) {
    if (controls && this.controlsChangeHandler) {
      controls.removeEventListener('change', this.controlsChangeHandler);
      this.controlsChangeHandler = null;
    }
  }
}

/**
 * Interactive 3D X/Y/Z axes orientation gizmo reverse-engineered from Hi3D ($n in D32u0e9YaPcG-pPC.js).
 */
export class Hi3DAxesGizmo {
  constructor(container, mainCamera, renderer, controls) {
    this.container = container;
    this.mainCamera = mainCamera;
    this.renderer = renderer;
    this.controls = controls;

    this.raycaster = new THREE.Raycaster();
    this.viewportSize = 120;
    this.rightGap = 8;
    this.topGap = 56;
    this.interactiveObjects = [];
    this.labelSprites = [];
    this.mouseDownPos = new THREE.Vector2();
    this.visible = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 50);
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    this.axesGroup = new THREE.Group();
    this.scene.add(this.axesGroup);

    this._initAxes();
    this._addEventListeners();
  }

  setMainCamera(cam) {
    this.mainCamera = cam;
  }

  _initAxes() {
    const colors = { x: 0xdd37df, y: 0x00ff00, z: 0x307eff };

    const addLabel = (axisName, pos) => {
      const sprite = this._createLabelSprite(axisName.toUpperCase());
      sprite.position.copy(pos);
      this.axesGroup.add(sprite);
      this.labelSprites.push(sprite);
    };

    const addAxisArm = (axis, color, dir, isPositive) => {
      const tipPos = dir.clone().multiplyScalar(1);
      const mat = new THREE.MeshBasicMaterial({ color });
      const sphereGeo = new THREE.SphereGeometry(0.2, 16, 16);
      const sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.position.copy(tipPos);
      sphere.userData = { axis, direction: dir.clone() };
      this.axesGroup.add(sphere);
      this.interactiveObjects.push(sphere);

      if (isPositive) {
        const cylGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
        cylGeo.translate(0, 0.5, 0);
        if (Math.abs(dir.x) > 0.5) {
          cylGeo.rotateZ(-Math.sign(dir.x) * (Math.PI / 2));
        } else if (Math.abs(dir.z) > 0.5) {
          cylGeo.rotateX(Math.sign(dir.z) * (Math.PI / 2));
        } else if (dir.y < 0) {
          cylGeo.rotateX(Math.PI);
        }
        const cyl = new THREE.Mesh(cylGeo, mat);
        this.axesGroup.add(cyl);
        addLabel(axis, tipPos);
      }
    };

    addAxisArm('x', colors.x, new THREE.Vector3(0, 0, -1), true);
    addAxisArm('x', colors.x, new THREE.Vector3(0, 0, 1), false);
    addAxisArm('y', colors.y, new THREE.Vector3(1, 0, 0), true);
    addAxisArm('y', colors.y, new THREE.Vector3(-1, 0, 0), false);
    addAxisArm('z', colors.z, new THREE.Vector3(0, 1, 0), true);
    addAxisArm('z', colors.z, new THREE.Vector3(0, -1, 0), false);

    const centerGeo = new THREE.SphereGeometry(0.13, 16, 16);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0xc7ffbc });
    this.axesGroup.add(new THREE.Mesh(centerGeo, centerMat));
  }

  _createLabelSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = '#101010';
      ctx.font = 'bold 92px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 67);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.36, 0.36, 0.36);
    sprite.renderOrder = 2;
    return sprite;
  }

  render() {
    if (!this.visible) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    const left = w - this.viewportSize - this.rightGap;
    const bottom = h - this.viewportSize - this.topGap;
    this.renderer.setViewport(left, bottom, this.viewportSize, this.viewportSize);
    this.renderer.setScissor(left, bottom, this.viewportSize, this.viewportSize);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    this.renderer.autoClear = true;
  }

  update() {
    if (!this.visible) return;
    const dir = new THREE.Vector3();
    this.mainCamera.getWorldPosition(dir);
    dir.sub(this.controls.target).normalize();
    this.camera.position.copy(dir.multiplyScalar(4));
    this.camera.up.copy(this.mainCamera.up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  _rayCast(event) {
    if (!this.visible) return null;
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = rect.width - this.viewportSize - this.rightGap;
    const top = this.topGap;
    if (
      x < left ||
      x > left + this.viewportSize ||
      y < top ||
      y > top + this.viewportSize
    ) {
      return null;
    }
    const ndcX = ((x - left) / this.viewportSize) * 2 - 1;
    const ndcY = -(((y - top) / this.viewportSize) * 2 - 1);
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return this.raycaster.intersectObjects(this.interactiveObjects);
  }

  _addEventListeners() {
    const dom = this.renderer.domElement;
    this._onMouseDown = (e) => this.mouseDownPos.set(e.clientX, e.clientY);
    this._onMouseMove = (e) => {
      const hits = this._rayCast(e);
      this._resetInteractiveScales();
      if (hits && hits.length > 0) {
        hits[0].object.scale.set(1.25, 1.25, 1.25);
      }
    };
    this._onMouseUp = (e) => {
      if (new THREE.Vector2(e.clientX, e.clientY).distanceTo(this.mouseDownPos) < 5) {
        const hits = this._rayCast(e);
        if (hits && hits.length > 0 && hits[0].object.userData?.direction) {
          this.animateCamera(hits[0].object.userData.direction);
        }
      }
    };
    this._onMouseLeave = () => this._resetInteractiveScales();

    dom.addEventListener('mousedown', this._onMouseDown);
    dom.addEventListener('mousemove', this._onMouseMove);
    dom.addEventListener('mouseup', this._onMouseUp);
    dom.addEventListener('mouseleave', this._onMouseLeave);
  }

  _resetInteractiveScales() {
    for (const obj of this.interactiveObjects) {
      obj.scale.setScalar(1);
    }
  }

  animateCamera(direction) {
    const dist = this.mainCamera.position.distanceTo(this.controls.target);
    const targetPos = direction.clone();
    if (Math.abs(direction.y) > 0.99) {
      const offset = this.mainCamera.position.clone().normalize().multiplyScalar(0.01);
      targetPos.add(offset).normalize().multiplyScalar(dist).add(this.controls.target);
    } else {
      targetPos.multiplyScalar(dist).add(this.controls.target);
    }

    const startPos = this.mainCamera.position.clone();
    const startTime = performance.now();
    const duration = 500;
    this.controls.enabled = false;

    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.mainCamera.position.lerpVectors(startPos, targetPos, ease);
      this.mainCamera.lookAt(this.controls.target);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.controls.enabled = true;
        this.controls.update();
      }
    };
    requestAnimationFrame(step);
  }

  setVisibility(visible) {
    this.visible = visible;
    this.axesGroup.visible = visible;
  }

  dispose() {
    const dom = this.renderer.domElement;
    dom.removeEventListener('mousedown', this._onMouseDown);
    dom.removeEventListener('mousemove', this._onMouseMove);
    dom.removeEventListener('mouseup', this._onMouseUp);
    dom.removeEventListener('mouseleave', this._onMouseLeave);
    for (const sp of this.labelSprites) {
      sp.material.map?.dispose();
      sp.material.dispose();
    }
    this.axesGroup.traverse((obj) => {
      obj.geometry?.dispose();
      if (obj.material) {
        Array.isArray(obj.material)
          ? obj.material.forEach((m) => m.dispose())
          : obj.material.dispose();
      }
    });
    this.scene.clear();
  }
}

/**
 * Surface firework particle burst system reverse-engineered from Hi3D (ws in D32u0e9YaPcG-pPC.js).
 */
export class Hi3DParticleSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.particleSystem = null;
    this.particleClock = null;
    this.state = 'stopped';
    this.waitTime = 0;
    this.playTime = 2.5;
    this.v2Config = {
      duration: 2.0,
      surfaceSizeScale: 1.6,
      surfaceMaxPointSize: 10.0
    };
    this.surfaceSamplerCache = new WeakMap();
    this.updateSize();
  }

  updateSize() {
    const minDim = Math.min(
      this.renderer.domElement.width || 800,
      this.renderer.domElement.height || 600
    );
    this.particleSize = (10 / 2400) * minDim;
    if (this.particleSystem?.material instanceof THREE.ShaderMaterial) {
      const u = this.particleSystem.material.uniforms;
      if (u.uSize) {
        u.uSize.value = this.particleSize * this.v2Config.surfaceSizeScale;
      }
    }
  }

  createFireworkParticlesFromObject(scene, rootObject, duration = this.v2Config.duration) {
    this.removeParticles(scene);
    this.updateSize();

    let cached = this.surfaceSamplerCache.get(rootObject);
    if (!cached) {
      rootObject.updateWorldMatrix(true, true);
      const radius =
        new THREE.Box3().setFromObject(rootObject).getSize(new THREE.Vector3()).length() * 0.5;
      const candidates = [];
      rootObject.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BufferGeometry)) {
          return;
        }
        const pos = child.geometry.getAttribute('position');
        if (pos && pos.count >= 3) {
          candidates.push({ mesh: child, weight: pos.count });
        }
      });
      if (candidates.length === 0) return;

      candidates.sort((a, b) => b.weight - a.weight);
      const top = candidates.slice(0, 18);
      const meshes = top.map((item) => ({
        mesh: item.mesh,
        sampler: new MeshSurfaceSampler(item.mesh).build(),
        weight: item.weight
      }));

      const cdf = new Float32Array(meshes.length);
      let sum = 0;
      for (let i = 0; i < meshes.length; i++) {
        sum += meshes[i].weight;
        cdf[i] = sum;
      }
      for (let i = 0; i < meshes.length; i++) {
        cdf[i] /= sum;
      }
      cached = { sphereRadius: radius, meshes, cdf };
      this.surfaceSamplerCache.set(rootObject, cached);
    }

    const r = cached.sphereRadius;
    const rawCount = Math.floor(r * r * 220);
    const count = Math.min(Math.max(rawCount, 420), 1200);

    const pickMesh = () => {
      const rand = Math.random();
      let lo = 0;
      let hi = cached.cdf.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rand <= cached.cdf[mid]) hi = mid;
        else lo = mid + 1;
      }
      return cached.meshes[lo];
    };

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const randoms = new Float32Array(count * 3);

    const samplePos = new THREE.Vector3();
    const sampleNorm = new THREE.Vector3();
    const normalMat = new THREE.Matrix3();

    for (let i = 0; i < count; i++) {
      const { mesh, sampler } = pickMesh();
      sampler.sample(samplePos, sampleNorm);
      samplePos.applyMatrix4(mesh.matrixWorld);
      normalMat.getNormalMatrix(mesh.matrixWorld);
      sampleNorm.applyMatrix3(normalMat).normalize();

      positions[i * 3] = samplePos.x;
      positions[i * 3 + 1] = samplePos.y;
      positions[i * 3 + 2] = samplePos.z;

      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4 + 0.15,
        (Math.random() - 0.5) * 0.4
      );
      const vel = sampleNorm.clone().add(jitter).normalize();
      velocities[i * 3] = vel.x;
      velocities[i * 3 + 1] = vel.y;
      velocities[i * 3 + 2] = vel.z;

      randoms[i * 3] = Math.random();
      randoms[i * 3 + 1] = Math.random();
      randoms[i * 3 + 2] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('randomValue', new THREE.BufferAttribute(randoms, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        #define PI 3.1415926535897932
        uniform float uTime;
        uniform float uSize;
        uniform float uDuration;
        uniform float uMaxPointSize;

        attribute vec3 velocity;
        attribute vec3 randomValue;

        varying float vAlpha;
        varying float vLife;

        float easeOutQuad(float t) {
          return 1.0 - (1.0 - t) * (1.0 - t);
        }

        void main() {
          float delay = randomValue.x * 0.3;
          float localTime = max(uTime - delay, 0.0);
          float life = clamp(localTime / uDuration, 0.0, 1.0);
          vLife = life;

          float speedFactor = 0.25 + randomValue.y * 0.35;
          float easedTime = easeOutQuad(life);
          float gravity = -0.18;

          vec3 newPos = position;
          newPos += velocity * speedFactor * easedTime * uDuration;
          newPos.y += gravity * localTime * localTime;

          float jitter = sin(localTime * 8.0 + randomValue.z * PI * 2.0) * 0.006 * (1.0 - life);
          newPos += vec3(jitter, jitter * 0.5, jitter);

          float fadeIn = smoothstep(0.0, 0.1, life);
          float fadeOut = 1.0 - smoothstep(0.3, 1.0, life);
          vAlpha = fadeIn * fadeOut;

          float sizeLife = 1.0 - pow(life * 2.0 - 1.0, 2.0);
          float sizeFactor = (0.5 + randomValue.z * 0.5) * max(sizeLife, 0.2);

          vec4 viewPos = modelViewMatrix * vec4(newPos, 1.0);
          gl_Position = projectionMatrix * viewPos;
          gl_PointSize = (uSize * sizeFactor) / gl_Position.w;
          gl_PointSize = min(gl_PointSize, uMaxPointSize);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vLife;

        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float circle = 1.0 - smoothstep(0.3, 0.5, d);
          float glow = max((1.0 - d * 2.0) * 0.3, 0.0);
          float alpha = (circle + glow) * vAlpha;

          vec3 color = mix(vec3(1.0, 0.98, 0.95), vec3(0.8, 0.85, 0.9), vLife * 0.3);
          gl_FragColor = vec4(color, alpha);
          if (alpha < 0.01) discard;
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: this.particleSize * this.v2Config.surfaceSizeScale },
        uDuration: { value: duration },
        uMaxPointSize: { value: this.v2Config.surfaceMaxPointSize }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    this.particleClock = new THREE.Clock();
    this.particleClock.start();
    this.particleSystem = new THREE.Points(geometry, material);
    this.particleSystem.renderOrder = 10;
    this.playTime = duration + 0.4;
    this.waitTime = this.playTime;
    this.state = 'playing';
    scene.add(this.particleSystem);
  }

  updateParticles() {
    if (!this.particleSystem || !this.particleClock || this.state === 'stopped') return;
    const dt = this.particleClock.getDelta();
    this.waitTime -= dt;
    if (this.waitTime <= 0) {
      this.removeParticles(this.particleSystem.parent);
      return;
    }
    this.particleSystem.material.uniforms.uTime.value = this.particleClock.getElapsedTime();
  }

  removeParticles(scene) {
    if (!this.particleSystem) return;
    if (scene) scene.remove(this.particleSystem);
    else this.particleSystem.parent?.remove(this.particleSystem);
    this.particleSystem.geometry.dispose();
    this.particleSystem.material.dispose();
    this.particleSystem = null;
    this.particleClock = null;
    this.state = 'stopped';
  }
}
