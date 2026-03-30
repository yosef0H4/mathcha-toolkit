import type { AiServiceKey, LogFn, NotifyFn } from "./types";
import { config } from "./config";

export function createServices({ notify }: { notify: NotifyFn; log: LogFn }) {
  return {
    openAiService(latex: string, serviceKey: AiServiceKey): void {
      const service = config.aiServices[serviceKey];
      if (!service) {
        notify("Invalid AI service selected", true);
        return;
      }

      const dialog = document.createElement("div");
      const overlay = document.createElement("div");

      Object.assign(dialog.style, {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        backgroundColor: "#fff",
        padding: "20px",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
        zIndex: "10000",
        width: "90%",
        maxWidth: "500px"
      });

      Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        backgroundColor: "rgba(0,0,0,0.5)",
        zIndex: "9999"
      });

      const serviceSelector = document.createElement("select");
      Object.assign(serviceSelector.style, {
        width: "100%",
        padding: "8px",
        marginBottom: "10px",
        borderRadius: "4px",
        border: "1px solid #ccc"
      });

      Object.entries(config.aiServices).forEach(([key, selectedService]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = selectedService.name;
        if (key === serviceKey) option.selected = true;
        serviceSelector.appendChild(option);
      });

      const textarea = document.createElement("textarea");
      Object.assign(textarea.style, {
        width: "100%",
        height: "150px",
        marginBottom: "10px",
        padding: "8px",
        borderRadius: "4px",
        border: "1px solid #ccc"
      });
      textarea.value = GM_getValue("lastPrompt", "Enter your prompt here.");

      const buttons = document.createElement("div");
      buttons.style.textAlign = "right";

      const submit = document.createElement("button");
      submit.textContent = "Send to AI";
      Object.assign(submit.style, {
        padding: "8px 16px",
        marginLeft: "10px",
        backgroundColor: "#4CAF50",
        color: "white",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer"
      });

      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      Object.assign(cancel.style, {
        padding: "8px 16px",
        backgroundColor: "#ddd",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer"
      });

      const cleanup = (): void => {
        dialog.remove();
        overlay.remove();
      };

      submit.onclick = () => {
        const selectedService = config.aiServices[serviceSelector.value as AiServiceKey];
        const prompt = textarea.value.trim();
        GM_setValue("lastPrompt", prompt);
        GM_setValue("lastAiService", serviceSelector.value);

        const url = selectedService.url.replace("%s", encodeURIComponent(`${prompt}\n\n${latex}`));
        GM_openInTab(url, { active: true });
        cleanup();
      };

      cancel.onclick = cleanup;
      textarea.onkeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submit.click();
        }

        if (event.key === "Escape") {
          cleanup();
        }
      };

      dialog.append(serviceSelector, textarea, buttons);
      buttons.append(cancel, submit);
      document.body.append(overlay, dialog);
      textarea.focus();
      textarea.select();
    },

    symbolab(latex: string): void {
      const cleaned = latex.replace(/\$/g, "").trim();
      GM_openInTab(`https://www.symbolab.com/solver/step-by-step/${encodeURIComponent(cleaned)}`, {
        active: true
      });
    }
  };
}
