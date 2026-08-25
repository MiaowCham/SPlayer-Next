/** Apple Music 风格背景可接受的封面资源。 */
export type AppleMusicBackgroundAlbum = string | TexImageSource;

/** Apple Music 风格背景渲染方案。 */
export type AppleMusicBackgroundVariant = "dev" | "beta";

/** 从播放器频谱提取的背景响应。 */
export interface AppleMusicBackgroundAudio {
  bass: number;
  mid: number;
  high: number;
  transient: number;
}

/** Apple Music 风格背景初始化选项。 */
export interface AppleMusicBackgroundOptions {
  variant?: AppleMusicBackgroundVariant;
  renderScale?: number;
  fps?: number;
  flowSpeed?: number;
  distortion?: number;
  darkOverlay?: number;
  blurLevel?: number;
  beatStrength?: number;
}

/** 背景渲染器公开接口。 */
export interface AppleMusicBackgroundRenderer {
  mount(container: HTMLElement): void;
  updateAlbum(album?: AppleMusicBackgroundAlbum): Promise<boolean>;
  updateAudio(audio: Partial<AppleMusicBackgroundAudio>): void;
  updateOptions(options: AppleMusicBackgroundOptions): void;
  setVisible(visible: boolean): void;
  setPlaying(playing: boolean): void;
  resize(): void;
  dispose(): void;
  getElement(): HTMLCanvasElement;
}

export interface AppleMusicBackgroundMotion {
  pulse: number;
  flow: number;
  detail: number;
  displacement: number;
}
