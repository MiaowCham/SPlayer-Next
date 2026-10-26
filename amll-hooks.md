# 歌词私有 Hook 与上游同步维护

## 当前依赖与补丁

本分支同步到 `upstream/dev@006c5806`（2026-10-24），应用版本为 1.2.1。
当前使用 `@applemusic-like-lyrics/core@0.6.0`、`lyric-dom@0.2.1` 和 `lyric-kit@0.6.1`。
三份补丁通过 `pnpm patch / patch-commit` 生成，登记在 `pnpm-workspace.yaml`，
锁文件记录实际版本与补丁 hash。0.5.2 补丁已删除，不能继续套用旧版内部 API。

## AMLL 私有协议

Hook 由 `AMLLLyrics.vue` 的展示副本写入，不是 AMLL 的公开设置。
Core 实例使用 `shallowRef`，保留挂载、异步等待与卸载之间的身份校验。

| Hook                                                               | 消费位置与约束                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `__amllIndependentRomanWordMask` / `__amllIndependentMainWordMask` | `LyricLineEl.createWord` 建立正文和发音的兄弟遮罩，`updateMaskImageSync` 按各层实际尺寸建立 animator |
| `__amllSkipWhitespaceSplit`                                        | `normalizeSpaces` 跳过空格折叠，分词器保留音节内部空格、原始时间，边界留白只参与排版                 |
| `__amllDisableWordHighlight`                                       | 重建遮罩时先释放旧 animator，再跳过新遮罩，不影响词容器的布局                                        |
| `__amllDisableEmphasize`                                           | `buildWord` 关闭强调判断与字符动画                                                                   |
| `__amllDisableCjkEmphasis`                                         | `buildWord` 排除 CJK 词的强调，保留其他词的判断                                                      |
| `__amllFloatAnimationIntensity`                                    | `createFloatAnimation` 应用五档位移，背景行仍按上游规则加倍                                          |
| `__amllAdvanceOverlapAnchor`                                       | 时间线控制器在首行结束、其余行仍播放时清理旧高亮并交接锚点                                           |

最后四个效果 Hook 在旧 0.5.2 补丁中没有消费者，本次已迁移并增加实际行为测试。
ESM 与 CommonJS 的消费方法必须保持一致；CommonJS 另修复了 structured-clone
默认导出被重复包装的问题，回归测试会实际构造两个入口的播放器。

### DOM 与动画所有权

- `mainElement` 保留上游布局、换行、上浮与强调职责，不直接承载独立遮罩
- `mainMaskElement` 包含正文和 ruby；发音容器内的 `romanMaskElement` 与其互不嵌套
- 缺失发音用不换行空格保留行高，正文不得被清空；提升发音后不能再次交换正文和发音
- 两层分别扣除 padding 测量文字尺寸，复用上游连续时间轴、ruby 分段和渐变尾部
- 0.6 使用 `WebMaskAnimator / CalcMaskAnimator`，不再使用 0.5.2 的 `maskAnimations` 数组
- 独立模式仅创建两个 animator，由一个行级组合对象统一转发播放、暂停、跳转与释放
- 组合对象随行销毁；不增加动画循环、跨歌曲尺寸缓存或长期持有的歌词详情
- 遮罩四边保留 1em 绘制空间，用负边距抵消排版占位；行级关闭 paint containment，视口仍裁切滚动内容

### 重叠对齐与间奏

`amll-player.ts` 读取受保护的 `timelineController.getSnapshot()`，
在同一帧消费 `highlightedGroups`，不能保存快照引用，也不能继续访问已删除的 `timelineState`。
高度通过 `getLineHeight()` 获取，与上游布局计算器一致。

抬高只参考前两条主高亮行，第三行原地亮起；首行结束后由时间线内部生成清理差异，
把锚点交给仍在播放的首行。关闭设置时恢复上游高亮保留规则。
对齐 setter 在 0.6 会主动刷新布局，适配层缓存最终位置，避免每次进度推送重复设置。
显式调用 `calcLayout` 必须传入 `LayoutReason`，锚点使用 `LayoutAlignAnchor`。
间奏以 `anchorLineIndex + 1` 插槽为基准，顶部和底部锚点对齐可见圆点，排除外侧留白。

## 默认引擎迁移

默认引擎已采用上游 `lyric-dom`，旧的本地引擎实现及样式已移除。
`DefaultLyrics.vue` 负责发音提升、逐行发音回退、设置切换与冻结期间的数据缓冲；
`Lyrics/index.vue` 统一转发两套引擎的定位、冻结、恢复和首次布局完成事件。

`lyric-dom` 补丁保留五档上浮、CJK 强调开关、前两条重叠主行抬高、
强制定位、译文/发音副行交换、逐句模式与 `preserveWordSpacing` 排版语义。
继续使用上游的声部布局、逐词发音、ruby、水平对齐、行缩放和动画释放流程。
旧的发音总开关与 AMLL 分项在配置恢复时迁移为上游的独立逐行/逐词开关，
迁移后删除旧字段，避免不可见的旧配置阻止显示。

发音提升逐句检查作者空格；等价原文优先复用，没有显式排版的 CJK 音节才自动补空格。
`forceSyllableSpacing` 默认关闭，开启后忽略作者的音节分隔，但不拆分音节内部文字或时间。
两套引擎都必须从原歌词重建，暂停时切换、关闭设置后恢复作者空格。

## 解析、导出与歌词来源

标准 LRC、QRC、YRC、KRC、LyS、SRT、ASS 使用 `lyric-kit` 的解析器。
本地适配层保留 LRCN / LNT / LQE、逐行 TTML 格式优先级、译文语言回退和发音语义。
TTML 解析继续使用 `shared/utils/ttml.ts` 规范化的本分支规则，
保留显式空格、粤语标签及编辑器原始/美化页签的往返行为。

`lyric-kit` 补丁仅扩展声明中的语言集合，允许传递 `yue / und-Hani`，
不改写上游运行时的语言判断。应用展示仍采用本分支的保守语言识别与中文发音过滤。

标准格式下载使用上游往返序列化，保留辅助行类型、毫秒时间和词间空隙；
已有 TTML 原文直接保留，避免丢失元数据与样式。扩展格式先经本地适配层解析再导出。

在线歌词候选立即展示，后续候选只升级格式；TTML 后台升级按加载代次去重。
逐曲来源首选项、手动管理歌词和搜索覆盖继续生效，显式平台选择不被后台 TTML 覆盖。
异步拼音过滤期间以有效原始歌词状态判断解析是否成功，不能只看暂时为空的展示数组。

格式化 TTML 缺少合法空格时，手动单曲导入允许确认继续，批量导入集中提示；
本地词库自动匹配跳过该文件并尝试下一候选。多 ID 索引和同 ID 多文件回退同时保留。

## Git 提交 Hook

上游新增 Husky 和 lint-staged，`prepare` 初始化 `core.hooksPath=.husky/_`。
`.husky/pre-commit` 对暂存代码运行 ESLint 修复和 Prettier，文档及配置运行 Prettier。
使用项目锁定的 Node 24 与 pnpm 12；不要通过跳过 Hook 完成同步提交。
生成的依赖补丁不能手工改 hunk 或 hash，也不应按普通源码格式化。

## 升级与验证

1. 拉取上游并记录目标提交，保留合并前的本地特性与可恢复引用
2. 对照实际安装版本、`patchedDependencies` 和锁文件，检查私有字段经过克隆、优化后仍存在
3. 检查 DOM 包含关系、尺寸测量、animator 释放和时间线快照协议
4. 通过 `pnpm patch` 编辑实际版本，再执行 `pnpm patch-commit`；同步 ESM、CommonJS、声明和 CSS
5. 运行 `pnpm typecheck`、`pnpm test`、`pnpm lint` 和 `pnpm exec electron-vite build`
6. 用真实 Electron 检查 ruby、宽窄发音、强调、换行、跳转、暂停与资源销毁，记录 60 秒内存样本
7. 提交前对全部纳入提交的可格式化文件执行 Prettier，并让提交 Hook 正常运行

### 2026-10-26 验证范围

合并前：Node 45 项、Vitest 258 项、Node/Web 类型检查通过。
合并后：Node 66 项、Vitest 705 项、Node/Web 类型、全仓 ESLint 与生产构建通过。
其中设置迁移回归覆盖旧总开关、分项关闭与再次恢复配置。

真实 Electron 对照夹具同时渲染 AMLL 与默认引擎，各加载 120 行，包含 ruby、
宽发音、强调与对唱。暂停前后帧计数相同，销毁后两套播放器节点和动画均为 0。
60 秒 Browser/GPU/Tab 工作集约为 110/118/160 MB 与 102/123/176 MB。
新版最终持有 338 个动画，基线 166 个，视口内构建量和布局也不同，因此不能据此断言内存无回归。
夹具窗口未显示，RAF 约 1Hz；此样本只用于常驻资源与释放对照，不代表完整播放器前台负载。
已尝试 `pnpm test:native`，在编译依赖 `signalsmith-stretch / ffmpeg_audio_sys` 时
因本机缺少 `libclang` 中断，音频引擎尚未执行到 Rust 测试用例。
单独运行其余三个原生 crate 的测试命令通过：音频捕获和任务栏模块编译成功，
媒体控制模块的 Discord 关闭/重启测试通过。
未执行安装包构建及完整应用的 10 分钟内存验收。

0.5.2 的历史实现与验收记录可从合并前提交 `d9e1735f` 查询。
