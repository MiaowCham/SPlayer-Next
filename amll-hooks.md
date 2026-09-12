# AMLL 私有 hook 与升级维护

当前补丁适配 `@applemusic-like-lyrics/core@0.5.2`。这些 hook 是 SPlayer 的私有协议，
不是 AMLL 的公开配置项。仅保留 Vue 中的字段不能使功能生效，必须同时存在对应包补丁。

## 入口与消费位置

| hook / 接入点                    | 写入或触发位置                                                    | 消费位置与约束                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `__amllIndependentRomanWordMask` | `AMLLLyrics.vue` 的 `processedLyrics`，正文为主文字且显示逐词发音 | `LyricLineEl.createWord` 拆分 DOM，`updateMaskImageSync` 选择路径，`generateWebAnimationBasedMaskImage` 分别生成两层动画                      |
| `__amllIndependentMainWordMask`  | 同上，发音经 `promotePronunciation` 提升为主文字                  | 消费位置相同；提升后 `word` 是发音，`romanWord` 是原正文，不得再次交换                                                                        |
| `__amllSkipWhitespaceSplit`      | `romanization.ts` 的 `promotePronunciation`                       | `normalizeSpaces` 跳过标准化，`rebuildElement → chunkAndSplitLyricWords` 保留音节内部空格和原始时间，只将边界空白提为排版节点                 |
| 重叠行抬高                       | `syncCurrentTime → syncAlignPosition`、配置 watcher               | `amll-player.ts` 子类读取 `timelineState.bufferedGroups`，统计其中主行；最终位置变化时调用 `setAlignPosition`、`setAlignAnchor`、`calcLayout` |
| 实例生命周期                     | `playerRef`、挂载后的异步身份检查                                 | 必须使用 `shallowRef` 保存 Core 实例，避免代理破坏实例身份检查                                                                                |

两个独立遮罩标记是同一功能在不同主文字设置下的入口。任一为 `true` 都要同时拆开正文和发音，
不能把独立发音遮罩放在仍有正文遮罩的祖先之下，否则两层遮罩相乘，发音仍受正文进度限制。
两个标记均不存在时沿用上游词容器和单层遮罩。

## 发音空格与重叠锚点

- 发音提升逐句检查显式排版：TTML 音译词之间的边界空格或 LRCN 本句发音中的内部空格表示应保留原样，句首句尾留白不作为依据。
  忽略符号、大小写和空白后相同的音节始终优先使用原文，即使本句存在手工空格；其余音节按本句的显式排版原样显示。
  没有显式排版的句子独立适配：CJK 音节间补空格，非 CJK 继承原文边界空格，不受其他句子的空格影响。
- `preserveRomanizationSpacing` 是解析器提供的语义信息；`preserveWordSpacing` 标记提升后的正文已经排版，供默认引擎使用。
  AMLL 另用 `__amllSkipWhitespaceSplit` 传给包内消费者。仅修改转换函数不够：上游优化和分词可能再次折叠空格、重分时长。
- 空格节点仍交给原有布局；不增加计时器、动画循环或跨曲目缓存。默认引擎保留完整音节时间并使用 `pre-wrap` 展示连续空格。
- AMLL 0.5.2 的滚动锚点与缓冲组同步，而非与每一行的 `endTime` 同步。旧行结束但仍缓冲时必须继续抬高，
  否则第一句先落回默认高度，第二句还未滚动到锚点。后续新行加入、全部缓冲行结束或 seek 重建时间线时，再按新缓冲组恢复。
- `timelineState` 是受保护的内部 API，通过窄子类方法读取，不复制上游时间线状态机。升级时核对 `bufferedGroups` 的索引、
  `commitPlayerTimeState` 的清理时机、背景行归组规则及 seek 行为；不能退回单纯统计时间区间。

## 格式化 TTML 维护

`shared/utils/ttml.ts` 是渲染解析、手动导入检查、词库候选筛选和编辑保存共用的规则。
检测到元素之间含换行缩进即视为格式化文件，忽略元素间全部纯空白；`<space/>` 和叶子元素文本内的空格保留。
紧凑 TTML 的原有元素间空格不改变含义，元数据中的空格不能作为歌词已正确分词的证据。

单曲手动导入遇到完全缺少合法空格的格式化文件时，警告并允许继续；批量手动导入集中提示文件数，允许继续导入或仅跳过这些文件。
本地词库自动匹配跳过该文件，继续同 ID、同标题候选或其他来源。词库返回原文本，编辑器可原样填入美化页；原始页与保存结果为紧凑 TTML。
编辑器使用与搜索页相同的 `STabs`，只在用户切换页签时同步文本，避免初始化时把原始美化排版覆盖。

## DOM、尺寸和时间轴约定

- `mainElement` 仍是上游词容器，供换行测量、上浮和强调动画使用，不直接承载独立模式的遮罩。
- `mainMaskElement` 只包含主文字及其 ruby；`romanMaskElement` 位于单独的发音容器内。
  缺失发音的词使用不换行空格保留行高，正文不得被清空。
- `.amll-main-mask` 使用自身内容宽度；`.amll-roman-mask` 保留少量底部空间，
  避免 `g/j/p/y` 等下伸字符被遮罩边界截断。修改上游 DOM 或 CSS 后要重新检查这两个选择器。
- 尺寸在上游 `updateMaskImageSync` 链路中读取。每层临时建立测量视图，
  不修改原始 `splittedWords` 的布局宽高，也不保存跨歌曲的尺寸缓存。
- 两层复用 0.5.2 的累计宽度、`getWordFadeWidth()`、`getRubySegments()` 和裁剪边界插值。
  独立指各层按自身字宽计算进度，不是另起逐词计时器；渐变尾部仍会自然延续到下一词。
- 临时测量视图必须共享原词的 `maskAnimations` 数组。先取消并清空旧动画，再追加两层新动画；
  不能在临时对象上替换数组，否则上游的暂停、跳转、隐藏恢复和释放将找不到这些动画。
- 时间单位统一为毫秒。独立模式的零时长行使用至少 1ms 的动画分母，零尺寸元素等待下次测量。
- 支持标准遮罩时生成 `maskPosition` 帧；仅支持 WebKit 遮罩时使用 `webkitMaskPosition`。
  此分支同样由上游动画生命周期管理。

## 尚未迁移的旧 hook

以下字段仍由 `AMLLLyrics.vue` 写入，但本次 0.5.2 补丁没有恢复消费者：

| 字段                            | 0.5.1 的原消费位置                 |
| ------------------------------- | ---------------------------------- |
| `__amllDisableWordHighlight`    | 两种遮罩生成器，跳过遮罩并取消动画 |
| `__amllDisableEmphasize`        | `buildWord` 的强调判断             |
| `__amllDisableCjkEmphasis`      | `buildWord` 的 CJK 强调过滤        |
| `__amllFloatAnimationIntensity` | `initFloatAnimation` 的位移强度    |

这些字段存在不代表 AMLL 模式支持对应设置。后续迁移需独立验证；
自研引擎有自己的实现，不依赖这份补丁。旧补丁可从提交 `0a46468` 查询，
但其 ESM 与 CommonJS 内容曾有差异，不能直接复制为新版实现。

## 升级流程

1. 确认实际安装版本、`pnpm-workspace.yaml` 的 `patchedDependencies` 以及锁文件匹配。
2. 检查新版 `setLyricLines` 的克隆与优化步骤是否保留私有字段，以及缓冲组是否仍与滚动锚点同步。
3. 对照新版 `createWord`、`updateMaskImageSync`、遮罩生成器和 `disposeElements`，
   确认 DOM 包含关系、尺寸测量、动画数组所有权和释放流程。
4. 检查对齐 setter 是否会重新布局，以及重叠进入、退出、暂停切换时是否需要显式刷新。
5. 使用 `pnpm patch @applemusic-like-lyrics/core@<实际版本>` 创建编辑目录。
   在 ESM、CommonJS 和必要的 CSS 中同步迁移，再执行 `pnpm patch-commit <编辑目录>`；
   不手工修改生成的 patch hunk 或 hash。
6. 运行 `pnpm typecheck`、`pnpm test` 并重新构建渲染产物。
   `amll-regression.spec.ts` 覆盖双层遮罩、ruby、缺失发音、零时长、动画释放、发音空格及缓冲锚点切换；
   `engine/seek-ghost.spec.ts` 覆盖自研引擎的重叠抬高与背景行排除，`engine/pronunciation-spacing.spec.ts` 验证发音 DOM 排版。
   `ttmlImport.spec.ts`、`localLyricRepo.spec.ts`、`LyricOptimizeDialog.spec.ts` 分别检查 TTML 空格往返、词库回退和编辑页签保存。
7. 使用真实 Electron 检查宽窄发音、强调、ruby、换行、缩放、跳转、暂停与隐藏恢复，
   并按 `AGENTS.md` 要求采样内存。DOM 测试的尺寸和动画是模拟值，不能替代视觉验收。

## 本轮验证边界（2026-09-12）

- Node 43 项、Vitest 162 项、两端类型检查、修改文件 ESLint / Prettier 及 `electron-vite build` 通过。
- 真实 Electron 隔离夹具使用 120 行，分别加载修改前后的 Core 和发音转换函数。
  首行结束后的 4500ms，旧逻辑恢复到 `0.35`，新逻辑保持 `0.15`；6500ms 切换新行及 seek 重建均恢复 `0.35`。
  已检查画面中的手工双空格、正文与发音对应关系，以及播放器释放。
- 同一夹具各运行 60 秒后，`app.getAppMetrics()` 的渲染进程工作集约为 150MB / 199MB；
  DOM 节点为 156 / 180，动画为 78 / 168。样例中的 `ni  hao` 不再被内部空白拆成两段，
  完整时长会参与上游强调判断，因此两次渲染负载不同；这些样本不能证明内存无回归。
  后续需在完整应用中分别检查强调开关、实际长发音歌词和持续播放样本，不能只引用通过的功能测试作为内存验收。
- 未执行 Rust 原生构建及完整应用打包、整机内存验收。构建仍有现有的 lyric/preload 静态与动态导入提示。
