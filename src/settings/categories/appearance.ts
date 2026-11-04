import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import FontConfig from "@/components/settings/custom/FontConfig.vue";
import BackgroundImagePicker from "@/components/settings/custom/BackgroundImagePicker.vue";
import SidebarCustomizeConfig from "@/components/settings/custom/SidebarCustomizeConfig.vue";
import IconLucidePalette from "~icons/lucide/palette";

const appearanceCategory: SettingCategory = {
  id: "appearance",
  icon: IconLucidePalette,
  sections: [
    {
      id: "theme",
      items: [
        {
          key: "themeMode",
          type: "select",
          binding: { store: "theme", path: "mode" },
          options: [
            { value: "light", labelKey: "settings.themeMode.light" },
            { value: "dark", labelKey: "settings.themeMode.dark" },
            { value: "system", labelKey: "settings.themeMode.system" },
          ],
          defaultValue: "system",
          // 图片背景下强制暗色，禁用此开关
          disabled: () => useThemeStore().appearanceStyle === "image",
        },
        {
          key: "themeSource",
          type: "select",
          binding: { store: "theme", path: "source" },
          options: [
            { value: "default", labelKey: "settings.themeSource.default" },
            { value: "custom", labelKey: "settings.themeSource.custom" },
            { value: "cover", labelKey: "settings.themeSource.cover" },
            { value: "solid", labelKey: "settings.themeSource.solid" },
          ],
          defaultValue: "default",
          childrenCondition: () => useThemeStore().source === "custom",
          hideChildren: true,
          children: [
            {
              key: "customColor",
              type: "color",
              binding: { store: "theme", path: "customColor" },
              defaultValue: "#fe7971",
              showAlpha: false,
              colorFormat: "hex",
            },
          ],
        },
        {
          key: "globalTint",
          type: "switch",
          binding: { store: "theme", path: "globalTint" },
          defaultValue: false,
          // 图片背景下强制开启全局着色，禁用切换
          disabled: () => useThemeStore().appearanceStyle === "image",
        },
      ],
    },
    {
      id: "appearanceStyle",
      items: [
        {
          key: "appearanceStyle",
          type: "select",
          binding: { store: "theme", path: "appearanceStyle" },
          options: [
            { value: "solid", labelKey: "settings.appearanceStyle.solid" },
            { value: "image", labelKey: "settings.appearanceStyle.image" },
          ],
          defaultValue: "solid",
          childrenCondition: () => useThemeStore().appearanceStyle === "image",
          hideChildren: true,
          children: [
            {
              key: "backgroundImage",
              type: "custom",
              component: BackgroundImagePicker,
            },
            {
              key: "backgroundBlur",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.blur" },
              min: 0,
              max: 80,
              step: 1,
              defaultValue: 0,
              marks: { 0: "0", 20: "20", 40: "40", 80: "80" },
            },
            {
              key: "backgroundDim",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.dim" },
              min: 0.3,
              max: 0.9,
              step: 0.05,
              defaultValue: 0.4,
              marks: { 0.3: "0.3", 0.4: "0.4", 0.9: "0.9" },
            },
            {
              key: "backgroundScale",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.scale" },
              min: 1,
              max: 2,
              step: 0.05,
              defaultValue: 1.2,
              marks: { 1: "1", 1.2: "1.2", 2: "2" },
            },
          ],
        },
      ],
    },
    {
      id: "font",
      items: [
        {
          key: "fontConfig",
          type: "custom",
          component: FontConfig,
        },
      ],
    },
    {
      id: "layout",
      items: [
        {
          key: "layoutMode",
          type: "select",
          binding: { store: "settings", path: "appearance.layoutMode" },
          options: [
            { value: "default", labelKey: "settings.layoutMode.default" },
            { value: "sidebar-full", labelKey: "settings.layoutMode.sidebarFull" },
            { value: "floating", labelKey: "settings.layoutMode.floating" },
          ],
          defaultValue: "default",
        },
        {
          key: "songListStyle",
          type: "select",
          binding: { store: "settings", path: "appearance.songListStyle" },
          options: [
            { value: "comfortable", labelKey: "settings.songListStyle.comfortable" },
            { value: "compact", labelKey: "settings.songListStyle.compact" },
          ],
          defaultValue: "comfortable",
        },
        {
          key: "sidebarCollapsed",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarCollapsed" },
          defaultValue: false,
        },
        {
          key: "sidebarShortcutToggle",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarShortcutToggle" },
          defaultValue: false,
        },
        {
          key: "sidebarPlaylistCover",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarPlaylistCover" },
          defaultValue: false,
        },
        {
          key: "sidebarCustomize",
          type: "custom",
          component: SidebarCustomizeConfig,
        },
        {
          key: "showQualitySwitch",
          type: "switch",
          binding: { store: "settings", path: "appearance.showQualitySwitch" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "softwareAnimations",
      items: [
        {
          key: "reduceMotion",
          type: "switch",
          binding: { store: "settings", path: "appearance.reduceMotion" },
          defaultValue: false,
        },
        {
          key: "marqueeScroll",
          type: "switch",
          binding: { store: "settings", path: "appearance.marqueeScroll" },
          defaultValue: true,
        },
        {
          key: "routeTransition",
          type: "select",
          binding: { store: "settings", path: "appearance.routeTransition" },
          options: [
            { value: "none", labelKey: "settings.routeTransition.none" },
            { value: "fade", labelKey: "settings.routeTransition.fade" },
            { value: "slide", labelKey: "settings.routeTransition.slide" },
            { value: "zoom", labelKey: "settings.routeTransition.zoom" },
          ],
          defaultValue: "fade",
        },
        {
          key: "seamlessTransition",
          type: "switch",
          binding: { store: "settings", path: "appearance.seamlessTransition" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "playerBar",
      items: [
        {
          key: "showLyricInBar",
          type: "switch",
          binding: { store: "settings", path: "player.showLyricInBar" },
          defaultValue: true,
          children: [
            {
              key: "barLyricMode",
              type: "select",
              binding: { store: "settings", path: "player.barLyricMode" },
              options: [
                { value: "lyric", labelKey: "settings.barLyricMode.lyric" },
                { value: "translation", labelKey: "settings.barLyricMode.translation" },
                { value: "word", labelKey: "settings.barLyricMode.word" },
              ],
              defaultValue: "translation",
            },
          ],
        },
        {
          key: "showProgressTooltip",
          type: "switch",
          binding: { store: "settings", path: "player.showProgressTooltip" },
          defaultValue: true,
          children: [
            {
              key: "showProgressLyric",
              type: "switch",
              binding: { store: "settings", path: "player.showProgressLyric" },
              defaultValue: false,
            },
          ],
        },
        {
          key: "snapToLyric",
          type: "switch",
          binding: { store: "settings", path: "player.snapToLyric" },
          defaultValue: false,
        },
        {
          key: "timeFormat",
          type: "select",
          binding: { store: "settings", path: "player.timeFormat" },
          options: [
            { value: "current-total", labelKey: "settings.timeFormat.currentTotal" },
            { value: "remaining-total", labelKey: "settings.timeFormat.remainingTotal" },
            { value: "current-remaining", labelKey: "settings.timeFormat.currentRemaining" },
          ],
          defaultValue: "current-total",
          descriptionKey: "settings.timeFormat.description",
        },
      ],
    },
    {
      id: "fullPlayer",
      items: [
        {
          key: "playerLayout",
          type: "select",
          binding: { store: "settings", path: "player.layout" },
          options: [
            { value: "classic", labelKey: "settings.playerLayout.classic" },
            { value: "fullCover", labelKey: "settings.playerLayout.fullCover" },
            { value: "fullLyric", labelKey: "settings.playerLayout.fullLyric" },
            { value: "apple", labelKey: "settings.playerLayout.apple" },
          ],
          defaultValue: "classic",
          // 封面占比与自动居中只作用于经典布局
          childrenCondition: () => useSettingsStore().player.layout === "classic",
          hideChildren: true,
          children: [
            {
              key: "coverLyricRatio",
              type: "slider",
              binding: { store: "settings", path: "player.coverLyricRatio" },
              min: 0.3,
              max: 0.6,
              step: 0.05,
              defaultValue: 0.45,
              marks: { 0.3: "30%", 0.45: "45%", 0.6: "60%" },
            },
            {
              key: "autoCenterCover",
              type: "switch",
              binding: { store: "settings", path: "player.autoCenterCover" },
              defaultValue: true,
            },
          ],
        },
        {
          key: "showPlaybackSource",
          type: "switch",
          binding: { store: "settings", path: "player.showPlaybackSource" },
          defaultValue: false,
        },
        {
          key: "followCoverColor",
          type: "switch",
          binding: { store: "settings", path: "player.followCoverColor" },
          defaultValue: true,
        },
        {
          key: "autoImmersive",
          type: "switch",
          binding: { store: "settings", path: "player.autoImmersive" },
          defaultValue: false,
        },
        {
          key: "keepScreenAwake",
          type: "switch",
          binding: { store: "settings", path: "system.player.keepScreenAwake" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "playerBackground",
      items: [
        {
          key: "playerBgType",
          type: "select",
          binding: { store: "settings", path: "player.playerBgType" },
          options: [
            { value: "blur", labelKey: "settings.playerBgType.blur" },
            { value: "solid", labelKey: "settings.playerBgType.solid" },
            { value: "animation", labelKey: "settings.playerBgType.animation" },
            { value: "isolation", labelKey: "settings.playerBgType.isolation" },
            { value: "titanium", labelKey: "settings.playerBgType.titanium" },
            { value: "apple-music", labelKey: "settings.playerBgType.appleMusic" },
            { value: "apple-music-classic", labelKey: "settings.playerBgType.appleMusicClassic" },
          ],
          defaultValue: "blur",
          confirm: {
            when: (next) =>
              next === "animation" ||
              next === "isolation" ||
              next === "titanium" ||
              next === "apple-music" ||
              next === "apple-music-classic",
            titleKey: "settings.confirm.highResourceTitle",
            contentKey: "settings.confirm.highResourceContent",
            type: "warning",
          },
          childrenCondition: () =>
            ["animation", "isolation", "titanium", "apple-music", "apple-music-classic"].includes(
              useSettingsStore().player.playerBgType,
            ),
          hideChildren: true,
          children: [
            {
              key: "playerBgRenderer",
              type: "select",
              binding: { store: "settings", path: "player.playerBgRenderer" },
              // 仅流体动画背景依赖 Metal/Pixi 渲染器，Apple Music 两种背景用不到
              visible: () => useSettingsStore().player.playerBgType === "animation",
              options: [
                { value: "mesh", labelKey: "settings.playerBgRenderer.mesh" },
                { value: "isolation", labelKey: "settings.playerBgRenderer.isolation" },
                { value: "pixi", labelKey: "settings.playerBgRenderer.pixi" },
                { value: "titanium", labelKey: "settings.playerBgRenderer.titanium" },
              ],
              defaultValue: "mesh",
            },
            {
              key: "playerBgLightWave",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgLightWave" },
              // 光波是 isolation 独有的明度调制；独立 isolation 背景与 isolation 引擎都能用
              // Apple Music 两种背景不提供 isolation 选项
              visible: () =>
                useSettingsStore().player.playerBgType === "isolation" ||
                (useSettingsStore().player.playerBgType === "animation" &&
                  useSettingsStore().player.playerBgRenderer === "isolation"),
              defaultValue: false,
            },
            {
              key: "playerBgIsolationPalette",
              type: "select",
              binding: { store: "settings", path: "player.playerBgIsolationPalette" },
              // Apple Music 两种背景不提供 isolation 选项
              visible: () =>
                useSettingsStore().player.playerBgType === "isolation" ||
                (useSettingsStore().player.playerBgType === "animation" &&
                  useSettingsStore().player.playerBgRenderer === "isolation"),
              options: [
                { value: "auto", labelKey: "settings.playerBgIsolationPalette.auto" },
                { value: "kmeans", labelKey: "settings.playerBgIsolationPalette.kmeans" },
                { value: "octtree", labelKey: "settings.playerBgIsolationPalette.octtree" },
              ],
              defaultValue: "auto",
            },
            {
              key: "playerBgIsolationDithering",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgIsolationDithering" },
              // Apple Music 两种背景不提供 isolation 选项
              visible: () =>
                useSettingsStore().player.playerBgType === "isolation" ||
                (useSettingsStore().player.playerBgType === "animation" &&
                  useSettingsStore().player.playerBgRenderer === "isolation"),
              defaultValue: true,
            },
            {
              key: "playerBgTitaniumGrain",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgTitaniumGrain" },
              // 独立 Titanium 背景与流体下的 titanium 引擎共用这批参数
              visible: () =>
                useSettingsStore().player.playerBgType === "titanium" ||
                useSettingsStore().player.playerBgRenderer === "titanium",
              min: 0,
              max: 1,
              step: 0.05,
              defaultValue: 0.7,
            },
            {
              key: "playerBgTitaniumSparkle",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgTitaniumSparkle" },
              // 独立 Titanium 背景与流体下的 titanium 引擎共用这批参数
              visible: () =>
                useSettingsStore().player.playerBgType === "titanium" ||
                useSettingsStore().player.playerBgRenderer === "titanium",
              min: 0,
              max: 1,
              step: 0.05,
              defaultValue: 0.75,
            },
            {
              key: "playerBgTitaniumSheen",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgTitaniumSheen" },
              // 独立 Titanium 背景与流体下的 titanium 引擎共用这批参数
              visible: () =>
                useSettingsStore().player.playerBgType === "titanium" ||
                useSettingsStore().player.playerBgRenderer === "titanium",
              min: 0,
              max: 1,
              step: 0.05,
              defaultValue: 0.5,
            },
            {
              key: "playerBgTitaniumMetalness",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgTitaniumMetalness" },
              // 独立 Titanium 背景与流体下的 titanium 引擎共用这批参数
              visible: () =>
                useSettingsStore().player.playerBgType === "titanium" ||
                useSettingsStore().player.playerBgRenderer === "titanium",
              min: 0,
              max: 1,
              step: 0.05,
              defaultValue: 0.35,
            },
            {
              key: "playerBgTitaniumCrestShiftMs",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgTitaniumCrestShiftMs" },
              // 独立 Titanium 背景与流体下的 titanium 引擎共用这批参数
              visible: () =>
                useSettingsStore().player.playerBgType === "titanium" ||
                useSettingsStore().player.playerBgRenderer === "titanium",
              min: 0,
              max: 6000,
              step: 100,
              defaultValue: 2000,
            },
            {
              key: "playerBgFlowSpeed",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgFlowSpeed" },
              min: 0.1,
              max: 10,
              step: 0.1,
              defaultValue: 4,
              marks: { 0.1: "0.1", 4: "4", 10: "10" },
            },
            {
              key: "playerBgRenderScale",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgRenderScale" },
              // 钛金属细颗粒固定原生分辨率，缩放比对其无效，直接隐藏避免空拖
              visible: () =>
                useSettingsStore().player.playerBgType !== "titanium" &&
                !(
                  useSettingsStore().player.playerBgType === "animation" &&
                  useSettingsStore().player.playerBgRenderer === "titanium"
                ),
              min: 0.5,
              max: 2,
              step: 0.1,
              defaultValue: 0.5,
              marks: { 0.5: "0.5", 1: "1", 2: "2" },
            },
            {
              key: "playerBgFps",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgFps" },
              min: 24,
              max: 120,
              step: 2,
              defaultValue: 30,
              marks: { 24: "24", 60: "60", 120: "120" },
            },
            {
              key: "playerBgFreezeOnPause",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgFreezeOnPause" },
              defaultValue: false,
            },
            {
              key: "playerBgBeat",
              type: "switch",
              // 仅流体/隔离/Titanium 提供开关；Apple Music 背景自己处理节奏（经典版为静态渐变）
              visible: () =>
                ["animation", "isolation", "titanium"].includes(
                  useSettingsStore().player.playerBgType,
                ),
              binding: { store: "settings", path: "player.playerBgBeat" },
              defaultValue: false,
            },
          ],
        },
      ],
    },
  ],
};

export default appearanceCategory;
