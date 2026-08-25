export interface AppleMusicBackgroundMesh {
  vertices: Float32Array;
  indices: Uint16Array;
}

const PRESET_COUNT = 5;
const MAX_RUNTIME_DEFORMATION = 1.65;
const PHASE_SAMPLES = 12;
const MIN_TRIANGLE_AREA = 0.00001;

const getPresetOffset = (preset: number, x: number, y: number): [number, number] => {
  const waveX = Math.sin((x * 1.7 + y * 0.9 + preset * 0.37) * Math.PI);
  const waveY = Math.cos((y * 1.55 - x * 0.72 + preset * 0.41) * Math.PI);
  const swirlX = -(y - 0.5) * (0.65 + preset * 0.06);
  const swirlY = (x - 0.5) * (0.58 + preset * 0.05);
  const radial = Math.sin((Math.hypot(x - 0.5, y - 0.5) * 3.2 + preset * 0.23) * Math.PI);
  const direction = preset % 2 === 0 ? 1 : -1;
  return [
    (waveX * 0.32 + swirlX * 0.26 + radial * (x - 0.5) * 0.22) * direction,
    (waveY * 0.3 + swirlY * 0.23 + radial * (y - 0.5) * 0.2) * (preset < 3 ? 1 : -1),
  ];
};

/** 依据封面标识选择稳定的形变预设。 */
export const selectAppleMusicBackgroundPreset = (identity: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % PRESET_COUNT;
};

/** 创建在两组控制点之间往返形变的规则网格。 */
export const createAppleMusicBackgroundMesh = (
  columns = 9,
  rows = 6,
  preset = 0,
): AppleMusicBackgroundMesh => {
  const width = Math.max(2, Math.floor(columns));
  const height = Math.max(2, Math.floor(rows));
  const normalizedPreset = ((Math.floor(preset) % PRESET_COUNT) + PRESET_COUNT) % PRESET_COUNT;
  const vertices = new Float32Array((width + 1) * (height + 1) * 6);
  const indices = new Uint16Array(width * height * 6);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (let row = 0; row <= height; row++) {
    const v = row / height;
    for (let column = 0; column <= width; column++) {
      const u = column / width;
      const baseX = (u * 2 - 1) * 1.08;
      const baseY = (v * 2 - 1) * 1.08;
      const edgeFade = Math.pow(Math.sin(u * Math.PI) * Math.sin(v * Math.PI), 0.58);
      const [fromOffsetX, fromOffsetY] = getPresetOffset(normalizedPreset, u, v);
      const [toOffsetX, toOffsetY] = getPresetOffset(
        (normalizedPreset + 2) % PRESET_COUNT,
        1 - u,
        v,
      );

      vertices[vertexOffset++] = baseX + fromOffsetX * edgeFade;
      vertices[vertexOffset++] = baseY + fromOffsetY * edgeFade;
      vertices[vertexOffset++] = baseX + toOffsetX * edgeFade;
      vertices[vertexOffset++] = baseY + toOffsetY * edgeFade;
      vertices[vertexOffset++] = u;
      vertices[vertexOffset++] = v;
    }
  }

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const bottomLeft = row * (width + 1) + column;
      const bottomRight = bottomLeft + 1;
      const topLeft = bottomLeft + width + 1;
      const topRight = topLeft + 1;
      indices[indexOffset++] = bottomLeft;
      indices[indexOffset++] = topLeft;
      indices[indexOffset++] = topRight;
      indices[indexOffset++] = topRight;
      indices[indexOffset++] = bottomRight;
      indices[indexOffset++] = bottomLeft;
    }
  }

  const getPosition = (index: number, phase: number, scale: number): [number, number] => {
    const offset = index * 6;
    const u = vertices[offset + 4];
    const v = vertices[offset + 5];
    const baseX = (u * 2 - 1) * 1.08;
    const baseY = (v * 2 - 1) * 1.08;
    const fromX = baseX + (vertices[offset] - baseX) * scale;
    const fromY = baseY + (vertices[offset + 1] - baseY) * scale;
    const toX = baseX + (vertices[offset + 2] - baseX) * scale;
    const toY = baseY + (vertices[offset + 3] - baseY) * scale;
    return [fromX + (toX - fromX) * phase, fromY + (toY - fromY) * phase];
  };

  const isStableScale = (scale: number): boolean => {
    for (let sample = 0; sample <= PHASE_SAMPLES; sample++) {
      const phase = sample / PHASE_SAMPLES;
      for (let index = 0; index < indices.length; index += 3) {
        const first = getPosition(indices[index], phase, scale);
        const second = getPosition(indices[index + 1], phase, scale);
        const third = getPosition(indices[index + 2], phase, scale);
        const area =
          (second[0] - first[0]) * (third[1] - first[1]) -
          (second[1] - first[1]) * (third[0] - first[0]);
        if (area >= -MIN_TRIANGLE_AREA) return false;
      }
    }
    return true;
  };

  let safeScale = 1;
  while (!isStableScale(safeScale * MAX_RUNTIME_DEFORMATION) && safeScale > 0.2) {
    safeScale *= 0.9;
  }
  for (let offset = 0; offset < vertices.length; offset += 6) {
    const baseX = (vertices[offset + 4] * 2 - 1) * 1.08;
    const baseY = (vertices[offset + 5] * 2 - 1) * 1.08;
    vertices[offset] = baseX + (vertices[offset] - baseX) * safeScale;
    vertices[offset + 1] = baseY + (vertices[offset + 1] - baseY) * safeScale;
    vertices[offset + 2] = baseX + (vertices[offset + 2] - baseX) * safeScale;
    vertices[offset + 3] = baseY + (vertices[offset + 3] - baseY) * safeScale;
  }

  return { vertices, indices };
};
