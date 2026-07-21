import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom intentionally omits CanvasRenderingContext2D. Pixi only needs text
// metrics for these unit tests; browser rendering remains covered by Playwright.
Object.defineProperty(globalThis, "CanvasRenderingContext2D", {
  configurable: true,
  value: class CanvasRenderingContext2DDouble {
    letterSpacing = "0px";
  },
});
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: function getContext(contextId: string) {
    if (contextId !== "2d") return null;
    return {
      canvas: this,
      font: "10px sans-serif",
      textBaseline: "alphabetic",
      textAlign: "start",
      letterSpacing: "0px",
      measureText: (text: string) => ({
        width: text.length * 10,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * 10,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      }),
      scale() {},
      clearRect() {},
      fillRect() {},
      fillText() {},
      strokeText() {},
      setTransform() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    };
  },
});

afterEach(() => {
  cleanup();
});
