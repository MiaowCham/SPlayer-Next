<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
const media = useMediaStore();
const settings = useSettingsStore();
const isChineseLocale = computed(() => settings.locale.startsWith("zh"));
/** 创作者名单按中文/西文环境选用顿号或逗号连接。 */
const lyricCreatorsText = computed(() =>
  media.lyricAuthors.join(isChineseLocale.value ? "、" : ", "),
);
/** 按创作者信息类别选择「创作者：/歌词制作：」等前缀文案。 */
const lyricCreditKey = computed(() =>
  media.lyricAuthorKind === "lyric-production"
    ? "player.lyricProduction"
    : media.lyricAuthorKind === "song-production"
      ? "player.songProduction"
      : "player.lyricCredit",
);
</script>
<template>
  <div
    v-if="media.lyricAuthors.length"
    class="w-full text-left text-[max(0.5em,10px)] pointer-events-none break-words"
  >
    <strong>{{ $t(lyricCreditKey) }}</strong>
    <span v-if="!isChineseLocale">&nbsp;</span>
    <span class="font-normal">{{ lyricCreatorsText }}</span>
  </div>
</template>
