# 🧬 Notebooks — 3D Generation & Multi-View LoRA Training Pipeline

This directory contains the **Computer Vision, Deep Learning, and 3D Computer Graphics** engineering notebooks dedicated to 3D reconstruction, multi-view identity fine-tuning, and game-ready `.glb` asset export for **Letícia**.

---

## 📓 Notebook Catalog

| Notebook | Description | Primary Output |
| :--- | :--- | :--- |
| [`avatar_leticia_3d_generation.ipynb`](./avatar_leticia_3d_generation.ipynb) | End-to-end pipeline for reference photo ingestion (`../images`), alpha segmentation, zero-shot camera view classification, multi-view LoRA fine-tuning, and PBR-textured 3D avatar synthesis. | `../outputs/avatar_3d/avatar_leticia_game_ready.glb` |

---

## 🏗️ 4-Module Architecture (`avatar_leticia_3d_generation.ipynb`)

### Module 1 — Ingestion, Photometric Audit & Alpha Segmentation
- **Data Audit (`audit_image_directory`)**: Inspects all images in `../images`, normalizes EXIF orientation (`ImageOps.exif_transpose`), detects corrupted files, and computes **sharpness scores** via the variance of the spatial Laplacian gradient (`compute_sharpness_score`), mean brightness, and contrast.
- **Sub-Pixel Background Removal (`briaai/RMBG-2.0`)**: Extracts the subject's alpha mask, crops around the active bounding box, and centers the avatar on a square $1024 \times 1024$ canvas with a constant $85\%$ foreground occupancy ratio over a neutral gray background ($RGB = 0.5$).

### Module 2 — Hugging Face Model Selection & Benchmark
The pipeline coordinates three model families from Hugging Face:

| Stage | Primary Model (Hugging Face) | Alternative / Fallback | Role in 3D Engineering |
| :--- | :--- | :--- | :--- |
| **Alpha Segmentation** | `briaai/RMBG-2.0` | `ZhengPeng7/BiRefNet` | High-precision silhouette and hair strand isolation to prevent background bleeding onto the 3D mesh. |
| **Camera View & Identity Analysis** | `google/siglip-so400m-patch14-384` | `openai/clip-vit-large-patch14` | Zero-shot classification across 7 canonical camera views (`front`, `three_quarter_left`, `three_quarter_right`, `left`, `right`, `back`, `face_closeup`) and identity centroid extraction. |
| **Multi-View 3D Generation + PBR** | `tencent/Hunyuan3D-2mv` + `tencent/Hunyuan3D-2` | `VAST-AI/TripoSG` / `TencentARC/InstantMesh` | Watertight geometry synthesis via Flow-Matching 3D DiT conditioned on multiple calibrated views + UV PBR texturing (`Hunyuan3D-Paint`). |

### Module 3 — Stratified Split & Multi-View LoRA Training
- **Data Leakage Prevention (`split_multiview_dataset`)**:
  - Selects the sharpest image of each available camera view as a mandatory anchor in the training set.
  - Splits the remaining images into **Train (70%)**, **Validation (15%)**, and **Test (15%)** *before* fitting `StandardScaler` and `OrdinalEncoder`.
- **Parametric Adaptation with `peft` LoRA (`MultiViewConditionedAvatarField`)**:
  - Injects LoRA adapters (`r=16`, `lora_alpha=32`, `lora_dropout=0.05`) into the attention projection matrices (`q_proj`, `k_proj`, `v_proj`, `out_proj`).
  - Optimizes a sharpness-weighted multi-objective loss function:
    $$\mathcal{L}_{\text{total}} = \lambda_{\text{L1}} \mathcal{L}_{\text{Photometric-L1}} + \lambda_{\text{IoU}} (1 - \text{IoU}_{\text{silhouette}}) + \lambda_{\text{ID}} (1 - \cos(e_{\text{pred}}, e_{\text{centroid}}))$$
  - Includes *Cosine Annealing LR*, *Gradient Clipping* ($\|\nabla\|_2 \le 1.0$), *Early Stopping*, and dynamic *Weight Decay* scaling if the generalization gap (`val_loss - train_loss`) exceeds the threshold.

### Module 4 — Game-Ready Geometric Post-Processing & `.GLB` Export
The function `optimize_mesh_for_games_and_export_glb` prepares the mesh for immediate import into **Unreal Engine 5**, **Unity**, **Godot**, **Blender**, and **Three.js**:
1. **Floater Removal**: Isolates the main connected component and discards disconnected floating artifacts.
2. **Topological Repair**: Removes degenerate/duplicate faces and unifies surface normals (`trimesh.repair.fix_normals`).
3. **Polygon Budget (LOD0)**: Applies quadric decimation to a configurable target of `25,000` triangles.
4. **Metric Scale & Pivot Alignment**: Normalizes character height to $1.70\text{ m}$ and translates the pivot to $(X=0, Z=0)$ with the soles of the feet resting on the $Y=0$ ground plane.
5. **glTF 2.0 PBR Material**: Assigns `M_Avatar_Leticia_PBR` (`metallicFactor = 0.05`, `roughnessFactor = 0.65`) on node `Avatar_Leticia_LOD0`.
