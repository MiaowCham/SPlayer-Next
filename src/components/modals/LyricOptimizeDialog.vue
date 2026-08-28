<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLyricOptimizeDialog } from "@/composables/useLyricOptimizeDialog";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import type { LyricFormat } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { compactTtmlToPretty, prettyTtmlToCompact } from "@/utils/lyric/ttmlBeautify";

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
const showPrettyTtml = ref(true);
/** 美化 TTML（由原始 TTML 生成/编辑） */
const prettyTtml = ref("");
/** 非内嵌格式的当前编辑 tab（主歌词 / 翻译 / 发音） */
const activeTab = ref<"main" | "trans" | "roma">("main");

/** tab 标题：按实际格式显示（如 qrc → QRC） */
const mainTabLabel = computed(() => {
  if (format.value === "ttml") return "TTML";
  if (format.value === "ttmlLine") return "TTML";
  return format.value.toUpperCase();
});

const canEmbed = computed(() => isEmbedded.value);

// 打开时加载候选内容
watch(open, () => {
  const c = candidate.value;
  if (!c) return;
  mainText.value = c.content ?? "";
  transText.value = c.translation ?? "";
  romajiText.value = c.romaji ?? "";
  if (format.value === "ttml" || format.value === "ttmlLine") {
    prettyTtml.value = compactTtmlToPretty(c.content ?? "");
  }
});

/** 保存：把编辑结果写回本地歌词 */
const save = async (): Promise<void> => {
  if (!candidate.value || !track.value) return;
  const trackData = track.value as unknown as Track;
  const c = candidate.value;
  const content =
    (format.value === "ttml" || format.value === "ttmlLine") && showPrettyTtml.value
      ? prettyTtmlToCompact(prettyTtml.value)
      : mainText.value;
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
      layer: "topmost",
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

/** 切换 TTML 视图时同步内容 */
watch(showPrettyTtml, (pretty) => {
  if (format.value !== "ttml" && format.value !== "ttmlLine") return;
  if (pretty) prettyTtml.value = compactTtmlToPretty(mainText.value);
  else mainText.value = prettyTtmlToCompact(prettyTtml.value);
});
</script>

<template>
  <SDialog :open="open" :title="t('lyricManager.optimize')" width="720px" tall layer="topmost" @update:open="optimize.setOpen($event)">
    <div class="flex flex-col gap-3">
      <!-- TTML：原始 / 美化 两个 tab -->
      <template v-if="format === 'ttml' || format === 'ttmlLine'">
        <div class="flex items-center gap-1 border-b border-outline-variant/30 pb-2">
          <SButton
            :type="!showPrettyTtml ? 'primary' : 'default'"
            :variant="!showPrettyTtml ? 'filled' : 'secondary'"
            size="small"
            class="rounded-md! shadow-none!"
            @click="showPrettyTtml = false"
          >
            原始 TTML
          </SButton>
          <SButton
            :type="showPrettyTtml ? 'primary' : 'default'"
            :variant="showPrettyTtml ? 'filled' : 'secondary'"
            size="small"
            class="rounded-md! shadow-none!"
            @click="showPrettyTtml = true"
          >
            美化 TTML
          </SButton>
        </div>
        <textarea
          v-if="!showPrettyTtml"
          v-model="mainText"
          class="w-full h-80 bg-surface-panel rounded-lg p-3 text-sm font-mono resize-y"
          spellcheck="false"
        />
        <textarea
          v-else
          v-model="prettyTtml"
          class="w-full h-80 bg-surface-panel rounded-lg p-3 text-sm font-mono resize-y"
          spellcheck="false"
        />
      </template>

      <!-- 其他格式：主歌词 / 翻译 / 发音 三个 tab（一次只显示一个内容区） -->
      <template v-else>
        <div class="flex items-center gap-1 border-b border-outline-variant/30 pb-2">
          <SButton
            :type="activeTab === 'main' ? 'primary' : 'default'"
            :variant="activeTab === 'main' ? 'filled' : 'secondary'"
            size="small"
            class="rounded-md! shadow-none!"
            @click="activeTab = 'main'"
          >
            {{ mainTabLabel }}
          </SButton>
          <SButton
            :type="activeTab === 'trans' ? 'primary' : 'default'"
            :variant="activeTab === 'trans' ? 'filled' : 'secondary'"
            size="small"
            class="rounded-md! shadow-none!"
            @click="activeTab = 'trans'"
          >
            {{ t("lyricManager.translation") }}
          </SButton>
          <SButton
            :type="activeTab === 'roma' ? 'primary' : 'default'"
            :variant="activeTab === 'roma' ? 'filled' : 'secondary'"
            size="small"
            class="rounded-md! shadow-none!"
            @click="activeTab = 'roma'"
          >
            {{ t("lyricManager.romaji") }}
          </SButton>
        </div>
        <textarea
          v-if="activeTab === 'main'"
          v-model="mainText"
          class="w-full h-[28rem] bg-surface-panel rounded-lg p-3 text-sm font-mono resize-y"
          spellcheck="false"
        />
        <textarea
          v-else-if="activeTab === 'trans'"
          v-model="transText"
          class="w-full h-[28rem] bg-surface-panel rounded-lg p-3 text-sm font-mono resize-y"
          spellcheck="false"
        />
        <textarea
          v-else
          v-model="romajiText"
          class="w-full h-[28rem] bg-surface-panel rounded-lg p-3 text-sm font-mono resize-y"
          spellcheck="false"
        />
      </template>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="save">{{ t("common.save") }}</SButton>
    </template>
  </SDialog>
</template>
