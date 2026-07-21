package com.zhaostephen.szmde

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Publish the IME (soft-keyboard) inset to the web layer as the CSS custom property
   * `--kb-inset`, in CSS pixels.
   *
   * WHY THIS EXISTS (measured on a physical Pixel 9 Pro / Android 16, M6 S3): the LAYOUT
   * viewport never resizes for the keyboard — `window.innerHeight` stays 952 with the IME
   * up. `interactive-widget=resizes-content` does not change that (Tauri #10631), and
   * neither does `android:windowSoftInputMode="adjustResize"`: `enableEdgeToEdge()` above
   * makes this an edge-to-edge window, and such a window is expected to consume
   * `WindowInsets.ime()` itself rather than being auto-resized. So `100dvh` can never
   * shrink on its own. CSS subtracts `--kb-inset` instead, which gives CodeMirror a correct
   * visible height so its own caret scrollIntoView works, and lifts the status chips.
   *
   * NOT a reason this exists: `visualViewport`. It DOES react (952 -> 578, matching this
   * bridge's 373 CSS px). An earlier revision of this comment claimed otherwise; that was
   * an artifact of the WebView-listener bug described below. Replacing this native bridge
   * with a `visualViewport` listener is a live, deliberately-deferred follow-up
   * (would also cover web/PWA) — see docs/m6-plan.md risk #4.
   *
   * `enableEdgeToEdge()` is called on EVERY api level, so the edge-to-edge reasoning above
   * is not specific to targetSdk 35+; `adjustResize` was therefore removed from the
   * manifest rather than kept as a "fallback for API 24-34" (it is inert across the whole
   * minSdk-24 range for the same reason, and if some OEM build DID honour it the window
   * would shrink AND `--kb-inset` would be subtracted — double-counting the keyboard).
   * Note `--kb-inset` is live on every API level, not just 35+: `Type.ime()` maps to the
   * platform type on 30+, and WindowInsetsCompat synthesises it from the system-window
   * insets on 24-29.
   *
   * ⚠️ NEVER ATTACH AN APPLY-INSETS LISTENER TO THE WebView.
   * It REPLACES the WebView's own inset handling — precisely how Chrome derives
   * `env(safe-area-inset-*)` and updates `visualViewport` — and silently zeroes both. That
   * cost real debugging time: it presented as "the physical device reports env() = 0 while
   * the emulator reports 52", a convincing-looking platform difference that was entirely
   * self-inflicted. env() is in fact correct (68px top / 24px bottom here), so the CSS
   * needs no safe-area bridge at all — only the IME one.
   *
   * The listener is attached to android.R.id.content, NOT the decorView: a decorView
   * listener likewise REPLACES `DecorView.onApplyWindowInsets`, which is what sizes the
   * system-bar scrim views (`updateColorViews`). content is a direct child, so it still
   * receives the full unconsumed insets including `Type.ime()`, while DecorView keeps its
   * own handling.
   */
  override fun onWebViewCreate(webView: WebView) {
    val pushIme = { imePx: Int ->
      val cssPx = (imePx / resources.displayMetrics.density).toInt()
      webView.post {
        webView.evaluateJavascript(
          "document.documentElement.style.setProperty('--kb-inset','${cssPx}px')",
          null,
        )
      }
    }

    // Catches IME changes that arrive without an animation (rotation, resume, hardware
    // keyboard attach). On android.R.id.content — see the warning above: neither the
    // WebView nor the decorView is a safe attach point.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { _, insets ->
      pushIme(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
      // Return the insets unconsumed so the system bars keep laying out normally.
      insets
    }

    // The primary path: the IME animation, dispatched precisely when the window itself
    // does not resize. Verified on-device (ime 0 -> 841px physical -> --kb-inset 373px).
    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          running: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          pushIme(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          val root = ViewCompat.getRootWindowInsets(webView)
          pushIme(root?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0)
        }
      },
    )
  }
}
