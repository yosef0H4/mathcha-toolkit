export {};

const extensionBrowserApi = ((globalThis as Record<string, unknown>).browser ??
  (globalThis as Record<string, unknown>).chrome) as {
  runtime?: {
    getURL?: (path: string) => string;
    sendMessage?: (message: unknown) => Promise<unknown> | void;
  };
  storage?: {
    local?: {
      get?: (keys?: string[] | Record<string, unknown>) => Promise<Record<string, unknown>> | void;
      set?: (items: Record<string, unknown>) => Promise<void> | void;
    };
  };
};

const CHANNEL = "mathcha-toolkit-extension";
const STORAGE_KEYS = ["answerFormat", "answerInsertMode", "lastPrompt", "lastAiService"];

const storageGet = async (keys: string[]): Promise<Record<string, unknown>> => {
  const storage = extensionBrowserApi.storage?.local;
  if (!storage?.get) return {};
  const result = storage.get(keys);
  return result instanceof Promise ? result : {};
};

const storageSet = async (items: Record<string, unknown>): Promise<void> => {
  const storage = extensionBrowserApi.storage?.local;
  if (!storage?.set) return;
  const result = storage.set(items);
  if (result instanceof Promise) {
    await result;
  }
};

const injectInitScript = (state: Record<string, unknown>): void => {
  const script = document.createElement("script");
  script.textContent = `window.__MATHCHA_TOOLKIT_EXTENSION_INIT__ = ${JSON.stringify({
    state,
    channel: CHANNEL
  })};`;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
};

const injectPageBundle = (): void => {
  if (document.querySelector("script[data-mathcha-toolkit-extension-page='1']")) {
    return;
  }

  const script = document.createElement("script");
  script.src = extensionBrowserApi.runtime?.getURL?.("page.js") ?? "";
  script.dataset.mathchaToolkitExtensionPage = "1";
  (document.documentElement || document.head || document.body).appendChild(script);
};

const handleBridgeMessage = async (event: MessageEvent): Promise<void> => {
  if (event.source !== window || typeof event.data !== "object" || event.data === null) return;

  const message = event.data as {
    source?: string;
    channel?: string;
    type?: string;
    payload?: Record<string, unknown>;
  };

  if (message.source !== "mathcha-toolkit-page" || message.channel !== CHANNEL) return;

  if (message.type === "storage:set" && message.payload?.key) {
    await storageSet({ [String(message.payload.key)]: message.payload.value });
    return;
  }

  if (message.type === "tabs:open" && message.payload?.url) {
    await extensionBrowserApi.runtime?.sendMessage?.({
      source: CHANNEL,
      type: "tabs:open",
      payload: {
        url: String(message.payload.url),
        active: Boolean(message.payload.active ?? true)
      }
    });
  }
};

void (async () => {
  const state = await storageGet(STORAGE_KEYS);
  injectInitScript(state);
  injectPageBundle();
  window.addEventListener("message", (event) => {
    void handleBridgeMessage(event);
  });
})();
