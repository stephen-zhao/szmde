/**
 * Runtime platform detection. Deliberately tiny and dependency-free: szmde has
 * no `@tauri-apps/plugin-os`, and the only decision that needs a runtime platform
 * branch is "which storage backend to construct" (SAF on Android vs the local
 * filesystem everywhere else). A user-agent test settles that without a native
 * plugin or IPC, so it stays fully unit-testable.
 *
 * The Tauri Android system-WebView UA contains "Android" (verified on a Pixel 9
 * Pro: `…Android 16; Pixel 9 Pro…wv… Chrome/…`); WebView2 (Windows) and WKWebView
 * (macOS) never do. `ua` is a parameter (defaulting to `navigator.userAgent`) so
 * tests drive it with a plain string.
 */
export function isAndroid(ua: string = navigator.userAgent): boolean {
  return /android/i.test(ua);
}
