import {
  createAppleMusicBackgroundAudioSmoother,
  getAppleMusicBackgroundMotion,
  normalizeAppleMusicBackgroundAudio,
} from "./audio";
import {
  BETA_COMPOSITE_FRAGMENT_SHADER,
  DEV_COMPOSITE_FRAGMENT_SHADER,
  DUAL_KAWASE_DOWNSAMPLE_FRAGMENT_SHADER,
  DUAL_KAWASE_UPSAMPLE_FRAGMENT_SHADER,
  FULLSCREEN_VERTEX_SHADER,
  MATERIAL_FRAGMENT_SHADER,
} from "./shaders";
import type {
  AppleMusicBackgroundOptions,
  AppleMusicBackgroundRenderer,
  AppleMusicBackgroundVariant,
} from "./types";

export type {
  AppleMusicBackgroundAlbum,
  AppleMusicBackgroundAudio,
  AppleMusicBackgroundOptions,
  AppleMusicBackgroundRenderer,
  AppleMusicBackgroundVariant,
} from "./types";
export {
  createAppleMusicBackgroundAudioAnalyzer,
  createAppleMusicBackgroundAudioSmoother,
  getAppleMusicBackgroundMotion,
  normalizeAppleMusicBackgroundAudio,
} from "./audio";
export { createAppleMusicBackgroundMesh, selectAppleMusicBackgroundPreset } from "./mesh";

const ARTWORK_TRANSITION_MS = 1800;
const MAX_BLUR_LEVELS = 5;

interface ProgramInfo {
  program: WebGLProgram;
  attributes: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface AlbumSlot {
  texture: WebGLTexture;
  width: number;
  height: number;
  seed: number;
}

interface BlurLevel {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface PendingAlbumUpload {
  source: TexImageSource;
  identity: string;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const smoothstep = (value: number): number => {
  const normalized = clamp01(value);
  return normalized * normalized * (3 - 2 * normalized);
};

const normalizeVariant = (
  value: AppleMusicBackgroundVariant | undefined,
): AppleMusicBackgroundVariant => (value === "beta" ? "beta" : "dev");

export const isAppleMusicBackgroundBitmapUrl = (src: string): boolean =>
  /^(cache|streaming-cover):/i.test(src);

/** 计算 Dual Kawase 每层采样偏移。 */
export const getAppleMusicBackgroundBlurScale = (
  renderScale: number,
  blurLevel: number,
): number => {
  const strengths = [0.7, 1.5, 2.5, 3] as const;
  const strength = strengths[Math.round(clamp(blurLevel, 0, 3, 2))];
  return (0.82 + strength * 0.68) * Math.sqrt(clamp(renderScale, 0.2, 1, 0.5));
};

/** 依据模糊设置选择固定上限内的降采样层数。 */
export const getAppleMusicBackgroundBlurPassCount = (blurLevel: number): number =>
  Math.round(clamp(blurLevel, 0, 3, 2)) + 2;

/** 将跳动幅度映射为克制但可见的缩放脉冲，最大值对应约 3% 放大。 */
export const getAppleMusicBackgroundPulse = (pulse: number, beatStrength: number): number => {
  const strength = clamp(beatStrength, 0.25, 2.5, 1);
  const maximum = 0.1 + ((strength - 0.25) / 2.25) * 0.15;
  return Math.min(0.25, clamp01(pulse) * maximum);
};

/** 将封面标识转换为稳定布局种子。 */
export const getAppleMusicBackgroundSeed = (identity: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

/** 计算一维平方距离变换，并记录每个位置对应的最近源位置。 */
const transformDistanceLine = (
  costs: Float64Array,
  length: number,
  distances: Float64Array,
  nearest: Int32Array,
  sites: Int32Array,
  boundaries: Float64Array,
): void => {
  let envelope = 0;
  sites[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;

  for (let position = 1; position < length; position++) {
    let site = sites[envelope];
    let intersection =
      (costs[position] + position * position - costs[site] - site * site) /
      (2 * position - 2 * site);
    while (envelope > 0 && intersection <= boundaries[envelope]) {
      envelope--;
      site = sites[envelope];
      intersection =
        (costs[position] + position * position - costs[site] - site * site) /
        (2 * position - 2 * site);
    }
    envelope++;
    sites[envelope] = position;
    boundaries[envelope] = intersection;
    boundaries[envelope + 1] = Number.POSITIVE_INFINITY;
  }

  envelope = 0;
  for (let position = 0; position < length; position++) {
    while (boundaries[envelope + 1] < position) envelope++;
    const site = sites[envelope];
    const delta = position - site;
    distances[position] = delta * delta + costs[site];
    nearest[position] = site;
  }
};

/** 用欧氏距离最近的不透明像素填充透明区域，避免形变采样出现空洞。 */
export const fillTransparentAlbumPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): boolean => {
  const pixelCount = width * height;
  if (pixelCount <= 0 || pixels.length < pixelCount * 4) return false;
  let opaqueCount = 0;

  for (let index = 0; index < pixelCount; index++) {
    if (pixels[index * 4 + 3] > 4) opaqueCount++;
  }
  if (opaqueCount === pixelCount) return false;
  if (opaqueCount === 0) {
    for (let index = 0; index < pixelCount; index++) {
      const offset = index * 4;
      pixels[offset] = 24;
      pixels[offset + 1] = 22;
      pixels[offset + 2] = 30;
      pixels[offset + 3] = 255;
    }
    return true;
  }

  const maxDistance = width * width + height * height + 1;
  const verticalDistances = new Float64Array(pixelCount);
  const verticalSources = new Int32Array(pixelCount);
  const lineLength = Math.max(width, height);
  const costs = new Float64Array(lineLength);
  const distances = new Float64Array(lineLength);
  const nearest = new Int32Array(lineLength);
  const sites = new Int32Array(lineLength);
  const boundaries = new Float64Array(lineLength + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      costs[y] = pixels[(y * width + x) * 4 + 3] > 4 ? 0 : maxDistance;
    }
    transformDistanceLine(costs, height, distances, nearest, sites, boundaries);
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      verticalDistances[index] = distances[y];
      verticalSources[index] = nearest[y] * width + x;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) costs[x] = verticalDistances[y * width + x];
    transformDistanceLine(costs, width, distances, nearest, sites, boundaries);
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const offset = index * 4;
      if (pixels[offset + 3] > 4) continue;
      const sourceOffset = verticalSources[y * width + nearest[x]] * 4;
      pixels[offset] = pixels[sourceOffset];
      pixels[offset + 1] = pixels[sourceOffset + 1];
      pixels[offset + 2] = pixels[sourceOffset + 2];
      pixels[offset + 3] = 255;
    }
  }
  return true;
};

const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建 Apple Music 背景着色器");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "未知着色器错误";
    gl.deleteShader(shader);
    throw new Error(`Apple Music 背景着色器编译失败：${message}`);
  }
  return shader;
};

const createProgram = (
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attributes: string[],
  uniforms: string[],
): ProgramInfo => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建 Apple Music 背景渲染程序");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "未知程序错误";
    gl.deleteProgram(program);
    throw new Error(`Apple Music 背景着色器链接失败：${message}`);
  }
  return {
    program,
    attributes: Object.fromEntries(
      attributes.map((name) => [name, gl.getAttribLocation(program, name)]),
    ),
    uniforms: Object.fromEntries(
      uniforms.map((name) => [name, gl.getUniformLocation(program, name)]),
    ),
  };
};

const createTexture = (gl: WebGLRenderingContext): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("无法创建 Apple Music 背景纹理");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

const allocateTexture = (
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
): void => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
};

const getSourceSize = (source: TexImageSource): { width: number; height: number } => {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  const sized = source as TexImageSource & {
    width?: number;
    height?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  return {
    width: sized.width ?? sized.displayWidth ?? 1,
    height: sized.height ?? sized.displayHeight ?? 1,
  };
};

/** 将封面约束为 300px 纹理，并在上传前填平透明区域。 */
const prepareAlbumSource = (source: TexImageSource): TexImageSource => {
  const size = getSourceSize(source);
  const scale = Math.min(1, 300 / Math.max(1, size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  try {
    context.drawImage(source as CanvasImageSource, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    if (fillTransparentAlbumPixels(image.data, width, height)) context.putImageData(image, 0, 0);
    return canvas;
  } catch {
    return source;
  }
};

/** 创建全屏强扭曲与四象限动态合成共用的 WebGL 背景管线。 */
export const createAppleMusicBackgroundRenderer = (
  options: AppleMusicBackgroundOptions = {},
): AppleMusicBackgroundRenderer => {
  let variant = normalizeVariant(options.variant);
  let renderScale = clamp(options.renderScale ?? 0.5, 0.2, 1, 0.5);
  let frameInterval = 1_000 / clamp(options.fps ?? 30, 1, 120, 30);
  let flowSpeed = clamp(options.flowSpeed ?? 1, 0.5, 2.5, 1);
  let distortion = clamp(options.distortion ?? 1, 0, 2, 1);
  let blurLevel = Math.round(clamp(options.blurLevel ?? 2, 0, 3, 2));
  let beatStrength = clamp(options.beatStrength ?? 1, 0.25, 2.5, 1);
  let darkOverlay = clamp01(options.darkOverlay ?? 0.1);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;";

  let container: HTMLElement | undefined;
  let gl: WebGLRenderingContext | null = null;
  let devCompositeProgram: ProgramInfo | null = null;
  let betaCompositeProgram: ProgramInfo | null = null;
  let downsampleProgram: ProgramInfo | null = null;
  let upsampleProgram: ProgramInfo | null = null;
  let materialProgram: ProgramInfo | null = null;
  let quadBuffer: WebGLBuffer | null = null;
  let sceneTexture: WebGLTexture | null = null;
  let sceneFramebuffer: WebGLFramebuffer | null = null;
  let blurLevels: BlurLevel[] = [];
  let albumSlots: AlbumSlot[] = [];
  let currentSlot = 0;
  let previousSlot = 0;
  let hasAlbum = false;
  let resizeObserver: ResizeObserver | undefined;
  let rafId: number | undefined;
  let nextFrameAt = 0;
  let motionTime = 0;
  let lastMotionAt = performance.now();
  let playing = false;
  let presentationVisible = true;
  let disposed = false;
  let contextLost = false;
  let transitionStartedAt = 0;
  let transitionActive = false;
  let transitionPausedElapsed = 0;
  let albumLoadToken = 0;
  let pendingImage: HTMLImageElement | undefined;
  let pendingAlbumUpload: PendingAlbumUpload | undefined;
  let currentAlbumSource: TexImageSource | undefined;
  let currentAlbumIdentity = "";
  let audio = normalizeAppleMusicBackgroundAudio({});
  const audioSmoother = createAppleMusicBackgroundAudioSmoother();
  let lastDrawAt = performance.now();

  const smoothAudio = (now: number): typeof audio => {
    const elapsed = Math.min(100, Math.max(1, now - lastDrawAt));
    lastDrawAt = now;
    return audioSmoother.update(audio, elapsed);
  };

  const closeBitmap = (source: TexImageSource | undefined): void => {
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
  };

  const bindTexture = (
    unit: number,
    texture: WebGLTexture,
    location: WebGLUniformLocation | null,
  ): void => {
    if (!gl) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  };

  const bindFullscreenQuad = (program: ProgramInfo): void => {
    if (!gl || !quadBuffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
  };

  const createCompositeProgram = (fragmentShader: string): ProgramInfo =>
    createProgram(
      gl!,
      FULLSCREEN_VERTEX_SHADER,
      fragmentShader,
      ["aPosition"],
      [
        "uCurrentAlbum",
        "uPreviousAlbum",
        "uResolution",
        "uCurrentAlbumSize",
        "uPreviousAlbumSize",
        "uTransition",
        "uTime",
        "uPulse",
        "uFlow",
        "uDisplacement",
        "uDistortion",
        "uSeed",
      ],
    );

  const initialize = (): void => {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("当前设备不支持 Apple Music 背景所需的 WebGL");

    devCompositeProgram = createCompositeProgram(DEV_COMPOSITE_FRAGMENT_SHADER);
    betaCompositeProgram = createCompositeProgram(BETA_COMPOSITE_FRAGMENT_SHADER);
    downsampleProgram = createProgram(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      DUAL_KAWASE_DOWNSAMPLE_FRAGMENT_SHADER,
      ["aPosition"],
      ["uSource", "uTexel", "uOffset"],
    );
    upsampleProgram = createProgram(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      DUAL_KAWASE_UPSAMPLE_FRAGMENT_SHADER,
      ["aPosition"],
      ["uSource", "uTexel", "uOffset"],
    );
    materialProgram = createProgram(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      MATERIAL_FRAGMENT_SHADER,
      ["aPosition"],
      ["uSource", "uDarkOverlay", "uDetail"],
    );

    quadBuffer = gl.createBuffer();
    sceneFramebuffer = gl.createFramebuffer();
    sceneTexture = createTexture(gl);
    if (!quadBuffer || !sceneFramebuffer) {
      throw new Error("无法创建 Apple Music 背景缓冲区");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    blurLevels = Array.from({ length: MAX_BLUR_LEVELS }, () => {
      const framebuffer = gl!.createFramebuffer();
      if (!framebuffer) throw new Error("无法创建 Apple Music 背景模糊缓冲区");
      return { texture: createTexture(gl!), framebuffer, width: 1, height: 1 };
    });
    albumSlots = [0, 1].map(() => {
      const texture = createTexture(gl!);
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        gl!.RGBA,
        1,
        1,
        0,
        gl!.RGBA,
        gl!.UNSIGNED_BYTE,
        new Uint8Array([24, 22, 30, 255]),
      );
      return { texture, width: 1, height: 1, seed: 0 };
    });
  };

  const drawComposite = (
    program: ProgramInfo,
    current: AlbumSlot,
    previous: AlbumSlot,
    transition: number,
    time: number,
    motion: ReturnType<typeof getAppleMusicBackgroundMotion>,
  ): void => {
    if (!gl || !sceneFramebuffer) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program.program);
    bindFullscreenQuad(program);
    bindTexture(0, current.texture, program.uniforms.uCurrentAlbum);
    bindTexture(1, previous.texture, program.uniforms.uPreviousAlbum);
    gl.uniform2f(program.uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform2f(program.uniforms.uCurrentAlbumSize, current.width, current.height);
    gl.uniform2f(program.uniforms.uPreviousAlbumSize, previous.width, previous.height);
    gl.uniform1f(program.uniforms.uTransition, transition);
    gl.uniform1f(program.uniforms.uTime, time);
    gl.uniform1f(program.uniforms.uPulse, motion.pulse);
    gl.uniform1f(program.uniforms.uFlow, motion.flow);
    gl.uniform1f(program.uniforms.uDisplacement, motion.displacement);
    gl.uniform1f(program.uniforms.uDistortion, distortion);
    gl.uniform1f(
      program.uniforms.uSeed,
      previous.seed + (current.seed - previous.seed) * transition,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const drawBlur = (): void => {
    if (
      !gl ||
      !sceneTexture ||
      !sceneFramebuffer ||
      !downsampleProgram ||
      !upsampleProgram ||
      blurLevels.length < MAX_BLUR_LEVELS
    ) {
      return;
    }
    const passCount = getAppleMusicBackgroundBlurPassCount(blurLevel);
    const offset = getAppleMusicBackgroundBlurScale(renderScale, blurLevel);
    let sourceTexture = sceneTexture;
    let sourceWidth = canvas.width;
    let sourceHeight = canvas.height;

    gl.useProgram(downsampleProgram.program);
    bindFullscreenQuad(downsampleProgram);
    for (let index = 0; index < passCount; index++) {
      const target = blurLevels[index];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      bindTexture(0, sourceTexture, downsampleProgram.uniforms.uSource);
      gl.uniform2f(downsampleProgram.uniforms.uTexel, 1 / sourceWidth, 1 / sourceHeight);
      gl.uniform1f(downsampleProgram.uniforms.uOffset, offset);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      sourceTexture = target.texture;
      sourceWidth = target.width;
      sourceHeight = target.height;
    }

    gl.useProgram(upsampleProgram.program);
    bindFullscreenQuad(upsampleProgram);
    for (let index = passCount - 1; index >= 0; index--) {
      const source = blurLevels[index];
      const target = index === 0 ? null : blurLevels[index - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? sceneFramebuffer);
      gl.viewport(0, 0, target?.width ?? canvas.width, target?.height ?? canvas.height);
      bindTexture(0, source.texture, upsampleProgram.uniforms.uSource);
      gl.uniform2f(upsampleProgram.uniforms.uTexel, 1 / source.width, 1 / source.height);
      gl.uniform1f(upsampleProgram.uniforms.uOffset, offset);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };

  const drawMaterial = (detail: number): void => {
    if (!gl || !sceneTexture || !materialProgram) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(materialProgram.program);
    bindFullscreenQuad(materialProgram);
    bindTexture(0, sceneTexture, materialProgram.uniforms.uSource);
    gl.uniform1f(materialProgram.uniforms.uDarkOverlay, darkOverlay);
    gl.uniform1f(materialProgram.uniforms.uDetail, detail);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const draw = (now: number): void => {
    if (
      !gl ||
      !devCompositeProgram ||
      !betaCompositeProgram ||
      !sceneTexture ||
      !sceneFramebuffer ||
      albumSlots.length < 2 ||
      disposed ||
      contextLost ||
      !presentationVisible
    ) {
      return;
    }
    if (!hasAlbum) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    const smoothedAudio = smoothAudio(now);
    const baseMotion = getAppleMusicBackgroundMotion(smoothedAudio, flowSpeed);
    const motion = {
      ...baseMotion,
      pulse: getAppleMusicBackgroundPulse(baseMotion.pulse, beatStrength),
      displacement: Math.min(0.05, 0.035 + (baseMotion.displacement - 0.035) * beatStrength * 0.1),
    };
    const rawTransition = transitionActive
      ? clamp01((now - transitionStartedAt) / ARTWORK_TRANSITION_MS)
      : 1;
    const transition = smoothstep(rawTransition);
    const completedTransition = transitionActive && rawTransition >= 1;
    const elapsedSeconds = Math.min(0.1, Math.max(0, now - lastMotionAt)) / 1_000;
    lastMotionAt = now;
    if (playing || transitionActive) {
      const transitionFlowScale = transitionActive
        ? 0.08 + smoothstep((rawTransition - 0.78) / 0.22) * 0.92
        : 1;
      motionTime += elapsedSeconds * motion.flow * transitionFlowScale;
    }
    if (completedTransition) {
      transitionActive = false;
      transitionPausedElapsed = 0;
    }
    const current = albumSlots[currentSlot];
    const previous = albumSlots[previousSlot];

    gl.disable(gl.BLEND);
    drawComposite(
      variant === "beta" ? betaCompositeProgram : devCompositeProgram,
      current,
      previous,
      transition,
      motionTime,
      { ...motion, flow: 1 },
    );
    drawBlur();
    drawMaterial(motion.detail);
    if (completedTransition) flushPendingAlbum();
  };

  const shouldAnimate = (): boolean => presentationVisible && (playing || transitionActive);

  const renderLoop = (now: number): void => {
    rafId = undefined;
    if (!shouldAnimate() || disposed || contextLost) return;
    if (now >= nextFrameAt) {
      nextFrameAt = now - ((now - nextFrameAt) % frameInterval) + frameInterval;
      draw(now);
    }
    if (shouldAnimate() && rafId === undefined) rafId = requestAnimationFrame(renderLoop);
  };

  const startLoop = (): void => {
    if (!shouldAnimate() || disposed || contextLost || rafId !== undefined) return;
    nextFrameAt = performance.now();
    rafId = requestAnimationFrame(renderLoop);
  };

  const stopLoop = (): void => {
    if (rafId === undefined) return;
    cancelAnimationFrame(rafId);
    rafId = undefined;
  };

  const commitAlbum = (source: TexImageSource, identity: string): boolean => {
    if (!gl || disposed || contextLost || albumSlots.length < 2) return false;
    const nextSlot = hasAlbum ? 1 - currentSlot : currentSlot;
    const slot = albumSlots[nextSlot];
    const size = getSourceSize(source);
    gl.bindTexture(gl.TEXTURE_2D, slot.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    slot.width = Math.max(1, size.width);
    slot.height = Math.max(1, size.height);
    slot.seed = hasAlbum ? albumSlots[currentSlot].seed : getAppleMusicBackgroundSeed(identity);
    if (currentAlbumSource !== source) closeBitmap(currentAlbumSource);
    currentAlbumSource = source;
    currentAlbumIdentity = identity;

    if (!hasAlbum) {
      previousSlot = nextSlot;
      currentSlot = nextSlot;
      hasAlbum = true;
      transitionActive = false;
      draw(performance.now());
      return true;
    }
    previousSlot = currentSlot;
    currentSlot = nextSlot;
    transitionStartedAt = performance.now();
    lastMotionAt = transitionStartedAt;
    transitionPausedElapsed = 0;
    transitionActive = true;
    startLoop();
    return true;
  };

  const queueAlbum = (source: TexImageSource, identity: string): void => {
    if (pendingAlbumUpload?.source !== source) closeBitmap(pendingAlbumUpload?.source);
    pendingAlbumUpload = { source, identity };
  };

  const uploadAlbum = (source: TexImageSource, identity: string): boolean => {
    if (!gl || disposed || contextLost || albumSlots.length < 2) return false;
    const preparedSource = prepareAlbumSource(source);
    if (preparedSource !== source) closeBitmap(source);
    source = preparedSource;
    if (transitionActive) {
      if (presentationVisible) {
        queueAlbum(source, identity);
        return true;
      }
      if (pendingAlbumUpload?.source !== source) closeBitmap(pendingAlbumUpload?.source);
      pendingAlbumUpload = undefined;
      transitionActive = false;
      transitionPausedElapsed = 0;
      previousSlot = currentSlot;
    }
    return commitAlbum(source, identity);
  };

  const flushPendingAlbum = (): void => {
    const pending = pendingAlbumUpload;
    if (!pending) return;
    pendingAlbumUpload = undefined;
    try {
      if (!commitAlbum(pending.source, pending.identity)) closeBitmap(pending.source);
    } catch {
      closeBitmap(pending.source);
    }
  };

  const loadAlbumBitmap = async (src: string, token: number): Promise<boolean> => {
    if (typeof createImageBitmap === "undefined") return false;
    let bitmap: ImageBitmap | undefined;
    try {
      const response = await fetch(src);
      if (!response.ok) return false;
      bitmap = await createImageBitmap(await response.blob());
      if (disposed || token !== albumLoadToken) {
        return false;
      }
      const accepted = uploadAlbum(bitmap, src);
      if (accepted) bitmap = undefined;
      return accepted;
    } catch {
      return false;
    } finally {
      bitmap?.close();
    }
  };

  const loadAlbumUrl = async (src: string, token: number): Promise<boolean> => {
    const image = new Image();
    pendingImage = image;
    if (/^(https?|cache|streaming-cover):/i.test(src)) image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = src;
    try {
      await image.decode();
      if (disposed || token !== albumLoadToken) return false;
      return uploadAlbum(image, src);
    } catch {
      // 加载失败时保留当前双纹理，避免切歌过程闪白。
      return false;
    } finally {
      if (pendingImage === image) pendingImage = undefined;
    }
  };

  const clearResources = (loseContext: boolean): void => {
    if (!gl) return;
    albumSlots.forEach((slot) => gl?.deleteTexture(slot.texture));
    blurLevels.forEach((level) => {
      gl?.deleteTexture(level.texture);
      gl?.deleteFramebuffer(level.framebuffer);
    });
    if (sceneTexture) gl.deleteTexture(sceneTexture);
    if (quadBuffer) gl.deleteBuffer(quadBuffer);
    if (sceneFramebuffer) gl.deleteFramebuffer(sceneFramebuffer);
    if (devCompositeProgram) gl.deleteProgram(devCompositeProgram.program);
    if (betaCompositeProgram) gl.deleteProgram(betaCompositeProgram.program);
    if (downsampleProgram) gl.deleteProgram(downsampleProgram.program);
    if (upsampleProgram) gl.deleteProgram(upsampleProgram.program);
    if (materialProgram) gl.deleteProgram(materialProgram.program);
    if (loseContext) gl.getExtension("WEBGL_lose_context")?.loseContext();
    albumSlots = [];
    blurLevels = [];
    devCompositeProgram = null;
    betaCompositeProgram = null;
    downsampleProgram = null;
    upsampleProgram = null;
    materialProgram = null;
    quadBuffer = null;
    sceneTexture = null;
    sceneFramebuffer = null;
  };

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    if (transitionActive) {
      transitionPausedElapsed = clamp(
        performance.now() - transitionStartedAt,
        0,
        ARTWORK_TRANSITION_MS,
        0,
      );
    }
    contextLost = true;
    stopLoop();
  };

  const onContextRestored = (): void => {
    if (disposed) return;
    const restoredSource = currentAlbumSource;
    const restoredIdentity = currentAlbumIdentity;
    const queuedAlbum = pendingAlbumUpload;
    pendingAlbumUpload = undefined;
    contextLost = false;
    hasAlbum = false;
    transitionActive = false;
    transitionPausedElapsed = 0;
    initialize();
    canvas.width = 0;
    canvas.height = 0;
    renderer.resize();
    if (restoredSource) {
      try {
        commitAlbum(restoredSource, restoredIdentity);
      } catch {
        // 保留当前封面来源，等待组件按原 URL 重试。
      }
    }
    if (queuedAlbum) {
      pendingAlbumUpload = queuedAlbum;
      flushPendingAlbum();
    }
    draw(performance.now());
    startLoop();
  };

  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  const renderer: AppleMusicBackgroundRenderer = {
    mount(target) {
      if (disposed) throw new Error("Apple Music 背景已释放");
      if (container === target) return;
      canvas.remove();
      container = target;
      target.appendChild(canvas);
      if (!gl) initialize();
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => renderer.resize());
      resizeObserver.observe(target);
      renderer.resize();
      startLoop();
    },
    async updateAlbum(album) {
      if (disposed) return false;
      const token = ++albumLoadToken;
      if (pendingImage) {
        pendingImage.src = "";
        pendingImage = undefined;
      }
      if (!album || !gl) return false;
      if (typeof album !== "string") {
        try {
          return uploadAlbum(album, `${album.constructor.name}:${token}`);
        } catch {
          return false;
        }
      }
      if (isAppleMusicBackgroundBitmapUrl(album)) {
        const loaded = await loadAlbumBitmap(album, token);
        if (loaded || token !== albumLoadToken) return loaded;
      }
      return loadAlbumUrl(album, token);
    },
    updateAudio(nextAudio) {
      audio = normalizeAppleMusicBackgroundAudio({ ...audio, ...nextAudio });
      if (!playing && !transitionActive) draw(performance.now());
    },
    updateOptions(nextOptions) {
      const nextVariant = normalizeVariant(nextOptions.variant ?? variant);
      const nextRenderScale = clamp(nextOptions.renderScale ?? renderScale, 0.2, 1, renderScale);
      const scaleChanged = nextRenderScale !== renderScale;
      variant = nextVariant;
      renderScale = nextRenderScale;
      frameInterval = 1_000 / clamp(nextOptions.fps ?? 1_000 / frameInterval, 1, 120, 30);
      flowSpeed = clamp(nextOptions.flowSpeed ?? flowSpeed, 0.5, 2.5, flowSpeed);
      distortion = clamp(nextOptions.distortion ?? distortion, 0, 2, distortion);
      blurLevel = Math.round(clamp(nextOptions.blurLevel ?? blurLevel, 0, 3, blurLevel));
      beatStrength = clamp(nextOptions.beatStrength ?? beatStrength, 0.25, 2.5, beatStrength);
      darkOverlay = clamp01(nextOptions.darkOverlay ?? darkOverlay);
      if (scaleChanged) renderer.resize();
      else draw(performance.now());
      startLoop();
    },
    setVisible(nextVisible) {
      if (disposed || presentationVisible === nextVisible) return;
      const now = performance.now();
      if (!nextVisible) {
        if (transitionActive) {
          transitionPausedElapsed = clamp(now - transitionStartedAt, 0, ARTWORK_TRANSITION_MS, 0);
        }
        presentationVisible = false;
        stopLoop();
        return;
      }
      presentationVisible = true;
      if (transitionActive) transitionStartedAt = now - transitionPausedElapsed;
      lastMotionAt = now;
      renderer.resize();
      draw(now);
      startLoop();
    },
    setPlaying(nextPlaying) {
      if (disposed || playing === nextPlaying) return;
      const now = performance.now();
      playing = nextPlaying;
      lastMotionAt = now;
      if (playing) startLoop();
      else {
        if (!transitionActive) stopLoop();
        draw(now);
      }
    },
    resize() {
      if (
        !container ||
        !gl ||
        !sceneTexture ||
        !sceneFramebuffer ||
        blurLevels.length < MAX_BLUR_LEVELS ||
        disposed ||
        contextLost
      ) {
        return;
      }
      const width = Math.max(1, Math.round(container.clientWidth * renderScale));
      const height = Math.max(1, Math.round(container.clientHeight * renderScale));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      allocateTexture(gl, sceneTexture, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);

      let levelWidth = width;
      let levelHeight = height;
      for (const level of blurLevels) {
        levelWidth = Math.max(1, Math.floor(levelWidth / 2));
        levelHeight = Math.max(1, Math.floor(levelHeight / 2));
        level.width = levelWidth;
        level.height = levelHeight;
        allocateTexture(gl, level.texture, levelWidth, levelHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          level.texture,
          0,
        );
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      draw(performance.now());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ++albumLoadToken;
      stopLoop();
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      if (pendingImage) {
        pendingImage.src = "";
        pendingImage = undefined;
      }
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      clearResources(true);
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
      container = undefined;
      gl = null;
      if (typeof ImageBitmap !== "undefined" && currentAlbumSource instanceof ImageBitmap) {
        currentAlbumSource.close();
      }
      if (pendingAlbumUpload?.source !== currentAlbumSource) {
        closeBitmap(pendingAlbumUpload?.source);
      }
      pendingAlbumUpload = undefined;
      currentAlbumSource = undefined;
    },
    getElement: () => canvas,
  };

  return renderer;
};
