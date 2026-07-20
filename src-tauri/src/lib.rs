use std::sync::Mutex;
use tauri::Manager;

/// Holds the file path szmde was launched with, if any. Consumed once by the
/// frontend via `get_launch_file`. Already resolved to something std::fs can open.
struct LaunchFile(Mutex<Option<String>>);

/// Read a file's contents as a UTF-8 string. Works for any path the OS can
/// resolve, including Windows UNC paths such as `\\wsl.localhost\<distro>\...`
/// (see SPEC §6.1). EOL/encoding management arrives in M1.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a UTF-8 string to a file ATOMICALLY: write to a sibling temp file in
/// the same directory, then rename it over the target. `std::fs::rename`
/// replaces the destination on both Windows and Unix and is atomic on the same
/// volume, so a mid-write failure (disk full, I/O error, power loss) can never
/// truncate or destroy the file the user already had on disk.
/// Atomically write `content` to `target`: write a sibling temp file then rename
/// it over the target (atomic on the same volume, replaces on Windows + Unix).
/// Shared by `write_file` and `write_settings_file`.
fn write_atomic(target: &std::path::Path, content: &str) -> Result<(), String> {
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled");
    // Per-call sequence so two concurrent writes to the same target never share a
    // temp file (which one could truncate or delete out from under the other).
    static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dir.join(format!(
        ".{}.{}.{}.szmde-tmp",
        name,
        std::process::id(),
        seq
    ));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp); // best-effort cleanup; original untouched
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    write_atomic(std::path::Path::new(&path), &content)
}

/// A file's contents plus an opaque revision token (REQ-SAVE-1 conflict
/// detection). `rev` is `{mtime_nanos}-{len}` — it changes whenever the file is
/// edited (mtime or size) and is cheap to compare without re-reading the body.
#[derive(serde::Serialize)]
struct FileMeta {
    content: String,
    rev: String,
}

/// Compose a revision token from a file's modified-time + length. Pure (no I/O)
/// so the format is cargo-testable. A missing/pre-epoch mtime degrades to 0 — the
/// length still varies the token, and equal (mtime,len) is treated as "unchanged".
fn compose_rev(modified: Option<std::time::SystemTime>, len: u64) -> String {
    let nanos = modified
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos}-{len}")
}

/// The current revision of a path: Some(rev) if it exists, None if absent
/// (NotFound), Err on a real I/O error. Used for the pre-write conflict check.
fn file_rev(path: &std::path::Path) -> Result<Option<String>, String> {
    match std::fs::metadata(path) {
        Ok(m) => Ok(Some(compose_rev(m.modified().ok(), m.len()))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Read a file's contents together with its revision (REQ-SAVE-1) in one IPC
/// call, so the caller's baseline rev matches the bytes it just loaded.
#[tauri::command]
fn read_file_meta(path: String) -> Result<FileMeta, String> {
    let p = std::path::Path::new(&path);
    let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    let rev = file_rev(p)?.unwrap_or_default();
    Ok(FileMeta { content, rev })
}

/// The current revision of a path without reading its body — the pre-save
/// conflict check. None = the file no longer exists (e.g. a fresh Save As target).
#[tauri::command]
fn stat_file(path: String) -> Result<Option<String>, String> {
    file_rev(std::path::Path::new(&path))
}

/// Read a file as an Option: Ok(None) when it's absent (a normal first run for a
/// settings file), Ok(Some) when present, Err on a real I/O error. Pure helper so
/// the None-vs-Err contract is unit-testable without an AppHandle.
fn read_optional(path: &std::path::Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Resolve a settings file ("user" | "system") under a config base dir. Pure (no
/// AppHandle) so the path logic is cargo-testable against a temp dir. Unknown
/// `which` → None (the command turns that into an error).
fn settings_path(base: &std::path::Path, which: &str) -> Option<std::path::PathBuf> {
    match which {
        "user" => Some(base.join("user.json")),
        "system" => Some(base.join("system.json")),
        _ => None,
    }
}

/// Read a settings file ("user" | "system") from the OS app-config dir. The dir
/// leaf is the bundle identifier (com.zhaostephen.szmde) — Tauri's convention;
/// SPEC §8's "%APPDATA%/szmde/" was illustrative. Ok(None) if the file is absent
/// (normal first run); Err on a real I/O error or an unknown `which`.
#[tauri::command]
fn read_settings_file(app: tauri::AppHandle, which: String) -> Result<Option<String>, String> {
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path =
        settings_path(&base, &which).ok_or_else(|| format!("unknown settings file: {which}"))?;
    read_optional(&path)
}

/// Atomically write the USER settings file (system.json is never written by the
/// app — it's read-only/admin-provided). Creates the config dir on first write.
#[tauri::command]
fn write_settings_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let path = settings_path(&base, "user").expect("\"user\" always resolves");
    write_atomic(&path, &content)
}

/// Returns (once) the file path szmde was launched with, e.g. `szmde notes.md`.
#[tauri::command]
fn get_launch_file(state: tauri::State<'_, LaunchFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// --- Cloud OAuth: client config + loopback redirect capture (M3 L2) --------
// Approach B (judge panel): Rust does ONLY the system-browser open + a one-shot
// loopback listener that captures the OAuth redirect; PKCE, token exchange, and
// Drive REST stay in the (tested) TS layer, egressing over @tauri-apps/plugin-http
// (reqwest) which is exempt from the webview CORS wall.

/// The non-secret-but-keep-out-of-git Google client config the user pastes into
/// `<app_config_dir>/gdrive_client.json`.
#[derive(serde::Serialize, serde::Deserialize)]
struct GdriveConfig {
    client_id: String,
    client_secret: String,
}

/// Path to the gdrive client config under a config base dir. Pure → cargo-testable.
fn gdrive_config_path(base: &std::path::Path) -> std::path::PathBuf {
    base.join("gdrive_client.json")
}

/// Read the Google client config, or None if the user hasn't created it yet.
#[tauri::command]
fn read_gdrive_config(app: tauri::AppHandle) -> Result<Option<GdriveConfig>, String> {
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    match read_optional(&gdrive_config_path(&base))? {
        Some(s) => serde_json::from_str::<GdriveConfig>(&s)
            .map(Some)
            .map_err(|e| format!("gdrive_client.json is malformed: {e}")),
        None => Ok(None),
    }
}

/// Holds the reserved loopback listener between `oauth_loopback_reserve` (which
/// binds it to learn the port) and `oauth_loopback_await` (which accepts the
/// redirect on it).
#[cfg(desktop)]
struct Loopback(Mutex<Option<std::net::TcpListener>>);

/// A parsed OAuth loopback redirect: the auth `code`, the CSRF `state`, and —
/// for the Google Picker flow (REQ-CLOUD-3, `trigger_onepick`) — the ids of the
/// files the user picked (`picked_file_ids`, comma-separated as Google sends it;
/// `None` on a plain sign-in redirect).
#[cfg(desktop)]
#[derive(Debug, PartialEq, serde::Serialize)]
struct Redirect {
    code: String,
    state: String,
    #[serde(rename = "pickedFileIds")]
    picked_file_ids: Option<String>,
}

/// Parse the redirect params from a raw loopback HTTP request. Pure →
/// cargo-testable. Expects a request line like `GET /?code=X&state=Y HTTP/1.1`.
#[cfg(desktop)]
fn parse_redirect(request: &str) -> Option<Redirect> {
    let target = request.lines().next()?.split_whitespace().nth(1)?; // "/?code=..&state=.."
    let query = target.split_once('?')?.1;
    let mut code = None;
    let mut state = None;
    let mut picked = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "code" => code = Some(urldecode(v)),
                "state" => state = Some(urldecode(v)),
                "picked_file_ids" => picked = Some(urldecode(v)),
                _ => {}
            }
        }
    }
    Some(Redirect {
        code: code?,
        state: state?,
        picked_file_ids: picked,
    })
}

/// Extract one percent-decoded query param from a raw request's request line.
/// Pure → cargo-testable.
#[cfg(desktop)]
fn query_param(request: &str, key: &str) -> Option<String> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let query = target.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| urldecode(v))
    })
}

/// The `error` param of a redirect, if Google sent one (e.g. `access_denied`
/// when the user cancels the consent/Picker). Pure → cargo-testable.
#[cfg(desktop)]
fn parse_error(request: &str) -> Option<String> {
    query_param(request, "error")
}

/// True iff the request's `Host` header targets the loopback listener itself.
/// This is the DNS-rebinding defence: a malicious page can point a hostname at
/// 127.0.0.1, but the browser still sends that hostname in `Host` — so anything
/// other than `127.0.0.1:<port>` / `localhost:<port>` is rejected (403). A
/// request with no Host header is rejected too. Pure → cargo-testable.
#[cfg(desktop)]
fn host_allowed(request: &str, port: u16) -> bool {
    let host = request.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.eq_ignore_ascii_case("host").then(|| v.trim())
    });
    match host {
        Some(h) => h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"),
        None => false,
    }
}

/// What to do with an accepted loopback request. A pure decision (→ cargo-testable),
/// so the security-critical gating is unit-covered while the socket loop stays thin.
#[cfg(desktop)]
#[derive(Debug, PartialEq)]
enum Disposition {
    /// The genuine, state-matched redirect — serve "signed in" and finish.
    Redirect(Redirect),
    /// A state-matched `error=` (user cancelled the consent/Picker) — finish with this reason.
    Declined(String),
    /// A stray request (bad Host, foreign/mismatched `state`, or not the redirect) — serve this
    /// status line and KEEP WAITING. Never aborts the flow.
    Ignore(&'static str),
}

/// Decide how to handle one accepted request. The CSRF `state` check lives HERE,
/// inside the wait loop (REQ-CLOUD-3 adversarial-review hardening): a request that
/// isn't this listener (`Host`), or that carries an absent/foreign/mismatched
/// `state`, is IGNORED rather than aborting a real sign-in — so a localhost
/// port-probe or a forged `error=`/`code=` can't DoS the flow. Only a request whose
/// `state` equals ours is honored (as the redirect, or as a genuine cancel).
#[cfg(desktop)]
fn classify_request(request: &str, expected_state: &str, port: u16) -> Disposition {
    if !host_allowed(request, port) {
        return Disposition::Ignore("403 Forbidden");
    }
    if query_param(request, "state").as_deref() != Some(expected_state) {
        return Disposition::Ignore("403 Forbidden"); // foreign/forged — not our redirect
    }
    if let Some(err) = parse_error(request) {
        return Disposition::Declined(err);
    }
    if let Some(redirect) = parse_redirect(request) {
        return Disposition::Redirect(redirect);
    }
    Disposition::Ignore("404 Not Found")
}

#[cfg(desktop)]
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Minimal percent-decoding for the redirect query (pure → cargo-testable).
/// Operates on BYTES (never slices the &str) so a `%` followed by a multi-byte
/// UTF-8 char can't panic on a non-char-boundary slice.
#[cfg(desktop)]
fn urldecode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => match (hex_val(b[i + 1]), hex_val(b[i + 2])) {
                (Some(hi), Some(lo)) => {
                    out.push(hi * 16 + lo);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One tiny HTTP response for the loopback (status line + html body).
#[cfg(desktop)]
fn http_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    )
}

/// Read a full HTTP request (headers) from `stream`: loop reads until the
/// `\r\n\r\n` header terminator or a 64 KiB cap, so a large `picked_file_ids`
/// redirect (or one split across TCP segments) isn't truncated into a 403. The
/// stream's 5 s read timeout bounds a slow/stalled sender. Returns whatever was
/// read on EOF/cap (the caller classifies it); an I/O error propagates so the
/// caller can drop the connection and keep waiting. Generic over `Read` → testable.
#[cfg(desktop)]
fn read_request<R: std::io::Read>(stream: &mut R) -> std::io::Result<String> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break; // client closed
        }
        buf.extend_from_slice(&chunk[..n]);
        // A GET redirect has no body; headers end at the first CRLFCRLF.
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 64 * 1024 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Accept loopback connections until the genuine (state-matched) OAuth redirect
/// arrives, reply with a close-this-tab page, and return the parsed redirect.
/// Hardened per the REQ-CLOUD-3 plan + its adversarial review: EVERY stray is
/// answered and IGNORED (never fatal) — a bad `Host`, a foreign/mismatched
/// `state`, a non-redirect path, a per-connection read error, or a transient
/// accept error all `continue` the wait; a state-matched `error=` (user cancelled)
/// ends it with a clear reason; the `deadline_secs` cap (checked every iteration)
/// stops an abandoned consent — or continuous stray traffic — blocking forever.
#[cfg(desktop)]
fn capture_one_redirect(
    listener: std::net::TcpListener,
    port: u16,
    expected_state: &str,
    deadline_secs: u64,
) -> Result<Redirect, String> {
    use std::io::Write;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(deadline_secs);
    loop {
        if std::time::Instant::now() > deadline {
            return Err("sign-in timed out".to_string());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(conn) => conn,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(150));
                continue;
            }
            // A transient accept error (a peer that RST'd while queued, etc.) must not
            // kill an in-flight sign-in — drop it and keep waiting (the deadline bounds us).
            Err(_) => continue,
        };
        // On Windows an accepted socket inherits the listener's non-blocking mode,
        // which would make set_read_timeout inert (immediate WouldBlock); reset it so
        // the 5 s read timeout actually bounds a slow sender.
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
        // A per-connection read error is a stray, not a flow-fatal event — drop + continue.
        let req = match read_request(&mut stream) {
            Ok(req) => req,
            Err(_) => continue,
        };
        match classify_request(&req, expected_state, port) {
            Disposition::Redirect(redirect) => {
                let body = "<!doctype html><meta charset=utf-8><body style=\"font-family:system-ui;padding:2rem\">Signed in — you can close this tab and return to szmde.</body>";
                let _ = stream.write_all(http_response("200 OK", body).as_bytes());
                return Ok(redirect);
            }
            Disposition::Declined(err) => {
                let body = "<!doctype html><meta charset=utf-8><body style=\"font-family:system-ui;padding:2rem\">Sign-in was cancelled — you can close this tab.</body>";
                let _ = stream.write_all(http_response("200 OK", body).as_bytes());
                return Err(format!("sign-in was declined: {err}"));
            }
            Disposition::Ignore(status) => {
                let _ = stream.write_all(http_response(status, "").as_bytes());
                continue;
            }
        }
    }
}

/// Reserve a one-shot loopback listener on an OS-assigned ephemeral port; returns
/// the port so the frontend can build `redirect_uri=http://127.0.0.1:<port>`.
#[cfg(desktop)]
#[tauri::command]
fn oauth_loopback_reserve(state: tauri::State<'_, Loopback>) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.0.lock().unwrap() = Some(listener);
    Ok(port)
}

/// Take the reserved listener (or error if none was reserved).
#[cfg(desktop)]
fn take_listener(state: &tauri::State<'_, Loopback>) -> Result<std::net::TcpListener, String> {
    state.0.lock().unwrap().take().ok_or_else(|| {
        "no reserved loopback listener (call oauth_loopback_reserve first)".to_string()
    })
}

/// Open the system browser to `auth_url` and capture the loopback redirect. The
/// CSRF `state` check happens INSIDE `capture_one_redirect` (so a mismatched state
/// is ignored-and-kept-waiting, not fatal); this just wires the browser open to the
/// capture. `deadline_secs` bounds the wait (longer for the interactive Picker).
#[cfg(desktop)]
async fn open_and_capture(
    app: tauri::AppHandle,
    listener: std::net::TcpListener,
    auth_url: String,
    expected_state: String,
    deadline_secs: u64,
) -> Result<Redirect, String> {
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(auth_url, None::<&str>)
            .map_err(|e| e.to_string())?;
    }
    tokio::task::spawn_blocking(move || {
        capture_one_redirect(listener, port, &expected_state, deadline_secs)
    })
    .await
    .map_err(|e| format!("loopback task failed: {e}"))?
}

/// Sign-in: open the browser, capture the loopback redirect, and return the
/// authorization `code`. 180 s deadline (a quick, non-interactive consent).
#[cfg(desktop)]
#[tauri::command]
async fn oauth_loopback_await(
    app: tauri::AppHandle,
    state: tauri::State<'_, Loopback>,
    auth_url: String,
    expected_state: String,
) -> Result<String, String> {
    let listener = take_listener(&state)?;
    Ok(
        open_and_capture(app, listener, auth_url, expected_state, 180)
            .await?
            .code,
    )
}

/// Picker variant (REQ-CLOUD-3): same browser-open + capture, but returns the WHOLE
/// redirect so the caller also gets `pickedFileIds` from the Google desktop Picker
/// (`trigger_onepick`) flow. 300 s deadline — the user is interactively BROWSING
/// their Drive in the Picker, which takes longer than a plain sign-in.
#[cfg(desktop)]
#[tauri::command]
async fn oauth_pick_await(
    app: tauri::AppHandle,
    state: tauri::State<'_, Loopback>,
    auth_url: String,
    expected_state: String,
) -> Result<Redirect, String> {
    let listener = take_listener(&state)?;
    open_and_capture(app, listener, auth_url, expected_state, 300).await
}

// --- Secure store (REQ-SEC-1) ---------------------------------------------
// OAuth tokens live in the OS credential store (Windows Credential Manager /
// macOS Keychain) via the `keyring` crate — never in user.json. `service`
// namespaces szmde's entries; `account` is the per-account key. The mobile
// keystore backend arrives with the Android target (M6).

/// Read a secret: Some(value) if present, None if absent, Err on a store error.
#[tauri::command]
fn secure_get(service: String, account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Store (or replace) a secret.
#[tauri::command]
fn secure_set(service: String, account: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Delete a secret. Idempotent: deleting an absent entry is not an error.
#[tauri::command]
fn secure_delete(service: String, account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(desktop)]
const VERSION: &str = env!("CARGO_PKG_VERSION");
#[cfg(desktop)]
const HELP: &str = "\
szmde — Stephen Zhao MarkDown Editor

USAGE:
    szmde [OPTIONS] [FILE]

ARGS:
    FILE    Markdown file to open. Relative paths resolve against the current
            working directory. A WSL/Linux path (\"/home/...\") is translated to
            the \\\\wsl.localhost UNC form on Windows.

OPTIONS:
    --new-window    Force a new window instead of forwarding to a running instance
    --render-mode <clean|markers-rendered|markers-syntax>
                    Initial render mode (applied in a later milestone)
    --version       Print version and exit
    --help          Print this help and exit
";

#[cfg(desktop)]
const RENDER_MODES: [&str; 3] = ["clean", "markers-rendered", "markers-syntax"];

/// Parsed CLI. `new_window`/`render_mode` are recognized (so they aren't treated
/// as a file or rejected as unknown) but not yet acted on — multi-window and the
/// render-mode engine are later-milestone work.
#[cfg(desktop)]
#[allow(dead_code)]
#[derive(Debug)]
struct Cli {
    file: Option<String>,
    new_window: bool,
    render_mode: Option<String>,
}

/// Parse argv (program name already stripped). `Err(code)` means the caller
/// should exit with that process code (0 for --help/--version, non-zero on bad args).
#[cfg(desktop)]
fn parse_cli<I: Iterator<Item = String>>(args: I, cwd: Option<&str>) -> Result<Cli, i32> {
    let mut cli = Cli {
        file: None,
        new_window: false,
        render_mode: None,
    };
    let mut it = args;
    while let Some(a) = it.next() {
        match a.as_str() {
            "--help" | "-h" => {
                print!("{HELP}");
                return Err(0);
            }
            "--version" | "-V" => {
                println!("szmde {VERSION}");
                return Err(0);
            }
            "--new-window" => cli.new_window = true,
            "--render-mode" => match it.next() {
                Some(v) if RENDER_MODES.contains(&v.as_str()) => cli.render_mode = Some(v),
                Some(v) => {
                    eprintln!(
                        "szmde: invalid --render-mode '{v}' (expected one of {RENDER_MODES:?})"
                    );
                    return Err(2);
                }
                None => {
                    eprintln!("szmde: --render-mode requires a value");
                    return Err(2);
                }
            },
            other if other.starts_with('-') => {
                eprintln!("szmde: unknown option '{other}'");
                return Err(2);
            }
            other => {
                if cli.file.is_none() {
                    cli.file = Some(resolve_path(other, cwd));
                } else {
                    eprintln!("szmde: unexpected extra argument '{other}'");
                    return Err(2);
                }
            }
        }
    }
    Ok(cli)
}

/// Resolve a CLI path argument to something std::fs can open: translate a
/// WSL/Linux absolute path to UNC, and make a relative path absolute against
/// `cwd` (the invoking shell's working directory — critical for forwarded opens).
#[cfg(desktop)]
fn resolve_path(arg: &str, cwd: Option<&str>) -> String {
    #[cfg(windows)]
    if arg.starts_with('/') {
        if let Some(unc) = wsl_to_unc(arg) {
            return unc;
        }
    }
    let p = std::path::Path::new(arg);
    if p.is_absolute() {
        return arg.to_string();
    }
    match cwd {
        Some(cwd) => std::path::Path::new(cwd)
            .join(p)
            .to_string_lossy()
            .into_owned(),
        None => arg.to_string(),
    }
}

/// Translate a WSL/Linux path to its Windows `\\wsl.localhost\<distro>\...` UNC
/// form via `wslpath -w` (SPEC §2.1 / §6.1). Returns None if WSL isn't available.
#[cfg(windows)]
fn wsl_to_unc(linux_path: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut cmd = std::process::Command::new("wsl.exe");
    // Resolve against the LAUNCHING distro when known: WSL sets WSL_DISTRO_NAME
    // for processes started from inside a distro. Without `-d`, wsl.exe uses the
    // DEFAULT distro, producing the wrong \\wsl.localhost\<distro>\ path on a
    // multi-distro machine launched from a non-default distro. (On the forwarded
    // single-instance path the launcher's env isn't available, so we fall back
    // to the default distro there.)
    if let Ok(distro) = std::env::var("WSL_DISTRO_NAME") {
        if !distro.is_empty() {
            cmd.args(["-d", &distro]);
        }
    }
    cmd.args(["-e", "wslpath", "-w", linux_path]);
    cmd.creation_flags(CREATE_NO_WINDOW); // no console window flash from the GUI process

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Attach to the launching console so `--version`/`--help`/errors are visible
/// even though the release build uses the Windows subsystem (no console of its own).
#[cfg(windows)]
fn attach_parent_console() {
    extern "system" {
        fn AttachConsole(dw_process_id: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First-launch CLI (desktop only): this process runs in the invoking shell's
    // cwd, so current_dir() is the right base for relative paths. Mobile has no
    // argv/cwd — the OS launches the app, never with a file argument.
    #[cfg(desktop)]
    let launch_file = {
        #[cfg(windows)]
        attach_parent_console();
        let cwd = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        match parse_cli(std::env::args().skip(1), cwd.as_deref()) {
            Ok(c) => c.file,
            Err(code) => std::process::exit(code),
        }
    };
    #[cfg(mobile)]
    let launch_file: Option<String> = None;

    let builder = tauri::Builder::default();

    // Single-instance must be the FIRST plugin registered (Tauri requirement).
    // Desktop only — mobile has no second process to forward args from.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        use tauri::Emitter;
        // Resolve the forwarded path against the FORWARDING shell's cwd (not
        // the running instance's), so `szmde notes.md` works from any dir.
        // This runs OFF the UI thread: resolve_path may invoke wsl.exe for a
        // WSL path, and this callback fires on the running instance's main
        // thread — a cold/stuck WSL must not freeze the window.
        let handle = app.clone();
        std::thread::spawn(move || {
            if let Ok(cli) = parse_cli(argv.into_iter().skip(1), Some(&cwd)) {
                if let Some(path) = cli.file {
                    let _ = handle.emit("open-file", path);
                }
            }
        });
        // Surface the running instance (fast; no WSL). set_focus() alone
        // no-ops on a minimized Windows window, so unminimize + show first.
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(LaunchFile(Mutex::new(launch_file)));

    // The loopback OAuth capture (reserve/await/pick) + its listener state are
    // desktop-only: Google deprecated the 127.0.0.1 loopback redirect for mobile,
    // so Android sign-in will use a deep-link redirect (a later M6 slice). The
    // mobile handler is the same command surface minus those three.
    #[cfg(desktop)]
    let builder =
        builder
            .manage(Loopback(Mutex::new(None)))
            .invoke_handler(tauri::generate_handler![
                read_file,
                write_file,
                read_file_meta,
                stat_file,
                get_launch_file,
                read_settings_file,
                write_settings_file,
                secure_get,
                secure_set,
                secure_delete,
                read_gdrive_config,
                oauth_loopback_reserve,
                oauth_loopback_await,
                oauth_pick_await
            ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        read_file,
        write_file,
        read_file_meta,
        stat_file,
        get_launch_file,
        read_settings_file,
        write_settings_file,
        secure_get,
        secure_set,
        secure_delete,
        read_gdrive_config
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // Requirement coverage (docs/requirements.md):
    //   [REQ-CLI-1] parse_cli   ·  [REQ-CLI-2] resolve_path
    //   [REQ-FILE-1] read_file   ·  [REQ-FILE-2] write_file (atomic)
    //   [REQ-SET-3] settings file IO (settings_path / write_atomic / read_optional)
    //   [REQ-SAVE-1] revision tokens (compose_rev / file_rev / read_file_meta / stat_file)
    //   [REQ-SEC-1] OS secure store (secure_get / secure_set / secure_delete)
    //   [REQ-CLOUD-1] loopback redirect capture (parse_redirect / urldecode / gdrive_config_path)
    use super::*;

    fn args(v: &[&str]) -> std::vec::IntoIter<String> {
        v.iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn parse_cli_bare_file_resolves_against_cwd() {
        let cwd = std::env::temp_dir();
        let cwd_s = cwd.to_string_lossy().into_owned();
        let cli = parse_cli(args(&["notes.md"]), Some(&cwd_s)).unwrap();
        let f = cli.file.expect("file should be set");
        assert!(std::path::Path::new(&f).is_absolute());
        assert!(f.ends_with("notes.md"));
        assert!(!cli.new_window);
        assert!(cli.render_mode.is_none());
    }

    #[test]
    fn parse_cli_new_window_flag() {
        let cli = parse_cli(args(&["--new-window"]), None).unwrap();
        assert!(cli.new_window);
        assert!(cli.file.is_none());
    }

    #[test]
    fn parse_cli_accepts_each_valid_render_mode() {
        for m in RENDER_MODES {
            let cli = parse_cli(args(&["--render-mode", m]), None).unwrap();
            assert_eq!(cli.render_mode.as_deref(), Some(m));
        }
    }

    #[test]
    fn parse_cli_invalid_render_mode_is_usage_error() {
        assert_eq!(
            parse_cli(args(&["--render-mode", "nope"]), None).unwrap_err(),
            2
        );
    }

    #[test]
    fn parse_cli_render_mode_without_value_is_usage_error() {
        assert_eq!(parse_cli(args(&["--render-mode"]), None).unwrap_err(), 2);
    }

    #[test]
    fn parse_cli_help_and_version_exit_zero() {
        for flag in ["--help", "-h", "--version", "-V"] {
            assert_eq!(parse_cli(args(&[flag]), None).unwrap_err(), 0, "{flag}");
        }
    }

    #[test]
    fn parse_cli_unknown_option_is_usage_error() {
        assert_eq!(parse_cli(args(&["--bogus"]), None).unwrap_err(), 2);
    }

    #[test]
    fn parse_cli_second_positional_is_usage_error() {
        assert_eq!(parse_cli(args(&["a.md", "b.md"]), None).unwrap_err(), 2);
    }

    #[test]
    fn resolve_path_absolute_is_returned_unchanged() {
        let abs = std::env::temp_dir().join("szmde-abs.md");
        let abs_s = abs.to_string_lossy().into_owned();
        // cwd is irrelevant for an already-absolute path
        assert_eq!(resolve_path(&abs_s, Some("/some/other/dir")), abs_s);
    }

    #[test]
    fn resolve_path_relative_joins_cwd() {
        let cwd = std::env::temp_dir();
        let cwd_s = cwd.to_string_lossy().into_owned();
        let r = resolve_path("notes.md", Some(&cwd_s));
        assert!(std::path::Path::new(&r).is_absolute());
        assert!(r.ends_with("notes.md"));
    }

    #[test]
    fn resolve_path_relative_without_cwd_is_unchanged() {
        assert_eq!(resolve_path("notes.md", None), "notes.md");
    }

    #[test]
    fn write_then_read_roundtrips_and_overwrites_atomically() {
        let path = std::env::temp_dir().join(format!("szmde-rt-{}.md", std::process::id()));
        let p = path.to_string_lossy().into_owned();
        write_file(p.clone(), "hello\nworld".into()).unwrap();
        assert_eq!(read_file(p.clone()).unwrap(), "hello\nworld");
        // Atomic rename replaces an existing file in place.
        write_file(p.clone(), "replaced".into()).unwrap();
        assert_eq!(read_file(p.clone()).unwrap(), "replaced");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_file_leaves_no_temp_residue() {
        let dir = std::env::temp_dir().join(format!("szmde-tmpcheck-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_file(
            dir.join("note.md").to_string_lossy().into_owned(),
            "x".into(),
        )
        .unwrap();
        let residue = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("szmde-tmp"));
        assert!(!residue, "atomic write left a temp file behind");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_on_missing_path_is_err() {
        let missing = std::env::temp_dir().join("szmde-definitely-absent-xyz.md");
        assert!(read_file(missing.to_string_lossy().into_owned()).is_err());
    }

    // --- [REQ-SET-3] settings file IO -------------------------------------
    #[test]
    fn settings_path_maps_known_files_and_rejects_unknown() {
        let base = std::path::Path::new("/cfg");
        assert_eq!(settings_path(base, "user"), Some(base.join("user.json")));
        assert_eq!(
            settings_path(base, "system"),
            Some(base.join("system.json"))
        );
        assert_eq!(settings_path(base, "bogus"), None);
    }

    #[test]
    fn read_optional_is_some_when_present_and_none_when_absent() {
        let dir = std::env::temp_dir().join(format!("szmde-set-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let user = settings_path(&dir, "user").unwrap();
        assert_eq!(read_optional(&user).unwrap(), None); // absent → None, not Err
        write_atomic(&user, "{\"version\":1}").unwrap();
        assert_eq!(
            read_optional(&user).unwrap(),
            Some("{\"version\":1}".to_string())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- [REQ-SAVE-1] revision / conflict detection -----------------------
    #[test]
    fn compose_rev_is_stable_and_varies_with_mtime_and_len() {
        // Use a whole second — SystemTime on Windows is FILETIME-backed (100 ns
        // ticks), so a sub-100 ns offset would quantize and make this brittle.
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
        assert_eq!(compose_rev(Some(t), 7), "1000000000-7");
        assert_eq!(compose_rev(Some(t), 8), "1000000000-8"); // length changes the token
        assert_eq!(compose_rev(None, 5), "0-5"); // missing mtime degrades to 0
    }

    #[test]
    fn file_rev_is_some_for_a_file_and_none_when_absent() {
        let dir = std::env::temp_dir().join(format!("szmde-rev-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.md");
        assert_eq!(file_rev(&f).unwrap(), None); // absent → None (not Err)
        std::fs::write(&f, "hello").unwrap();
        let rev = file_rev(&f).unwrap().expect("present → Some");
        assert!(rev.ends_with("-5"), "len 5 encoded in rev: {rev}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_meta_returns_content_and_rev_matching_stat() {
        let f = std::env::temp_dir().join(format!("szmde-meta-{}.md", std::process::id()));
        let p = f.to_string_lossy().into_owned();
        write_file(p.clone(), "abc".into()).unwrap();
        let meta = read_file_meta(p.clone()).unwrap();
        assert_eq!(meta.content, "abc");
        assert!(meta.rev.ends_with("-3"), "len 3 in rev: {}", meta.rev);
        // stat_file on the same unchanged file yields the identical rev.
        assert_eq!(
            stat_file(p.clone()).unwrap().as_deref(),
            Some(meta.rev.as_str())
        );
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn stat_file_is_none_for_a_missing_path() {
        let missing = std::env::temp_dir().join("szmde-absent-rev-xyz.md");
        assert_eq!(
            stat_file(missing.to_string_lossy().into_owned()).unwrap(),
            None
        );
    }

    // --- [REQ-SEC-1] OS secure store --------------------------------------
    // Integration test: round-trips through the real OS credential store
    // (Windows Credential Manager on the dev box). Needs an available keyring;
    // skip-equivalent on environments without one.
    #[test]
    fn secure_store_roundtrips_and_delete_is_idempotent() {
        let svc = "com.zhaostephen.szmde.test".to_string();
        let acct = format!("rt-{}", std::process::id());
        assert_eq!(secure_get(svc.clone(), acct.clone()).unwrap(), None); // absent
        secure_set(svc.clone(), acct.clone(), "secret-value".into()).unwrap();
        assert_eq!(
            secure_get(svc.clone(), acct.clone()).unwrap().as_deref(),
            Some("secret-value"),
        );
        secure_delete(svc.clone(), acct.clone()).unwrap();
        assert_eq!(secure_get(svc.clone(), acct.clone()).unwrap(), None); // gone
        secure_delete(svc.clone(), acct.clone()).unwrap(); // idempotent: no error
    }

    // --- [REQ-CLOUD-1] loopback redirect capture (pure helpers) -----------
    #[test]
    fn parse_redirect_extracts_code_and_state() {
        let req = "GET /?code=4/abc-DEF_123&state=xyz789 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(
            parse_redirect(req),
            Some(Redirect {
                code: "4/abc-DEF_123".to_string(),
                state: "xyz789".to_string(),
                picked_file_ids: None,
            }),
        );
    }

    #[test]
    fn parse_redirect_percent_decodes_values() {
        // Google often percent-encodes the `/` in the code as %2F.
        let req = "GET /?state=s1&code=4%2Fabc%20def HTTP/1.1\r\n\r\n";
        assert_eq!(
            parse_redirect(req),
            Some(Redirect {
                code: "4/abc def".to_string(),
                state: "s1".to_string(),
                picked_file_ids: None,
            }),
        );
    }

    #[test]
    fn parse_redirect_is_none_without_code_or_query() {
        assert_eq!(parse_redirect("GET /?state=only HTTP/1.1\r\n\r\n"), None);
        assert_eq!(parse_redirect("GET / HTTP/1.1\r\n\r\n"), None);
        assert_eq!(parse_redirect(""), None);
    }

    // --- [REQ-CLOUD-3] Picker redirect + loopback hardening (pure helpers) --
    #[test]
    fn parse_redirect_extracts_picked_file_ids() {
        // The shape of a real trigger_onepick redirect (S1 spike, 2026-07-11) —
        // extra params like `iss`/`scope` are present and must be tolerated.
        let req = "GET /?state=s1&iss=https%3A%2F%2Faccounts.google.com&picked_file_ids=ID1%2CID2&code=4%2Fcode&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file HTTP/1.1\r\nHost: 127.0.0.1:49737\r\n\r\n";
        assert_eq!(
            parse_redirect(req),
            Some(Redirect {
                code: "4/code".to_string(),
                state: "s1".to_string(),
                picked_file_ids: Some("ID1,ID2".to_string()),
            }),
        );
    }

    #[test]
    fn parse_error_extracts_a_declined_consent() {
        let req = "GET /?error=access_denied&state=s1 HTTP/1.1\r\n\r\n";
        assert_eq!(parse_error(req), Some("access_denied".to_string()));
        assert_eq!(parse_error("GET /?code=x&state=s1 HTTP/1.1\r\n\r\n"), None);
        assert_eq!(parse_error("GET / HTTP/1.1\r\n\r\n"), None);
    }

    #[test]
    fn host_allowed_accepts_only_the_loopback_listener() {
        let ok_ip = "GET /? HTTP/1.1\r\nHost: 127.0.0.1:49737\r\n\r\n";
        let ok_name = "GET /? HTTP/1.1\r\nhost: localhost:49737\r\n\r\n"; // case-insensitive
        let bad_host = "GET /? HTTP/1.1\r\nHost: evil.example:49737\r\n\r\n"; // DNS rebinding
        let bad_port = "GET /? HTTP/1.1\r\nHost: 127.0.0.1:9999\r\n\r\n";
        let no_host = "GET /? HTTP/1.1\r\n\r\n";
        assert!(host_allowed(ok_ip, 49737));
        assert!(host_allowed(ok_name, 49737));
        assert!(!host_allowed(bad_host, 49737));
        assert!(!host_allowed(bad_port, 49737));
        assert!(!host_allowed(no_host, 49737));
    }

    #[test]
    fn query_param_extracts_and_decodes() {
        let req = "GET /?a=1&b=x%2Fy&c= HTTP/1.1\r\n\r\n";
        assert_eq!(query_param(req, "a").as_deref(), Some("1"));
        assert_eq!(query_param(req, "b").as_deref(), Some("x/y"));
        assert_eq!(query_param(req, "c").as_deref(), Some(""));
        assert_eq!(query_param(req, "missing"), None);
        assert_eq!(query_param("GET / HTTP/1.1\r\n\r\n", "a"), None); // no query
    }

    // classify_request is the security gate: the CSRF `state` check lives inside the
    // wait loop so strays are ignored (kept waiting), only our state-matched redirect
    // (or genuine cancel) is honored. Covers the adversarial-review findings.
    #[test]
    fn classify_ignores_bad_host_and_foreign_state() {
        let host = "Host: 127.0.0.1:49737";
        // Wrong Host (DNS rebinding) → ignore even with the right state.
        let rebind = "GET /?code=c&state=S HTTP/1.1\r\nHost: evil:49737\r\n\r\n";
        assert_eq!(
            classify_request(rebind, "S", 49737),
            Disposition::Ignore("403 Forbidden")
        );
        // Right Host but a FORGED/foreign state → ignore (can't DoS the real flow).
        let forged = format!("GET /?code=c&state=WRONG HTTP/1.1\r\n{host}\r\n\r\n");
        assert_eq!(
            classify_request(&forged, "S", 49737),
            Disposition::Ignore("403 Forbidden")
        );
        // A forged error= with no/foreign state must NOT abort the flow either.
        let forged_err = format!("GET /?error=access_denied HTTP/1.1\r\n{host}\r\n\r\n");
        assert_eq!(
            classify_request(&forged_err, "S", 49737),
            Disposition::Ignore("403 Forbidden")
        );
        // A non-redirect path (favicon) with the right Host but no state → ignore.
        let favicon = format!("GET /favicon.ico HTTP/1.1\r\n{host}\r\n\r\n");
        assert_eq!(
            classify_request(&favicon, "S", 49737),
            Disposition::Ignore("403 Forbidden")
        );
    }

    #[test]
    fn classify_honors_state_matched_redirect_and_cancel() {
        let host = "Host: 127.0.0.1:49737";
        // The genuine redirect (state matches) → Redirect.
        let ok = format!("GET /?state=S&picked_file_ids=ID&code=c HTTP/1.1\r\n{host}\r\n\r\n");
        assert_eq!(
            classify_request(&ok, "S", 49737),
            Disposition::Redirect(Redirect {
                code: "c".into(),
                state: "S".into(),
                picked_file_ids: Some("ID".into()),
            })
        );
        // A state-matched error= (real user cancel) → Declined.
        let cancel = format!("GET /?error=access_denied&state=S HTTP/1.1\r\n{host}\r\n\r\n");
        assert_eq!(
            classify_request(&cancel, "S", 49737),
            Disposition::Declined("access_denied".into())
        );
        // Right Host + right state but neither code nor error (odd but possible) → 404 ignore.
        let neither = format!("GET /?state=S&foo=bar HTTP/1.1\r\n{host}\r\n\r\n");
        assert_eq!(
            classify_request(&neither, "S", 49737),
            Disposition::Ignore("404 Not Found")
        );
    }

    #[test]
    fn read_request_reads_until_the_header_terminator() {
        // Stops at CRLFCRLF (a GET redirect has no body) even with trailing bytes.
        let raw = b"GET /?code=c&state=S HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\nIGNORED_BODY";
        let got = read_request(&mut &raw[..]).unwrap();
        assert!(got.contains("code=c&state=S"));
        assert!(got.contains("\r\n\r\n"));
        // A large multi-file redirect (no early terminator until the end) survives intact
        // rather than truncating at 4 KiB — the fix for the picked_file_ids overflow.
        // Real Drive ids are ~33 chars; 200 of them overflow the 4 KiB read buffer.
        let ids = (0..200)
            .map(|i| format!("{i:033}"))
            .collect::<Vec<_>>()
            .join("%2C");
        let big = format!("GET /?state=S&picked_file_ids={ids}&code=c HTTP/1.1\r\nHost: h\r\n\r\n");
        assert!(big.len() > 4096, "fixture must exceed one read buffer");
        let got = read_request(&mut big.as_bytes()).unwrap();
        assert!(got.contains("code=c")); // the code after the long id list is not lost
        assert_eq!(query_param(&got, "code").as_deref(), Some("c"));
    }

    #[test]
    fn urldecode_handles_percent_plus_and_bad_escapes() {
        assert_eq!(urldecode("a%2Fb"), "a/b");
        assert_eq!(urldecode("a+b"), "a b");
        assert_eq!(urldecode("plain"), "plain");
        assert_eq!(urldecode("bad%zz"), "bad%zz"); // malformed escape kept literally
        assert_eq!(urldecode("trailing%"), "trailing%"); // truncated escape kept
        assert_eq!(urldecode("%\u{20AC}"), "%\u{20AC}"); // % before a multi-byte char: no panic
    }

    #[test]
    fn gdrive_config_path_is_under_the_base() {
        let base = std::path::Path::new("/cfg");
        assert_eq!(gdrive_config_path(base), base.join("gdrive_client.json"));
    }

    #[test]
    fn settings_write_atomic_overwrites_and_leaves_no_residue() {
        let dir = std::env::temp_dir().join(format!("szmde-setrt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let user = settings_path(&dir, "user").unwrap();
        write_atomic(&user, "{\"a\":1}").unwrap();
        write_atomic(&user, "{\"a\":2}").unwrap(); // in-place atomic replace
        assert_eq!(read_optional(&user).unwrap(), Some("{\"a\":2}".to_string()));
        let residue = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("szmde-tmp"));
        assert!(!residue, "atomic write left a temp file behind");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
