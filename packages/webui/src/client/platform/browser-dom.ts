// Browser-only DOM operations used by the WebUI bindings. The composition root
// supplies the browser objects; components receive only the narrow operations
// they need and never reach for document directly.

import type {
  WebuiBrowserCanvas,
  WebuiBrowserImage,
} from "../contracts/browser-drawing.js";

export type { WebuiBrowserCanvas, WebuiBrowserImage };

export interface WebuiBrowserDom {
  readonly portalTarget: () => HTMLElement | null;
  readonly listenForMouseDown: (listener: (event: MouseEvent) => void) => () => void;
  readonly listenForPointerDown: (listener: (event: PointerEvent) => void, capture?: boolean) => () => void;
  readonly listenForKeyDown: (listener: (event: KeyboardEvent) => void) => () => void;
  readonly listenForStorageChange: (listener: () => void) => () => void;
  /**
   * Whether this page is currently hidden from the reader.
   *
   * A composition root that has no document answers `false` — a reader that does
   * not exist yet is not a reader who has gone away.
   */
  readonly isPageHidden: () => boolean;
  /** Fires when the page becomes visible or hidden. */
  readonly listenForVisibilityChange: (listener: () => void) => () => void;
  readonly listenForContextWindowUsageChange: (listener: () => void) => () => void;
  readonly getElementById: (id: string) => HTMLElement | null;
  readonly getActiveElement: () => HTMLElement | null;
  readonly updateDocumentAppearance: (theme: "dark" | "light", language: string) => void;
  readonly dispatchContextWindowUsageChange: () => void;
  readonly copyTextFallback: (text: string) => void;
  /**
   * Reads a theme token's resolved colour.
   *
   * The account page's share image is painted with the same tokens the page
   * uses, so the image follows the active theme instead of hard-coding a
   * palette.
   */
  readonly readCssVariable: (name: string, fallback: string) => string;
  /**
   * Creates a drawing surface.
   *
   * The share image is rendered on a canvas rather than in the DOM, so the
   * download is a plain PNG. A composition root that has no document answers
   * `null`.
   */
  readonly createCanvas: (width: number, height: number) => WebuiBrowserCanvas | null;
  /**
   * Loads an image the canvas can draw.
   *
   * The image is fetched first and decoded from the bytes, so a drawn image
   * does not taint the canvas and the export stays readable.
   */
  readonly loadImage: (src: string) => Promise<WebuiBrowserImage>;
  /** Saves a blob under a file name. */
  readonly downloadBlob: (blob: Blob, fileName: string) => void;
}

export function createWebuiBrowserDom(
  documentObject: Document | undefined,
  windowObject: (Window & typeof globalThis) | undefined,
): WebuiBrowserDom {
  const listen = <K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    capture = false,
  ): (() => void) => {
    if (!documentObject) return () => undefined;
    const handler = listener as EventListener;
    documentObject.addEventListener(type, handler, capture);
    return () => documentObject.removeEventListener(type, handler, capture);
  };

  return {
    portalTarget: () => documentObject?.body ?? null,
    listenForMouseDown: (listener) => listen("mousedown", listener),
    listenForPointerDown: (listener, capture) => listen("pointerdown", listener, capture),
    listenForKeyDown: (listener) => listen("keydown", listener),
    listenForStorageChange: (listener) => {
      if (!windowObject) return () => undefined;
      windowObject.addEventListener("storage", listener);
      return () => windowObject.removeEventListener("storage", listener);
    },
    isPageHidden: () => documentObject?.visibilityState === "hidden",
    listenForVisibilityChange: (listener) => listen("visibilitychange", () => listener()),
    listenForContextWindowUsageChange: (listener) => {
      if (!windowObject) return () => undefined;
      windowObject.addEventListener("webui-context-window-usage-change", listener);
      return () => windowObject.removeEventListener("webui-context-window-usage-change", listener);
    },
    getElementById: (id) => documentObject?.getElementById(id) ?? null,
    getActiveElement: () => {
      if (!documentObject) return null;
      const activeElement = documentObject.activeElement;
      return activeElement && typeof (activeElement as HTMLElement).focus === "function"
        ? activeElement as HTMLElement
        : null;
    },
    updateDocumentAppearance: (theme, language) => {
      if (!documentObject) return;
      documentObject.documentElement.classList.toggle("dark", theme === "dark");
      documentObject.documentElement.classList.toggle("light", theme !== "dark");
      documentObject.documentElement.lang = language.startsWith("zh") ? "zh-CN" : "en";
    },
    dispatchContextWindowUsageChange: () => {
      if (windowObject) windowObject.dispatchEvent(new Event("webui-context-window-usage-change"));
    },
    copyTextFallback: (text) => {
      if (!documentObject?.body) return;
      const area = documentObject.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      documentObject.body.appendChild(area);
      area.select();
      documentObject.execCommand("copy");
      area.remove();
    },
    readCssVariable: (name, fallback) => {
      if (!documentObject?.defaultView) return fallback;
      const value = documentObject.defaultView
        .getComputedStyle(documentObject.documentElement)
        .getPropertyValue(name)
        .trim();
      return value || fallback;
    },
    createCanvas: (width, height) => {
      if (!documentObject) return null;
      const canvas = documentObject.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      return {
        width,
        height,
        context,
        toBlob: () =>
          new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Unable to create the usage report image"));
              },
              "image/png",
            );
          }),
      };
    },
    loadImage: async (src) => {
      if (!windowObject) throw new Error("Unable to load the usage report image");
      const response = await windowObject.fetch(src, { credentials: "omit" });
      if (!response.ok) {
        throw new Error(`Unable to load the usage report image: ${response.status}`);
      }
      const blob = await response.blob();
      if (typeof windowObject.createImageBitmap === "function") {
        const bitmap = await windowObject.createImageBitmap(blob);
        return { image: bitmap, width: bitmap.width, height: bitmap.height };
      }
      const url = windowObject.URL.createObjectURL(blob);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const element = new windowObject.Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error(`Unable to load the usage report image: ${src}`));
          element.src = url;
        });
        return {
          image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        };
      } finally {
        windowObject.URL.revokeObjectURL(url);
      }
    },
    downloadBlob: (blob, fileName) => {
      if (!documentObject?.body || !windowObject) return;
      const url = windowObject.URL.createObjectURL(blob);
      const anchor = documentObject.createElement("a");
      try {
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = "none";
        documentObject.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        windowObject.URL.revokeObjectURL(url);
      }
    },
  };
}

export const EMPTY_WEBUI_BROWSER_DOM: WebuiBrowserDom = createWebuiBrowserDom(undefined, undefined);
