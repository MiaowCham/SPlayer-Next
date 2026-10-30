# 默认歌词渲染器私有 Hook 维护

## 版本与入口

当前依赖为 `lyric-dom@0.2.1`，默认引擎适配层为
`src/components/player/Lyrics/DefaultLyrics.vue`，统一入口为 `Lyrics/index.vue`。
补丁为 `patches/lyric-dom@0.2.1.patch`，在 `pnpm-workspace.yaml` 登记，
由锁文件记录补丁 hash。依赖只发布 ESM 运行时，没有需要同步修改的 CommonJS 入口。
AMLL 的协议单独维护在 [amll-hooks.md](./amll-hooks.md)。

新增和升级补丁必须使用 `pnpm patch lyric-dom@实际版本` 与 `pnpm patch-commit`，
同时检查 `dist/index.mjs`、`dist/index.d.mts`、`dist/style.css`，不能手改补丁 hunk 或 hash。

## 本地扩展清单

| 接口                                  | 写入位置                                                | 消费位置与约束                                                                |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `independentWordRomanizationProgress` | 统一入口转发共用设置，DefaultLyrics 初始化与 watch 更新 | RendererConfig、DEFAULTS、LyricRenderer.applyConfig、measureAndApplyWordMasks |
| `preserveWordSpacing`                 | 发音提升生成的展示副本                                  | buildWordSpans 保留音节内部空格，词边界空白放在遮罩外                         |
| `isLineLyric`                         | 强制逐句发音提升                                        | buildLineElements 选择逐句静态层，不生成伪逐字时间                            |
| `swapTranslationPronunciation`        | DefaultLyrics 配置                                      | appendSubs 交换副行顺序                                                       |
| `floatAnimationIntensity`             | DefaultLyrics 配置                                      | createFloatAnimation 消费五档上浮幅度                                         |
| `disableCjkEmphasis`                  | DefaultLyrics 配置                                      | shouldEmphasize / shouldChunkEmphasize 排除 CJK 强调                          |
| `raiseAlignPositionOnOverlap`         | DefaultLyrics 配置                                      | 重叠主行动态抬高及锚点交接                                                    |
| `scrollToTime`                        | 父组件定位或跳转                                        | 恢复跟随并同步上游时间线                                                      |

这些接口是本分支对依赖的扩展，不代表上游稳定公开 API。
`showRuby`、`showWordRomanization`、`showRomanization` 继续使用上游接口，互不充当总开关。

## 逐词发音 DOM 与左对齐

普通词为 `.lp-word-roman > .lp-word-text + .lp-roman-word`，
强调词为 `.lp-emp-wrapper.lp-word-roman > .lp-emp-chars + .lp-roman-word`。
ruby 属于正文层；没有发音的词保留不换行空格及正文，不借用相邻词发音。
逐词发音统一采用 `text-align: left` 与 `align-items: flex-start`，
首词、后续词、强调词和换行后的词保持相同规则。

发音提升后 `.lp-word-text` 承载发音，`.lp-roman-word` 承载原文。
Hook 按显示层处理，无需交换字段或再复制一套歌词时间。
强制逐句模式没有逐词发音层，因此不生成独立逐词遮罩。

## 独立计算发音进度

共用设置为 `lyric.independentWordRomanizationProgress`，默认关闭。
歌词设置中的同一开关同时控制 AMLL 和默认引擎，逐词发音关闭时禁用该选项。

关闭时保留上游的词容器遮罩；开启后移除父词容器遮罩，分别在正文与发音层建立遮罩。
两层不能嵌套遮罩，否则较窄的祖先遮罩会再次裁掉较宽层。
普通词和强调词都必须走此路径，强调字符动画及逐词上浮仍由原控制器持有。

`measureAndApplyWordMasks` 为本次测量构造临时的两层目标，先批量读取尺寸，再写入遮罩样式。
各层内容宽度为 clientWidth 减左右 padding，内容高度减上下 padding，
CSS 词间间距和用于绘制的 padding 不进入推进距离。
层内保留 1em 绘制留白，用负 margin 抵消排版占位，避免截断 ruby、上浮和强调辉光。

每层的遮罩尺寸和速度分别按该层宽高计算，仍共用原词起止时间、行级 `--t`、
上游渐变参数及最多 80ms 的起始预滚。不拉伸歌词时间，不生成或猜测额外的发音时间。
因此两层在词末同时完成，但宽窄不同的文字以各自的像素速度推进。

## 更新与释放

- applyConfig 热切换 root 的 `.lp-independent-word-masks`，原地重测，保留词节点身份
- 关闭时移除子层 mask 样式并恢复父遮罩，不能同时保留两套遮罩
- 重建歌词、显示开关、渐变宽度、水平对齐、容器和字体尺寸变化均重测各层
- setCurrentTime、scrollToTime 和行级 `--t` 继续负责播放与正反跳转，无新增 RAF 或定时器
- 冻结与恢复继续使用上游循环和 ResizeObserver，隐藏时不增加后台更新
- 测量临时数组不跨歌曲保存；销毁移除 root Hook class，随原 DOM、观察器和动画一起释放

## 升级验证

升级时核对上述类名、两层父子关系、applyConfig 和所有 measureAndApplyWordMasks 调用点。
保留默认值、声明、热切换、dispose 清理与 CSS 留白规则，不能只修改适配层参数。

回归文件：

- `DefaultLyrics.spec.ts`：共用开关传递、发音提升与还原、原始数据不变
- `engine/independent-pronunciation.spec.ts`：普通/强调双层尺寸、缺失发音、暂停与冻结热切换、重测、销毁

另用真实 Electron 检查宽发音/窄正文、ruby、正反跳转、遮罩切换及布局，
记录同尺寸基线与补丁版本的 60 秒 app.getAppMetrics 样本，最后检查 DOM 和动画归零。
内存、运行时与命令验证结果在每次修改后记录，不能把单元测试的模拟尺寸当作浏览器测量结果。

### 2026-10-30 验证记录

全仓 ESLint、Node/Web 类型检查、66 项 Node 测试、832 项 Vitest 测试、
electron-vite 生产构建及离线冻结锁文件安装通过。

真实 Electron 对照各载入 40 行，包含宽罗马音、窄正文、ruby 与对唱。
开启后父词容器 mask 为 none，两层 mask-size 分别为 105px 与 291.3px，
相同时刻 mask-position 分别为 7.5px 与 -56.15px，证明各层使用自己的尺寸。
关闭后保留同一词节点、恢复父遮罩且清除子遮罩，冻结/恢复与正反跳转检查通过。
另用真实强调词确认 lp-emp-chars 与 lp-roman-word 的遮罩尺寸独立，销毁后动画归零。

运行超过 60 秒后，基线与补丁 Tab 工作集约为 91.9 MB 与 92.7 MB，
共用 Browser/GPU 工作集约为 102.8/96.9 MB。
销毁后两侧子节点、动画与 Hook class 均为 0，无渲染错误。
夹具窗口隐藏且暂停，样本只用于同尺寸常驻资源对照，不代表完整应用前台或 10 分钟负载。
测试脚本、截图、日志、用户数据和补丁编辑目录在验证后清理。
