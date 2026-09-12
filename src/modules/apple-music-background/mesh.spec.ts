import { describe, expect, it } from "vitest";
import { createMesh, subdivide } from "./mesh";

describe("Lyricify 背景网格移植", () => {
  it("细分保留平面网格及四角", () => {
    const grid = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    expect(Array.from(subdivide(grid, 2))).toEqual([
      0, 0, 0.5, 0, 1, 0, 0, 0.5, 0.5, 0.5, 1, 0.5, 0, 1, 0.5, 1, 1, 1,
    ]);
  });

  it("曲面细分遵守边界与内部权重", () => {
    const grid = new Float32Array([0, 0, 1, 0, 2, 0, 0, 1, 1, 3, 2, 1, 0, 2, 1, 2, 2, 2]);
    const result = subdivide(grid, 3);
    expect(Array.from(result.slice(24, 26))).toEqual([1, 2.125]);
    expect(Array.from(result.slice(4, 6))).toEqual([1, 0]);
    expect(Array.from(result.slice(14, 16))).toEqual([1, 1.25]);
    expect(Array.from(result.slice(12, 14))).toEqual([0.5, 1]);
  });

  for (const variant of ["modern", "classic"] as const) {
    for (const portrait of [true, false]) {
      for (let slot = 0; slot < 5; slot++) {
        it(`${variant}/${portrait ? "竖屏" : "横屏"}/${slot} 顶点数量、UV 和索引正确`, () => {
          const { vertices, indices } = createMesh(variant, portrait, slot);
          const side = (portrait ? 5 : 8) * (variant === "modern" ? 4 : 8) + 1;
          expect(vertices.length).toBe(side * side * 6);
          expect(indices.length).toBe((side - 1) ** 2 * 6);
          expect(Array.from(vertices).every(Number.isFinite)).toBe(true);
          expect(Math.max(...indices)).toBe(side * side - 1);
          expect(Array.from(vertices.slice(4, 6))).toEqual([0, 1]);
          expect(Array.from(vertices.slice(-2))).toEqual([1, 0]);
          expect(Array.from(indices.slice(0, 6))).toEqual([0, side, side + 1, side + 1, 1, 0]);
        });
      }
    }
  }

  it("竖屏第 2、3 槽位共享形态，而横屏保持独立", () => {
    expect(createMesh("modern", true, 2)).toEqual(createMesh("modern", true, 3));
    expect(createMesh("modern", false, 2).vertices).not.toEqual(
      createMesh("modern", false, 3).vertices,
    );
  });

  it("保留参考网格越界角点，不能钳制为单位正方形", () => {
    for (const variant of ["modern", "classic"] as const) {
      const portrait = createMesh(variant, true, 4).vertices;
      expect(portrait[0]).toBeCloseTo(-1.4702, 5);
      expect(portrait[1]).toBeCloseTo(-1.1934, 5);
      const landscape = createMesh(variant, false, 0).vertices;
      expect(Array.from(landscape.slice(0, 2))).toEqual([-1, -1]);
      expect(landscape[2]).toBeCloseTo(-1.4584, 5);
      expect(landscape[3]).toBeCloseTo(-1.1058, 5);
    }
  });
});
