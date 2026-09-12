/**
 * 参考 Lyricify-Backgrounds bdd31b5 的 WinUI Renderer 帧管线，改写为 WebGL2。
 * 原作采用 Apache-2.0；许可证与变更说明见根目录 apple-music-background.md。
 */
import { createMesh, type BackgroundVariant } from "./mesh";
import * as shaders from "./shaders";

interface Program {
  handle: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation>;
}
interface Surface {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}
export interface Frame {
  timeMs: number;
  coverMix: number;
  lyricsMix: number;
  rotationScale: number;
  imageScale: number;
  light: boolean;
  renderScale: number;
}

/** 管理固定数量的 GPU 对象；不持有歌曲或 Vue 状态。 */
export class BackgroundGpu {
  private readonly gl: WebGL2RenderingContext;
  private readonly programs: Program[] = [];
  private readonly buffers: WebGLBuffer[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];
  private readonly surfaces: Surface[] = [];
  private readonly covers: WebGLTexture[] = [];
  private readonly portraitSlot = Math.floor(Math.random() * 5);
  private readonly landscapeSlot = Math.floor(Math.random() * 5);
  private portrait: boolean | undefined;
  private indexCount = 0;
  private width = 0;
  private height = 0;
  private surfaceWidth = 0;
  private surfaceHeight = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly variant: BackgroundVariant,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error("WebGL2 不可用");
    this.gl = gl;
    try {
      // 经典材质模糊前会超出 0–1，必须保留浮点值，不能降级为截断色彩的 RGBA8。
      if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("浮点渲染目标不可用");
      for (const [vertex, fragment] of [
        [shaders.artworkVertex, shaders.artworkFragment],
        [shaders.quadVertex, shaders.blurFragment],
        [shaders.quadVertex, shaders.materialFragment],
        [shaders.pinchVertex, shaders.materialFragment],
      ])
        this.programs.push(this.createProgram(vertex, fragment));
      for (let i = 0; i < 2; i++) {
        const vao = gl.createVertexArray();
        this.vaos.push(vao);
        gl.bindVertexArray(vao);
        const buffer = gl.createBuffer();
        this.buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        if (i === 0) {
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]),
            gl.STATIC_DRAW,
          );
          for (let attribute = 0; attribute < 2; attribute++) {
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 16, attribute * 8);
          }
        } else {
          for (let attribute = 0; attribute < 3; attribute++) {
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 24, attribute * 8);
          }
          const indices = gl.createBuffer();
          this.buffers.push(indices);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
        }
      }
      for (let i = 0; i < 4; i++) {
        const texture = this.createTexture();
        const framebuffer = gl.createFramebuffer();
        this.surfaces.push({ texture, framebuffer });
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * 编译并反射固定着色程序，失败时同步回收中间对象。
   * @param vertex - 顶点着色器
   * @param fragment - 片元着色器
   * @returns 程序及其活动 uniform
   */
  private createProgram(vertex: string, fragment: string): Program {
    const gl = this.gl;
    const handle = gl.createProgram();
    const compiled: WebGLShader[] = [];
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type)!;
        compiled.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || "背景着色器编译失败");
        gl.attachShader(handle, shader);
      }
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(handle) || "背景着色器链接失败");
      const uniforms: Program["uniforms"] = {};
      for (let i = 0; i < gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); i++) {
        const name = gl.getActiveUniform(handle, i)!.name;
        uniforms[name] = gl.getUniformLocation(handle, name)!;
      }
      return { handle, uniforms };
    } catch (error) {
      gl.deleteProgram(handle);
      throw error;
    } finally {
      for (const shader of compiled) gl.deleteShader(shader);
    }
  }

  /** @returns 使用线性过滤和边缘钳制、由调用者拥有的纹理 */
  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /**
   * 上传已缩小的封面，仅保留当前与上一张。
   * @param image - 最大边不超过 300px 的封面
   */
  setCover(image: HTMLCanvasElement): void {
    const gl = this.gl;
    const texture = this.createTexture();
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    }
    if (this.covers.length === 2) gl.deleteTexture(this.covers.shift()!);
    this.covers.push(texture);
  }

  /** 封面过渡结束后立即释放旧纹理。 */
  finishCoverTransition(): void {
    if (this.covers.length === 2) this.gl.deleteTexture(this.covers.shift()!);
  }

  /**
   * 更新输出与降采样目标；分辨率仅由宿主容器和渲染倍率决定。
   * @param width - 输出像素宽度
   * @param height - 输出像素高度
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    this.width = this.canvas.width = width;
    this.height = this.canvas.height = height;
    // 对齐参考 Renderer 的最大 sigma 预算，模糊目标不随每帧模式过渡重建。
    this.surfaceWidth = Math.max(1, Math.floor(width / ((4 * 80) / 42.5)));
    this.surfaceHeight = Math.max(1, Math.floor(height / ((4 * 80) / 42.5)));
    for (const surface of this.surfaces) {
      gl.bindTexture(gl.TEXTURE_2D, surface.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        this.surfaceWidth,
        this.surfaceHeight,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("背景浮点帧缓冲不完整");
    }
    const portrait = height > width;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      const mesh = createMesh(
        this.variant,
        portrait,
        portrait ? this.portraitSlot : this.landscapeSlot,
      );
      gl.bindVertexArray(this.vaos[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers[2]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      this.indexCount = mesh.indices.length;
    }
  }

  /**
   * 按参考实现依次填充、旋转、两次模糊，再合成普通/歌词材质。
   * @param frame - 毫秒时钟与本帧材质状态
   */
  render(frame: Frame): void {
    if (!this.covers.length || !this.width || !this.height) return;
    const gl = this.gl;
    const classic = this.variant === "classic";
    const aspect = this.width / this.height;
    const view = classic
      ? [-(aspect < 1 ? 1 / aspect : 1), aspect]
      : aspect >= 1
        ? [1, aspect]
        : [1 / aspect, 1];
    const sigma = classic ? 40 : 80 + (42.5 - 80) * frame.lyricsMix;
    const blurX = (sigma * 4 * frame.renderScale) / (this.width * 42.5);
    const blurY = (sigma * 4 * frame.renderScale) / (this.height * 42.5);
    const backdrop = (target: Surface, imageScale: number) => {
      gl.viewport(0, 0, this.surfaceWidth, this.surfaceHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfaces[0].framebuffer);
      gl.bindVertexArray(this.vaos[0]);
      const artwork = this.programs[0];
      gl.useProgram(artwork.handle);
      const u = artwork.uniforms;
      gl.uniform1i(u.classic, Number(classic));
      gl.uniform1f(u.timeMs, frame.timeMs);
      gl.uniform1f(u.rotationScale, frame.rotationScale);
      gl.uniform2f(u.viewScale, view[0], view[1]);
      gl.uniform1f(u.imageScale, imageScale);
      gl.uniform1f(u.coverMix, frame.coverMix);
      this.bindTexture(artwork, "currentCover", this.covers[this.covers.length - 1], 0);
      this.bindTexture(artwork, "previousCover", this.covers[0], 1);
      for (let layer = -1; layer < 3; layer++) {
        gl.uniform1i(u.layer, layer);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      const blur = this.programs[1];
      gl.useProgram(blur.handle);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfaces[1].framebuffer);
      this.bindTexture(blur, "source", this.surfaces[0].texture, 0);
      gl.uniform2f(blur.uniforms.direction, blurX, 0);
      gl.uniform1i(blur.uniforms.normalizeOutput, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.bindTexture(blur, "source", this.surfaces[1].texture, 0);
      gl.uniform2f(blur.uniforms.direction, 0, blurY);
      gl.uniform1i(blur.uniforms.normalizeOutput, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const transitioning = frame.lyricsMix > 0 && frame.lyricsMix < 1;
    if (transitioning) backdrop(this.surfaces[3], 1);
    backdrop(this.surfaces[2], frame.lyricsMix > 0 ? frame.imageScale : 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    for (let pass = 0; pass < (frame.lyricsMix > 0 ? 2 : 1); pass++) {
      const program = this.programs[pass + 2];
      gl.useProgram(program.handle);
      const u = program.uniforms;
      gl.uniform1i(u.classic, Number(classic));
      gl.uniform1f(u.lyricsMix, frame.lyricsMix);
      gl.uniform1f(u.darkMix, Number(!frame.light));
      gl.uniform1f(u.scrimAlpha, frame.light ? 1 / 3 : 0.4);
      gl.uniform1f(u.ditherStrength, 1);
      this.bindTexture(program, "lyricSource", this.surfaces[2].texture, 0);
      this.bindTexture(program, "ordinarySource", this.surfaces[transitioning ? 3 : 2].texture, 1);
      gl.bindVertexArray(this.vaos[pass]);
      if (pass === 0) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      else {
        gl.uniform1f(u.timeMs, frame.timeMs);
        gl.uniform1f(u.uvScale, classic || !this.portrait ? 0.8 : 1);
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
      }
    }
  }

  /**
   * 绑定固定纹理槽，避免各渲染阶段继承错误的活动单元。
   * @param program - 当前着色程序
   * @param name - 采样器名称
   * @param texture - 输入纹理
   * @param unit - 纹理单元
   */
  private bindTexture(program: Program, name: string, texture: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.uniforms[name], unit);
  }

  /** 释放固定对象集合；上下文丢失时调用同样安全。 */
  dispose(): void {
    const gl = this.gl;
    for (const program of this.programs) gl.deleteProgram(program.handle);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const vao of this.vaos) gl.deleteVertexArray(vao);
    for (const texture of this.covers) gl.deleteTexture(texture);
    for (const surface of this.surfaces) {
      gl.deleteTexture(surface.texture);
      gl.deleteFramebuffer(surface.framebuffer);
    }
    this.programs.length =
      this.buffers.length =
      this.vaos.length =
      this.covers.length =
      this.surfaces.length =
        0;
  }
}
