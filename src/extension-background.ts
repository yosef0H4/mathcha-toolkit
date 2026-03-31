export {};

const extensionBrowserApi = ((globalThis as Record<string, unknown>).browser ??
  (globalThis as Record<string, unknown>).chrome) as {
  runtime?: {
    onMessage?: {
      addListener?: (listener: (message: unknown) => void | Promise<void>) => void;
    };
  };
  tabs?: {
    create?: (info: { url: string; active?: boolean }) => Promise<unknown> | void;
  };
};

extensionBrowserApi.runtime?.onMessage?.addListener?.((message: unknown) => {
  const payload = message as {
    source?: string;
    type?: string;
    payload?: { url?: string; active?: boolean };
  };

  if (payload.source !== "mathcha-toolkit-extension" || payload.type !== "tabs:open" || !payload.payload?.url) {
    return;
  }

  const result = extensionBrowserApi.tabs?.create?.({
    url: payload.payload.url,
    active: payload.payload.active ?? true
  });

  if (result instanceof Promise) {
    return result.then(() => undefined);
  }
});
