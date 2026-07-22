import { describe, expect, it } from "vitest";
import { isAndroid } from "./platform";

describe("[REQ-MOBILE-3] isAndroid — platform selection for the SAF backend", () => {
  it("is true for the Android system-WebView UA (verified on a Pixel 9 Pro)", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro Build/CP1A.260505.005; wv) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.124 Mobile Safari/537.36";
    expect(isAndroid(ua)).toBe(true);
  });

  it("is false for the Windows WebView2 UA (desktop)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";
    expect(isAndroid(ua)).toBe(false);
  });

  it("defaults to navigator.userAgent when no arg is given (happy-dom → not Android)", () => {
    // Exercises the default-parameter binding for coverage; happy-dom's UA has no
    // "Android", so the SAF backend is (correctly) not selected under test.
    expect(isAndroid()).toBe(false);
  });
});
