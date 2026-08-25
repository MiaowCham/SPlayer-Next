import { describe, expect, it } from "vitest";
import { bestExternalIndex, detectFormat, parseLyric } from "./parse";

describe("lyric parse", () => {
  it("根据内容识别常见歌词格式", () => {
    expect(detectFormat("[00:01.00]歌词")).toBe("lrc");
    expect(detectFormat("1\n00:00:01,000 --> 00:00:02,000\n歌词")).toBe("srt");
    expect(detectFormat('<tt xmlns="http://www.w3.org/ns/ttml"></tt>')).toBe("ttml");
    expect(detectFormat("[1000,500](1000,500,0)歌词")).toBe("yrc");
    expect(detectFormat("[1000,500]歌词(1000,500)")).toBe("qrc");
    expect(detectFormat("[Lyrics Next]\n[version:2.3]\n[00:01.000]歌词")).toBe("lrcn");
    expect(detectFormat("[translate: format@LRCN Trans]\n[L1]翻译")).toBe("lnt");
  });

  it("按照指定优先级选择外部歌词", () => {
    const lyrics = [{ format: "lrc" as const }, { format: "ttml" as const }];

    expect(bestExternalIndex(lyrics, ["ttml", "lrc"])).toBe(1);
    expect(bestExternalIndex([], ["ttml", "lrc"])).toBe(-1);
  });

  it("LRC 会忽略元数据、按时间排序并展开多时间戳", () => {
    const lines = parseLyric(
      { content: "[ar:歌手]\n[00:02.00]第二行\n[00:01.00][00:03.00]重复行" },
      "lrc",
    );

    expect(lines.map(({ startTime }) => startTime)).toEqual([1_000, 2_000, 3_000]);
    expect(lines.map(({ words }) => words.map(({ word }) => word).join(""))).toEqual([
      "重复行",
      "第二行",
      "重复行",
    ]);
  });

  it("在容差内配对翻译和音译，超过容差时不误配", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Hello\n[00:02.00]World",
        translation: "[00:01.20]你好\n[00:02.40]世界",
        translationFormat: "lrc",
        romaji: "[00:01.10]Harō\n[00:02.10]Wārudo",
        romajiFormat: "lrc",
      },
      "lrc",
    );

    expect(lines[0].translatedLyric).toBe("你好");
    expect(lines[1].translatedLyric).toBe("");
    expect(lines[0].romanLyric).toBe("Harō");
    expect(lines[1].romanLyric).toBe("Wārudo");
  });

  it("忽略大小写和缺失标点，仅在整行内容一致时移除逐行音译", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Same, CONTENT!\n[00:02.00]Keep this?",
        romaji: "[00:01.00]same content\n[00:02.00]keep",
        romajiFormat: "lrc",
      },
      "lrc",
    );

    expect(lines.map((line) => line.romanLyric)).toEqual(["", "keep"]);
  });

  it("整行逐字音译与主歌词一致时只清除逐字音译", () => {
    const [line] = parseLyric(
      {
        content:
          "[Lyrics Next]\n[lyrics: format@LRCN]\n[1.000,2.000,,L1]<1.000,1.500>Same, <1.500,2.000>CONTENT!\n[transliteration: format@LRC]\n[1.000]different",
        romaji: "[transliteration: format@LNT]\n[L1]<1.000,1.500>same<1.500,2.000>content",
        romajiFormat: "lnt",
      },
      "lrcn",
    );

    expect(line.romanLyric).toBe("different");
    expect(line.words.every((word) => word.romanWord === undefined)).toBe(true);
  });

  it("LRCN 逐行音译整行一致时只清除逐行音译", () => {
    const [line] = parseLyric(
      {
        content:
          "[Lyrics Next]\n[lyrics: format@LRCN]\n[1.000,2.000,,L1]<1.000,1.500>same <1.500,2.000>content\n[transliteration: format@LRCN Trans]\n[L1]<1.000,1.500>different<1.500,2.000>words\n[transliteration: format@LRC]\n[1.000]same content",
      },
      "lrcn",
    );

    expect(line.romanLyric).toBe("");
    expect(line.words.map((word) => word.romanWord)).toEqual(["different", "words"]);
  });

  it("按应用语言选择 TTML 元数据翻译，并在允许时回退中文", () => {
    const content =
      '<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata><translations><translation xml:lang="en-US"><text for="L1">English translation</text></translation><translation xml:lang="zh-CN"><text for="L1">中文翻译</text></translation></translations></metadata></head><body><div><p begin="1s" end="2s" key="L1">原文</p></div></body></tt>';

    expect(parseLyric({ content }, "ttml", "en-US")[0].translatedLyric).toBe("English translation");
    expect(parseLyric({ content }, "ttml", "ja-JP")[0].translatedLyric).toBe("中文翻译");
    expect(
      parseLyric({ content }, "ttml", "ja-JP", { fallbackTranslation: false })[0].translatedLyric,
    ).toBe("");
  });

  it("按应用语言选择 LRCN Trans 翻译，并保留无语言标记时的首个翻译", () => {
    const content =
      "[Lyrics Next]\n[lyrics: format@LRCN]\n[1.000,2.000,,L1]原文\n[translate: format@LRCN Trans]\n[lang:en-US]\n[1.000,L1]English translation\n[translate: format@LRCN Trans]\n[lang:zh-CN]\n[1.000,L1]中文翻译";

    expect(parseLyric({ content }, "lrcn", "en-US")[0].translatedLyric).toBe("English translation");
    expect(parseLyric({ content }, "lrcn", "ja-JP")[0].translatedLyric).toBe("中文翻译");
    expect(
      parseLyric({ content }, "lrcn", "ja-JP", { fallbackTranslation: false })[0].translatedLyric,
    ).toBe("");

    const withoutLang =
      "[Lyrics Next]\n[lyrics: format@LRCN]\n[1.000,2.000,,L1]原文\n[translate: format@LRCN Trans]\n[1.000,L1]首个翻译\n[translate: format@LRCN Trans]\n[1.000,L1]第二个翻译";
    expect(
      parseLyric({ content: withoutLang }, "lrcn", "ja-JP", { fallbackTranslation: false })[0]
        .translatedLyric,
    ).toBe("首个翻译");

    const mixedLang =
      "[Lyrics Next]\n[lyrics: format@LRCN]\n[1.000,2.000,,L1]原文\n[translate: format@LRCN Trans]\n[1.000,L1]未标记翻译\n[translate: format@LRCN Trans]\n[lang:en-US]\n[1.000,L1]English translation";
    expect(
      parseLyric({ content: mixedLang }, "lrcn", "ja-JP", { fallbackTranslation: false })[0]
        .translatedLyric,
    ).toBe("");
  });

  it("TTML 逐字音译整行一致时清除，且保留不同的逐行音译", () => {
    const [line] = parseLyric(
      {
        content:
          '<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata><transliterations><transliteration><text for="L1"><span begin="1s" end="1.5s">same</span><span begin="1.5s" end="2s">content</span></text></transliteration></transliterations></metadata></head><body><div><p begin="1s" end="2s" key="L1"><span begin="1s" end="1.5s">same </span><span begin="1.5s" end="2s">content</span><span role="x-roman">different</span></p></div></body></tt>',
      },
      "ttml",
    );

    expect(line.romanLyric).toBe("different");
    expect(line.words.every((word) => word.romanWord === undefined)).toBe(true);
  });

  it("TTML 逐行音译整行一致时清除，且保留不同的逐字音译", () => {
    const [line] = parseLyric(
      {
        content:
          '<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata><transliterations><transliteration><text for="L1">same content<span begin="1s" end="1.5s">different</span><span begin="1.5s" end="2s">words</span></text></transliteration></transliterations></metadata></head><body><div><p begin="1s" end="2s" key="L1"><span begin="1s" end="1.5s">same </span><span begin="1.5s" end="2s">content</span></p></div></body></tt>',
      },
      "ttml",
    );

    expect(line.romanLyric).toBe("");
    expect(line.words.map((word) => word.romanWord)).toEqual(["different", "words"]);
  });

  it("过滤无意义的翻译占位内容", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Hello\n[00:02.00]World",
        translation: "[00:01.00]//\n[00:02.00]作品的著作权由原作者所有",
        translationFormat: "lrc",
      },
      "lrc",
    );

    expect(lines.every(({ translatedLyric }) => translatedLyric === "")).toBe(true);
  });

  it("将空时间标签作为上一行结束时间且不生成空行", () => {
    const lines = parseLyric({ content: "[00:00.00]A\n[00:01.00]\n[00:02.00]B" }, "lrc");

    expect(lines).toHaveLength(2);
    expect(lines[0].endTime).toBe(1_000);
    expect(lines[0].words[0].endTime).toBe(1_000);
    expect(lines[1].startTime).toBe(2_000);
  });

  it("使用行尾时间标签作为当前 LRC 行结束时间", () => {
    const lines = parseLyric({ content: "[00:04.234]歌词[00:05.253]" }, "lrc");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ startTime: 4_234, endTime: 5_253 });
    expect(lines[0].words).toEqual([{ startTime: 4_234, endTime: 5_253, word: "歌词" }]);
  });

  it("合并同刻翻译时保留空时间标签指定的结束时间", () => {
    const lines = parseLyric({ content: "[00:01.00]Original\n[00:01.00]翻译\n[00:02.50]" }, "lrc");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      startTime: 1_000,
      endTime: 2_500,
      translatedLyric: "翻译",
    });
    expect(lines[0].words[0].endTime).toBe(2_500);
  });

  it("使用 ESLRC 末尾时间标签结束最后一个字", () => {
    const [line] = parseLyric({ content: "[00:00.00]<00:00.00>A<00:01.00>B<00:02.00>" }, "lrc");

    expect(line.words).toEqual([
      { startTime: 0, endTime: 1_000, word: "A" },
      { startTime: 1_000, endTime: 2_000, word: "B" },
    ]);
    expect(line.endTime).toBe(2_000);
  });

  it("解析 LRCN 的 SMIL 时间、省略结束时间和背景行", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[version:2.3]\n[00:01.000,,v1,L1]<00:01.000,00:01.500>你<00:01.500>好\n[x-bg]<00:01.200,00:01.900>啊\n[00:03.000,00:04.000,,L2]世界",
      },
      "lrcn",
    );

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ startTime: 1_000, endTime: 3_000, isBG: false });
    expect(lines[0].words).toEqual([
      { word: "你", startTime: 1_000, endTime: 1_500 },
      { word: "好", startTime: 1_500, endTime: 3_000 },
    ]);
    expect(lines[1]).toMatchObject({ startTime: 1_200, endTime: 1_900, isBG: true });
    expect(lines[2]).toMatchObject({ startTime: 3_000, endTime: 4_000 });
  });

  it("应用 LRCN 平台 offset，并使用 LNT 行 ID 配对附属歌词", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[offset:100]\n[offset:netease@200]\n[00:01.000,00:02.000,,L1]A\n[00:02.000,00:03.000,,L2]B",
        translation: "[translate: format@LRCN Trans]\n[L2]乙\n[L1]甲",
        translationFormat: "lnt",
      },
      "lrcn",
      "",
      { platform: "netease" },
    );

    expect(lines.map((line) => line.startTime)).toEqual([1_200, 2_200]);
    expect(lines.map((line) => line.translatedLyric)).toEqual(["甲", "乙"]);
  });

  it("解析 LRCN 内嵌 LNT 翻译和逐字音译", () => {
    const [line] = parseLyric(
      {
        content:
          "[Lyrics Next]\n[version:2.3]\n[lyrics: format@LRCN]\n[00:01.000,00:02.000,,L1]<00:01.000,00:01.500>你<00:01.500,00:02.000>好\n[translate: format@LNT]\n[L1]你好\n[transliteration: format@LRCN Trans]\n[L1]<00:01.000,00:01.500>ni<00:01.500,00:02.000>hao",
      },
      "lrcn",
    );

    expect(line.translatedLyric).toBe("你好");
    expect(line.romanLyric).toBe("");
    expect(line.words.map((word) => word.romanWord)).toEqual(["ni", "hao"]);
  });

  it("同时保留 LRCN Trans 逐字音译和 LRC 整行音译", () => {
    const [line] = parseLyric(
      {
        content:
          "[Lyrics Next]\n[lyrics: format@Lyrics Next]\n[7.443,10.624,v1,L1]<7.443,7.835>用法<7.835,8.234>容量\n[transliteration: format@LRCN Trans]\n[7.443,L1]<7.443,7.835>Youhou<7.835,8.234>yoryo\n[transliteration: format@LRC]\n[7.443]Youhou yoryo",
      },
      "lrcn",
    );

    expect(line.romanLyric).toBe("Youhou yoryo");
    expect(line.words.map((word) => word.romanWord)).toEqual(["Youhou", "yoryo"]);
  });

  it("应用 LRCN offset 后仍按时间把 LNT 发音传递到对应单词", () => {
    const [line] = parseLyric(
      {
        content:
          "[Lyrics Next]\n[offset:500]\n[00:01.000,00:02.000,,L1]<00:01.000,00:01.100>，<00:01.100,00:01.500>你<00:01.500,00:02.000>好",
        romaji:
          "[transliteration: format@LNT]\n[L1]<00:01.100,00:01.500> ni <00:01.500,00:02.000> hao ",
        romajiFormat: "lnt",
      },
      "lrcn",
    );

    expect(line.words.map((word) => word.romanWord)).toEqual([undefined, "ni", "hao"]);
  });

  it("LRCN Trans 逐字音译按行 ID 精确配对，允许乱序且未知 ID 保持为空", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[1.000,2.000,,L1]<1.000,2.000>甲\n[2.000,3.000,,L2]<2.000,3.000>乙\n[3.000,4.000,,L3]<3.000,4.000>丙",
        romaji:
          "[transliteration: format@LRCN Trans]\n[2.000,L2]<2.000,3.000>second\n[9.000,L9]<9.000,10.000>unknown\n[1.000,L1]<1.000,2.000>first",
        romajiFormat: "lnt",
      },
      "lrcn",
    );

    expect(lines.map((line) => line.words[0].romanWord)).toEqual(["first", "second", undefined]);
  });

  it("补齐 LNT 完整行中省略的逐字时间并跳过无发音标点", () => {
    const [line] = parseLyric(
      {
        content: "[Lyrics Next]\n[1.000,2.000,,L1]<1.000,1.100>，<1.100,1.500>你<1.500,2.000>好",
        romaji: "[transliteration: format@LNT]\n[1.000,L1]ni <1.500>hao",
        romajiFormat: "lnt",
      },
      "lrcn",
    );

    expect(line.words.map((word) => word.romanWord)).toEqual([undefined, "ni", "hao"]);
  });

  it("清除 LNT 背景翻译括号且不跨主行误配背景", () => {
    const lines = parseLyric(
      {
        content: "[Lyrics Next]\n[1.000,2.000,,L1]第一行\n[2.000,3.000,,L2]第二行\n[x-bg]（背景）",
        translation:
          "[translate: format@LNT]\n[L1]First\n[x-bg]（Wrong backing）\n[L2]Second\n[x-bg]（Backing）",
        translationFormat: "lnt",
      },
      "lrcn",
    );

    expect(lines[0].translatedLyric).toBe("First");
    expect(lines[1].translatedLyric).toBe("Second");
    expect(lines[2].translatedLyric).toBe("Backing");
  });

  it("LRCN 交叠主行与无时间背景行分别配对各自的逐行音译", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[lyrics: format@LRCN]\n[2:57.896,3:02.816,v1,L47]主行四十七\n[x-bg]<3:00.687,3:02.816>(背景四十七)\n[3:01.607,3:04.116,v2,L48]主行四十八\n[x-bg]<3:03.505,3:04.116>(背景四十八)\n[transliteration: format@LRC]\n[2:57.896]roman main 47\n[x-bg](roman background 47)\n[3:01.607]roman main 48\n[x-bg](roman background 48)",
      },
      "lrcn",
    );

    expect(lines.map((line) => line.romanLyric)).toEqual([
      "roman main 47",
      "roman background 47",
      "roman main 48",
      "roman background 48",
    ]);
  });

  it("LRC 行级音译缺少前置背景行时不应串到后续背景行", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[lyrics: format@LRCN]\n[1.000,2.000,v1,L1]第一行\n[x-bg]<1.500,2.000>(第一背景)\n[2.000,3.000,v1,L2]第二行\n[x-bg]<2.500,3.000>(第二背景)\n[transliteration: format@LRC]\n[2.000]second main\n[x-bg](second background)",
      },
      "lrcn",
    );

    expect(lines.map((line) => line.romanLyric)).toEqual([
      "",
      "",
      "second main",
      "second background",
    ]);
  });

  it("隐藏 LRCN 背景歌词的显示括号", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[00:01.000,00:02.000]主歌词\n[x-bg]<00:01.000,00:01.500>（背景<00:01.500,00:02.000>和声）",
      },
      "lrcn",
    );

    expect(lines[1].isBG).toBe(true);
    expect(lines[1].words.map((word) => word.word).join("")).toBe("背景和声");
  });

  it("根据 LRCN Agent 传递对唱方向，特殊 Agent 不影响后续比较", () => {
    const lines = parseLyric(
      {
        content:
          "[Lyrics Next]\n[agent:person@v1]\n[agent:person@v2]\n[agent:group@g]\n[agent:other@o]\n[1.000,2.000,v1,L1]甲\n[2.000,3.000,v1,L2]乙\n[3.000,4.000,v2,L3]丙\n[4.000,5.000,g,L4]合\n[x-bg]（和声）\n[5.000,6.000,v2,L5]丁\n[6.000,7.000,o,L6]旁\n[7.000,8.000,v1,L7]戊",
      },
      "lrcn",
    );

    expect(lines.map((line) => line.isDuet)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it("将首个 v2 Agent 作为右侧对唱行", () => {
    const [line] = parseLyric(
      { content: "[Lyrics Next]\n[agent:person@v2]\n[1.000,2.000,v2,L1]右侧" },
      "lrcn",
    );

    expect(line.isDuet).toBe(true);
  });

  it("识别 LQE 并复用 LyS 主歌词、LRC 翻译和发音", () => {
    const [line] = parseLyric(
      {
        content:
          "[Lyricify Quick Export]\n[lyrics: format@Lyricify Syllable]\n[4]你(1000,500)好(1500,500)\n[translation: format@LRC]\n[00:01.000]你好\n[pronunciation: format@LRC, language@romaji]\n[00:01.000]ni hao",
      },
      "lqe",
    );

    expect(detectFormat("[Lyricify Quick Export]\n[version:1.0]")).toBe("lqe");
    expect(line.words.map((word) => word.word).join("")).toBe("你好");
    expect(line.translatedLyric).toBe("你好");
    expect(line.romanLyric).toBe("ni hao");
  });
});
