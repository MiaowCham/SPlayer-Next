# 第三方声明

## 汉语拼音识别

“隐藏中文发音”使用 [zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro)
`3.29.3` 的普通话字典核对读音。版权所有 `Copyright (c) 2022-present zh-lx`，
采用 MIT 许可证，完整文本随应用分发，见 [许可证](public/licenses/pinyin-pro.txt)。
字典仅在启用该选项且歌词存在发音时延迟加载；分类与展示过滤为本项目实现。

## 仿 Apple Music 背景

`src/modules/apple-music-background/` 中的网格数据、算法、着色器与渲染管线参考并改写自
[WXRIW/Lyricify-Backgrounds](https://github.com/WXRIW/Lyricify-Backgrounds)。
参考版本：`bdd31b5c5f678bbdf8946c6258883291f6b58657`。
原项目采用 Apache-2.0；本项目将 C# / HLSL 实现移植为 TypeScript / WebGL2 / GLSL ES，
完整许可证随渲染端资源分发，见 [许可证](public/licenses/Lyricify-Backgrounds.txt) 和
[移植声明](public/licenses/Lyricify-Backgrounds-NOTICE.txt)。

## Apple Music TTML 歌词来源

`electron/main/services/appleMusicLyrics.ts` 的请求流程参考并改写自
[am-ttml-fetch](https://github.com/kid141252010/am-ttml-fetch)，版权所有 1412。

参考版本：`a67c4e2efc616b164ca001e1a4bb306fb3f606b8`（2026-08-25）。
原项目采用 AGPL-3.0-or-later；本项目同样采用 AGPL-3.0，因此该改写实现按
AGPL-3.0-or-later 提供。完整许可证文本见本仓库 [LICENSE](LICENSE)。
