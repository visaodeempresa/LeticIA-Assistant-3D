# Stylized Vintage Cyber Young Girl — Hi3D Three.js Local Package

100% self-contained (offline-ready) 3D web viewer package reconstructed via reverse engineering from the Hi3D AI 3D character pipeline.

## File Structure

```text
reverse/
├── index.html                  # Standalone interactive 3D Studio (local Three.js r178)
├── metadata.json               # Sanitized 3D model specification manifest
├── package.json                # Reusable ES Module manifest
├── src/
│   ├── Hi3DAvatarViewer.js     # Main reusable viewer component (createAvatarViewer)
│   ├── Hi3DMaterials.js        # Custom shaders (PBR, Clay, Wireframe, FloorGrid)
│   └── Hi3DCameraAndGizmo.js   # Perspective/Ortho controller, 3D X/Y/Z Gizmo & Particles
├── assets/
│   ├── avatar-web.glb          # Web-optimized GLB (precomputed smooth normals + calibrated PBR)
│   ├── avatar.glb              # Raw original GLB mesh (unmodified geometry)
│   ├── textures/
│   │   └── baseColor.png       # 4096x4096 UV baseColor texture extracted from the GLB
│   ├── env/                    # All 5 HDRI/EXR environment lighting maps
│   │   ├── Office_Room_Ten24.hdr  (Default preset: indoor2, intensity 3.0, rotation -60°)
│   │   ├── map.hdr                (indoor1)
│   │   ├── map2.hdr               (outdoor1)
│   │   ├── map3.hdr               (outdoor2)
│   │   └── room_env_cube_uv.exr   (studio)
│   └── media/                  # Reference renders and 360° orbit preview video
│       ├── reference-source.png
│       ├── clay-no-tex.png
│       ├── cover.png
│       ├── cover.webp
│       ├── share-card.png
│       └── orbit.mp4
└── vendor/
    └── three/                  # Three.js r178 + Addons (GLTFLoader, RGBELoader, GTAOPass, etc.)
```

## Reverse Engineering Findings (Why does the raw GLB look different without this pipeline?)

1. **Missing `NORMAL` Attribute and `metallicFactor` in the Raw `avatar.glb`**:
   - The raw generated file (`avatar.glb`) only includes `POSITION` and `TEXCOORD_0` attributes (no vertex normals) and defines `roughnessFactor: 0.9036` without specifying `metallicFactor` (which defaults to `1.0` — 100% metallic — under the glTF 2.0 specification).
   - At runtime, `Hi3DMaterialManager` executes `geometry.computeVertexNormals()`, sets `material.flatShading = false`, and enforces `metalness = 0.0` and `roughness = 0.5`.
   - We generated **`assets/avatar-web.glb`** with all **1,017,477 smooth vertex normals precomputed** and `metallicFactor: 0.0, roughnessFactor: 0.5` embedded directly into the glTF binary, ensuring accurate out-of-the-box rendering in any 3D engine (`Three.js`, `<model-viewer>`, React Three Fiber, Blender, Unreal Engine, Unity).

2. **Exact Lighting & Post-Processing Pipeline**:
   - **Tone Mapping**: `THREE.ACESFilmicToneMapping` (`exposure: 1.0`).
   - **Default HDRI**: `Office_Room_Ten24.hdr` (`environmentIntensity = 3.0`, `environmentRotation.y = -60°`).
   - **Scene Lights**:
     - `DirectionalLight(0xdef3ff, 4.0)` at position `(-1.743, 1.1558, -2.118)`
     - `PointLight(0xffffff, 5.0, 0)` at position `(0, 0, 1.9417)`
   - **Post-Processing**: `EffectComposer` + `RenderPass` + `GTAOPass` (`radius: 0.1, thickness: 0.2, scale: 1.5, samples: 16`) + `OutputPass`.

## Running the Viewer Locally

Serve the `reverse/` directory using any static HTTP server:

```bash
cd reverse
python3 -m http.server 8080
# Open http://localhost:8080
```

## Reusing in Any Web Application

```js
import { createAvatarViewer } from './src/Hi3DAvatarViewer.js';

const viewer = createAvatarViewer(document.getElementById('avatar-container'), {
  modelUrl: './assets/avatar-web.glb',
  envBasePath: './assets/env',
  hdriKey: 'indoor2',        // 'outdoor1' | 'outdoor2' | 'indoor1' | 'indoor2' | 'studio'
  envIntensity: 3.0,
  envRotationY: -60,
  renderMode: 'texture',     // 'texture' | 'white' | 'albedo' | 'normal'
  wireframe: false,
  autoRotate: true,
  perspective: true,
  showGrid: false,
  showAxes: false,
  usePostProcessing: true
});
```
