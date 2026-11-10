# 🎨 LetícIA-Assistant-3D

Standalone Three.js r178 3D Avatar Studio, custom PBR shader pipeline, and multi-view 3D reconstruction notebook for **Letícia** (*Stylized Vintage Cyber Young Girl*).

---

## 🚀 Repository Architecture

```text
LeticIA-Assistant-3D/
├── reverse/                   # Self-contained offline-ready Three.js r178 3D Viewer
│   ├── index.html             # Interactive 3D Studio Web Application
│   ├── src/                   # ES6 Modules (Viewer, Custom PBR Shaders, Camera & Gizmo)
│   ├── assets/                # Web-optimized GLB models, HDRIs, 4K textures & media
│   └── vendor/                # Bundled Three.js r178 core and post-processing addons
├── images/                    # Multi-view reference renders (white & neutral gray backgrounds)
├── notebooks/                 # 3D Reconstruction, Multi-View LoRA Training & Game-Ready .GLB Export
│   ├── README.md              # Technical documentation of the 4-stage 3D AI pipeline
│   └── avatar_leticia_3d_generation.ipynb # End-to-end pipeline (RMBG-2.0 + SigLIP LoRA + Hunyuan3D-2mv)
├── labs/                      # Experimental 3D prototypes and reference studies
├── scripts/                   # Local development server and 3D asset auditing scripts
├── .github/workflows/ci.yml   # Self-contained Continuous Integration quality gate
├── Makefile                   # Unified task runner for local execution and auditing
└── version.json               # Semantic versioning manifest
```

---

## 🛠️ Quick Start

### 1. Environment Setup (Optional)
```bash
cp .env.example .env
```

### 2. Run the Interactive 3D Web Viewer Locally
```bash
make dev
# Open in your browser: http://localhost:8080
```

### 3. Audit 3D Models & Textures
```bash
make audit
```

---

## 🖥️ Interactive 3D Web Studio (`reverse/`)

The `reverse/` package provides a zero-dependency, offline-ready 3D studio powered by **Three.js r178**:
- **Precomputed Smooth Normals (`avatar-web.glb`)**: 1,017,477 smooth vertex normals and calibrated glTF 2.0 PBR properties (`metallicFactor: 0.0`, `roughnessFactor: 0.5`).
- **Custom Shader Modes (`Hi3DMaterials.js`)**:
  - **PBR Texture**: Full Image-Based Lighting (IBL) with real-time roughness/metalness strength and contrast controls.
  - **Clay Model**: Custom Blinn-Phong screen-space normal perturbation clay shader.
  - **Albedo (Unlit)** & **World/Tangent Normal Map** inspection modes.
  - **Barycentric Wireframe Overlay**: Depth-compensated anti-aliased wireframe shader (`fwidth`).
- **Post-Processing & Scene Helpers**:
  - `ACESFilmicToneMapping` (`exposure: 1.0`) + Ground-Truth Ambient Occlusion (`GTAOPass`).
  - 5 HDRI/EXR environment presets (`indoor1`, `indoor2`, `outdoor1`, `outdoor2`, `studio`).
  - Interactive 3D X/Y/Z orientation gizmo, perspective/orthographic camera switcher, exponential-fade floor grid, and surface firework particle system.

See [reverse/README.md](reverse/README.md) for full integration details.

---

## 🧬 Multi-View 3D Generation & LoRA Fine-Tuning Pipeline (`notebooks/`)

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/visaodeempresa/LeticIA-Assistant-3D/blob/main/notebooks/avatar_leticia_3d_generation.ipynb)

The Jupyter Notebook [`notebooks/avatar_leticia_3d_generation.ipynb`](notebooks/avatar_leticia_3d_generation.ipynb) implements a complete 4-stage 3D reconstruction and identity adaptation pipeline from the reference images in `images/`:

1. **Photometric Audit & Alpha Segmentation (`briaai/RMBG-2.0`)**: Image integrity verification, EXIF orientation normalization, Laplacian variance sharpness scoring, and centered RGBA subject cropping ($1024 \times 1024$ at $85\%$ foreground occupancy).
2. **Zero-Shot Camera View Classification & Identity Extraction (`google/siglip-so400m-patch14-384`)**: Automatic classification into 7 canonical camera views (`front`, `three_quarter_left`, `three_quarter_right`, `left`, `right`, `back`, `face_closeup`) and $L_2$-normalized identity centroid estimation.
3. **Leakage-Free Multi-View LoRA Fine-Tuning (`peft`)**: Stratified *Train / Validation / Test* split prior to statistical scaling, adapting attention layers (`q_proj`, `k_proj`, `v_proj`, `out_proj`) with a composite objective (Photometric $L_1$ + Silhouette IoU + Cosine Identity Similarity), *Early Stopping*, and adaptive *Weight Decay*.
4. **3D Mesh Synthesis & Game-Ready `.GLB` Export (`tencent/Hunyuan3D-2mv` + `Hunyuan3D-Paint`)**: Watertight mesh extraction via Flow-Matching 3D DiT, UV PBR texturing, floater removal, quadric decimation to game engine polygon budgets (`25,000` triangles LOD0), metric height normalization ($1.70\text{ m}$, ground-aligned pivot at $Y=0$), and binary glTF 2.0 export (`outputs/avatar_3d/avatar_leticia_game_ready.glb`).

See [notebooks/README.md](notebooks/README.md) for the complete technical breakdown.
