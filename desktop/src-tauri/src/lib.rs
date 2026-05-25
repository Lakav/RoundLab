//! RoundLab desktop — Tauri commands that replace the HTTP parser server.
//!
//! Invariants:
//! - All parsed demos live under `<app_data_dir>/parsed/<uuid>.json.gz`.
//! - Parser binaries are shipped as Tauri sidecars (`binaries/parser-*` and
//!   `binaries/parser-fallback-*`).
//! - Each match is parsed once, then cached. Subsequent reads stream the
//!   gzipped JSON on demand — we don't keep the full match in memory.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant, SystemTime};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod logger;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        },
        SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    partial: bool,
    #[serde(
        default,
        rename = "parseError",
        skip_serializing_if = "String::is_empty"
    )]
    parse_error: String,
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
#[derive(Serialize, Deserialize, Clone, Default)]
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
    #[serde(
        default,
        rename = "projectileFrames",
        skip_serializing_if = "serde_json::Value::is_null"
    )]
    projectile_frames: serde_json::Value,
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

    // Filter out CS2-generated filenames that look like a UUID slug
    // (e.g. "1-0e1c1545-8f49-41a8-bbf3-fabeacf2abc1-1-1") — they're noise.
    // Heuristic: contains a UUID-shaped chunk (8-4-4-4-12 hex) anywhere.
    let is_noise = name.as_deref().map(looks_like_uuid_slug).unwrap_or(false);
    if let Some(n) = name.filter(|_| !is_noise) {
        return n;
    }

    // Fall back to a friendly placeholder. Frontend can still let the user
    // override it.
    format!("Untitled match · {}", &id[..8])
}

fn match_score_name_from_meta(meta: &Meta) -> String {
    let team_a = clean_match_part(&meta.team_a, "Team");
    let team_b = clean_match_part(&meta.team_b, "Team");
    let map = clean_match_part(&meta.map, "map");
    format!(
        "{}-{} - {} vs {} - {}",
        meta.score_a, meta.score_b, team_a, team_b, map
    )
}

fn clean_match_part(raw: &str, fallback: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || matches!(trimmed, "CT" | "T" | "Counter-Terrorists" | "Terrorists") {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn looks_like_uuid_slug(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 36 <= bytes.len() {
        let window = &bytes[i..i + 36];
        let dash_ok =
            window[8] == b'-' && window[13] == b'-' && window[18] == b'-' && window[23] == b'-';
        let hex_ok = window
            .iter()
            .enumerate()
            .all(|(j, &b)| matches!(j, 8 | 13 | 18 | 23) || b.is_ascii_hexdigit());
        if dash_ok && hex_ok {
            return true;
        }
        i += 1;
    }
    false
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

/// Read and gunzip the entire match file into memory. Used by replay loading,
/// not by parse finalization.
fn read_match_file(path: &Path) -> Result<MatchFile, String> {
    let f = fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let br = BufReader::new(f);
    let mut gz = GzDecoder::new(br);
    let mut buf = Vec::with_capacity(4 * 1024 * 1024);
    gz.read_to_end(&mut buf)
        .map_err(|e| format!("gunzip: {e}"))?;
    let mut m: MatchFile = serde_json::from_slice(&buf).map_err(|e| format!("parse json: {e}"))?;
    backfill_missing_round_scores(&mut m);
    if should_normalize_competitive_round_scores(&m) {
        normalize_competitive_round_scores(&mut m);
    }
    Ok(m)
}

fn backfill_missing_round_scores(m: &mut MatchFile) {
    let mut ct_score = 0;
    let mut t_score = 0;
    for round in &mut m.rounds {
        let missing = round.score_a.is_none() || round.score_b.is_none();
        if missing {
            match round.winner.as_str() {
                "CT" => ct_score += 1,
                "T" => t_score += 1,
                _ => {}
            }
            if round.score_a.is_none() {
                round.score_a = Some(ct_score);
            }
            if round.score_b.is_none() {
                round.score_b = Some(t_score);
            }
        } else {
            ct_score = round.score_a.unwrap_or(ct_score);
            t_score = round.score_b.unwrap_or(t_score);
        }
    }
}

fn is_knife_or_bomb_weapon_name(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    n.is_empty()
        || n == "world"
        || n.contains("knife")
        || n.contains("bayonet")
        || n.contains("karambit")
        || n.contains("butterfly")
        || n.contains("stiletto")
        || n.contains("ursus")
        || n.contains("talon")
        || n.contains("skeleton")
        || n.contains("kukri")
        || n.contains("bowie")
        || n.contains("flip")
        || n.contains("gut")
        || n.contains("c4")
        || n.contains("bomb")
}

fn collect_round_weapon_usage(round: &RawRound) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    if let Some(events) = round.events.as_array() {
        for event in events {
            if event.get("type").and_then(serde_json::Value::as_str) != Some("kill") {
                continue;
            }
            if let Some(weapon) = event.get("weapon").and_then(serde_json::Value::as_str) {
                if !weapon.is_empty() {
                    *counts.entry(weapon.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    if let Some(frames) = round.frames.as_array() {
        for frame in frames {
            let Some(players) = frame.get("players").and_then(serde_json::Value::as_array) else {
                continue;
            };
            for player in players {
                if let Some(active) = player.get("active").and_then(serde_json::Value::as_str) {
                    if !active.is_empty() {
                        *counts.entry(active.to_string()).or_insert(0) += 1;
                    }
                }
                if let Some(weapons) = player.get("weapons").and_then(serde_json::Value::as_array) {
                    for weapon in weapons {
                        if let Some(name) = weapon.as_str() {
                            if !name.is_empty() {
                                *counts.entry(name.to_string()).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    counts
}

fn compact_weapon_usage_summary(round: &RawRound) -> String {
    let mut counts = collect_round_weapon_usage(round)
        .into_iter()
        .collect::<Vec<(String, usize)>>();
    if counts.is_empty() {
        return "none".into();
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    counts
        .into_iter()
        .take(10)
        .map(|(weapon, count)| format!("{}:{count}", weapon.replace(' ', "_")))
        .collect::<Vec<_>>()
        .join(",")
}

fn round_total_kills(round: &RawRound) -> usize {
    round
        .events
        .as_array()
        .map(|events| {
            events
                .iter()
                .filter(|event| {
                    event.get("type").and_then(serde_json::Value::as_str) == Some("kill")
                })
                .count()
        })
        .unwrap_or(0)
}

fn looks_like_knife_round(round: &RawRound) -> bool {
    if round.duration > 90.0 || round_total_kills(round) == 0 {
        return false;
    }
    let weapons = collect_round_weapon_usage(round);
    !weapons.is_empty()
        && weapons
            .keys()
            .all(|weapon| is_knife_or_bomb_weapon_name(weapon))
}

fn log_score_adjustment(
    event: &str,
    round_index: usize,
    round: &RawRound,
    score_a: i64,
    score_b: i64,
    is_knife_round: bool,
) {
    logger::info(
        "rounds",
        &format!(
            "ROUNDLAB_DEBUG_SCORE {event} roundIndex={round_index} startTick={} totalKills={} weaponUsage={} scoreA={score_a} scoreB={score_b} isKnifeRound={is_knife_round}",
            round.start_tick,
            round_total_kills(round),
            compact_weapon_usage_summary(round)
        ),
    );
}

fn should_normalize_competitive_round_scores(m: &MatchFile) -> bool {
    if m.rounds.iter().any(looks_like_knife_round) {
        return true;
    }
    m.rounds
        .first()
        .map(|round| round.score_a.unwrap_or(0) != 0 || round.score_b.unwrap_or(0) != 0)
        .unwrap_or(false)
}

fn winner_slot(
    round: &RawRound,
    team_a_name: &str,
    team_b_name: &str,
    raw_a: i64,
    raw_b: i64,
    score_a: i64,
    score_b: i64,
) -> Option<char> {
    if let Some(winner_name) = &round.winner_name {
        if winner_name == team_a_name {
            return Some('A');
        }
        if winner_name == team_b_name {
            return Some('B');
        }
    }
    if raw_a > score_a && raw_b == score_b {
        return Some('A');
    }
    if raw_b > score_b && raw_a == score_a {
        return Some('B');
    }
    if raw_a > score_a && raw_a - score_a >= raw_b - score_b {
        return Some('A');
    }
    if raw_b > score_b {
        return Some('B');
    }
    None
}

fn normalize_competitive_round_scores(m: &mut MatchFile) {
    let team_a_name = m.meta.team_a.clone();
    let team_b_name = m.meta.team_b.clone();
    let mut score_a = 0;
    let mut score_b = 0;
    let mut visible = Vec::with_capacity(m.rounds.len());
    for (idx, round) in m.rounds.drain(..).enumerate() {
        let raw_a = round.score_a.unwrap_or(score_a);
        let raw_b = round.score_b.unwrap_or(score_b);
        let is_knife_round = looks_like_knife_round(&round);
        log_score_adjustment(
            "score-before-adjust",
            idx,
            &round,
            raw_a,
            raw_b,
            is_knife_round,
        );
        if is_knife_round {
            log_score_adjustment("knife-round-detected", idx, &round, raw_a, raw_b, true);
            log_score_adjustment("knife-round-hidden", idx, &round, raw_a, raw_b, true);
            continue;
        }
        let mut adjusted = round;
        adjusted.number = visible.len() as i64;
        adjusted.score_a = Some(score_a);
        adjusted.score_b = Some(score_b);
        log_score_adjustment(
            "score-after-adjust",
            idx,
            &adjusted,
            score_a,
            score_b,
            false,
        );
        match winner_slot(
            &adjusted,
            &team_a_name,
            &team_b_name,
            raw_a,
            raw_b,
            score_a,
            score_b,
        ) {
            Some('A') => score_a += 1,
            Some('B') => score_b += 1,
            _ => {}
        }
        visible.push(adjusted);
    }
    m.rounds = visible;
}

fn log_tauri_round_score(source: &str, round: &RawRound) {
    logger::info(
        "rounds",
        &format!(
            "ROUNDLAB_DEBUG_SCORE tauri-round-score source={source} round={} ctScore={} tScore={} winningSide={}",
            round.number,
            round.score_a.unwrap_or(-1),
            round.score_b.unwrap_or(-1),
            round.winner
        ),
    );
}

fn log_tauri_round_loaded(source: &str, round_index: usize, round: &RawRound) {
    logger::info(
        "rounds",
        &format!(
            "ROUNDLAB_DEBUG_ROUNDS tauri-round-loaded source={source} roundIndex={round_index} roundNumber={} startTick={} endTick={} freezeEndTick={} duration={:.3} selectedInitialRoundIndex=-1 reason=loaded",
            round.number,
            round.start_tick,
            round.end_tick,
            round.freeze_end_tick.unwrap_or(-1),
            round.duration
        ),
    );
}

fn read_match_name(path: &Path) -> Result<String, String> {
    let f = fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let br = BufReader::new(f);
    let mut gz = GzDecoder::new(br);
    let mut buf = Vec::with_capacity(8192);
    let mut chunk = [0u8; 4096];

    loop {
        let n = gz
            .read(&mut chunk)
            .map_err(|e| format!("gunzip meta: {e}"))?;
        if n == 0 {
            return Err("meta field not found".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(meta_json) = find_json_field_value(&buf, b"\"meta\"") {
            let meta: Meta =
                serde_json::from_slice(meta_json).map_err(|e| format!("parse json meta: {e}"))?;
            return Ok(match_score_name_from_meta(&meta));
        }
        if buf.len() > 1024 * 1024 {
            return Err("meta field was not found in the first 1MB".into());
        }
    }
}

fn find_json_field_value<'a>(bytes: &'a [u8], field: &[u8]) -> Option<&'a [u8]> {
    let field_pos = bytes
        .windows(field.len())
        .position(|window| window == field)?;
    let mut i = field_pos + field.len();
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() || bytes[i] != b':' {
        return None;
    }
    i += 1;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }

    let start = i;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, &byte) in bytes[start..].iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }

        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&bytes[start..=start + offset]);
                }
            }
            _ => {}
        }
    }
    None
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
    out.sort_by_key(|a| std::cmp::Reverse(a.created_at));
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
        .enumerate()
        .map(|(idx, r)| {
            log_tauri_round_loaded("metadata", idx, r);
            log_tauri_round_score("metadata", r);
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

#[derive(Default)]
struct RoundProjectileCounts {
    frames: usize,
    frames_with_projectiles: usize,
    frame_projectiles: usize,
    projectile_frames: usize,
    projectile_frame_projectiles: usize,
    effects: usize,
}

fn array_len(value: &serde_json::Value) -> usize {
    value.as_array().map_or(0, Vec::len)
}

fn projectiles_len(value: &serde_json::Value) -> usize {
    value
        .get("projectiles")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len)
}

fn round_projectile_counts(round: &RawRound) -> RoundProjectileCounts {
    let mut counts = RoundProjectileCounts {
        frames: array_len(&round.frames),
        projectile_frames: array_len(&round.projectile_frames),
        effects: array_len(&round.effects),
        ..RoundProjectileCounts::default()
    };
    if let Some(frames) = round.frames.as_array() {
        for frame in frames {
            let projectiles = projectiles_len(frame);
            if projectiles > 0 {
                counts.frames_with_projectiles += 1;
                counts.frame_projectiles += projectiles;
            }
        }
    }
    if let Some(projectile_frames) = round.projectile_frames.as_array() {
        for frame in projectile_frames {
            counts.projectile_frame_projectiles += projectiles_len(frame);
        }
    }
    counts
}

/// Full round payload (frames + events + effects + weaponFires).
#[tauri::command]
fn get_round(
    app: AppHandle,
    id: String,
    number: i64,
    debug_projectiles: Option<bool>,
) -> Result<serde_json::Value, String> {
    let m = load_match_cached(&app, &id)?;
    let r = m
        .rounds
        .iter()
        .find(|r| r.number == number)
        .ok_or_else(|| format!("round {number} not found"))?;
    log_tauri_round_loaded("get-round", number as usize, r);
    log_tauri_round_score("get-round", r);
    if debug_projectiles.unwrap_or(false) {
        let counts = round_projectile_counts(r);
        logger::info(
            "projectil",
            &format!(
                "ROUNDLAB_DEBUG_PROJECTILES tauri-round-deserialized matchId={id} roundNumber={} frames={} framesWithProjectiles={} frameProjectiles={} projectileFrames={} projectileFrameProjectiles={} effects={}",
                r.number,
                counts.frames,
                counts.frames_with_projectiles,
                counts.frame_projectiles,
                counts.projectile_frames,
                counts.projectile_frame_projectiles,
                counts.effects
            ),
        );
    }
    serde_json::to_value(r).map_err(|e| e.to_string())
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

struct DiagnosticPlayerSample {
    id: i64,
    team: i64,
    x: f64,
    y: f64,
    t: f64,
    alive_until: f64,
    has_bomb: bool,
}

fn diagnostic_player(sample: DiagnosticPlayerSample) -> serde_json::Value {
    let DiagnosticPlayerSample {
        id,
        team,
        x,
        y,
        t,
        alive_until,
        has_bomb,
    } = sample;
    let hp = if t > alive_until { 0 } else { 100 };
    let active = match (team, t < 8.0) {
        (2, true) => "glock",
        (2, false) => "ak47",
        (3, true) => "usp_silencer",
        _ => "m4a1_silencer",
    };
    serde_json::json!({
        "id": id,
        "x": x,
        "y": y,
        "z": 0,
        "yaw": (t * 20.0) % 360.0,
        "hp": hp,
        "armor": if t < 8.0 { 0 } else { 100 },
        "money": 800 + id * 250,
        "helmet": t >= 8.0,
        "kit": team == 3 && id % 2 == 0,
        "hasBomb": has_bomb,
        "team": team,
        "active": active,
        "weapons": if team == 2 {
            serde_json::json!([active, "glock", "weapon_knife", "flashbang", "smokegrenade", "molotov", "c4"])
        } else {
            serde_json::json!([active, "usp_silencer", "weapon_knife", "flashbang", "hegrenade", "incgrenade", "defuser"])
        },
        "flashLeft": if (14.0..16.0).contains(&t) && team == 3 { 1.5 } else { 0.0 },
        "flashTotal": 2.0,
        "activeAction": if has_bomb && (18.0..21.2).contains(&t) {
            serde_json::json!({"type": "plant", "item": "c4", "elapsed": t - 18.0, "duration": 3.2})
        } else {
            serde_json::Value::Null
        }
    })
}

fn diagnostic_round(number: i64, start_tick: i64, score_a: i64, score_b: i64) -> RawRound {
    let mut frames = Vec::new();
    let mut projectile_frames = Vec::new();
    for step in 0..=60 {
        let t = step as f64 * 0.5;
        let push = t * 32.0;
        let player = |id, team, x, y, alive_until, has_bomb| {
            diagnostic_player(DiagnosticPlayerSample {
                id,
                team,
                x,
                y,
                t,
                alive_until,
                has_bomb,
            })
        };
        let players = serde_json::json!([
            player(1001, 2, -1180.0 + push, -880.0 + push * 0.22, 27.0, false),
            player(
                1002,
                2,
                -1260.0 + push * 0.9,
                -1020.0 + push * 0.16,
                31.0,
                false
            ),
            player(
                1003,
                2,
                -1340.0 + push * 0.72,
                -1120.0 + push * 0.12,
                40.0,
                t < 21.2
            ),
            player(
                1004,
                2,
                -1510.0 + push * 0.44,
                -760.0 + push * 0.08,
                40.0,
                false
            ),
            player(
                1005,
                2,
                -1420.0 + push * 0.62,
                -940.0 + push * 0.18,
                40.0,
                false
            ),
            player(
                2001,
                3,
                310.0 - push * 0.25,
                -1220.0 + push * 0.08,
                13.4,
                false
            ),
            player(
                2002,
                3,
                160.0 - push * 0.22,
                -940.0 + push * 0.04,
                25.0,
                false
            ),
            player(
                2003,
                3,
                -30.0 - push * 0.16,
                -670.0 + push * 0.03,
                40.0,
                false
            ),
            player(
                2004,
                3,
                420.0 - push * 0.18,
                -780.0 + push * 0.05,
                40.0,
                false
            ),
            player(
                2005,
                3,
                520.0 - push * 0.3,
                -1010.0 + push * 0.1,
                40.0,
                false
            )
        ]);
        let mut projectiles = Vec::new();
        if (4.0..=6.5).contains(&t) {
            projectiles.push(serde_json::json!({"id": 7101, "type": "smokegrenade", "x": -1020.0 + (t - 4.0) * 230.0, "y": -840.0 + (t - 4.0) * 80.0, "z": 80.0 - (t - 5.2).abs() * 22.0, "thrower": 1001}));
        }
        if (8.0..=10.2).contains(&t) {
            projectiles.push(serde_json::json!({"id": 7102, "type": "molotov", "x": -980.0 + (t - 8.0) * 190.0, "y": -980.0 + (t - 8.0) * 96.0, "z": 90.0 - (t - 9.1).abs() * 28.0, "thrower": 1002}));
        }
        if (13.0..=14.4).contains(&t) {
            projectiles.push(serde_json::json!({"id": 7103, "type": "flashbang", "x": -760.0 + (t - 13.0) * 260.0, "y": -760.0 + (t - 13.0) * 120.0, "z": 120.0 - (t - 13.7).abs() * 35.0, "thrower": 1004}));
        }
        let bomb = if t < 21.2 {
            serde_json::json!({"status": "carried", "carrier": 1003, "x": -1340.0 + push * 0.72, "y": -1120.0 + push * 0.12, "z": 0})
        } else {
            serde_json::json!({"status": "planted", "x": -150.0, "y": -880.0, "z": 0})
        };
        frames.push(serde_json::json!({"t": t, "players": players, "bomb": bomb, "projectiles": projectiles}));
        projectile_frames.push(serde_json::json!({"t": t, "projectiles": projectiles}));
    }
    RawRound {
        number,
        start_tick,
        freeze_end_tick: Some(start_tick + 128),
        end_tick: start_tick + 2048,
        duration: 30.0,
        winner: "T".into(),
        winner_name: Some("Diagnostic T".into()),
        score_a: Some(score_a),
        score_b: Some(score_b),
        frames: serde_json::Value::Array(frames),
        events: serde_json::json!([
            {"t": 13.4, "type": "kill", "killer": 1001, "victim": 2001, "weapon": "ak47", "hs": true},
            {"t": 18.0, "type": "bomb_defuse_abort", "player": 2002},
            {"t": 21.2, "type": "bomb_planted", "player": 1003},
            {"t": 25.0, "type": "kill", "killer": 1002, "victim": 2002, "weapon": "molotov"},
            {"t": 27.0, "type": "kill", "killer": 2003, "victim": 1001, "weapon": "awp"},
            {"t": 30.0, "type": "round_end", "winner": "T"}
        ]),
        effects: serde_json::json!([
            {"id": 8101, "type": "smoke", "start": 6.4, "end": 24.0, "x": -450.0, "y": -650.0, "z": 0, "team": 2},
            {"id": 8102, "type": "fire", "variant": "molotov", "start": 10.1, "end": 17.5, "x": -560.0, "y": -770.0, "z": 0, "team": 2},
            {"id": 8103, "type": "flash", "start": 14.3, "end": 15.2, "x": -380.0, "y": -590.0, "z": 0, "team": 2},
            {"id": 8104, "type": "he", "start": 16.8, "end": 17.6, "x": -310.0, "y": -720.0, "z": 0, "team": 3},
            {"id": 8105, "type": "bomb_planted", "start": 21.2, "end": 30.0, "x": -150.0, "y": -880.0, "z": 0, "team": 2}
        ]),
        weapon_fires: serde_json::json!([
            {"t": 12.8, "shooter": 1001, "weapon": "ak47", "x": -760.0, "y": -820.0, "z": 0, "yaw": 32, "team": 2},
            {"t": 13.3, "shooter": 1001, "weapon": "ak47", "x": -744.0, "y": -816.0, "z": 0, "yaw": 34, "team": 2},
            {"t": 24.9, "shooter": 1002, "weapon": "ak47", "x": -590.0, "y": -900.0, "z": 0, "yaw": 18, "team": 2},
            {"t": 27.0, "shooter": 2003, "weapon": "awp", "x": -220.0, "y": -630.0, "z": 0, "yaw": 212, "team": 3}
        ]),
        projectile_frames: serde_json::Value::Array(projectile_frames),
    }
}

fn diagnostic_match_file() -> MatchFile {
    MatchFile {
        meta: Meta {
            map: "de_mirage".into(),
            tick_rate: 64.0,
            sample_rate: 2.0,
            duration_sec: 60.0,
            team_a: "Diagnostic T".into(),
            team_b: "Diagnostic CT".into(),
            score_a: 2,
            score_b: 0,
            partial: false,
            parse_error: String::new(),
        },
        players: vec![
            Player {
                steam_id: 1001,
                name: "Diag-T Entry".into(),
                team: "T".into(),
            },
            Player {
                steam_id: 1002,
                name: "Diag-T Pack".into(),
                team: "T".into(),
            },
            Player {
                steam_id: 1003,
                name: "Diag-T Bomb".into(),
                team: "T".into(),
            },
            Player {
                steam_id: 1004,
                name: "Diag-T Lurk".into(),
                team: "T".into(),
            },
            Player {
                steam_id: 1005,
                name: "Diag-T Trade".into(),
                team: "T".into(),
            },
            Player {
                steam_id: 2001,
                name: "Diag-CT Anchor".into(),
                team: "CT".into(),
            },
            Player {
                steam_id: 2002,
                name: "Diag-CT Rotator".into(),
                team: "CT".into(),
            },
            Player {
                steam_id: 2003,
                name: "Diag-CT AWPer".into(),
                team: "CT".into(),
            },
            Player {
                steam_id: 2004,
                name: "Diag-CT Support".into(),
                team: "CT".into(),
            },
            Player {
                steam_id: 2005,
                name: "Diag-CT Retake".into(),
                team: "CT".into(),
            },
        ],
        rounds: vec![
            diagnostic_round(0, 0, 0, 0),
            diagnostic_round(1, 4096, 1, 0),
        ],
    }
}

#[tauri::command]
fn create_visual_test_match(app: AppHandle) -> Result<MatchSummary, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let path = parsed_path(&app, &id)?;
    let file = fs::File::create(&path).map_err(|e| format!("create visual test match: {e}"))?;
    let mut gz = GzEncoder::new(file, Compression::fast());
    let raw = serde_json::to_vec(&diagnostic_match_file())
        .map_err(|e| format!("serialize visual test match: {e}"))?;
    gz.write_all(&raw)
        .map_err(|e| format!("write visual test match: {e}"))?;
    gz.finish()
        .map_err(|e| format!("finish visual test match: {e}"))?;
    write_match_info(
        &app,
        &id,
        &StoredMatchInfo {
            name: "Visual diagnostic replay".into(),
            source_path: "generated://roundlab-visual-diagnostic".into(),
        },
    )?;
    invalidate_cache(&id);
    let md = fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    let created = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(MatchSummary {
        id,
        name: "Visual diagnostic replay".into(),
        created_at: created,
        size: md.len(),
    })
}

#[tauri::command]
fn enter_match_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Options controlling how the sidecar parses a demo. These come from the
/// user's settings panel on the frontend. Defaults target maximum fidelity
/// on desktop — the whole point of the native build is that we have the
/// RAM to afford it.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ParseOptions {}

#[derive(Default)]
struct ParseJob {
    running: bool,
    cancel_requested: bool,
    timeout_triggered: bool,
    child: Option<CommandChild>,
    memory_guard: Option<ParserMemoryGuard>,
}

fn parse_job() -> &'static Mutex<ParseJob> {
    static JOB: OnceLock<Mutex<ParseJob>> = OnceLock::new();
    JOB.get_or_init(|| Mutex::new(ParseJob::default()))
}

struct ParseJobGuard;

impl Drop for ParseJobGuard {
    fn drop(&mut self) {
        let mut job = parse_job().lock().expect("parse job mutex poisoned");
        if let Some(child) = job.child.take() {
            let _ = child.kill();
        }
        job.memory_guard = None;
        job.running = false;
        job.cancel_requested = false;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseProgress {
    phase: String,
    progress: f64,
    message: String,
}

fn emit_parse_progress(app: &AppHandle, phase: &str, progress: f64, message: &str) {
    let _ = app.emit(
        "parse-progress",
        ParseProgress {
            phase: phase.into(),
            progress,
            message: message.into(),
        },
    );
}

const POST_95_TIMEOUT: Duration = Duration::from_secs(30);

struct Post95Watchdog {
    active: AtomicBool,
    final_phase: AtomicBool,
    warned: AtomicBool,
    last_event: Mutex<Instant>,
    last_step: Mutex<String>,
}

impl Post95Watchdog {
    fn new() -> Self {
        Self {
            active: AtomicBool::new(true),
            final_phase: AtomicBool::new(false),
            warned: AtomicBool::new(false),
            last_event: Mutex::new(Instant::now()),
            last_step: Mutex::new(String::new()),
        }
    }

    fn mark_progress(&self, progress: f64) {
        if progress < 0.95 {
            return;
        }
        self.final_phase.store(true, Ordering::Relaxed);
        self.warned.store(false, Ordering::Relaxed);
        if let Ok(mut last_event) = self.last_event.lock() {
            *last_event = Instant::now();
        }
    }

    /// Called for each ROUNDLAB_FINAL line. `step_label` is a short
    /// description ("start step=gz.Close", "done step=of.Sync", …) used in
    /// the timeout message so we can tell which step actually wedged.
    fn mark_final_event(&self, step_label: &str) {
        self.final_phase.store(true, Ordering::Relaxed);
        if let Ok(mut last_event) = self.last_event.lock() {
            *last_event = Instant::now();
        }
        if !step_label.is_empty() {
            if let Ok(mut last_step) = self.last_step.lock() {
                *last_step = step_label.to_string();
            }
        }
    }

    fn last_step_snapshot(&self) -> String {
        self.last_step.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn stop(&self) {
        self.active.store(false, Ordering::Relaxed);
    }
}

fn start_post_95_watchdog(app: AppHandle, name: String) -> Arc<Post95Watchdog> {
    let watchdog = Arc::new(Post95Watchdog::new());
    let thread_watchdog = Arc::clone(&watchdog);
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        if !thread_watchdog.active.load(Ordering::Relaxed) {
            return;
        }
        if !thread_watchdog.final_phase.load(Ordering::Relaxed) {
            continue;
        }
        let elapsed = thread_watchdog
            .last_event
            .lock()
            .map(|last_event| last_event.elapsed())
            .unwrap_or_default();
        if elapsed < POST_95_TIMEOUT || thread_watchdog.warned.swap(true, Ordering::Relaxed) {
            continue;
        }
        let last_step = thread_watchdog.last_step_snapshot();
        let last_step_hint = if last_step.is_empty() {
            "(no ROUNDLAB_FINAL step seen yet)".to_string()
        } else {
            format!("(last seen: {last_step})")
        };
        let message = format!(
            "Parser timeout: still waiting after {}s in finalization phase {last_step_hint}. Killing process.",
            POST_95_TIMEOUT.as_secs()
        );
        eprintln!("[{name}] post-95 watchdog: {message}");
        logger::warn(&name, &format!("post-95 watchdog: {message}"));
        emit_parse_progress(&app, &name, 0.99, &message);
        if let Ok(mut job) = parse_job().lock() {
            job.timeout_triggered = true;
            if let Some(child) = job.child.take() {
                let _ = child.kill();
            }
        }
    });
    watchdog
}

fn parse_sidecar_progress(line: &str) -> Option<(f64, String)> {
    let payload = line.trim().strip_prefix("ROUNDLAB_PROGRESS ")?;
    let (raw_progress, message) = payload.split_once(' ')?;
    let progress = raw_progress.parse::<f64>().ok()?.clamp(0.0, 0.99);
    Some((progress, message.trim().to_string()))
}

fn stderr_tail(stderr: &str, max_lines: usize) -> String {
    stderr
        .lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_parser_oom(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("fatal error: out of memory")
        || lower.contains("virtualalloc")
        || lower.contains("cannot allocate memory")
}

fn parse_failure_message(name: &str, code: i32, stderr: &str) -> String {
    let tail = stderr_tail(stderr, 40);
    let reason = if is_parser_oom(stderr) {
        "Parser ran out of memory while decoding the demo."
    } else {
        "Parser failed while decoding the demo."
    };
    if tail.trim().is_empty() {
        format!("{reason}\n\n{name} exited with status {code}.")
    } else {
        format!("{reason}\n\n{name} exited with status {code}.\n\nLast parser log lines:\n{tail}")
    }
}

#[tauri::command]
fn get_debug_info() -> serde_json::Value {
    match parse_job().lock() {
        Ok(job) => serde_json::json!({
            "running": job.running,
            "cancelRequested": job.cancel_requested,
            "timeoutTriggered": job.timeout_triggered,
        }),
        Err(_) => serde_json::json!({
            "error": "failed to acquire lock"
        }),
    }
}

fn kill_active_parser() {
    if let Ok(mut job) = parse_job().lock() {
        job.cancel_requested = true;
        if let Some(child) = job.child.take() {
            let _ = child.kill();
        }
        job.memory_guard = None;
        job.running = false;
    }
}

#[cfg(windows)]
struct ParserMemoryGuard {
    job_handle: HANDLE,
}

#[cfg(windows)]
// Safety: the raw job handle is only moved into the global parse state so it can
// be closed on cancel/shutdown; all handle operations still happen under the mutex.
unsafe impl Send for ParserMemoryGuard {}

#[cfg(windows)]
impl Drop for ParserMemoryGuard {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.job_handle);
        }
    }
}

#[cfg(not(windows))]
struct ParserMemoryGuard;

#[cfg(windows)]
fn windows_parser_memory_limit_bytes() -> Option<usize> {
    const APP_MEMORY_LIMIT_PERCENT: u64 = 70;
    const APP_RUNTIME_RESERVE_BYTES: u64 = 512 * 1024 * 1024;
    const MIN_PARSER_LIMIT_BYTES: u64 = 512 * 1024 * 1024;

    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    if ok == 0 || status.ullTotalPhys == 0 {
        return None;
    }
    let app_budget = status.ullTotalPhys.saturating_mul(APP_MEMORY_LIMIT_PERCENT) / 100;
    let parser_budget = app_budget
        .saturating_sub(APP_RUNTIME_RESERVE_BYTES)
        .max(MIN_PARSER_LIMIT_BYTES);
    Some(parser_budget as usize)
}

#[cfg(windows)]
fn windows_go_heap_limit_mb(process_limit_bytes: usize) -> String {
    let go_heap_bytes = (process_limit_bytes as u64).saturating_mul(85) / 100;
    ((go_heap_bytes / 1024 / 1024).max(512)).to_string()
}

#[cfg(windows)]
fn attach_windows_memory_limit(pid: u32, limit_bytes: usize) -> Result<ParserMemoryGuard, String> {
    unsafe {
        let job_handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job_handle.is_null() {
            return Err("CreateJobObjectW failed".into());
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        limits.ProcessMemoryLimit = limit_bytes;

        let set_ok = SetInformationJobObject(
            job_handle,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set_ok == 0 {
            CloseHandle(job_handle);
            return Err("SetInformationJobObject failed".into());
        }

        let process_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process_handle.is_null() {
            CloseHandle(job_handle);
            return Err("OpenProcess failed".into());
        }

        let assign_ok = AssignProcessToJobObject(job_handle, process_handle);
        CloseHandle(process_handle);
        if assign_ok == 0 {
            CloseHandle(job_handle);
            return Err("AssignProcessToJobObject failed".into());
        }

        Ok(ParserMemoryGuard { job_handle })
    }
}

#[tauri::command]
fn cancel_parse() -> Result<(), String> {
    let mut job = parse_job().lock().map_err(|e| e.to_string())?;
    if !job.running {
        return Ok(());
    }
    job.cancel_requested = true;
    if let Some(child) = job.child.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    job.memory_guard = None;
    Ok(())
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
    // Init the file logger early. Cheap on subsequent calls.
    logger::init_logger(&app);

    {
        let mut job = parse_job().lock().map_err(|e| e.to_string())?;
        if job.running {
            return Err("A demo is already being parsed.".into());
        }
        job.running = true;
        job.cancel_requested = false;
        job.timeout_triggered = false;
        job.child = None;
    }
    let _guard = ParseJobGuard;

    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err(format!("file not found: {src_path}"));
    }
    let lower = src_path.to_lowercase();
    if !(lower.ends_with(".dem") || lower.ends_with(".dem.zst") || lower.ends_with(".zst")) {
        return Err("expected a .dem or .dem.zst file".into());
    }

    // Log demo metadata WITHOUT logging anything sensitive: just the file
    // basename and size in bytes. Full path could leak the user's home
    // directory layout in a triage log copy-paste.
    let basename = src
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "<unknown>".into());
    let size_bytes = fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
    logger::info(
        "tauri",
        &format!("parse_demo: starting (file={basename}, size={size_bytes} bytes)"),
    );

    let id = uuid::Uuid::new_v4().to_string();
    let out_path = parsed_path(&app, &id)?;
    let _opts = options.unwrap_or_default();
    let quality = "full";

    // Build the argv. The parser auto-detects zstd by peeking 4 bytes.
    let argv: Vec<String> = vec![
        "-in".into(),
        src_path.clone(),
        "-out".into(),
        out_path.to_string_lossy().into_owned(),
        "-quality".into(),
        quality.into(),
    ];

    emit_parse_progress(&app, "starting", 0.04, "Preparing parser…");
    if let Err(primary_error) =
        run_parser_sidecar(&app, "parser", argv.clone(), &out_path, 0.08).await
    {
        if parse_job()
            .lock()
            .map_err(|e| e.to_string())?
            .cancel_requested
        {
            let _ = fs::remove_file(&out_path);
            emit_parse_progress(&app, "cancelled", 0.0, "Parsing cancelled.");
            return Err("Parsing cancelled.".into());
        }
        let _ = fs::remove_file(&out_path);
        if is_parser_oom(&primary_error) {
            emit_parse_progress(
                &app,
                "failed",
                0.0,
                "Parsing failed: parser ran out of memory.",
            );
            return Err(primary_error);
        }
        eprintln!("primary parser failed, trying fallback parser:\n{primary_error}");
        emit_parse_progress(
            &app,
            "fallback",
            0.35,
            "Primary parser failed, trying fallback…",
        );
        if let Err(fallback_error) =
            run_parser_sidecar(&app, "parser-fallback", argv, &out_path, 0.38).await
        {
            if parse_job()
                .lock()
                .map_err(|e| e.to_string())?
                .cancel_requested
            {
                let _ = fs::remove_file(&out_path);
                emit_parse_progress(&app, "cancelled", 0.0, "Parsing cancelled.");
                return Err("Parsing cancelled.".into());
            }
            let _ = fs::remove_file(&out_path);
            let msg = format!(
                "Both parsers failed.\n\nPrimary parser:\n{primary_error}\n\nFallback parser:\n{fallback_error}"
            );
            emit_parse_progress(&app, "failed", 0.0, "Parsing failed.");
            return Err(msg);
        }
    }

    if !out_path.exists() {
        return Err("parser finished but produced no output".into());
    }
    emit_parse_progress(&app, "finalizing", 0.997, "Finalizing match metadata…");
    eprintln!("parse_demo: parser exited cleanly, reading match name from {out_path:?}");
    let parsed_name = read_match_name(&out_path).unwrap_or_else(|err| {
        eprintln!("parse_demo: read_match_name failed ({err}), falling back to filename");
        default_match_name(&src, &id)
    });
    eprintln!("parse_demo: writing match metadata for id={id}");
    let info = StoredMatchInfo {
        name: parsed_name,
        source_path: src_path,
    };
    write_match_info(&app, &id, &info)?;
    // Invalidate any cached entry for this id (in case of a rare UUID collision
    // or a replace-in-place workflow down the road).
    invalidate_cache(&id);
    eprintln!("parse_demo: done id={id}");
    emit_parse_progress(&app, "done", 1.0, "Parsing complete.");
    Ok(id)
}

async fn run_parser_sidecar(
    app: &AppHandle,
    name: &str,
    argv: Vec<String>,
    out_path: &Path,
    base_progress: f64,
) -> Result<(), String> {
    // Sidecar names in tauri.conf.json expand to `binaries/<name>-<target-triple>`
    // at build/package time.
    logger::info(name, &format!("spawn sidecar argv={argv:?}"));
    let sidecar = app
        .shell()
        .sidecar(name)
        .map_err(|e| format!("{name} sidecar init: {e}"))?
        .args(argv);

    #[cfg(windows)]
    let memory_limit_bytes = windows_parser_memory_limit_bytes();
    #[cfg(windows)]
    let sidecar = {
        let mut sidecar = sidecar;
        if let Some(limit_bytes) = memory_limit_bytes {
            sidecar = sidecar.env(
                "ROUNDLAB_PARSER_MEMORY_LIMIT_MB",
                windows_go_heap_limit_mb(limit_bytes),
            );
        }
        sidecar
    };

    let (mut rx, child) = sidecar.spawn().map_err(|e| format!("spawn {name}: {e}"))?;
    #[cfg(windows)]
    let memory_guard = if let Some(limit_bytes) = memory_limit_bytes {
        match attach_windows_memory_limit(child.pid(), limit_bytes) {
            Ok(guard) => Some(guard),
            Err(err) => {
                let _ = child.kill();
                return Err(format!("{name} memory limit setup: {err}"));
            }
        }
    } else {
        None
    };
    #[cfg(not(windows))]
    let memory_guard: Option<ParserMemoryGuard> = None;

    {
        let mut job = parse_job().lock().map_err(|e| e.to_string())?;
        if job.cancel_requested {
            let _ = child.kill();
            return Err("Parsing cancelled.".into());
        }
        job.memory_guard = memory_guard;
        job.child = Some(child);
    }
    emit_parse_progress(app, name, base_progress, "Parsing demo…");
    let watchdog = start_post_95_watchdog(app.clone(), name.to_string());
    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                for raw_line in text.lines() {
                    if let Some((progress, message)) = parse_sidecar_progress(raw_line) {
                        watchdog.mark_progress(progress);
                        emit_parse_progress(app, name, progress, &message);
                        logger::info(name, &format!("ROUNDLAB_PROGRESS {progress:.4} {message}"));
                    } else if raw_line.starts_with("OK[") || raw_line.starts_with("OK fallback") {
                        watchdog.mark_final_event("emit-ok");
                        emit_parse_progress(
                            app,
                            name,
                            0.99,
                            "Parser emitted OK; waiting for process termination...",
                        );
                        stderr.push_str(raw_line);
                        stderr.push('\n');
                        logger::info(name, raw_line);
                    } else if raw_line.starts_with("ROUNDLAB_FINAL ") {
                        // Each finalization step from the parser counts as a
                        // liveness signal: it postpones the post-95 timeout.
                        // Without this, a slow but still-progressing gz.Close
                        // / of.Sync / of.Close on Windows would falsely trip
                        // the watchdog at exactly 30s.
                        let label = raw_line
                            .strip_prefix("ROUNDLAB_FINAL ")
                            .unwrap_or("")
                            .trim();
                        watchdog.mark_final_event(label);
                        eprintln!("[{name}] {raw_line}");
                        stderr.push_str(raw_line);
                        stderr.push('\n');
                        logger::info(name, raw_line);
                    } else {
                        stderr.push_str(raw_line);
                        stderr.push('\n');
                        // Mirror non-empty stderr lines into the file too.
                        // Useful when the parser panics with a stack trace
                        // we'd otherwise lose.
                        if !raw_line.trim().is_empty() {
                            logger::info(name, raw_line);
                        }
                    }
                }
            }
            CommandEvent::Stdout(_) => {}
            CommandEvent::Terminated(payload) => {
                watchdog.stop();
                eprintln!(
                    "[{name}] CommandEvent::Terminated received: code={:?} signal={:?}",
                    payload.code, payload.signal
                );
                logger::info(
                    name,
                    &format!(
                        "CommandEvent::Terminated received: code={:?} signal={:?}",
                        payload.code, payload.signal
                    ),
                );
                let mut timeout_triggered = false;
                if let Ok(mut job) = parse_job().lock() {
                    job.child = None;
                    job.memory_guard = None;
                    timeout_triggered = job.timeout_triggered;
                    if job.cancel_requested {
                        let _ = fs::remove_file(out_path);
                        return Err("Parsing cancelled.".into());
                    }
                }
                if timeout_triggered {
                    let _ = fs::remove_file(out_path);
                    let msg = format!(
                        "{name} timeout: killed after {}s in finalization phase",
                        POST_95_TIMEOUT.as_secs()
                    );
                    logger::error(name, &msg);
                    return Err(msg);
                }
                let code = payload.code.unwrap_or(-1);
                if code != 0 {
                    let _ = fs::remove_file(out_path);
                    let message = parse_failure_message(name, code, &stderr);
                    logger::error(
                        name,
                        &format!("sidecar exited with status {code}; tail of stderr follows"),
                    );
                    for ln in stderr_tail(&stderr, 40).lines() {
                        logger::error(name, ln);
                    }
                    emit_parse_progress(
                        app,
                        "failed",
                        0.0,
                        message.lines().next().unwrap_or("Parsing failed."),
                    );
                    return Err(message);
                }
                emit_parse_progress(app, name, 0.995, "Sidecar terminated; validating output...");
                // Always echo the sidecar's final OK line so we can tell
                // primary vs fallback from the Tauri logs.
                if !stderr.trim().is_empty() {
                    eprintln!("[{name}] {}", stderr.trim());
                }
                return Ok(());
            }
            CommandEvent::Error(e) => {
                watchdog.stop();
                logger::error(name, &format!("CommandEvent::Error: {e}"));
                if let Ok(mut job) = parse_job().lock() {
                    job.child = None;
                    job.memory_guard = None;
                }
                let _ = fs::remove_file(out_path);
                return Err(format!("{name} error: {e}"));
            }
            _ => {}
        }
    }

    watchdog.stop();
    Err(format!("{name} stopped without an exit status"))
}

// -------------------------- Logger-facing commands --------------------------

/// Absolute path to the active log file, suitable for displaying or
/// copying from the Debug Console. Computed even before any parse has
/// run, so the Debug Console can always show where logs live.
#[tauri::command]
fn get_log_file_path(app: AppHandle) -> Result<String, String> {
    let p = logger::log_file_path(&app)?;
    Ok(p.to_string_lossy().into_owned())
}

/// Last `lines` lines of the live log file (best-effort; returns empty
/// if no log has been written yet). The 5 MB rotation cap keeps the
/// file size bounded so this stays cheap.
#[tauri::command]
fn read_log_tail(app: AppHandle, lines: u32) -> Result<String, String> {
    logger::read_tail(&app, lines as usize)
}

#[derive(Serialize)]
struct DebugLogScan {
    lines: String,
    #[serde(rename = "rawTail")]
    raw_tail: String,
    #[serde(rename = "scannedLines")]
    scanned_lines: usize,
    #[serde(rename = "matchedLines")]
    matched_lines: usize,
    paths: Vec<String>,
    #[serde(rename = "writtenPath")]
    written_path: String,
    #[serde(rename = "projectilePath")]
    projectile_path: String,
    #[serde(rename = "projectileSizeBytes")]
    projectile_size_bytes: u64,
    #[serde(rename = "projectileLines")]
    projectile_lines: usize,
}

#[tauri::command]
fn read_projectile_debug_logs(app: AppHandle, lines: u32) -> Result<DebugLogScan, String> {
    let max_lines = if lines == 0 { 2000 } else { lines.min(10_000) };
    let scan = logger::scan_matching_lines(&app, "ROUNDLAB_DEBUG_PROJECTILES", max_lines as usize)?;
    Ok(DebugLogScan {
        lines: scan.lines,
        raw_tail: scan.raw_tail,
        scanned_lines: scan.scanned_lines,
        matched_lines: scan.matched_lines,
        paths: scan.paths,
        written_path: logger::log_file_path(&app)?.to_string_lossy().into_owned(),
        projectile_path: scan.dedicated_path,
        projectile_size_bytes: scan.dedicated_size,
        projectile_lines: scan.dedicated_lines,
    })
}

#[derive(Serialize)]
struct ProjectileLogInfo {
    path: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    lines: usize,
}

#[tauri::command]
fn get_projectile_log_info(app: AppHandle) -> Result<ProjectileLogInfo, String> {
    logger::init_logger(&app);
    let path = logger::projectile_log_file_path(&app)?;
    let bytes = fs::read(&path).unwrap_or_default();
    let lines = String::from_utf8_lossy(&bytes).lines().count();
    Ok(ProjectileLogInfo {
        path: path.to_string_lossy().into_owned(),
        size_bytes: bytes.len() as u64,
        lines,
    })
}

/// Open the logs folder in the OS file explorer. Used by the Debug
/// Console "Open logs folder" button so the user can ZIP and share it.
///
/// We invoke the OS file manager directly via `std::process::Command`
/// rather than going through tauri-plugin-shell::open (which is
/// deprecated in tauri 2 in favour of tauri-plugin-opener).
#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let path = logger::log_file_path(&app)?;
    let folder = path
        .parent()
        .ok_or_else(|| "log path has no parent".to_string())?;
    // Ensure it exists before asking the OS to open it; otherwise the
    // first call (before any parse) would fail.
    fs::create_dir_all(folder).map_err(|e| format!("mkdir logs: {e}"))?;

    let folder_str = folder.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(&folder_str)
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&folder_str).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(&folder_str)
        .spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("open logs folder ({folder_str}): {e}"))
}

#[tauri::command]
fn open_projectile_logs_folder(app: AppHandle) -> Result<(), String> {
    let path = logger::projectile_log_file_path(&app)?;
    let folder = path
        .parent()
        .ok_or_else(|| "projectile log path has no parent".to_string())?;
    fs::create_dir_all(folder).map_err(|e| format!("mkdir projectile logs folder: {e}"))?;

    let folder_str = folder.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(&folder_str)
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&folder_str).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(&folder_str)
        .spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("open projectile logs folder ({folder_str}): {e}"))
}

#[tauri::command]
fn open_projectile_log_file(app: AppHandle) -> Result<(), String> {
    logger::init_logger(&app);
    let path = logger::projectile_log_file_path(&app)?;
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| format!("mkdir projectile logs folder: {e}"))?;
    }

    let path_str = path.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &path_str])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&path_str).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(&path_str)
        .spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("open projectile log file ({path_str}): {e}"))
}

#[tauri::command]
fn write_debug_log(app: AppHandle, source: String, message: String) -> Result<String, String> {
    logger::init_logger(&app);
    let source = source
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .take(24)
        .collect::<String>();
    let source = if source.is_empty() {
        "frontend".to_string()
    } else {
        source
    };
    logger::info(&source, &message);
    Ok(logger::log_file_path(&app)?.to_string_lossy().into_owned())
}

// -------------------------- App entry --------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|_, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                kill_active_parser();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_matches,
            get_match_metadata,
            get_round,
            delete_match,
            rename_match,
            create_visual_test_match,
            enter_match_fullscreen,
            cancel_parse,
            parse_demo,
            get_debug_info,
            get_log_file_path,
            get_projectile_log_info,
            read_log_tail,
            read_projectile_debug_logs,
            open_logs_folder,
            open_projectile_logs_folder,
            open_projectile_log_file,
            write_debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

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

    #[test]
    fn read_match_name_reads_meta_from_gzip() {
        let path = std::env::temp_dir().join(format!(
            "roundlab-meta-test-{}.json.gz",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_nanos()
        ));
        {
            let file = fs::File::create(&path).expect("create test gzip");
            let mut gz = GzEncoder::new(file, Compression::fast());
            gz.write_all(
                br#"{"meta":{"map":"de_mirage","tickRate":64,"sampleRate":64,"teamA":"NAVI","teamB":"Vitality","scoreA":13,"scoreB":11},"players":[],"rounds":[{"frames":[{"players":[]}]}]}"#,
            )
            .expect("write test match");
            gz.finish().expect("finish gzip");
        }

        let name = read_match_name(&path).expect("read match name");
        let _ = fs::remove_file(&path);
        assert_eq!(name, "13-11 - NAVI vs Vitality - de_mirage");
    }

    #[test]
    fn backfill_missing_round_scores_prevents_zero_fallback_for_old_parses() {
        let mut m = MatchFile {
            meta: Meta {
                map: "de_mirage".into(),
                tick_rate: 64.0,
                sample_rate: 64.0,
                duration_sec: 0.0,
                team_a: "A".into(),
                team_b: "B".into(),
                score_a: 2,
                score_b: 1,
                partial: false,
                parse_error: String::new(),
            },
            players: vec![],
            rounds: vec![
                RawRound {
                    number: 0,
                    winner: "CT".into(),
                    ..RawRound::default()
                },
                RawRound {
                    number: 1,
                    winner: "T".into(),
                    ..RawRound::default()
                },
                RawRound {
                    number: 2,
                    winner: "CT".into(),
                    ..RawRound::default()
                },
            ],
        };

        backfill_missing_round_scores(&mut m);

        let scores = m
            .rounds
            .iter()
            .map(|r| (r.score_a, r.score_b))
            .collect::<Vec<_>>();
        assert_eq!(
            scores,
            vec![(Some(1), Some(0)), (Some(1), Some(1)), (Some(2), Some(1))]
        );
    }

    fn test_meta() -> Meta {
        Meta {
            map: "de_mirage".into(),
            tick_rate: 64.0,
            sample_rate: 64.0,
            duration_sec: 0.0,
            team_a: "A".into(),
            team_b: "B".into(),
            score_a: 2,
            score_b: 0,
            partial: false,
            parse_error: String::new(),
        }
    }

    fn rifle_round(number: i64, score_a: i64, score_b: i64, winner_name: &str) -> RawRound {
        RawRound {
            number,
            duration: 95.0,
            winner_name: Some(winner_name.into()),
            score_a: Some(score_a),
            score_b: Some(score_b),
            events: serde_json::json!([
                {"type": "kill", "weapon": "ak47"}
            ]),
            frames: serde_json::json!([
                {"players": [{"active": "ak47", "weapons": ["ak47", "weapon_knife"]}]}
            ]),
            ..RawRound::default()
        }
    }

    #[test]
    fn normalize_round_scores_is_skipped_for_already_normalized_matches() {
        let m = MatchFile {
            meta: test_meta(),
            players: vec![],
            rounds: vec![rifle_round(0, 0, 0, "A"), rifle_round(1, 1, 0, "A")],
        };

        assert!(!should_normalize_competitive_round_scores(&m));
    }

    #[test]
    fn normalize_round_scores_detects_old_after_round_scores() {
        let mut m = MatchFile {
            meta: test_meta(),
            players: vec![],
            rounds: vec![rifle_round(0, 1, 0, "A"), rifle_round(1, 2, 0, "A")],
        };

        assert!(should_normalize_competitive_round_scores(&m));
        normalize_competitive_round_scores(&mut m);

        let scores = m
            .rounds
            .iter()
            .map(|r| (r.number, r.score_a, r.score_b))
            .collect::<Vec<_>>();
        assert_eq!(scores, vec![(0, Some(0), Some(0)), (1, Some(1), Some(0))]);
    }

    #[test]
    fn normalize_round_scores_hides_knife_rounds_and_renumbers() {
        let knife_round = RawRound {
            number: 0,
            duration: 20.0,
            score_a: Some(1),
            score_b: Some(0),
            events: serde_json::json!([
                {"type": "kill", "weapon": "weapon_knife"}
            ]),
            frames: serde_json::json!([
                {"players": [{"active": "weapon_knife", "weapons": ["weapon_knife"]}]}
            ]),
            ..RawRound::default()
        };
        let mut m = MatchFile {
            meta: test_meta(),
            players: vec![],
            rounds: vec![knife_round, rifle_round(1, 2, 0, "A")],
        };

        assert!(should_normalize_competitive_round_scores(&m));
        normalize_competitive_round_scores(&mut m);

        assert_eq!(m.rounds.len(), 1);
        assert_eq!(m.rounds[0].number, 0);
        assert_eq!(
            (m.rounds[0].score_a, m.rounds[0].score_b),
            (Some(0), Some(0))
        );
    }

    #[test]
    fn diagnostic_match_file_exercises_visual_surfaces() {
        let m = diagnostic_match_file();

        assert_eq!(m.meta.map, "de_mirage");
        assert_eq!(m.players.len(), 10);
        assert_eq!(m.rounds.len(), 2);
        let round = &m.rounds[0];
        assert!(array_len(&round.frames) > 0);
        assert!(array_len(&round.projectile_frames) > 0);
        assert!(array_len(&round.effects) >= 4);
        assert!(round
            .events
            .as_array()
            .expect("events array")
            .iter()
            .any(|event| event.get("type").and_then(serde_json::Value::as_str) == Some("kill")));
        assert!(
            serde_json::to_vec(&m)
                .expect("diagnostic match should serialize")
                .len()
                > 1024
        );
    }

    #[test]
    fn parse_failure_message_classifies_oom_and_keeps_tail() {
        let stderr = (0..45)
            .map(|i| format!("line {i}"))
            .chain([
                "runtime: VirtualAlloc of 4556898304 bytes failed with errno=1455".to_string(),
                "fatal error: out of memory".to_string(),
                "sendtables2.(*Entity).readFields".to_string(),
            ])
            .collect::<Vec<_>>()
            .join("\n");

        let message = parse_failure_message("parser", 1, &stderr);

        assert!(message.contains("Parser ran out of memory"));
        assert!(message.contains("Last parser log lines"));
        assert!(!message.contains("line 0"));
        assert!(message.contains("line 8"));
        assert!(message.contains("VirtualAlloc"));
        assert!(message.contains("sendtables2.(*Entity).readFields"));
    }

    #[test]
    fn parse_failure_message_handles_empty_stderr() {
        let message = parse_failure_message("parser", 1, "");

        assert_eq!(
            message,
            "Parser failed while decoding the demo.\n\nparser exited with status 1."
        );
    }
}
