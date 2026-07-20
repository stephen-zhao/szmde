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
   * WHY THIS EXISTS (measured on a Pixel 9 Pro / Android 16, M6 S3): when the keyboard
   * opens, the web layer is told *nothing*. `window.innerHeight`, `visualViewport.height`
   * and `visualViewport.offsetTop` all stay at their full-screen values (952/952/0):
   *
   *   - `interactive-widget=resizes-content` in the viewport meta does not resize the
   *     layout viewport here (Tauri #10631), and
   *   - `android:windowSoftInputMode="adjustResize"` is ALSO inert, because a targetSdk 35+
   *     edge-to-edge app no longer gets automatic IME resizing from the framework — it is
   *     expected to consume `WindowInsets.ime()` itself.
   *
   * So this native push is the only signal the frontend can get. CSS then subtracts
   * `--kb-inset` so the editor and the status chips sit above the keyboard.
   *
   * The manifest keeps `adjustResize` for API < 35, where the framework DOES still resize
   * the window; there `--kb-inset` simply stays 0 and `100dvh` already does the right
   * thing. The two mechanisms are complementary across our minSdk-24 range.
   */
  override fun onWebViewCreate(webView: WebView) {
    val d = resources.displayMetrics.density
    val px = { v: Int -> (v / d).toInt() }

    // Publish the IME inset only (cheap path, used by the IME animation callback).
    val pushIme = { imePx: Int ->
      webView.post {
        webView.evaluateJavascript(
          "document.documentElement.style.setProperty('--kb-inset','${px(imePx)}px')",
          null,
        )
      }
    }

    // Publish the system-bar / cutout insets too, as --sat/--sab/--sal/--sar.
    //
    // WHY: `env(safe-area-inset-*)` is NOT reliable here. Measured 2026-07-20 on the SAME
    // app build: the Pixel 9 Pro AVD (WebView 134) reports env top = 52px, but a physical
    // Pixel 9 Pro (WebView 150) reports **0px on every edge** — so the CSS-only inset
    // strategy silently no-ops on real hardware and the hamburger lands on the status bar.
    // (This is not the documented "WebView < M136 returns 0" case; 150 is far newer.)
    // These vars are the trustworthy source; CSS takes max(env(...), var(--sa*)) so
    // whichever side actually reports a value wins, and desktop stays at 0.
    val pushAll = { insets: WindowInsetsCompat ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      webView.post {
        webView.evaluateJavascript(
          """
          (function(s){
            s.setProperty('--sat','${px(bars.top)}px');
            s.setProperty('--sab','${px(bars.bottom)}px');
            s.setProperty('--sal','${px(bars.left)}px');
            s.setProperty('--sar','${px(bars.right)}px');
            s.setProperty('--kb-inset','${px(ime)}px');
          })(document.documentElement.style)
          """.trimIndent(),
          null,
        )
      }
    }

    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      pushAll(insets)
      // Return the insets unconsumed so the system bars keep laying out normally.
      insets
    }

    // The apply-insets listener may not re-fire when the window does not resize, so also
    // ride the IME animation, which is dispatched precisely for this case.
    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          running: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
          pushIme(ime)
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          val root = ViewCompat.getRootWindowInsets(webView)
          val ime = root?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
          pushIme(ime)
        }
      },
    )
  }
}
