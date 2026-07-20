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
    val push = { imePx: Int, src: String ->
      val cssPx = (imePx / resources.displayMetrics.density).toInt()
      android.util.Log.d("szmde-ime", "push src=$src imePx=$imePx cssPx=$cssPx")
      webView.post {
        webView.evaluateJavascript(
          "document.documentElement.style.setProperty('--kb-inset','${cssPx}px')",
          null,
        )
      }
    }

    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val vis = insets.isVisible(WindowInsetsCompat.Type.ime())
      val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
      android.util.Log.d("szmde-ime", "applyInsets ime=$ime visible=$vis sysBars=$sys")
      push(ime, "applyInsets")
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
          android.util.Log.d("szmde-ime", "animProgress ime=$ime")
          push(ime, "animProgress")
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          val root = ViewCompat.getRootWindowInsets(webView)
          val ime = root?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
          android.util.Log.d("szmde-ime", "animEnd ime=$ime")
          push(ime, "animEnd")
        }
      },
    )
  }
}
