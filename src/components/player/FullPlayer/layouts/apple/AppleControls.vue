<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useFavorite } from "@/composables/useFavorite";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { useProgressLyric } from "@/composables/useProgressLyric";
import * as player from "@/core/player";
import { volumeGainToPosition, volumePositionToGain } from "@/utils/volume";
import type { Artist } from "@shared/types/player";
import { getValidArtists } from "@shared/utils/track";
import {
  canNavigateToResource,
  navigateToResource,
  type ResourceNavigationTarget,
} from "@/utils/navigate";
import { getQualityLabel, isLosslessQuality } from "@/utils/quality";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useDownload } from "@/composables/useDownload";
import { useTrackMenu } from "@/composables/useTrackMenu";

const { t } = useI18n();
const status = useStatusStore();
const media = useMediaStore();
const fav = useFavorite();
const { isPlaying, isLoading, position, duration, repeatMode, shuffleMode, heartMode, fmMode } =
  storeToRefs(status);
const { timeDisplay, toggleTimeFormat } = useTimeFormat();
const { snapToNearestLyric } = useProgressLyric();

/** 加载中的歌曲使用队列当前项兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const hasTrack = computed(() => !!displayTrack.value);

const artists = computed(() => getValidArtists(displayTrack.value?.artists));

/** 生成歌手详情页跳转目标 */
const artistTarget = (artist: Artist): ResourceNavigationTarget => ({
  type: "artist",
  source: displayTrack.value?.source,
  id: artist.id,
  name: artist.name,
});

/** 歌手是否可跳转 */
const isArtistLinkable = (artist: Artist): boolean => canNavigateToResource(artistTarget(artist));

/** 跳转歌手详情页并收起全屏播放器 */
const goToArtist = (artist: Artist): void => {
  if (!isArtistLinkable(artist)) return;
  if (navigateToResource(artistTarget(artist))) status.isPlayerExpanded = false;
};

/** 当前专辑详情页跳转目标 */
const albumTarget = computed<ResourceNavigationTarget | null>(() => {
  const track = displayTrack.value;
  if (!track?.album?.name) return null;
  return {
    type: "album",
    source: track.source,
    id: track.album.id,
    name: track.album.name,
  };
});

/** 专辑是否可跳转 */
const isAlbumLinkable = computed(() =>
  albumTarget.value ? canNavigateToResource(albumTarget.value) : false,
);

/** 跳转专辑详情页并收起全屏播放器 */
const goToAlbum = (): void => {
  const target = albumTarget.value;
  if (!target || !isAlbumLinkable.value) return;
  if (navigateToResource(target)) status.isPlayerExpanded = false;
};

const quality = computed(() => media.detail?.quality ?? displayTrack.value?.quality);

const volumePosition = computed(() => volumeGainToPosition(status.volume));

const onSeekDragEnd = (value: number): void => {
  player.seek(snapToNearestLyric(value));
};

const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

const { enqueue: enqueueDownload } = useDownload();
const { items: menuItems, handleSelect: onMenuSelect } = useTrackMenu(toRef(media, "track"), {
  hidePlayActions: true,
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});
</script>

<template>
  <div class="w-full flex flex-col gap-[1.6vh] text-[max(2vh,14px)]">
    <!-- 标题与歌手 -->
    <div class="flex items-center gap-3 leading-[1.25em]">
      <div class="flex-1 min-w-0">
        <SMarquee fit class="max-w-full font-medium tracking-[0.4px] text-cover/90">
          {{ displayTrack?.title }}
        </SMarquee>
        <div
          class="flex min-w-0 items-baseline gap-x-1.5 select-none tracking-[0.4px] text-cover/45"
        >
          <span
            class="min-w-0 truncate whitespace-nowrap"
            :class="albumTarget?.name ? 'max-w-[55%]' : 'max-w-full'"
          >
            <template v-if="artists.length">
              <template v-for="(artist, index) in artists" :key="artist.id ?? artist.name">
                <span v-if="index > 0" class="mr-1">,</span>
                <button
                  type="button"
                  class="app-no-drag appearance-none border-0 bg-transparent p-0 transition-colors"
                  :class="
                    isArtistLinkable(artist)
                      ? 'cursor-pointer hover:text-cover/80 hover:underline underline-offset-[3px]'
                      : 'cursor-default'
                  "
                  @click="goToArtist(artist)"
                >
                  {{ artist.name }}
                </button>
              </template>
            </template>
            <template v-else>{{ t("playlist.unknownArtist") }}</template>
          </span>
          <template v-if="albumTarget?.name">
            <span class="shrink-0 text-cover/25">—</span>

            <button
              type="button"
              class="app-no-drag min-w-0 flex-1 appearance-none truncate border-0 bg-transparent p-0 text-left transition-colors"
              :class="
                isAlbumLinkable
                  ? 'cursor-pointer hover:text-cover/80 hover:underline underline-offset-[3px]'
                  : 'cursor-default'
              "
              @click="goToAlbum"
            >
              {{ albumTarget.name }}
            </button>
          </template>
        </div>
      </div>
      <SButton
        v-if="displayTrack?.source !== 'plugin'"
        type="cover"
        variant="secondary"
        circle
        :size="32"
        :disabled="!hasTrack || !fav.isSupported(displayTrack)"
        @click="fav.toggle(displayTrack)"
      >
        <template #icon>
          <SIconSwap :active="fav.isLiked(displayTrack)">
            <template #on><IconSpAmStarFilled /></template>
            <template #off><IconSpAmStar /></template>
          </SIconSwap>
        </template>
      </SButton>
      <SDropdownMenu
        v-if="media.track"
        :items="menuItems"
        cover
        side="top"
        align="end"
        @select="onMenuSelect"
      >
        <template #trigger>
          <SButton type="cover" variant="secondary" circle :size="32">
            <template #icon><IconLucideEllipsis /></template>
          </SButton>
        </template>
      </SDropdownMenu>
    </div>
    <!-- 进度与音质 -->
    <div>
      <SSlider
        :model-value="position"
        :glow="status.transitioning"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="8"
        :hover-track-height="20"
        hide-thumb
        cover
        @drag-end="onSeekDragEnd"
      />
      <div
        class="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center text-[max(1.5vh,13px)] font-medium tabular-nums"
      >
        <span class="text-cover/50 cursor-pointer select-none" @click="toggleTimeFormat">
          {{ timeDisplay[0] }}
        </span>
        <span
          v-if="quality || status.transitioning"
          class="inline-grid place-items-center overflow-hidden px-1.5 py-0.5 rounded-[4px] text-[max(1.5vh,13px)] leading-none text-cover/80 transition-colors duration-200"
          :class="status.transitioning ? 'cursor-default' : 'cursor-pointer bg-cover/15'"
          @click="!status.transitioning && (status.audioInfoOpen = true)"
        >
          <span
            class="[grid-area:1/1] flex items-center gap-1 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            :class="status.transitioning ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'"
            :aria-hidden="status.transitioning"
          >
            <template v-if="quality">
              <IconSpLossless v-if="isLosslessQuality(quality)" class="text-[1.2em]" />
              {{ getQualityLabel(quality) }}
            </template>
          </span>
          <Transition
            enter-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            leave-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            enter-from-class="opacity-0 translate-y-1"
            leave-to-class="opacity-0 translate-y-1"
          >
            <span
              v-if="status.transitioning"
              class="apple-transition-shine [grid-area:1/1] whitespace-nowrap"
              role="status"
            >
              {{
                status.transitionMode === "automix"
                  ? t("player.automixing")
                  : t("player.transitioning")
              }}
            </span>
          </Transition>
        </span>
        <span v-else />
        <span class="text-right text-cover/50 cursor-pointer select-none" @click="toggleTimeFormat">
          {{ timeDisplay[1] }}
        </span>
      </div>
    </div>
    <!-- 播放控制 -->
    <div class="flex items-center justify-between text-cover">
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        @click="
          fmMode
            ? player.dislikeFmTrack()
            : heartMode
              ? player.exitHeartMode()
              : player.toggleShuffleMode()
        "
      >
        <IconLucideHeartOff v-if="fmMode" class="size-[clamp(18px,2.4vh,30px)]" />
        <IconSpHeartMode v-else-if="heartMode" class="size-[clamp(18px,2.4vh,30px)]" />
        <IconSpAmShuffleActive
          v-else-if="shuffleMode === 'on'"
          class="size-[clamp(26px,4vh,48px)]"
        />
        <IconSpAmShuffle v-else class="size-[clamp(26px,4vh,48px)]" />
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="!hasTrack || fmMode"
        @click="player.prevTrack()"
      >
        <IconSpAmRewind class="size-[clamp(40px,6.4vh,80px)]" />
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="!hasTrack && !isLoading"
        @click="player.togglePlay()"
      >
        <SLoading v-if="isLoading" class="size-[clamp(28px,4.4vh,56px)]" />
        <SIconSwap v-else :active="isPlaying" class="size-[clamp(28px,4.4vh,56px)]">
          <template #on><IconSpAmPause /></template>
          <template #off><IconSpAmPlay /></template>
        </SIconSwap>
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="!hasTrack"
        @click="player.nextTrack()"
      >
        <IconSpAmForward class="size-[clamp(40px,6.4vh,80px)]" />
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="fmMode"
        @click="player.cycleRepeatMode()"
      >
        <IconLucideInfinity v-if="fmMode" class="size-[clamp(18px,2.4vh,30px)]" />
        <IconSpAmRepeatOne v-else-if="repeatMode === 'one'" class="size-[clamp(26px,4vh,48px)]" />
        <IconSpAmRepeatActive v-else class="size-[clamp(26px,4vh,48px)]" />
      </SButton>
    </div>
    <!-- 音量 -->
    <div class="flex items-center gap-1 text-cover/50">
      <IconSpAmSpeaker class="shrink-0 w-8 h-10" />
      <SSlider
        :model-value="volumePosition"
        :min="0"
        :max="1"
        :step="0.01"
        :track-height="8"
        :hover-track-height="20"
        hide-thumb
        cover
        class="flex-1"
        @change="player.setVolume(volumePositionToGain($event))"
      />
      <IconSpAmSpeakerMax class="shrink-0 w-[43px] h-10" />
    </div>
  </div>
  <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
</template>

<style scoped>
.apple-transition-shine {
  color: transparent;
  background: linear-gradient(
    100deg,
    rgb(var(--s-cover) / 0.6) 40%,
    rgb(var(--s-cover)) 50%,
    rgb(var(--s-cover) / 0.6) 60%
  );
  background-size: 200% 100%;
  background-clip: text;
  animation: apple-transition-shine 1.4s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    background: none;
    color: rgb(var(--s-cover));
  }
}

@keyframes apple-transition-shine {
  from {
    background-position: 100% center;
  }
  to {
    background-position: -100% center;
  }
}
</style>
