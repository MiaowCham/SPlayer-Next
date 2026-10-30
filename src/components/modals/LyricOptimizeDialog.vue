<script setup lang="ts">
import { useLyricOptimizeDialog } from "@/composables/useLyricOptimizeDialog";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import type { LyricFormat } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { compactTtmlToPretty, prettyTtmlToCompact } from "@/utils/lyric/ttmlBeautify";
import { normalizeTtml } from "@shared/utils/ttml";

const optimize = useLyricOptimizeDialog();
const { t } = useI18n();

/** 可内嵌翻译/发音的格式（无需单独文件） */
const EMBEDDED_FORMATS = new Set<LyricFormat>(["ttml", "ttmlLine", "lrcn", "lqe"]);

const candidate = computed(() => optimize.candidate.value);
const track = computed(() => optimize.track.value);
const open = computed(() => optimize.open.value);

const format = computed<LyricFormat>(() => candidate.value?.format ?? "lrc");
const isEmbedded = computed(() => EMBEDDED_FORMATS.has(format.value));

/** 当前编辑的主歌词文本 */
const mainText = ref("");
/** 翻译 / 发音文本（仅非内嵌格式显示） */
const transText = ref("");
const romajiText = ref("");

/** TTML 是否切换到美化视图 */
const showPrettyTtml = computed(() => activeTab.value === "pretty");
/** 美化 TTML（由原始 TTML 生成/编辑） */
const prettyTtml = ref("");
/** TTML 与非内嵌格式共用的当前编辑页签。 */
const activeTab = ref("main");
const isTtml = computed(() => format.value === "ttml" || format.value === "ttmlLine");
const tabs = computed(() =>
  isTtml.value
    ? [
        { key: "raw", label: t("lyricManager.rawTtml") },
        { key: "pretty", label: t("lyricManager.prettyTtml") },
      ]
    : [
        { key: "main", label: mainTabLabel.value },
        ...(!isEmbedded.value
          ? [
              { key: "trans", label: t("lyricManager.translation") },
              { key: "roma", label: t("lyricManager.romaji") },
            ]
          : []),
      ],
);
const editorText = computed({
  get: () =>
    activeTab.value === "pretty"
      ? prettyTtml.value
      : activeTab.value === "trans"
        ? transText.value
        : activeTab.value === "roma"
          ? romajiText.value
          : mainText.value,
  set: (value: string) => {
    if (activeTab.value === "pretty") prettyTtml.value = value;
    else if (activeTab.value === "trans") transText.value = value;
    else if (activeTab.value === "roma") romajiText.value = value;
    else mainText.value = value;
  },
});

/** tab 标题：按实际格式显示（如 qrc → QRC） */
const mainTabLabel = computed(() => {
  if (format.value === "ttml") return "TTML";
  if (format.value === "ttmlLine") return "TTML";
  return format.value.toUpperCase();
});

const canEmbed = computed(() => isEmbedded.value);

// 重新打开或切换候选时重置编辑状态，避免上一首歌词的 tab 和内容串入。
watch(
  [open, candidate],
  () => {
    const c = candidate.value;
    if (!open.value || !c) return;
    mainText.value = c.content ?? "";
    transText.value = c.translation ?? "";
    romajiText.value = c.romaji ?? "";
    activeTab.value = isTtml.value ? "raw" : "main";
    if (isTtml.value) {
      try {
        const normalized = normalizeTtml(mainText.value);
        prettyTtml.value = normalized.formatted
          ? mainText.value
          : compactTtmlToPretty(mainText.value);
      } catch {
        // 保留无效文本供用户修正，保存时由解析校验阻止写入。
        prettyTtml.value = mainText.value;
      }
    }
  },
  { immediate: true },
);

/** 保存：把编辑结果写回本地歌词 */
const save = async (): Promise<void> => {
  if (!candidate.value || !track.value) return;
  const trackData = track.value as unknown as Track;
  const c = candidate.value;
  let content =
    (format.value === "ttml" || format.value === "ttmlLine") && showPrettyTtml.value
      ? prettyTtmlToCompact(prettyTtml.value)
      : mainText.value;
  if (isTtml.value) {
    try {
      content = normalizeTtml(content).content;
      if (
        new DOMParser().parseFromString(content, "application/xml").querySelector("parsererror")
      ) {
        throw new Error("TTML XML 格式无效");
      }
    } catch {
      toast.error(t("lyricManager.invalidTtml"));
      return;
    }
  }
  const trans = canEmbed.value ? undefined : transText.value;
  const romaji = canEmbed.value ? undefined : romajiText.value;

  // 无修改的保存（仅本地歌词）被拒绝
  const unchanged =
    content === c.content &&
    (trans ?? "") === (c.translation ?? "") &&
    (romaji ?? "") === (c.romaji ?? "");
  if (c.local && unchanged) {
    toast.info(t("lyricManager.optimizeUnchanged"));
    return;
  }

  // 已是本地歌词：改写前二次确认
  if (c.local) {
    const confirmed = await dialog.confirm({
      title: t("lyricManager.optimizeOverwriteTitle"),
      description: t("lyricManager.optimizeOverwriteDesc"),
      type: "warning",
    });
    if (!confirmed) return;
  }

  try {
    // IPC 需要可克隆的纯对象；构造最小字段，避免 Vue 只读代理无法被 structuredClone
    const ok = await window.api.lyrics.saveOptimizedLyric(
      {
        source: trackData.source,
        id: trackData.id,
        title: trackData.title,
        artists: trackData.artists?.map((artist) => ({ name: artist.name })),
      },
      {
        id: c.id,
        origin: c.origin,
        platform: c.platform,
        format: c.format,
        filename: c.filename,
        content: c.content,
        translation: c.translation,
        translationFormat: c.translationFormat,
        romaji: c.romaji,
        romajiFormat: c.romajiFormat,
        local: c.local,
        active: c.active,
        extra: c.extra ? { id: c.extra.id, mid: c.extra.mid, hash: c.extra.hash } : undefined,
      },
      { content, translation: trans, romaji },
    );
    if (ok) {
      toast.success(t("lyricManager.optimizeSaved"));
      optimize.hide();
    } else {
      toast.error(t("lyricManager.optimizeSaveFailed"));
    }
  } catch (e) {
    console.error("[lyricOptimize] save failed:", e);
    toast.error(t("lyricManager.optimizeSaveFailed"));
  }
};

/** 切换真实 Tab 前同步两个 TTML 视图，初始化不触发反向转换。 */
const switchTab = (nextTab: string): void => {
  if (nextTab === activeTab.value) return;
  if (isTtml.value) {
    if (activeTab.value === "pretty") mainText.value = prettyTtmlToCompact(prettyTtml.value);
    else prettyTtml.value = compactTtmlToPretty(mainText.value);
  }
  activeTab.value = nextTab;
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('lyricManager.optimize')"
    width="720px"
    tall
    @update:open="optimize.setOpen($event)"
  >
    <div class="flex flex-col gap-3">
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="switchTab" />
      <textarea
        v-model="editorText"
        :aria-label="tabs.find((tab) => tab.key === activeTab)?.label"
        class="w-full h-[28rem] bg-surface-panel rounded-lg p-3 text-sm font-mono resize-y"
        spellcheck="false"
      />
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="save">{{ t("common.save") }}</SButton>
    </template>
  </SDialog>
</template>
