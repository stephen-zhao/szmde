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
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(&path);
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled");
    let tmp = dir.join(format!(".{}.{}.szmde-tmp", name, std::process::id()));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp); // best-effort cleanup; original untouched
        return Err(e.to_string());
    }
    Ok(())
}

/// Returns (once) the file path szmde was launched with, e.g. `szmde notes.md`.
#[tauri::command]
fn get_launch_file(state: tauri::State<'_, LaunchFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

const VERSION: &str = env!("CARGO_PKG_VERSION");
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

const RENDER_MODES: [&str; 3] = ["clean", "markers-rendered", "markers-syntax"];

/// Parsed CLI. `new_window`/`render_mode` are recognized (so they aren't treated
/// as a file or rejected as unknown) but not yet acted on — multi-window and the
/// render-mode engine are later-milestone work.
#[allow(dead_code)]
#[derive(Debug)]
struct Cli {
    file: Option<String>,
    new_window: bool,
    render_mode: Option<String>,
}

/// Parse argv (program name already stripped). `Err(code)` means the caller
/// should exit with that process code (0 for --help/--version, non-zero on bad args).
fn parse_cli<I: Iterator<Item = String>>(args: I, cwd: Option<&str>) -> Result<Cli, i32> {
    let mut cli = Cli { file: None, new_window: false, render_mode: None };
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
                    eprintln!("szmde: invalid --render-mode '{v}' (expected one of {RENDER_MODES:?})");
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
        Some(cwd) => std::path::Path::new(cwd).join(p).to_string_lossy().into_owned(),
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
    #[cfg(windows)]
    attach_parent_console();

    // First-launch CLI: this process runs in the invoking shell's cwd, so
    // current_dir() is the right base for relative paths.
    let cwd = std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned());
    let cli = match parse_cli(std::env::args().skip(1), cwd.as_deref()) {
        Ok(c) => c,
        Err(code) => std::process::exit(code),
    };
    let launch_file = cli.file;

    let mut builder = tauri::Builder::default();

    // Single-instance must be the FIRST plugin registered (Tauri requirement).
    // Desktop only — mobile has no second process to forward args from.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
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
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(LaunchFile(Mutex::new(launch_file)))
        .invoke_handler(tauri::generate_handler![read_file, write_file, get_launch_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // Requirement coverage (docs/traceability.md):
    //   [REQ-CLI-1] parse_cli   ·  [REQ-CLI-2] resolve_path
    //   [REQ-FILE-1] read_file   ·  [REQ-FILE-2] write_file (atomic)
    use super::*;

    fn args(v: &[&str]) -> std::vec::IntoIter<String> {
        v.iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter()
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
        assert_eq!(parse_cli(args(&["--render-mode", "nope"]), None).unwrap_err(), 2);
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
        write_file(dir.join("note.md").to_string_lossy().into_owned(), "x".into()).unwrap();
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
}
