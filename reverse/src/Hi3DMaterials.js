import * as THREE from 'three';

/**
 * Custom MeshStandardMaterial reverse-engineered from Hi3D (Dv2_2ZX-wJQsO0VN.js).
 * Supports PBR data encoded in vertex attribute `color_1` (green = roughness, blue = metalness),
 * applies metalness-driven luminance boost, and exposes real-time roughness/metalness
 * strength and contrast uniforms.
 */
export class Hi3DPBRMaterial extends THREE.MeshStandardMaterial {
  constructor(parameters = {}, hasPBRDataInColor1 = false) {
    super(parameters);
    this.hasPBRDataInColor1 = hasPBRDataInColor1;
    this.userData.uMetalStrength = { value: 1.0 };
    this.userData.uMetalContrast = { value: 1.0 };
    this.userData.uRoughStrength = { value: 1.0 };
    this.userData.uRoughContrast = { value: 1.0 };

    this.onBeforeCompile = this._onBeforeCompile.bind(this);
    this.customProgramCacheKey = this._customProgramCacheKey.bind(this);
  }

  _customProgramCacheKey() {
    return this.hasPBRDataInColor1
      ? 'hi3d_custom_standard_material_pbrc1'
      : 'hi3d_custom_standard_material';
  }

  _onBeforeCompile(shader) {
    shader.uniforms.uMetalStrength = this.userData.uMetalStrength;
    shader.uniforms.uMetalContrast = this.userData.uMetalContrast;
    shader.uniforms.uRoughStrength = this.userData.uRoughStrength;
    shader.uniforms.uRoughContrast = this.userData.uRoughContrast;

    if (this.hasPBRDataInColor1) {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
        attribute vec3 color_1;
        varying vec3 vPbrData;
        void main() {
          vPbrData = color_1;
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        varying vec3 vPbrData;
        uniform float uMetalStrength;
        uniform float uMetalContrast;
        uniform float uRoughStrength;
        uniform float uRoughContrast;
        void main() {
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `
        #include <metalnessmap_fragment>
        roughnessFactor *= vPbrData.g;
        metalnessFactor *= vPbrData.b;

        float boost = mix(1.0, 4.0, metalnessFactor);
        float lumin = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float newLumin = lumin * boost / (1.0 + lumin * (boost - 1.0));
        vec3 scaled = diffuseColor.rgb * newLumin / max(lumin, 1e-6);
        float maxC = max(max(scaled.r, scaled.g), scaled.b);
        diffuseColor.rgb = scaled / max(maxC, 1.0);

        roughnessFactor = clamp((roughnessFactor - 0.5) * uRoughContrast + 0.5, 0.0, 1.0) * uRoughStrength;
        metalnessFactor = clamp((metalnessFactor - 0.5) * uMetalContrast + 0.5, 0.0, 1.0) * uMetalStrength;
        roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
        metalnessFactor = clamp(metalnessFactor, 0.0, 1.0);
        `
      );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        uniform float uMetalStrength;
        uniform float uMetalContrast;
        uniform float uRoughStrength;
        uniform float uRoughContrast;
        void main() {
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `
        #include <metalnessmap_fragment>

        float boost = mix(1.0, 4.0, metalnessFactor);
        float lumin = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float newLumin = lumin * boost / (1.0 + lumin * (boost - 1.0));
        vec3 scaled = diffuseColor.rgb * newLumin / max(lumin, 1e-6);
        float maxC = max(max(scaled.r, scaled.g), scaled.b);
        diffuseColor.rgb = scaled / max(maxC, 1.0);

        roughnessFactor = clamp((roughnessFactor - 0.5) * uRoughContrast + 0.5, 0.0, 1.0) * uRoughStrength;
        metalnessFactor = clamp((metalnessFactor - 0.5) * uMetalContrast + 0.5, 0.0, 1.0) * uMetalStrength;
        roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
        metalnessFactor = clamp(metalnessFactor, 0.0, 1.0);
        `
      );
    }
  }

  copy(source) {
    super.copy(source);
    if (source instanceof Hi3DPBRMaterial) {
      this.hasPBRDataInColor1 = source.hasPBRDataInColor1;
    }
    return this;
  }
}

/**
 * Manages mesh normals, material modes ('texture' | 'white' | 'albedo' | 'normal'),
 * PBR parameters, and barycentric wireframe overlays exactly as Hi3D's Model3DViewer does.
 */
export class Hi3DMaterialManager {
  constructor(rootObject, isPortraitMesh = false) {
    this.meshes = [];
    this.isPortraitMesh = isPortraitMesh;
    this.wireframeCache = new Map();
    this.defaultNormalTexture = null;

    this.roughnessScale = 1.0;
    this.roughnessContrast = 1.0;
    this.metalnessScale = 1.0;
    this.metalnessContrast = 1.0;

    this._collectMeshes(rootObject, this.meshes);
    this.originalState = this._saveOriginalState();
  }

  _collectMeshes(obj, list) {
    obj.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry.hasAttribute('normal')) {
          child.geometry.normalizeNormals();
        } else {
          child.geometry.computeVertexNormals();
          if (child.material) child.material.flatShading = false;
        }
        list.push(child);
      }
      this._collectMeshes(child, list);
    });
  }

  _saveOriginalState() {
    const state = new Map();

    const convertMaterial = (mat, hasColor1, isPortrait) => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) {
        return mat.clone();
      }
      const custom = new Hi3DPBRMaterial({}, hasColor1);
      custom.copy(mat);
      if (!hasColor1 && custom.metalnessMap === null && custom.roughnessMap === null) {
        custom.metalness = 0.0;
        custom.roughness = 0.5;
      }
      if (isPortrait) {
        custom.metalnessMap = null;
        custom.roughnessMap = null;
        custom.metalness = 0.0;
        custom.roughness = 1.0;
      }
      return custom;
    };

    this.meshes.forEach((mesh) => {
      const hasColor1 =
        mesh.geometry instanceof THREE.BufferGeometry &&
        mesh.geometry.hasAttribute('color_1');

      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          state.set(
            mesh.id,
            mesh.material.map((m) => convertMaterial(m, hasColor1, this.isPortraitMesh))
          );
        } else {
          state.set(
            mesh.id,
            convertMaterial(mesh.material, hasColor1, this.isPortraitMesh)
          );
        }
      } else {
        state.set(mesh.id, null);
      }
    });

    return state;
  }

  restoreOriginal() {
    const syncUniforms = (mat) => {
      if (mat instanceof Hi3DPBRMaterial) {
        mat.userData.uRoughStrength = { value: this.roughnessScale };
        mat.userData.uRoughContrast = { value: this.roughnessContrast };
        mat.userData.uMetalStrength = { value: this.metalnessScale };
        mat.userData.uMetalContrast = { value: this.metalnessContrast };
      }
    };

    this.meshes.forEach((mesh) => {
      const orig = this.originalState.get(mesh.id);
      if (orig) {
        if (Array.isArray(orig)) {
          mesh.material = orig.map((m) => m.clone());
          mesh.material.forEach(syncUniforms);
        } else {
          mesh.material = orig.clone();
          syncUniforms(mesh.material);
        }
      } else {
        mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      }
    });
  }

  applyAlbedoMaterial() {
    const template = new THREE.MeshBasicMaterial();
    this.meshes.forEach((mesh) => {
      const orig = this.originalState.get(mesh.id);
      if (orig) {
        if (Array.isArray(orig)) {
          mesh.material = orig.map((m) => {
            const mat = template.clone();
            THREE.Material.prototype.copy.call(mat, m);
            mat.map = m.map || null;
            mat.color.copy(m.color || new THREE.Color(0xffffff));
            return mat;
          });
        } else {
          const mat = template.clone();
          THREE.Material.prototype.copy.call(mat, orig);
          mat.map = orig.map || null;
          mat.color.copy(orig.color || new THREE.Color(0xffffff));
          mesh.material = mat;
        }
      } else {
        mesh.material = template.clone();
      }
    });
  }

  applyNormalMaterial() {
    const template = new THREE.MeshNormalMaterial();
    this.meshes.forEach((mesh) => {
      const orig = this.originalState.get(mesh.id);
      if (orig) {
        if (Array.isArray(orig)) {
          mesh.material = orig.map((m) => {
            const mat = template.clone();
            if (m.normalMap) mat.normalMap = m.normalMap;
            if (m.normalMapType) mat.normalMapType = m.normalMapType;
            if (m.normalScale) mat.normalScale = m.normalScale;
            return mat;
          });
        } else {
          const mat = template.clone();
          if (orig.normalMap) mat.normalMap = orig.normalMap;
          if (orig.normalMapType) mat.normalMapType = orig.normalMapType;
          if (orig.normalScale) mat.normalScale = orig.normalScale;
          mesh.material = mat;
        }
      } else {
        mesh.material = template;
      }
    });
  }

  _getDefaultNormalTexture() {
    if (!this.defaultNormalTexture) {
      const tex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
      tex.needsUpdate = true;
      this.defaultNormalTexture = tex;
    }
    return this.defaultNormalTexture;
  }

  /**
   * Hi3D's custom Blinn-Phong + screen-space normal map perturbation clay shader ('white' mode).
   */
  applySolidMaterial() {
    const defaultNorm = this._getDefaultNormalTexture();
    const createSolidShader = (normalMap, normalScale) =>
      new THREE.ShaderMaterial({
        uniforms: {
          baseColor: { value: new THREE.Color(1, 1, 1).multiplyScalar(0.5) },
          shininess: { value: 109.0 },
          normalMap: { value: normalMap ?? defaultNorm },
          useNormalMap: { value: normalMap ? 1.0 : 0.0 },
          normalScale: { value: normalScale ? normalScale.clone() : new THREE.Vector2(1, 1) }
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          varying vec2 vUv;

          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 baseColor;
          uniform float shininess;
          uniform sampler2D normalMap;
          uniform float useNormalMap;
          uniform vec2 normalScale;

          varying vec3 vNormal;
          varying vec3 vViewPosition;
          varying vec2 vUv;

          vec3 perturbNormalFromMap(vec3 eyePos, vec3 surfNormal, vec3 mapN, vec2 uv) {
            vec3 q0 = dFdx(eyePos);
            vec3 q1 = dFdy(eyePos);
            vec2 st0 = dFdx(uv);
            vec2 st1 = dFdy(uv);

            vec3 N = surfNormal;
            vec3 q1perp = cross(q1, N);
            vec3 q0perp = cross(N, q0);

            vec3 T = q1perp * st0.x + q0perp * st1.x;
            vec3 B = q1perp * st0.y + q0perp * st1.y;

            float det = max(dot(T, T), dot(B, B));
            float scale = det == 0.0 ? 0.0 : inversesqrt(det);

            return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);
          }

          void main() {
            vec3 norm = normalize(vNormal);
            vec3 mapN = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
            mapN.xy *= normalScale;
            vec3 perturbedNorm = perturbNormalFromMap(-vViewPosition, norm, mapN, vUv);
            norm = mix(norm, perturbedNorm, useNormalMap);

            vec3 lightDir = normalize(vViewPosition);
            vec3 viewDir = normalize(vViewPosition);

            float diff = max(dot(norm, lightDir), 0.0);
            vec3 diffuse = diff * baseColor;

            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(norm, halfDir), 0.0), shininess);
            vec3 specular = baseColor * spec;

            vec3 ambient = baseColor * 0.1;
            vec3 result = ambient + diffuse + specular;
            gl_FragColor = vec4(result, 1.0);
          }
        `
      });

    const sharedMat = createSolidShader(null, new THREE.Vector2(1, 1));
    this.meshes.forEach((mesh) => {
      mesh.material = sharedMat;
    });
  }

  setRoughnessParams(scale, contrast) {
    this.roughnessScale = scale;
    this.roughnessContrast = contrast;
  }

  setMetalnessParams(scale, contrast) {
    this.metalnessScale = scale;
    this.metalnessContrast = contrast;
  }

  applyRoughMetalScale() {
    const updateMat = (mat) => {
      if (mat instanceof Hi3DPBRMaterial) {
        mat.userData.uRoughStrength.value = this.roughnessScale;
        mat.userData.uRoughContrast.value = this.roughnessContrast;
        mat.userData.uMetalStrength.value = this.metalnessScale;
        mat.userData.uMetalContrast.value = this.metalnessContrast;
      }
    };
    this.meshes.forEach((mesh) => {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(updateMat);
      } else if (mesh.material) {
        updateMat(mesh.material);
      }
    });
  }

  createWireframeGeo(geometry) {
    const bary = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1)
    ];
    const pos = geometry.attributes.position;
    const norm = geometry.attributes.normal;
    const outGeo = new THREE.BufferGeometry();

    if (geometry.index) {
      const count = geometry.index.count;
      const idxArr = geometry.index.array;
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const centers = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const vi = idxArr[i];
        positions[i * 3] = pos.getX(vi);
        positions[i * 3 + 1] = pos.getY(vi);
        positions[i * 3 + 2] = pos.getZ(vi);

        normals[i * 3] = norm.getX(vi);
        normals[i * 3 + 1] = norm.getY(vi);
        normals[i * 3 + 2] = norm.getZ(vi);

        bary[i % 3].toArray(centers, i * 3);
      }
      outGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      outGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
      outGeo.setAttribute('center', new THREE.BufferAttribute(centers, 3));
    } else {
      const count = pos.count;
      const centers = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        bary[i % 3].toArray(centers, i * 3);
      }
      outGeo.setAttribute('position', pos.clone());
      outGeo.setAttribute('normal', norm.clone());
      outGeo.setAttribute('center', new THREE.BufferAttribute(centers, 3));
    }
    return outGeo;
  }

  getOrCreateWireframe(mesh) {
    const cached = this.wireframeCache.get(mesh.id);
    if (cached) return cached;

    const geo = this.createWireframeGeo(mesh.geometry);
    const mat = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: 1.0 } },
      vertexShader: `
        attribute vec3 center;
        varying vec3 vCenter;
        varying float vDepth;

        void main() {
          vCenter = center;
          vec3 movedPosition = position + normal * 0.0002;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(movedPosition, 1.0);
          vDepth = gl_Position.w;
        }
      `,
      fragmentShader: `
        uniform float thickness;
        varying vec3 vCenter;
        varying float vDepth;

        void main() {
          vec3 afwidth = fwidth(vCenter.xyz);
          float clampedDepth = clamp(vDepth, 2.0, 10.0);
          float finalThickness = thickness * (1.0 / clampedDepth);
          vec3 edge3 = smoothstep((finalThickness - 0.15) * afwidth, (finalThickness + 0.15) * afwidth, vCenter.xyz);
          float edge = 1.0 - min(min(edge3.x, edge3.y), edge3.z);

          if (edge <= 0.0) discard;

          float alpha = mix(1.0, 0.0, (clamp(vDepth, 3.0, 10.0) - 3.0) / 7.0);
          gl_FragColor = vec4(0.15, 0.15, 0.15, edge * alpha);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true
    });

    const wireMesh = new THREE.Mesh(geo, mat);
    wireMesh.name = `${mesh.name || 'mesh'}_wireframe`;
    wireMesh.renderOrder = 1;
    this.wireframeCache.set(mesh.id, wireMesh);
    return wireMesh;
  }

  addWireframeOverlay() {
    this.meshes.forEach((mesh) => {
      const wire = this.getOrCreateWireframe(mesh);
      wire.position.copy(mesh.position);
      wire.rotation.copy(mesh.rotation);
      wire.scale.copy(mesh.scale);
      if (mesh.parent && !wire.parent) {
        mesh.parent.add(wire);
      }
    });
  }

  removeWireframeOverlay() {
    this.meshes.forEach((mesh) => {
      const wire = this.wireframeCache.get(mesh.id);
      if (wire && wire.parent) {
        wire.parent.remove(wire);
      }
    });
  }

  dispose() {
    this.wireframeCache.forEach((wire) => {
      if (wire.parent) wire.parent.remove(wire);
      wire.geometry?.dispose();
      wire.material?.dispose();
    });
    this.wireframeCache.clear();
    this.defaultNormalTexture?.dispose();
    this.defaultNormalTexture = null;
  }
}

/**
 * Custom exponential-fade floor grid reverse-engineered from Hi3D (-XfPQp6xe4X7d3jv.js).
 */
class Hi3DGridMaterial extends THREE.LineBasicMaterial {
  constructor(parameters) {
    super(parameters);
    this.onBeforeCompile = this._onBeforeCompile.bind(this);
    this.customProgramCacheKey = () => 'hi3d_custom_grids_material';
  }

  _onBeforeCompile(shader) {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `
      varying vec3 vWorldPosition;
      void main() {
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vWorldPosition = transformed;
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `
      varying vec3 vWorldPosition;
      void main() {
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      #include <opaque_fragment>
      float vDistance = length(vWorldPosition);
      float clampedDistance = max(0.0, vDistance - 3.0);
      gl_FragColor.a = exp(-clampedDistance * 0.35);
      `
    );
  }
}

export class Hi3DFloorGrid {
  constructor(scene) {
    this.scene = scene;
    const size = 100;
    const step = 0.1;
    const half = size / 2;
    const divisions = size / step;
    const majorColor = new THREE.Color(0x4c4c4c); // 5000268
    const minorColor = new THREE.Color(0x3a3a3a); // 3815994

    const vertexCount = (divisions + 1) * 4;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0, cIdx = 0, coord = -half; i <= divisions; i++, coord += step) {
      positions[i * 12] = -half;
      positions[i * 12 + 1] = 0;
      positions[i * 12 + 2] = coord;
      positions[i * 12 + 3] = half;
      positions[i * 12 + 4] = 0;
      positions[i * 12 + 5] = coord;

      positions[i * 12 + 6] = coord;
      positions[i * 12 + 7] = 0;
      positions[i * 12 + 8] = -half;
      positions[i * 12 + 9] = coord;
      positions[i * 12 + 10] = 0;
      positions[i * 12 + 11] = half;

      const col = i % 10 === 0 ? majorColor : minorColor;
      for (let k = 0; k < 4; k++) {
        col.toArray(colors, cIdx);
        cIdx += 3;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new Hi3DGridMaterial({
      vertexColors: true,
      transparent: true,
      toneMapped: false
    });

    this.floorGrids = new THREE.LineSegments(geometry, material);
    this.floorGrids.position.set(0, -0.5, 0);
    this.floorGrids.renderOrder = 20;
    this.scene.add(this.floorGrids);
  }

  setVisibility(visible) {
    if (this.floorGrids) {
      this.floorGrids.visible = visible;
    }
  }

  dispose() {
    if (this.floorGrids) {
      this.floorGrids.geometry.dispose();
      this.floorGrids.material.dispose();
      this.scene.remove(this.floorGrids);
      this.floorGrids = null;
    }
  }
}
