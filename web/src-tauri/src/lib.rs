//! RoundLab desktop — Tauri commands that replace the HTTP parser server.
//!
//! Invariants:
//! - All parsed demos live under `<app_data_dir>/parsed/<uuid>.json.gz`.
//! - The parser Go binary is shipped as a Tauri sidecar (`binaries/parser-<triple>`).
//! - Each match is parsed once, then cached. Subsequent reads stream the
//!   gzipped JSON on demand — we don't keep the full match in memory.

use std::collections::VecDeque;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
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
    #[serde(
        default,
        rename = "freezeEndTick",
        skip_serializing_if = "Option::is_none"
    )]
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
    #[serde(
        default,
        rename = "weaponFires",
        skip_serializing_if = "serde_json::Value::is_null"
    )]
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
    name: String,
    #[serde(rename = "createdAt")]
    created_at: u128,
    size: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredMatchInfo {
    #[serde(default)]
    name: String,
    #[serde(default)]
    source_path: String,
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

fn metadata_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = data_root(app)?;
    let dir = root.join("metadata");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir metadata: {e}"))?;
    Ok(dir)
}

fn metadata_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err("invalid match id".into());
    }
    Ok(metadata_dir(app)?.join(format!("{id}.json")))
}

fn default_match_name(path: &Path, id: &str) -> String {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| {
            s.strip_suffix(".dem.zst")
                .or_else(|| s.strip_suffix(".dem"))
                .or_else(|| s.strip_suffix(".zst"))
                .unwrap_or(s)
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty());
    name.unwrap_or_else(|| id[..8].to_string())
}

fn read_match_info(app: &AppHandle, id: &str) -> StoredMatchInfo {
    let Ok(path) = metadata_path(app, id) else {
        return StoredMatchInfo::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return StoredMatchInfo::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_match_info(app: &AppHandle, id: &str, info: &StoredMatchInfo) -> Result<(), String> {
    let path = metadata_path(app, id)?;
    let raw = serde_json::to_vec_pretty(info).map_err(|e| format!("serialize metadata: {e}"))?;
    fs::write(path, raw).map_err(|e| format!("write metadata: {e}"))
}

fn is_valid_id(id: &str) -> bool {
    // UUID v4 (8-4-4-4-12 hex, 36 chars total incl. dashes)
    id.len() == 36
        && id.chars().enumerate().all(|(i, c)| match i {
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
    let m: MatchFile = serde_json::from_slice(&buf).map_err(|e| format!("parse json: {e}"))?;
    Ok(m)
}

// -------------------------- Match cache --------------------------
//
// Decoding the gzipped JSON for a full match takes ~50–150 ms on a modern
// laptop. Without a cache, every round switch pays that cost twice (once
// for metadata, once for the round itself). We keep the most recently used
// matches around so adjacent-round navigation is instantaneous.

const CACHE_CAPACITY: usize = 4;

struct MatchCache {
    // (id, match). Newest at the back; pop_front on eviction.
    entries: VecDeque<(String, Arc<MatchFile>)>,
}

impl MatchCache {
    fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(CACHE_CAPACITY),
        }
    }

    fn get(&mut self, id: &str) -> Option<Arc<MatchFile>> {
        let pos = self.entries.iter().position(|(i, _)| i == id)?;
        let entry = self.entries.remove(pos)?;
        let match_arc = Arc::clone(&entry.1);
        self.entries.push_back(entry);
        Some(match_arc)
    }

    fn insert(&mut self, id: String, m: Arc<MatchFile>) {
        // Replace if present.
        if let Some(pos) = self.entries.iter().position(|(i, _)| i == &id) {
            self.entries.remove(pos);
        }
        while self.entries.len() >= CACHE_CAPACITY {
            self.entries.pop_front();
        }
        self.entries.push_back((id, m));
    }

    fn remove(&mut self, id: &str) {
        if let Some(pos) = self.entries.iter().position(|(i, _)| i == id) {
            self.entries.remove(pos);
        }
    }
}

fn cache() -> &'static Mutex<MatchCache> {
    static CACHE: OnceLock<Mutex<MatchCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(MatchCache::new()))
}

fn load_match_cached(app: &AppHandle, id: &str) -> Result<Arc<MatchFile>, String> {
    if let Ok(mut c) = cache().lock() {
        if let Some(m) = c.get(id) {
            return Ok(m);
        }
    }
    let path = parsed_path(app, id)?;
    let m = Arc::new(read_match_file(&path)?);
    if let Ok(mut c) = cache().lock() {
        c.insert(id.to_string(), Arc::clone(&m));
    }
    Ok(m)
}

fn invalidate_cache(id: &str) {
    if let Ok(mut c) = cache().lock() {
        c.remove(id);
    }
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
        let info = read_match_info(&app, &stem);
        let name = if info.name.trim().is_empty() {
            stem[..8].to_string()
        } else {
            info.name
        };
        out.push(MatchSummary {
            id: stem,
            name,
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
    let m = load_match_cached(&app, &id)?;
    // Strip heavy fields; keep round headers.
    let rounds: Vec<serde_json::Value> = m
        .rounds
        .iter()
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
fn get_round(app: AppHandle, id: String, number: i64) -> Result<serde_json::Value, String> {
    let m = load_match_cached(&app, &id)?;
    let r = m
        .rounds
        .iter()
        .find(|r| r.number == number)
        .ok_or_else(|| format!("round {number} not found"))?;
    Ok(serde_json::to_value(r).map_err(|e| e.to_string())?)
}

/// Delete a parsed match.
#[tauri::command]
fn delete_match(app: AppHandle, id: String) -> Result<(), String> {
    let path = parsed_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove: {e}"))?;
    }
    if let Ok(meta_path) = metadata_path(&app, &id) {
        let _ = fs::remove_file(meta_path);
    }
    invalidate_cache(&id);
    Ok(())
}

#[tauri::command]
fn rename_match(app: AppHandle, id: String, name: String) -> Result<MatchSummary, String> {
    let parsed = parsed_path(&app, &id)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("match name cannot be empty".into());
    }
    if trimmed.chars().count() > 120 {
        return Err("match name is too long".into());
    }
    if !parsed.exists() {
        return Err("match not found".into());
    }

    let mut info = read_match_info(&app, &id);
    info.name = trimmed.to_string();
    write_match_info(&app, &id, &info)?;

    let md = fs::metadata(&parsed).map_err(|e| format!("metadata: {e}"))?;
    let created = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    Ok(MatchSummary {
        id,
        name: trimmed.to_string(),
        created_at: created,
        size: md.len(),
    })
}

/// Options controlling how the sidecar parses a demo. These come from the
/// user's settings panel on the frontend. Defaults target maximum fidelity
/// on desktop — the whole point of the native build is that we have the
/// RAM to afford it.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ParseOptions {
    /// "full" (1:1, ~8Hz), "high" (~4Hz), "medium" (~2Hz), "low" (~1Hz).
    /// Defaults to "full".
    #[serde(default)]
    quality: Option<String>,
    /// Skip per-frame projectile positions. Defaults to false (projectiles kept).
    #[serde(default)]
    skip_projectiles: bool,
    /// Skip weapon fire events. Defaults to false (weapon fires kept).
    #[serde(default)]
    skip_weapon_fires: bool,
}

/// Parse a local .dem or .dem.zst via the sidecar parser binary.
///
/// The sidecar now sniffs the first 4 bytes of the input to detect a zstd
/// frame, so both plain and compressed demos work the same way.
#[tauri::command]
async fn parse_demo(
    app: AppHandle,
    src_path: String,
    options: Option<ParseOptions>,
) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err(format!("file not found: {src_path}"));
    }
    let lower = src_path.to_lowercase();
    if !(lower.ends_with(".dem") || lower.ends_with(".dem.zst") || lower.ends_with(".zst")) {
        return Err("expected a .dem or .dem.zst file".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let out_path = parsed_path(&app, &id)?;
    let opts = options.unwrap_or_default();
    let quality = opts.quality.as_deref().unwrap_or("full");

    // Build the argv. The parser auto-detects zstd by peeking 4 bytes.
    let mut argv: Vec<String> = vec![
        "-in".into(),
        src_path.clone(),
        "-out".into(),
        out_path.to_string_lossy().into_owned(),
        "-quality".into(),
        quality.into(),
    ];
    if opts.skip_projectiles {
        argv.push("-skipProjectiles".into());
    }
    if opts.skip_weapon_fires {
        argv.push("-skipWeaponFires".into());
    }

    // Sidecar named `parser` in tauri.conf.json → expanded to
    // `binaries/parser-<target-triple>` at build/package time.
    let sidecar = app
        .shell()
        .sidecar("parser")
        .map_err(|e| format!("sidecar init: {e}"))?
        .args(argv);

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
    let info = StoredMatchInfo {
        name: default_match_name(&src, &id),
        source_path: src_path,
    };
    write_match_info(&app, &id, &info)?;
    // Invalidate any cached entry for this id (in case of a rare UUID collision
    // or a replace-in-place workflow down the road).
    invalidate_cache(&id);
    Ok(id)
}

// -------------------------- App entry --------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            list_matches,
            get_match_metadata,
            get_round,
            delete_match,
            rename_match,
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
            round0.frames.as_array().map(|a| a.len()).unwrap_or(0)
        );
    }
}
