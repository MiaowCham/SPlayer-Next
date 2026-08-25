import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import IconLucideFlaskConical from "~icons/lucide/flask-conical";

const devTag = { text: "Dev", type: "warning" } as const;

const isExperimentalEnabled = () => useSettingsStore().experimental.enabled;
const isAppleMusicDevBg = () => useSettingsStore().player.playerBgType === "apple-music-dev";
const isEarlyEndEnabled = () => useSettingsStore().lyric.earlyEndMode !== "off";
const isAmllEngine = () => useSettingsStore().lyric.engine === "amll";

const disableAppleMusicBg = (enabled?: unknown): void => {
  if (enabled !== false) return;
  const store = useSettingsStore();
  if (
    store.player.playerBgType !== "apple-music-dev" &&
    store.player.playerBgType !== "apple-music-beta"
  ) {
    return;
  }
  store.player.playerBgType = "animation";
  store.afterLocalChange("player.playerBgType", "animation");
};

const disableExperimentalFeatures = (enabled?: unknown): void => {
  if (enabled !== false) return;
  useSettingsStore().disableExperimentalFeatures();
};

const experimentalCategory: SettingCategory = {
  id: "experimental",
  icon: IconLucideFlaskConical,
  tag: devTag,
  visible: isExperimentalEnabled,
  sections: [
    {
      id: "experimentalGeneral",
      tag: devTag,
      items: [
        {
          key: "experimentalFeaturesEnabled",
          type: "switch",
          binding: { store: "settings", path: "experimental.enabled" },
          defaultValue: false,
          action: disableExperimentalFeatures,
        },
      ],
    },
    {
      id: "experimentalBackground",
      tag: devTag,
      items: [
        {
          key: "appleMusicBgEnabled",
          type: "switch",
          binding: { store: "settings", path: "player.appleMusicBgEnabled" },
          defaultValue: false,
          action: disableAppleMusicBg,
          hideChildren: true,
          children: [
            {
              key: "appleMusicBgFlowSpeed",
              type: "slider",
              binding: { store: "settings", path: "player.appleMusicBgFlowSpeed" },
              min: 0.5,
              max: 10,
              step: 0.05,
              defaultValue: 1,
              marks: { 0.5: "0.5", 1: "1", 5: "5", 10: "10" },
            },
            {
              key: "appleMusicBgDistortion",
              type: "slider",
              binding: { store: "settings", path: "player.appleMusicBgDistortion" },
              min: 0,
              max: 2,
              step: 0.05,
              defaultValue: 1,
              marks: { 0: "0", 1: "1", 2: "2" },
              visible: isAppleMusicDevBg,
            },
            {
              key: "appleMusicBgRenderScale",
              type: "slider",
              binding: { store: "settings", path: "player.appleMusicBgRenderScale" },
              min: 0.3,
              max: 1,
              step: 0.1,
              defaultValue: 0.5,
              marks: { 0.3: "0.3", 0.5: "0.5", 1: "1" },
            },
            {
              key: "appleMusicBgFps",
              type: "slider",
              binding: { store: "settings", path: "player.appleMusicBgFps" },
              min: 24,
              max: 60,
              step: 2,
              defaultValue: 30,
              marks: { 24: "24", 30: "30", 60: "60" },
            },
            {
              key: "appleMusicBgBlurStrength",
              type: "slider",
              binding: { store: "settings", path: "player.appleMusicBgBlurStrength" },
              min: 0,
              max: 3,
              step: 1,
              defaultValue: 2,
              marks: { 0: "0.5", 1: "1", 2: "2", 3: "3" },
            },
            {
              key: "appleMusicBgDimness",
              type: "slider",
              binding: { store: "settings", path: "player.appleMusicBgDimness" },
              min: 0,
              max: 0.6,
              step: 0.02,
              defaultValue: 0.1,
              marks: { 0: "0", 0.1: "0.1", 0.3: "0.3", 0.6: "0.6" },
            },
            {
              key: "appleMusicBgFreezeOnPause",
              type: "switch",
              binding: { store: "settings", path: "player.appleMusicBgFreezeOnPause" },
              defaultValue: false,
            },
            {
              key: "appleMusicBgBeat",
              type: "switch",
              binding: { store: "settings", path: "player.appleMusicBgBeat" },
              defaultValue: true,
              children: [
                {
                  key: "appleMusicBgBeatStrength",
                  type: "slider",
                  binding: { store: "settings", path: "player.appleMusicBgBeatStrength" },
                  min: 0.25,
                  max: 10,
                  step: 0.05,
                  defaultValue: 1,
                  marks: { 0.25: "0.25", 1: "1", 5: "5", 10: "10" },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "experimentalLyric",
      tag: devTag,
      items: [
        {
          key: "largerLyricText",
          type: "select",
          binding: { store: "settings", path: "lyric.largerLyricText" },
          options: [
            { value: "lyrics", labelKey: "settings.largerLyricText.lyrics" },
            { value: "pronunciation", labelKey: "settings.largerLyricText.pronunciation" },
          ],
          defaultValue: "lyrics",
        },
        {
          key: "forceLinePronunciationAsMain",
          type: "switch",
          binding: { store: "settings", path: "lyric.forceLinePronunciationAsMain" },
          defaultValue: false,
        },
        {
          key: "independentWordRomanizationProgress",
          type: "switch",
          binding: {
            store: "settings",
            path: "lyric.independentWordRomanizationProgress",
          },
          defaultValue: false,
          visible: isAmllEngine,
        },
        {
          key: "maxHighlightedLines",
          type: "select",
          binding: { store: "settings", path: "lyric.maxHighlightedLines" },
          options: [
            { value: 2, labelKey: "settings.maxHighlightedLines.two" },
            { value: 3, labelKey: "settings.maxHighlightedLines.three" },
            { value: "unlimited", labelKey: "settings.maxHighlightedLines.unlimited" },
          ],
          defaultValue: "unlimited",
        },
        {
          key: "earlyEndMode",
          type: "select",
          binding: { store: "settings", path: "lyric.earlyEndMode" },
          options: [
            { value: "off", labelKey: "settings.earlyEndMode.off" },
            { value: "conservative", labelKey: "settings.earlyEndMode.conservative" },
            { value: "aggressive", labelKey: "settings.earlyEndMode.aggressive" },
          ],
          defaultValue: "off",
          hideChildren: true,
          childrenCondition: isEarlyEndEnabled,
          children: [
            {
              key: "earlyEndGapThreshold",
              type: "slider",
              binding: { store: "settings", path: "lyric.earlyEndGapThreshold" },
              min: 0,
              max: 3000,
              step: 50,
              defaultValue: 1300,
              unit: "ms",
              marks: { 0: "0", 1300: "1300", 3000: "3000" },
            },
            {
              key: "earlyEndAdvance",
              type: "slider",
              binding: { store: "settings", path: "lyric.earlyEndAdvance" },
              min: 100,
              max: 2000,
              step: 50,
              defaultValue: 700,
              unit: "ms",
              marks: { 100: "100", 700: "700", 1200: "1200", 2000: "2000" },
            },
            {
              key: "earlyEndScrollLead",
              type: "slider",
              binding: { store: "settings", path: "lyric.earlyEndScrollLead" },
              min: 500,
              max: 3000,
              step: 50,
              defaultValue: 850,
              unit: "ms",
              marks: { 500: "500", 850: "850", 1500: "1500", 3000: "3000" },
            },
            {
              key: "multiLineOverlapThreshold",
              type: "slider",
              binding: { store: "settings", path: "lyric.multiLineOverlapThreshold" },
              min: 0,
              max: 3000,
              step: 10,
              defaultValue: 490,
              unit: "ms",
              marks: { 0: "0", 490: "490", 3000: "3000" },
            },
          ],
        },
        {
          key: "earlyEndAdvanceToNextLine",
          type: "switch",
          binding: { store: "settings", path: "lyric.earlyEndAdvanceToNextLine" },
          defaultValue: false,
        },
        {
          key: "lineSelectionPreference",
          type: "select",
          binding: { store: "settings", path: "lyric.lineSelectionPreference" },
          options: [
            { value: "default", labelKey: "settings.lineSelectionPreference.default" },
            { value: "early-end", labelKey: "settings.lineSelectionPreference.earlyEnd" },
          ],
          defaultValue: "default",
        },
      ],
    },
  ],
};

export default experimentalCategory;
