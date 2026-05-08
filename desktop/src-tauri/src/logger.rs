//! File-based persistent logger for production parser triage.
//!
//! Why exist: in a packaged Windows build, stderr/eprintln output goes
//! nowhere visible to the user. When the parser wedges at 95-99%, we need
//! the same data we have in dev (ROUNDLAB_PROGRESS, ROUNDLAB_FINAL,
//! CommandEvent::Terminated, watchdog trips) but in a file we can ask the
//! user to copy back.
//!
//! Format: one line per entry, plain text, easy to tail/grep:
//!   2026-05-07T14:31:02.123Z [INFO ] [primary  ] ROUNDLAB_FINAL start step=of.Sync …
//!
//! Fields:
//!   timestamp  — ISO-8601 UTC, millisecond precision
//!   level      — INFO | WARN | ERROR (5-char padded so columns align)
//!   source     — primary | fallback | tauri | frontend (9-char padded)
//!   message    — free-form, never trusted to be UTF-8 cleanly
//!
//! Path: <app_data_dir>/RoundLab/logs/roundlab.log
//! Rotation: when the live file exceeds 5 MB, it is renamed to
//! roundlab.old.log (overwriting any previous .old) and a fresh file
//! is opened. Two log files maximum, no compression.
//!
//! Failure mode: any I/O error during logging is silently swallowed.
//! Logging must never break the parser.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

const ROTATE_AT_BYTES: u64 = 5 * 1024 * 1024;
const LOG_FILE_NAME: &str = "roundlab.log";
const OLD_LOG_FILE_NAME: &str = "roundlab.old.log";
const PROJECTILE_LOG_FILE_NAME: &str = "projectile-debug.log";
const OLD_PROJECTILE_LOG_FILE_NAME: &str = "projectile-debug.old.log";
const PROJECTILE_LOG_MARKER: &str = "ROUNDLAB_DEBUG_PROJECTILES";

#[derive(Clone, Copy, Debug)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Info => "INFO ",
            LogLevel::Warn => "WARN ",
            LogLevel::Error => "ERROR",
        }
    }
}

/// Global path to the active log file. Set once via `init_logger`.
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static PROJECTILE_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Mutex guards the file handle. None until init succeeds; reopened on
/// rotation.
static LOG_FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static PROJECTILE_LOG_FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    Ok(base.join("RoundLab").join("logs"))
}

/// Compute the canonical log file path under <app_data_dir>/RoundLab/logs/.
/// Cheap; safe to call from any tauri::command without taking the file
/// lock.
pub fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = LOG_PATH.get() {
        return Ok(p.clone());
    }
    let dir = log_dir(app)?;
    Ok(dir.join(LOG_FILE_NAME))
}

pub fn projectile_log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = PROJECTILE_LOG_PATH.get() {
        return Ok(p.clone());
    }
    let dir = log_dir(app)?;
    Ok(dir.join(PROJECTILE_LOG_FILE_NAME))
}

fn init_file_handle(mutex: &Mutex<Option<File>>, path: &PathBuf, old_path: &PathBuf) {
    if let Some(dir) = path.parent() {
        if fs::create_dir_all(dir).is_err() {
            return;
        }
    }

    let already_open = mutex.lock().map(|g| g.is_some()).unwrap_or(false);
    if !already_open {
        if let Ok(meta) = fs::metadata(path) {
            if meta.len() > ROTATE_AT_BYTES {
                let _ = fs::remove_file(old_path);
                let _ = fs::rename(path, old_path);
            }
        }
    }

    if let Ok(mut guard) = mutex.lock() {
        if guard.is_none() {
            *guard = OpenOptions::new().create(true).append(true).open(path).ok();
        }
    }
}

/// Open (or create) the log file under <app_data_dir>/RoundLab/logs/.
/// Idempotent: subsequent calls reuse the same handle and skip rotation
/// if a handle is already open (renaming an open file fails on Windows
/// with a sharing violation).
pub fn init_logger(app: &AppHandle) {
    let mutex = LOG_FILE.get_or_init(|| Mutex::new(None));
    let projectile_mutex = PROJECTILE_LOG_FILE.get_or_init(|| Mutex::new(None));

    let dir = match log_dir(app) {
        Ok(d) => d,
        Err(_) => return,
    };
    let path = dir.join(LOG_FILE_NAME);
    let projectile_path = dir.join(PROJECTILE_LOG_FILE_NAME);

    let _ = LOG_PATH.set(path.clone());
    let _ = PROJECTILE_LOG_PATH.set(projectile_path.clone());

    init_file_handle(mutex, &path, &dir.join(OLD_LOG_FILE_NAME));
    init_file_handle(
        projectile_mutex,
        &projectile_path,
        &dir.join(OLD_PROJECTILE_LOG_FILE_NAME),
    );

    // Sentinel line so the file is never empty when triage starts.
    log(LogLevel::Info, "tauri", "logger initialised");
}

/// Format `SystemTime::now()` as ISO-8601 UTC with millisecond precision.
/// We avoid pulling chrono/time just for this — formatting a UNIX
/// timestamp is a few lines.
fn now_iso8601() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();

    // Days since 1970-01-01.
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let hour = (time_of_day / 3600) as u32;
    let minute = ((time_of_day % 3600) / 60) as u32;
    let second = (time_of_day % 60) as u32;

    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Convert "days since 1970-01-01" to (year, month, day) using the civil
/// calendar algorithm from Howard Hinnant's date library. Self-contained
/// so we don't pull a chrono-shaped dependency just to print a date.
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 {
        z / 146_097
    } else {
        (z - 146_096) / 146_097
    };
    let doe = (z - era * 146_097) as u32; // [0, 146_096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

/// Pad `s` on the right with spaces to exactly `width` chars (counted in
/// chars, not bytes — never panics on a multi-byte UTF-8 input). Truncates
/// if longer. Keeps columns visually aligned in the log.
fn pad_right(s: &str, width: usize) -> String {
    let mut out: String = s.chars().take(width).collect();
    let len = out.chars().count();
    if len < width {
        for _ in len..width {
            out.push(' ');
        }
    }
    out
}

/// Write one log entry. Silently swallows I/O errors so a broken disk
/// can never wedge the parser.
pub fn log(level: LogLevel, source: &str, message: &str) {
    // Always also mirror to stderr in dev so `pnpm tauri dev` keeps
    // showing logs without forcing a file read.
    eprintln!(
        "{} [{}] [{}] {}",
        now_iso8601(),
        level.as_str(),
        pad_right(source, 9),
        message
    );

    let mutex = match LOG_FILE.get() {
        Some(m) => m,
        None => return,
    };
    let Ok(mut guard) = mutex.lock() else {
        return;
    };
    let Some(file) = guard.as_mut() else {
        return;
    };

    let line = format!(
        "{} [{}] [{}] {}\n",
        now_iso8601(),
        level.as_str(),
        pad_right(source, 9),
        message
    );
    let bytes = line.as_bytes();
    let _ = file.write_all(bytes);
    // Flushing every line is slow but worth it for a triage tool: if the
    // app crashes mid-parse, we don't want the last 4 KB sitting in a
    // BufWriter.
    let _ = file.flush();
    let _ = file.sync_data();

    if message.contains(PROJECTILE_LOG_MARKER) {
        if let Some(mutex) = PROJECTILE_LOG_FILE.get() {
            if let Ok(mut guard) = mutex.lock() {
                if let Some(projectile_file) = guard.as_mut() {
                    let _ = projectile_file.write_all(bytes);
                    let _ = projectile_file.flush();
                    let _ = projectile_file.sync_data();
                }
            }
        }
    }
}

/// Convenience wrappers.
pub fn info(source: &str, message: &str) {
    log(LogLevel::Info, source, message);
}
pub fn warn(source: &str, message: &str) {
    log(LogLevel::Warn, source, message);
}
pub fn error(source: &str, message: &str) {
    log(LogLevel::Error, source, message);
}

/// Read the last `lines` lines from the live log file. Used by the
/// "Copy last 200 lines" button in the debug console.
///
/// Implementation is naive (read the whole file, split on `\n`, slice
/// from the end). The 5 MB rotation cap keeps that cheap — at most 5 MB
/// of memory and one syscall.
pub fn read_tail(app: &AppHandle, lines: usize) -> Result<String, String> {
    let path = log_file_path(app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let text = String::from_utf8_lossy(&bytes);
    let collected: Vec<&str> = text.lines().collect();
    let start = collected.len().saturating_sub(lines);
    Ok(collected[start..].join("\n"))
}

pub struct LogScanResult {
    pub lines: String,
    pub raw_tail: String,
    pub scanned_lines: usize,
    pub matched_lines: usize,
    pub paths: Vec<String>,
    pub dedicated_path: String,
    pub dedicated_size: u64,
    pub dedicated_lines: usize,
}

pub fn scan_matching_lines(
    app: &AppHandle,
    needle: &str,
    max_lines: usize,
) -> Result<LogScanResult, String> {
    let live = log_file_path(app)?;
    let projectile_live = projectile_log_file_path(app)?;
    let mut paths = Vec::new();
    if let Some(dir) = live.parent() {
        paths.push(dir.join(OLD_LOG_FILE_NAME));
    }
    paths.push(live);
    if let Some(dir) = projectile_live.parent() {
        paths.push(dir.join(OLD_PROJECTILE_LOG_FILE_NAME));
    }
    paths.push(projectile_live.clone());

    let mut matches = Vec::new();
    let mut raw_tail: Vec<String> = Vec::new();
    let mut scanned_lines = 0;
    let mut scanned_paths = Vec::new();
    for path in paths {
        scanned_paths.push(path.to_string_lossy().into_owned());
        if !path.exists() {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines() {
            scanned_lines += 1;
            raw_tail.push(line.to_string());
            if raw_tail.len() > 20 {
                raw_tail.remove(0);
            }
            if line.contains(needle) {
                matches.push(line.to_string());
            }
        }
    }

    let dedicated_bytes = fs::read(&projectile_live).unwrap_or_default();
    let dedicated_text = String::from_utf8_lossy(&dedicated_bytes);
    let dedicated_lines = dedicated_text.lines().count();
    let matched_lines = matches.len();
    let start = matches.len().saturating_sub(max_lines);
    Ok(LogScanResult {
        lines: matches[start..].join("\n"),
        raw_tail: raw_tail.join("\n"),
        scanned_lines,
        matched_lines,
        paths: scanned_paths,
        dedicated_path: projectile_live.to_string_lossy().into_owned(),
        dedicated_size: dedicated_bytes.len() as u64,
        dedicated_lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pad_right_ascii() {
        assert_eq!(pad_right("abc", 5), "abc  ");
        assert_eq!(pad_right("abcdef", 3), "abc");
        assert_eq!(pad_right("", 4), "    ");
    }

    #[test]
    fn pad_right_multibyte_does_not_panic() {
        // Smiley face is 4 bytes in UTF-8 but 1 char.
        assert_eq!(pad_right("😀", 3).chars().count(), 3);
    }

    #[test]
    fn ymd_known_dates() {
        // 1970-01-01 = day 0
        assert_eq!(days_to_ymd(0), (1970, 1, 1));
        // 2000-01-01 = day 10957
        assert_eq!(days_to_ymd(10957), (2000, 1, 1));
        // 2026-05-07 = day 20580
        assert_eq!(days_to_ymd(20580), (2026, 5, 7));
    }

    #[test]
    fn iso_timestamp_shape() {
        // We can't pin the exact time, but the shape must always be
        // "YYYY-MM-DDTHH:MM:SS.mmmZ" — 24 chars.
        let ts = now_iso8601();
        assert_eq!(ts.len(), 24, "timestamp wrong shape: {ts}");
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.as_bytes()[10], b'T');
        assert_eq!(ts.as_bytes()[19], b'.');
    }
}
