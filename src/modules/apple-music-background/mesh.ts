/**
 * 从 Lyricify-Backgrounds AppleMusicIosMesh.cs 改写为 TypeScript 数组运算。
 * 来源提交：bdd31b5c5f678bbdf8946c6258883291f6b58657；Apache-2.0。
 * 保留默认网格，省略本项目未提供的自定义控制点重采样配置。
 */
import * as presets from "./presets";

export type BackgroundVariant = "modern" | "classic";

/**
 * 结构化 Catmull-Clark 细分；固定角点，边界使用三次曲线权重，避免网格边缘收缩。
 * @param source - 行优先排列的二维控制点
 * @param size - 每边的控制点数
 * @returns 一次细分后的控制点
 */
export function subdivide(source: Float32Array, size: number): Float32Array {
  const nextSize = size * 2 - 1;
  const result = new Float32Array(nextSize * nextSize * 2);
  const faces = new Float32Array((size - 1) ** 2 * 2);
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      for (let axis = 0; axis < 2; axis++) {
        const p = (row * size + col) * 2 + axis;
        faces[(row * (size - 1) + col) * 2 + axis] =
          (source[p] + source[p + 2] + source[p + size * 2] + source[p + size * 2 + 2]) / 4;
      }
    }
  }
  for (let row = 0; row < nextSize; row++) {
    for (let col = 0; col < nextSize; col++) {
      const r = Math.floor(row / 2);
      const c = Math.floor(col / 2);
      for (let axis = 0; axis < 2; axis++) {
        const p = (r * size + c) * 2 + axis;
        const f = (r * (size - 1) + c) * 2 + axis;
        let value: number;
        if (row % 2 && col % 2) {
          value = faces[f];
        } else if (col % 2) {
          value =
            row === 0 || row === nextSize - 1
              ? (source[p] + source[p + 2]) / 2
              : (source[p] + source[p + 2] + faces[f] + faces[f - (size - 1) * 2]) / 4;
        } else if (row % 2) {
          value =
            col === 0 || col === nextSize - 1
              ? (source[p] + source[p + size * 2]) / 2
              : (source[p] + source[p + size * 2] + faces[f] + faces[f - 2]) / 4;
        } else {
          const boundaryRow = r === 0 || r === size - 1;
          const boundaryCol = c === 0 || c === size - 1;
          if (boundaryRow && boundaryCol) value = source[p];
          else if (boundaryRow) value = (source[p - 2] + 6 * source[p] + source[p + 2]) / 8;
          else if (boundaryCol)
            value = (source[p - size * 2] + 6 * source[p] + source[p + size * 2]) / 8;
          else {
            const faceAverage =
              (faces[f] + faces[f - 2] + faces[f - (size - 1) * 2] + faces[f - size * 2]) / 4;
            const edgeAverage =
              (4 * source[p] +
                source[p - 2] +
                source[p + 2] +
                source[p - size * 2] +
                source[p + size * 2]) /
              8;
            value = (faceAverage + 2 * edgeAverage + source[p]) / 4;
          }
        }
        result[(row * nextSize + col) * 2 + axis] = value;
      }
    }
  }
  return result;
}

/**
 * 从参考项目的五个槽位构造 GPU 网格；不缓存布局，生命周期由渲染器管理。
 * @param variant - 新版使用两次细分，经典版使用三次
 * @param portrait - 是否为竖向布局
 * @param slot - 初始化时选取的槽位，范围为 0 至 4
 * @returns 交错排列的 from/to/UV 顶点与三角形索引；UV 沿用参考项目上原点约定
 */
export function createMesh(variant: BackgroundVariant, portrait: boolean, slot: number) {
  const portraitIndex = [0, 1, 2, 2, 3][slot];
  let size = portrait ? 6 : 9;
  let from: Float32Array;
  let to: Float32Array;
  if (portrait) {
    from = [presets.Preset0From, presets.Preset1From, presets.Preset2From, presets.Preset3From][
      portraitIndex
    ];
    to = [presets.Preset0To, presets.Preset1To, presets.Preset2To, presets.Preset3To][
      portraitIndex
    ];
  } else {
    from = new Float32Array(size * size * 2);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        from[(row * size + col) * 2] = col / (size - 1);
        from[(row * size + col) * 2 + 1] = row / (size - 1);
      }
    }
    to = [
      presets.LandscapePreset0To,
      presets.LandscapePreset1To,
      presets.LandscapePreset2To,
      presets.LandscapePreset3To,
      presets.LandscapePreset4To,
    ][slot];
  }
  for (let level = 0; level < (variant === "modern" ? 2 : 3); level++) {
    from = subdivide(from, size);
    to = subdivide(to, size);
    size = size * 2 - 1;
  }
  const vertices = new Float32Array(size * size * 6);
  const indices = new Uint16Array((size - 1) ** 2 * 6);
  let index = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const point = row * size + col;
      vertices.set(
        [
          from[point * 2] * 2 - 1,
          from[point * 2 + 1] * 2 - 1,
          to[point * 2] * 2 - 1,
          to[point * 2 + 1] * 2 - 1,
          col / (size - 1),
          1 - row / (size - 1),
        ],
        point * 6,
      );
      if (row < size - 1 && col < size - 1) {
        indices.set(
          [point, point + size, point + size + 1, point + size + 1, point + 1, point],
          index,
        );
        index += 6;
      }
    }
  }
  return { vertices, indices };
}
