import type { OpenTabOptions, PyodideWindow, ToolkitPlatform } from "./types";

const DEFAULT_EXTENSION_CHANNEL = "mathcha-toolkit-extension";

let currentPlatform: ToolkitPlatform | null = null;

const getExtensionInit = (): { state: Record<string, unknown>; channel: string } => {
  const init = window.__MATHCHA_TOOLKIT_EXTENSION_INIT__;
  return {
    state: { ...(init?.state ?? {}) },
    channel: init?.channel ?? DEFAULT_EXTENSION_CHANNEL
  };
};

export const setPlatform = (platform: ToolkitPlatform): void => {
  currentPlatform = platform;
};

export const getPlatform = (): ToolkitPlatform => {
  if (!currentPlatform) {
    throw new Error("Mathcha Toolkit platform has not been initialized");
  }
  return currentPlatform;
};

export const createUserscriptPlatform = (): ToolkitPlatform => ({
  kind: "userscript",
  pageWindow: unsafeWindow as PyodideWindow,
  getValue: <T>(key: string, fallback: T): T => GM_getValue(key, fallback) as T,
  setValue: (key: string, value: unknown): void => {
    GM_setValue(key, value);
  },
  openTab: (url: string, options?: OpenTabOptions): void => {
    GM_openInTab(url, { active: options?.active ?? true });
  }
});

export const createConsolePlatform = (): ToolkitPlatform => ({
  kind: "console",
  pageWindow: window as PyodideWindow,
  getValue: <T>(key: string, fallback: T): T => {
    try {
      const raw = window.localStorage.getItem(`mathcha-toolkit:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  setValue: (key: string, value: unknown): void => {
    window.localStorage.setItem(`mathcha-toolkit:${key}`, JSON.stringify(value));
  },
  openTab: (url: string): void => {
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

export const createExtensionPlatform = (): ToolkitPlatform => {
  const extension = getExtensionInit();
  const cache = extension.state;

  const postBridgeMessage = (type: string, payload: Record<string, unknown>): void => {
    window.postMessage(
      {
        source: "mathcha-toolkit-page",
        channel: extension.channel,
        type,
        payload
      },
      window.location.origin
    );
  };

  return {
    kind: "extension",
    pageWindow: window as PyodideWindow,
    getValue: <T>(key: string, fallback: T): T => (key in cache ? (cache[key] as T) : fallback),
    setValue: (key: string, value: unknown): void => {
      cache[key] = value;
      postBridgeMessage("storage:set", { key, value });
    },
    openTab: (url: string, options?: OpenTabOptions): void => {
      postBridgeMessage("tabs:open", { url, active: options?.active ?? true });
    }
  };
};
