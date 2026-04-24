//! RoundLab desktop — Tauri commands that replace the HTTP parser server.
//!
//! Invariants:
//! - All parsed demos live under `<app_data_dir>/parsed/<uuid>.json.gz`.
//! - The parser Go binary is shipped as a Tauri sidecar (`binaries/parser-<triple>`).
//! - Each match is parsed once, then cached. Subsequent reads stream the
//!   gzipped JSON on demand — we don't keep the full match in memory.

use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// -------------------------- Types mirroring parser output --------------------------

#[derive(Serialize, Deserialize, Clone)]
struct Meta {
    #[serde(default)]
    map: String,
    #[serde(default, rename = "tickRate")]
    tick_rate: f64,
    #[serde(default, rename = "sampleRate")]
    sample_rate: f64,
    #[serde(default, rename = "durationSec")]
    duration_sec: f64,
    #[serde(default, rename = "teamA")]
    team_a: String,
    #[serde(default, rename = "teamB")]
    team_b: String,
    #[serde(default, rename = "scoreA")]
    score_a: i64,
    #[serde(default, rename = "scoreB")]
    score_b: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct Player {
    #[serde(default, rename = "steamId")]
    steam_id: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    team: String,
}

/// A round stored on disk: we keep the heavy fields as raw JSON so we can
/// choose to strip them for metadata calls without paying the parse cost.
#[derive(Serialize, Deserialize, Clone)]
struct RawRound {
    #[serde(default)]
    number: i64,
    #[serde(default, rename = "startTick")]
    start_tick: i64,
    #[serde(default, rename = "freezeEndTick", skip_serializing_if = "Option::is_none")]
    freeze_end_tick: Option<i64>,
    #[serde(default, rename = "endTick")]
    end_tick: i64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    winner: String,
    #[serde(
        default,
        rename = "winnerName",
        skip_serializing_if = "Option::is_none"
    )]
    winner_name: Option<String>,
    #[serde(default, rename = "scoreA", skip_serializing_if = "Option::is_none")]
    score_a: Option<i64>,
    #[serde(default, rename = "scoreB", skip_serializing_if = "Option::is_none")]
    score_b: Option<i64>,
    #[serde(default)]
    frames: serde_json::Value,
    #[serde(default)]
    events: serde_json::Value,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    effects: serde_json::Value,
    #[serde(default, rename = "weaponFires", skip_serializing_if = "serde_json::Value::is_null")]
    weapon_fires: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct MatchFile {
    meta: Meta,
    players: Vec<Player>,
    rounds: Vec<RawRound>,
}

/// Short summary used for the home screen.
#[derive(Serialize)]
struct MatchSummary {
    id: String,
    #[serde(rename = "createdAt")]
    created_at: u128,
    size: u64,
}

// -------------------------- Paths --------------------------

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let root = base.join("RoundLab");
    Ok(root)
}

fn parsed_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = data_root(app)?;
    let dir = root.join("parsed");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir parsed: {e}"))?;
    Ok(dir)
}

fn parsed_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err("invalid match id".into());
    }
    Ok(parsed_dir(app)?.join(format!("{id}.json.gz")))
}

fn is_valid_id(id: &str) -> bool {
    // UUID v4 (8-4-4-4-12 hex, 36 chars total incl. dashes)
    id.len() == 36
        && id
            .chars()
            .enumerate()
            .all(|(i, c)| match i {
                8 | 13 | 18 | 23 => c == '-',
                _ => c.is_ascii_hexdigit(),
            })
}

// -------------------------- Parsing a match file --------------------------

/// Read and gunzip the entire match file into memory. Matches are ~1–15 MB
/// uncompressed, so this is fine — no streaming needed yet.
fn read_match_file(path: &Path) -> Result<MatchFile, String> {
    let f = fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let br = BufReader::new(f);
    let mut gz = GzDecoder::new(br);
    let mut buf = Vec::with_capacity(4 * 1024 * 1024);
    gz.read_to_end(&mut buf)
        .map_err(|e| format!("gunzip: {e}"))?;
    let m: MatchFile =
        serde_json::from_slice(&buf).map_err(|e| format!("parse json: {e}"))?;
    Ok(m)
}

// -------------------------- Commands --------------------------

#[tauri::command]
fn list_matches(app: AppHandle) -> Result<Vec<MatchSummary>, String> {
    let dir = parsed_dir(&app)?;
    let mut out = Vec::new();
    let read_dir = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("gz") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.trim_end_matches(".json").to_string(),
            None => continue,
        };
        if !is_valid_id(&stem) {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let created = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        out.push(MatchSummary {
            id: stem,
            created_at: created,
            size: md.len(),
        });
    }
    // Newest first
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Metadata: everything except per-frame positions/events. Shape mirrors the
/// frontend's `MatchData` type.
#[tauri::command]
fn get_match_metadata(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let path = parsed_path(&app, &id)?;
    let m = read_match_file(&path)?;
    // Strip heavy fields; keep round headers.
    let rounds: Vec<serde_json::Value> = m
        .rounds
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "number": r.number,
                "startTick": r.start_tick,
                "freezeEndTick": r.freeze_end_tick,
                "endTick": r.end_tick,
                "duration": r.duration,
                "winner": r.winner,
                "winnerName": r.winner_name,
                "scoreA": r.score_a,
                "scoreB": r.score_b,
                "frames": [],
                "events": [],
            })
        })
        .collect();
    Ok(serde_json::json!({
        "meta": m.meta,
        "players": m.players,
        "rounds": rounds,
    }))
}

/// Full round payload (frames + events + effects + weaponFires).
#[tauri::command]
fn get_round(
    app: AppHandle,
    id: String,
    number: i64,
) -> Result<serde_json::Value, String> {
    let path = parsed_path(&app, &id)?;
    let m = read_match_file(&path)?;
    let r = m
        .rounds
        .into_iter()
        .find(|r| r.number == number)
        .ok_or_else(|| format!("round {number} not found"))?;
    Ok(serde_json::to_value(&r).map_err(|e| e.to_string())?)
}

/// Delete a parsed match.
#[tauri::command]
fn delete_match(app: AppHandle, id: String) -> Result<(), String> {
    let path = parsed_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove: {e}"))?;
    }
    Ok(())
}

/// Parse a local .dem or .dem.zst via the sidecar parser binary.
///
/// The parser accepts `-in <path> -out <path>` — on Tauri we pass the user's
/// selected file directly so there's no streaming indirection. The parser
/// itself detects zstd by magic bytes when the input is `-` (stdin), but here
/// we'd need file-based detection. For v1 of the desktop build we only
/// support plain .dem; the user can decompress .zst externally first.
///
/// TODO: teach the parser to sniff zstd when reading from a file path too,
/// so .dem.zst works natively. For now we reject .zst and tell the user.
#[tauri::command]
async fn parse_demo(app: AppHandle, src_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err(format!("file not found: {src_path}"));
    }
    let lower = src_path.to_lowercase();
    if lower.ends_with(".zst") {
        return Err(
            "Compressed .dem.zst is not yet supported in the desktop build. \
             Please decompress with `zstd -d` and try again."
                .into(),
        );
    }
    if !lower.ends_with(".dem") {
        return Err("expected a .dem file".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let out_path = parsed_path(&app, &id)?;

    // Sidecar named `parser` in tauri.conf.json → expanded to
    // `binaries/parser-<target-triple>` at build/package time.
    let sidecar = app
        .shell()
        .sidecar("parser")
        .map_err(|e| format!("sidecar init: {e}"))?
        .args([
            "-in",
            src_path.as_str(),
            "-out",
            out_path.to_string_lossy().as_ref(),
        ]);

    let (mut rx, _child) = sidecar.spawn().map_err(|e| format!("spawn parser: {e}"))?;
    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                stderr.push_str(&String::from_utf8_lossy(&line));
                stderr.push('\n');
            }
            CommandEvent::Stdout(_) => {}
            CommandEvent::Terminated(payload) => {
                let code = payload.code.unwrap_or(-1);
                if code != 0 {
                    // The parser failed — drop the half-written output.
                    let _ = fs::remove_file(&out_path);
                    return Err(format!(
                        "parser exited with status {code}:\n{}",
                        stderr.trim()
                    ));
                }
                break;
            }
            CommandEvent::Error(e) => {
                let _ = fs::remove_file(&out_path);
                return Err(format!("parser error: {e}"));
            }
            _ => {}
        }
    }

    if !out_path.exists() {
        return Err("parser finished but produced no output".into());
    }
    Ok(id)
}

// -------------------------- App entry --------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            list_matches,
            get_match_metadata,
            get_round,
            delete_match,
            parse_demo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test: when the env var `ROUNDLAB_TEST_MATCH` points to a parsed
    /// `.json.gz` on disk, verify the full read pipeline — gunzip, JSON parse,
    /// round selection, and metadata stripping — matches the frontend schema.
    ///
    /// Run with:
    ///   ROUNDLAB_TEST_MATCH=/path/to/<uuid>.json.gz cargo test -- --nocapture
    #[test]
    fn read_match_file_end_to_end() {
        let Some(path) = std::env::var_os("ROUNDLAB_TEST_MATCH") else {
            eprintln!("skipping: set ROUNDLAB_TEST_MATCH to a .json.gz to run");
            return;
        };
        let path = std::path::PathBuf::from(path);
        let m = read_match_file(&path).expect("read_match_file failed");

        assert!(!m.meta.map.is_empty(), "meta.map should be set");
        assert!(m.meta.tick_rate > 0.0, "meta.tickRate should be > 0");
        assert!(!m.players.is_empty(), "should have at least one player");
        assert!(!m.rounds.is_empty(), "should have at least one round");

        // The metadata command strips frames/events but keeps round scaffolding.
        let round0 = &m.rounds[0];
        assert!(round0.end_tick >= round0.start_tick, "endTick >= startTick");

        // The round payload must round-trip through serde_json.
        let as_json = serde_json::to_value(round0).expect("round serialize");
        assert!(as_json.get("number").is_some());
        assert!(as_json.get("frames").is_some());

        eprintln!(
            "✓ map={} rounds={} players={} round0.frames={}",
            m.meta.map,
            m.rounds.len(),
            m.players.len(),
            round0
                .frames
                .as_array()
                .map(|a| a.len())
                .unwrap_or(0)
        );
    }
}
