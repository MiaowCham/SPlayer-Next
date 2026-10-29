import type { SettingCategory } from "@/types/settings-schema";
import PlatformAccount from "@/components/settings/custom/PlatformAccount.vue";
import StreamingServerList from "@/components/settings/custom/StreamingServerList.vue";
import IconLucideLibrary from "~icons/lucide/library";

const mediaSourceCategory: SettingCategory = {
  id: "mediaSource",
  icon: IconLucideLibrary,
  sections: [
    {
      id: "streaming",
      items: [
        {
          key: "localMediaEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.mediaSource.localEnabled" },
          defaultValue: true,
        },
        {
          key: "streamingEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.streaming.enabled" },
          defaultValue: true,
        },
      ],
    },
    {
      id: "mediaStatistics",
      items: [
        {
          key: "includeRemoteStats",
          type: "switch",
          binding: { store: "settings", path: "system.mediaSource.includeRemoteStats" },
          defaultValue: true,
        },
      ],
    },
    {
      id: "platformLogin",
      tag: { text: "Beta" },
      items: [
        {
          key: "qmAccount",
          type: "custom",
          component: PlatformAccount,
          componentProps: { platform: "qqmusic" },
          fullWidth: true,
          descriptionKey: "settings.platformLogin.desc",
          keywords: [
            "settings.platformLogin.title",
            "settings.platformLogin.desc",
            "settings.platformLogin.loginWeb",
            "settings.platformLogin.manualCookie",
          ],
        },
        {
          key: "kgAccount",
          type: "custom",
          component: PlatformAccount,
          componentProps: { platform: "kugou" },
          fullWidth: true,
          descriptionKey: "settings.platformLogin.desc",
          keywords: [
            "settings.platformLogin.title",
            "settings.platformLogin.desc",
            "settings.platformLogin.loginQr",
            "settings.platformLogin.manualCookie",
          ],
        },
      ],
    },
    {
      id: "platformConfig",
      tag: { text: "Beta" },
      items: [
        {
          key: "kugouLoginVersion",
          type: "select",
          binding: { store: "settings", path: "system.system.kugouLoginVersion" },
          options: [
            { value: "standard", labelKey: "settings.kugouLoginVersion.standard" },
            { value: "concept", labelKey: "settings.kugouLoginVersion.concept" },
          ],
          defaultValue: "standard",
          confirm: {
            titleKey: "settings.confirm.kugouLoginVersionTitle",
            contentKey: "settings.confirm.kugouLoginVersionContent",
            type: "warning",
          },
        },
      ],
    },
    {
      id: "mediaServerManagement",
      items: [
        {
          key: "streamingServerList",
          type: "custom",
          component: StreamingServerList,
          fullWidth: true,
          keywords: ["streaming.server.add", "streaming.server.test", "streaming.server.connect"],
        },
      ],
    },
  ],
};

export default mediaSourceCategory;
