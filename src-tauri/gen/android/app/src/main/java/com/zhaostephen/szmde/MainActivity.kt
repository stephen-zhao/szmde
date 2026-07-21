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
   * WHY THIS EXISTS (measured on a physical Pixel 9 Pro / Android 16, M6 S3): when the
   * keyboard opens, the web layer is told *nothing*. `window.innerHeight`,
   * `visualViewport.height` and `visualViewport.offsetTop` all stay at their full-screen
   * values (952/952/0):
   *
   *   - `interactive-widget=resizes-content` in the viewport meta does not resize the
   *     layout viewport here (Tauri #10631),
   *   - `visualViewport` — the documented fallback — does not react either, and
   *   - `android:windowSoftInputMode="adjustResize"` is ALSO inert, because a targetSdk 35+
   *     edge-to-edge app no longer gets automatic IME resizing from the framework; it is
   *     expected to consume `WindowInsets.ime()` itself.
   *
   * So this native push is the only signal the frontend can get. CSS subtracts
   * `--kb-inset` so the editor shrinks (giving CodeMirror a correct visible height for its
   * own caret scrollIntoView) and the status chips sit above the keyboard.
   *
   * The manifest keeps `adjustResize` anyway: inert on 35+, but still functional on
   * API 24-34, most of our minSdk-24 range. There `--kb-inset` stays 0 and `100dvh`
   * already does the right thing. The two are complementary, not redundant.
   *
   * ⚠️ THE LISTENER MUST BE ON THE decorView, NEVER ON THE WebView.
   * Registering an OnApplyWindowInsetsListener on the WebView REPLACES the WebView's own
   * inset handling — which is precisely how Chrome derives `env(safe-area-inset-*)` — and
   * silently zeroes all four safe-area edges. That cost real debugging time: it presented
   * as "the physical device reports env() = 0 while the emulator reports 52", i.e. a
   * convincing-looking platform difference that was entirely self-inflicted. With the
   * listener on the decorView, env() reports correctly (68px top / 24px bottom on the
   * Pixel 9 Pro), so the CSS needs no safe-area bridge at all — only the IME one.
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
    // keyboard attach). On the decorView — see the warning above.
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
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
