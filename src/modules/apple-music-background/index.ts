import { BackgroundGpu } from "./gpu";
import type { BackgroundVariant } from "./mesh";

export type { BackgroundVariant } from "./mesh";

export interface BackgroundState {
  visible: boolean;
  playing: boolean;
  hasLyrics: boolean;
  fps: number;
  flowSpeed: number;
  renderScale: number;
  light: boolean;
}

/**
 * 独立背景会话：只在可见且需要动画/过渡时请求帧，封面和 GPU 对象均有明确所有者。
 * 500ms 封面过渡和 250ms 歌词模式过渡参考 Lyricify-Backgrounds bdd31b5（Apache-2.0）。
 */
export class AppleMusicBackground {
  readonly canvas = document.createElement("canvas");
  private gpu: BackgroundGpu | undefined;
  private disposed = false;
  private lost = false;
  private failed = false;
  private raf = 0;
  private previousTime = 0;
  private lastDraw = -Infinity;
  private motionTime = 0;
  private transitionTime = 0;
  private coverStart = -500;
  private coverPending = false;
  private modeStart = -250;
  private modeFrom = 1;
  private modeTo = 1;
  private modeMix = 1;
  private dirty = true;
  private imageScale = 1;
  private image: HTMLImageElement | undefined;
  private artwork: HTMLCanvasElement | undefined;
  private album = "";
  private loadToken = 0;
  private cssWidth = 1;
  private cssHeight = 1;
  private readonly observer: ResizeObserver;
  private state: BackgroundState = {
    visible: true,
    playing: true,
    hasLyrics: true,
    fps: 30,
    flowSpeed: 4,
    renderScale: 0.5,
    light: false,
  };

  constructor(
    container: HTMLElement,
    private readonly variant: BackgroundVariant,
    private readonly onError: (error: Error) => void,
  ) {
    this.canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
    container.appendChild(this.canvas);
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.canvas.addEventListener("webglcontextrestored", this.contextRestored);
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.observer = new ResizeObserver(([entry]) => {
      this.cssWidth = entry.contentRect.width;
      this.cssHeight = entry.contentRect.height;
      this.dirty = true;
      this.schedule();
    });
    this.observer.observe(container);
    try {
      this.gpu = new BackgroundGpu(this.canvas, variant);
      const rect = container.getBoundingClientRect();
      this.cssWidth = rect.width;
      this.cssHeight = rect.height;
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * 同步宿主设置；暂停只冻结运动，已开始的封面/模式过渡仍会结束。
   * @param state - 当前可见性、运动与画质设置
   */
  update(state: BackgroundState): void {
    if (this.disposed) return;
    if (state.hasLyrics !== this.state.hasLyrics) {
      this.modeFrom = this.modeMix;
      this.modeTo = Number(state.hasLyrics);
      this.modeStart = this.transitionTime;
    }
    this.state = { ...state };
    this.dirty = true;
    this.stop();
    this.schedule();
  }

  /**
   * 更新共享锚点缩放，经典版不使用低频缩放。
   * @param scale - 宿主频谱分析得出的图像倍率
   */
  setImageScale(scale: number): void {
    if (this.variant === "classic" || this.imageScale === scale) return;
    this.imageScale = scale;
    this.dirty = true;
    this.schedule();
  }

  /**
   * 解码封面并缩小到 300px；代次校验避免快速切歌把旧请求覆盖到新歌。
   * @param url - 缩略图地址，不应传入 coverOriginal
   */
  async setAlbum(url: string): Promise<void> {
    if (this.disposed || url === this.album) return;
    this.album = url;
    const token = ++this.loadToken;
    if (this.image) this.image.src = "";
    const image = new Image();
    this.image = image;
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
      if (this.disposed || token !== this.loadToken) return;
      const artwork = document.createElement("canvas");
      const scale = Math.min(1, 300 / Math.max(image.naturalWidth, image.naturalHeight));
      artwork.width = Math.max(1, Math.round(image.naturalWidth * scale));
      artwork.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = artwork.getContext("2d")!;
      context.drawImage(image, 0, 0, artwork.width, artwork.height);
      const hadArtwork = Boolean(this.artwork);
      if (!this.lost) this.gpu?.setCover(artwork);
      // CPU 只保留当前缩略图供上下文恢复；上一张封面仅保留在 GPU，过渡结束即释放。
      this.artwork = artwork;
      this.coverStart = this.transitionTime - (hadArtwork ? 0 : 500);
      this.coverPending = hadArtwork;
      this.dirty = true;
      this.schedule();
    } catch (error) {
      if (!this.disposed && token === this.loadToken)
        this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (token === this.loadToken) {
        this.image = undefined;
        image.src = "";
      }
    }
  }

  private readonly visibilityChanged = (): void => {
    this.stop();
    this.dirty = true;
    this.schedule();
  };

  private readonly contextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.stop();
    this.gpu?.dispose();
    this.gpu = undefined;
  };

  private readonly contextRestored = (): void => {
    if (this.disposed) return;
    try {
      this.gpu = new BackgroundGpu(this.canvas, this.variant);
      if (this.artwork) this.gpu.setCover(this.artwork);
      this.coverStart = this.transitionTime - 500;
      this.coverPending = false;
      this.lost = false;
      this.failed = false;
      this.canvas.style.visibility = "";
      this.dirty = true;
      this.schedule();
    } catch (error) {
      this.fail(error);
    }
  };

  /** 停止后清除时间锚点，恢复时不补算隐藏期间的运动。 */
  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.previousTime = 0;
    this.lastDraw = -Infinity;
  }

  /** 单一 RAF 所有权，隐藏或无待处理帧时不继续循环。 */
  private schedule(): void {
    if (
      this.raf ||
      this.disposed ||
      this.lost ||
      this.failed ||
      !this.artwork ||
      !this.state.visible ||
      document.hidden ||
      this.cssWidth <= 0 ||
      this.cssHeight <= 0
    )
      return;
    const transitioning = this.coverPending || this.modeMix !== this.modeTo;
    if (this.dirty || this.state.playing || transitioning)
      this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    const delta = this.previousTime ? now - this.previousTime : 0;
    this.previousTime = now;
    this.transitionTime += delta;
    if (this.state.playing) this.motionTime += delta;
    const interval = 1000 / this.state.fps;
    if (now - this.lastDraw >= interval) {
      // 保留节拍余量，避免 60Hz 浮点时间误差把 30fps 设置降成约 20fps。
      this.lastDraw = Number.isFinite(this.lastDraw)
        ? now - ((now - this.lastDraw) % interval)
        : now;
      try {
        const scale = Math.min(
          this.state.renderScale,
          Math.sqrt(4_194_304 / (this.cssWidth * this.cssHeight)),
        );
        const width = Math.max(1, Math.round(this.cssWidth * scale));
        const height = Math.max(1, Math.round(this.cssHeight * scale));
        this.gpu?.resize(width, height);
        const progress = Math.min(1, (this.transitionTime - this.modeStart) / 250);
        // 对齐参考实现 CSS ease-in-out(.42,0,.58,1)，不是直接对时间做 smoothstep。
        let low = 0,
          high = 1,
          parameter = progress;
        for (let i = 0; i < 12 && progress > 0 && progress < 1; i++) {
          parameter = (low + high) / 2;
          const inverse = 1 - parameter;
          const x =
            3 * inverse * inverse * parameter * 0.42 +
            3 * inverse * parameter * parameter * 0.58 +
            parameter ** 3;
          if (x < progress) low = parameter;
          else high = parameter;
        }
        const eased = parameter * parameter * (3 - 2 * parameter);
        this.modeMix = this.modeFrom + (this.modeTo - this.modeFrom) * eased;
        const coverMix = Math.min(1, (this.transitionTime - this.coverStart) / 500);
        this.gpu?.render({
          timeMs: this.motionTime,
          coverMix,
          lyricsMix: this.modeMix,
          rotationScale: this.state.flowSpeed / 4,
          imageScale: this.imageScale,
          light: this.state.light,
          renderScale: scale,
        });
        if (coverMix === 1) {
          this.gpu?.finishCoverTransition();
          this.coverPending = false;
        }
        this.dirty = false;
      } catch (error) {
        this.fail(error);
      }
    }
    this.schedule();
    // 静止后切换封面应从零开始过渡，不把空闲时间计入首帧。
    if (!this.raf) this.previousTime = 0;
  };

  /**
   * 停止失败管线，交由宿主显示已有纯色底层，不循环重试分配 GPU。
   * @param error - 初始化或帧渲染错误
   */
  private fail(error: unknown): void {
    this.failed = true;
    this.stop();
    this.gpu?.dispose();
    this.gpu = undefined;
    this.canvas.style.visibility = "hidden";
    this.onError(error instanceof Error ? error : new Error(String(error)));
  }

  /** 停止异步工作并释放监听、解码图、GPU 与独立上下文。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken++;
    this.stop();
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.contextRestored);
    if (this.image) this.image.src = "";
    this.image = undefined;
    this.artwork = undefined;
    this.gpu?.dispose();
    this.gpu = undefined;
    this.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
  }
}
