/** 获取歌曲 UGC 百科信息。 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const ugc_song_get: NeteaseModule = (query, request) =>
  request("/api/rep/ugc/song/get", { songId: query.id }, createOption(query));

export default ugc_song_get;
