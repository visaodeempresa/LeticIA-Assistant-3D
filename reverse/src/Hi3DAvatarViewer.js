import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Hi3DMaterialManager, Hi3DFloorGrid } from './Hi3DMaterials.js';
import {
  Hi3DCameraController,
  Hi3DAxesGizmo,
  Hi3DParticleSystem
} from './Hi3DCameraAndGizmo.js';

export const HI3D_ENV_PRESETS = [
  { key: 'outdoor1', label: 'Outdoor 1 (map2.hdr)', file: 'map2.hdr' },
  { key: 'outdoor2', label: 'Outdoor 2 (map3.hdr)', file: 'map3.hdr' },
  { key: 'indoor1', label: 'Indoor 1 (map.hdr)', file: 'map.hdr' },
  { key: 'indoor2', label: 'Indoor 2 — Default (Office_Room_Ten24.hdr)', file: 'Office_Room_Ten24.hdr' },
  { key: 'studio', label: 'Studio (room_env_cube_uv.exr)', file: 'room_env_cube_uv.exr' }
];

/**
 * Reusable 3D Avatar Viewer reverse-engineered from Hi3D's Model3DViewer (Three.js r178).
 * Can be mounted in any DOM element in Vanilla JS, React, Vue, or Next.js applications.
 */
export class Hi3DAvatarViewer {
  constructor(container, options = {}) {
    if (!container) {
      throw new Error('Hi3DAvatarViewer requires a valid container DOM element.');
    }
    this.container = container;
    this.options = {
      modelUrl: options.modelUrl ?? './assets/avatar-web.glb',
      envBasePath: options.envBasePath ?? './assets/env',
      hdriKey: options.hdriKey ?? 'indoor2',
      envIntensity: options.envIntensity ?? 3.0,
      envRotationY: options.envRotationY ?? -60,
      defaultSize: options.defaultSize ?? 1.0,
      rotation: options.rotation ?? [0, 0, 0],
      renderMode: options.renderMode ?? 'texture', // 'texture' | 'white' | 'albedo' | 'normal'
      wireframe: options.wireframe ?? false,
      autoRotate: options.autoRotate ?? true,
      autoRotateSpeed: options.autoRotateSpeed ?? 0.3,
      perspective: options.perspective ?? true,
      showGrid: options.showGrid ?? true,
      showAxes: options.showAxes ?? true,
      usePostProcessing: options.usePostProcessing ?? true,
      playIntroParticles: options.playIntroParticles ?? true,
      enableZoom: options.enableZoom ?? true,
      onProgress: options.onProgress ?? null,
      onStage: options.onStage ?? null,
      onReady: options.onReady ?? null,
      onError: options.onError ?? null,
      onZoomPercentChange: options.onZoomPercentChange ?? null
    };

    this.disposed = false;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.composer = null;
    this.renderPass = null;
    this.gtaoPass = null;
    this.modelRoot = null;
    this.materialManager = null;
    this.floorGrid = null;
    this.axesGizmo = null;
    this.particleSystem = null;
    this.envCache = new Map();
    this.animationFrameId = null;
    this.resizeObserver = null;

    this.cameraController = new Hi3DCameraController({
      minDistance: 0.4,
      maxDistance: 10.0,
      perspectiveFov: 45.0,
      frustumBaseDistance: 1.7,
      getCamera: () => this.camera,
      getControls: () => this.controls,
      setCamera: (cam) => {
        this.camera = cam;
        if (this.controls) this.controls.object = cam;
        if (this.renderPass) this.renderPass.camera = cam;
        if (this.gtaoPass) this.gtaoPass.camera = cam;
        if (this.axesGizmo) this.axesGizmo.setMainCamera(cam);
      },
      onZoomPercent: (pct) => this.options.onZoomPercentChange?.(pct),
      onAfterPerspectiveSwitch: () => this._renderFrame()
    });

    this.gltfLoader = new GLTFLoader();
    this._init();
  }

  async _init() {
    try {
      const width = this.container.clientWidth || 800;
      const height = this.container.clientHeight || 600;

      // 1. Scene
      this.scene = new THREE.Scene();
      this.scene.background = null;

      // 2. Camera
      this.camera = this.cameraController.createInitialCamera(width, height, {
        perspective: this.options.perspective,
        near: 0.01,
        far: 20,
        distance: 1.7
      });
      this.camera.lookAt(0, 0, 0);

      // 3. Lights (exact Hi3D general model lighting rig)
      const dirLight = new THREE.DirectionalLight(0xdef3ff, 4.0);
      dirLight.position.set(-1.743, 1.1558, -2.118);
      this.scene.add(dirLight);
      this.directionalLight = dirLight;

      const pointLight = new THREE.PointLight(0xffffff, 5.0, 0);
      pointLight.position.set(0, 0, 1.9417);
      this.scene.add(pointLight);
      this.pointLight = pointLight;

      // 4. WebGLRenderer
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(dpr);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.setClearColor(0x000000, 0);
      this.container.appendChild(this.renderer.domElement);

      // 5. Post-Processing (RenderPass + GTAOPass + OutputPass)
      this._initPostProcessing(width, height);

      // 6. OrbitControls
      this._initControls();

      // 7. Helpers (FloorGrid, ParticleSystem, AxesGizmo)
      this.floorGrid = new Hi3DFloorGrid(this.scene);
      this.floorGrid.setVisibility(this.options.showGrid);

      this.particleSystem = new Hi3DParticleSystem(this.renderer);

      this.axesGizmo = new Hi3DAxesGizmo(
        this.container,
        this.camera,
        this.renderer,
        this.controls
      );
      this.axesGizmo.setVisibility(this.options.showAxes);

      // 8. Resize listener
      this._onWindowResize = () => this.resize();
      window.addEventListener('resize', this._onWindowResize);
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(() => this.resize());
        });
        this.resizeObserver.observe(this.container);
      }

      // 9. Start loop
      this._startLoop();

      // 10. Load HDRI environment + 3D Model
      this.options.onStage?.('environment');
      await this.setEnvironmentPreset(this.options.hdriKey);

      if (this.options.modelUrl) {
        await this.loadModel(this.options.modelUrl);
      }
    } catch (err) {
      console.error('[Hi3DAvatarViewer] Initialization error:', err);
      this.options.onError?.(err);
    }
  }

  _initPostProcessing(width, height) {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat
    });
    this.composer = new EffectComposer(this.renderer, rt);

    this.renderPass = new RenderPass(this.scene, this.camera, null, new THREE.Color(0, 0, 0), 0);
    this.composer.addPass(this.renderPass);

    this.gtaoPass = new GTAOPass(this.scene, this.camera, width, height);
    this.gtaoPass.blendIntensity = 1.0;
    this.gtaoPass.updateGtaoMaterial({
      radius: 0.1,
      distanceExponent: 2,
      thickness: 0.2,
      scale: 1.5,
      samples: 16,
      distanceFallOff: 1,
      screenSpaceRadius: false
    });
    this.gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 0.2,
      normalPhi: 3,
      radius: 4,
      radiusExponent: 1,
      rings: 2,
      samples: 16
    });
    this.composer.addPass(this.gtaoPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.autoRotate = this.options.autoRotate;
    this.controls.autoRotateSpeed = this.options.autoRotateSpeed;
    this.cameraController.applyControlsZoomLimits(this.controls);
    this.controls.enableDamping = true;
    this.controls.enableZoom = this.options.enableZoom;

    const dom = this.renderer.domElement;
    this._onMouseEnter = () => {
      if (this.controls) this.controls.autoRotate = false;
    };
    this._onMouseLeave = () => {
      if (this.controls && this.options.autoRotate) {
        this.controls.autoRotate = true;
      }
    };
    dom.addEventListener('mouseenter', this._onMouseEnter);
    dom.addEventListener('mouseleave', this._onMouseLeave);

    this.cameraController.bindControlsZoomSync(this.controls);
  }

  async _loadEnvTexture(url) {
    if (this.envCache.has(url)) {
      return this.envCache.get(url);
    }
    const isHdr = url.toLowerCase().endsWith('.hdr');
    const loader = isHdr ? new RGBELoader() : new EXRLoader();
    const tex = await loader.loadAsync(url);
    tex.mapping = isHdr
      ? THREE.EquirectangularReflectionMapping
      : THREE.CubeUVReflectionMapping;
    this.envCache.set(url, tex);
    return tex;
  }

  async setEnvironmentPreset(key) {
    const preset = HI3D_ENV_PRESETS.find((p) => p.key === key) || HI3D_ENV_PRESETS[3];
    this.options.hdriKey = preset.key;
    const url = `${this.options.envBasePath.replace(/\/$/, '')}/${preset.file}`;
    const tex = await this._loadEnvTexture(url);
    if (this.disposed) return;

    this.scene.environment = tex;
    this.scene.background = null;
    this.scene.environmentIntensity = this.options.envIntensity;
    this.scene.environmentRotation = new THREE.Euler(
      0,
      THREE.MathUtils.degToRad(this.options.envRotationY),
      0
    );
  }

  setEnvironmentIntensity(intensity) {
    this.options.envIntensity = Number(intensity);
    if (this.scene) {
      this.scene.environmentIntensity = this.options.envIntensity;
    }
  }

  setEnvironmentRotation(degreesY) {
    this.options.envRotationY = Number(degreesY);
    if (this.scene) {
      this.scene.environmentRotation = new THREE.Euler(
        0,
        THREE.MathUtils.degToRad(this.options.envRotationY),
        0
      );
    }
  }

  async loadModel(url) {
    this.options.onStage?.('downloading');
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.materialManager?.dispose();
      this.modelRoot = null;
    }

    const gltf = await this.gltfLoader.loadAsync(url, (evt) => {
      if (evt.lengthComputable || evt.total) {
        this.options.onProgress?.({
          loaded: evt.loaded,
          total: evt.total,
          percent: Math.round((evt.loaded / evt.total) * 100)
        });
      }
    });

    if (this.disposed) return;
    this.options.onStage?.('scene');

    const root = gltf.scene;
    root.rotation.set(
      this.options.rotation[0],
      this.options.rotation[1],
      this.options.rotation[2]
    );

    // Normalize bounding box to defaultSize (1.0) and center at origin (0,0,0)
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = this.options.defaultSize / maxDim;
    root.scale.setScalar(scale);

    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    root.position.sub(center);

    this.modelRoot = root;
    this.materialManager = new Hi3DMaterialManager(root, false);
    this.scene.add(root);

    this.setRenderMode(this.options.renderMode);
    this.setWireframe(this.options.wireframe);

    this.controls?.saveState();

    // Calculate stats
    let vertices = 0;
    let faces = 0;
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        const pos = obj.geometry.getAttribute('position');
        if (pos) vertices += pos.count;
        if (obj.geometry.index) faces += obj.geometry.index.count / 3;
        else if (pos) faces += pos.count / 3;
      }
    });

    this.resize();

    if (this.options.playIntroParticles) {
      this.triggerParticles();
    }

    this.options.onReady?.({
      vertices,
      faces: Math.round(faces),
      boundingBox: size,
      scale
    });
  }

  setRenderMode(mode) {
    this.options.renderMode = mode;
    if (!this.materialManager) return;

    switch (mode) {
      case 'texture':
        this.materialManager.restoreOriginal();
        break;
      case 'white':
        this.materialManager.applySolidMaterial();
        break;
      case 'albedo':
        this.materialManager.applyAlbedoMaterial();
        break;
      case 'normal':
        this.materialManager.applyNormalMaterial();
        break;
      default:
        this.materialManager.restoreOriginal();
    }
    this._syncWireframe();
  }

  setWireframe(enabled) {
    this.options.wireframe = Boolean(enabled);
    this._syncWireframe();
  }

  _syncWireframe() {
    if (!this.materialManager) return;
    if (this.options.wireframe) {
      this.materialManager.addWireframeOverlay();
    } else {
      this.materialManager.removeWireframeOverlay();
    }
  }

  setRoughnessParams(strength, contrast) {
    if (!this.materialManager) return;
    this.materialManager.setRoughnessParams(Number(strength), Number(contrast));
    if (this.options.renderMode === 'texture') {
      this.materialManager.applyRoughMetalScale();
    }
  }

  setMetalnessParams(strength, contrast) {
    if (!this.materialManager) return;
    this.materialManager.setMetalnessParams(Number(strength), Number(contrast));
    if (this.options.renderMode === 'texture') {
      this.materialManager.applyRoughMetalScale();
    }
  }

  setAutoRotate(enabled) {
    this.options.autoRotate = Boolean(enabled);
    if (this.controls) {
      this.controls.autoRotate = this.options.autoRotate;
    }
  }

  setPerspective(perspective) {
    this.options.perspective = Boolean(perspective);
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.cameraController.applyPerspectiveMode(this.options.perspective, w, h);
  }

  setGridVisible(visible) {
    this.options.showGrid = Boolean(visible);
    this.floorGrid?.setVisibility(this.options.showGrid);
  }

  setAxesVisible(visible) {
    this.options.showAxes = Boolean(visible);
    this.axesGizmo?.setVisibility(this.options.showAxes);
  }

  setPostProcessing(enabled) {
    this.options.usePostProcessing = Boolean(enabled);
  }

  setZoomPercent(pct) {
    this.cameraController.applyZoomPercentFromModel(Number(pct), (cb) =>
      requestAnimationFrame(cb)
    );
  }

  resetCamera() {
    if (!this.controls) return;
    this.controls.reset();
    this.cameraController.emitZoomPercentFromCamera();
  }

  triggerParticles() {
    if (this.modelRoot && this.particleSystem) {
      this.particleSystem.createFireworkParticlesFromObject(this.scene, this.modelRoot);
    }
  }

  takeScreenshot(filename = 'avatar-capture.png') {
    this._renderFrame();
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    if (filename) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    }
    return dataUrl;
  }

  resize() {
    if (this.disposed || !this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / Math.max(h, 1);
      this.camera.updateProjectionMatrix();
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      this.cameraController.resizeOrthographicIfNeeded(w, h);
    }

    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.particleSystem?.updateSize();
    this._renderFrame();
  }

  _startLoop() {
    const tick = () => {
      if (this.disposed) return;
      this.animationFrameId = requestAnimationFrame(tick);
      this.controls?.update();
      this.particleSystem?.updateParticles();
      this._renderFrame();
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  _renderFrame() {
    if (!this.renderer || !this.camera || !this.scene) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.setScissorTest(false);

    const useComposer =
      this.options.usePostProcessing &&
      this.composer &&
      this.options.renderMode !== 'normal' &&
      this.options.renderMode !== 'albedo';

    if (useComposer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.axesGizmo && this.options.showAxes) {
      this.axesGizmo.update();
      this.axesGizmo.render();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    window.removeEventListener('resize', this._onWindowResize);
    this.resizeObserver?.disconnect();

    if (this.controls) {
      this.cameraController.unbindControlsZoomSync(this.controls);
      this.controls.dispose();
    }

    this.materialManager?.dispose();
    this.floorGrid?.dispose();
    this.axesGizmo?.dispose();
    this.particleSystem?.removeParticles(this.scene);

    this.envCache.forEach((tex) => tex.dispose());
    this.envCache.clear();

    if (this.renderer) {
      const dom = this.renderer.domElement;
      dom.removeEventListener('mouseenter', this._onMouseEnter);
      dom.removeEventListener('mouseleave', this._onMouseLeave);
      this.renderer.dispose();
      dom.remove();
    }
  }
}

export function createAvatarViewer(container, options = {}) {
  return new Hi3DAvatarViewer(container, options);
}
