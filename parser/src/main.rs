use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use ahash::AHashMap;
use anyhow::{anyhow, bail, Context, Result};
use flate2::{write::GzEncoder, Compression};
use parser::{
    first_pass::parser_settings::{rm_user_friendly_names, FirstPassParser, ParserInputs},
    parse_demo::{Parser, ParsingMode},
    second_pass::{
        parser_settings::create_huffman_lookup_table,
        variants::{soa_to_aos, OutputSerdeHelperStruct, PropColumn, VarVec, Variant},
    },
};
use rayon::prelude::*;
use serde::Serialize;
use serde_json::Value;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];
const TICK_RATE: f64 = 64.0;
const JSON_WRITE_BUFFER_BYTES: usize = 256 * 1024;
const REPLAY_SCHEMA_VERSION: &str = "roundlab.replay.v2";
const PARSER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Default)]
struct Args {
    input: String,
    output: String,
    quality: String,
    skip_projectiles: bool,
    skip_weapon_fires: bool,
    stats: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    map: String,
    tick_rate: f64,
    sample_rate: i32,
    duration_sec: f64,
    team_a: String,
    team_b: String,
    score_a: i32,
    score_b: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Player {
    #[serde(serialize_with = "serialize_u64_as_string")]
    steam_id: u64,
    name: String,
    team: String,
}

#[derive(Serialize)]
struct Frame {
    t: f64,
    players: Vec<PlayerPos>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bomb: Option<BombState>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    projectiles: Vec<ProjectilePos>,
}

#[derive(Clone, Serialize)]
struct BombState {
    x: f64,
    y: f64,
    z: f64,
    status: String,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    carrier: Option<u64>,
}

#[derive(Serialize)]
struct ProjectileFrame {
    t: f64,
    projectiles: Vec<ProjectilePos>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerPos {
    #[serde(serialize_with = "serialize_u64_as_string")]
    id: u64,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pitch: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    velocity_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    velocity_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    velocity_z: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    airborne: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    walking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duck_amount: Option<f64>,
    hp: i64,
    armor: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    money: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    equipment_value: Option<i64>,
    #[serde(skip_serializing_if = "is_false")]
    helmet: bool,
    #[serde(skip_serializing_if = "is_false")]
    kit: bool,
    #[serde(rename = "hasBomb", skip_serializing_if = "is_false")]
    has_bomb: bool,
    team: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    active: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    weapons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flash_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flash_total: Option<f64>,
    #[serde(rename = "use", skip_serializing_if = "is_false")]
    use_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_action: Option<ActiveAction>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveAction {
    #[serde(rename = "type")]
    kind: String,
    item: String,
    elapsed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectilePos {
    id: i64,
    #[serde(rename = "type", serialize_with = "serialize_projectile_kind")]
    kind: ProjectileKind,
    x: f64,
    y: f64,
    z: f64,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    thrower: Option<u64>,
}

#[derive(Clone, PartialEq, Eq)]
enum ProjectileKind {
    Smoke,
    He,
    Flash,
    Molotov,
    Other(String),
}

impl ProjectileKind {
    fn from_name(name: &str) -> Self {
        match name {
            "CSmokeGrenadeProjectile" => Self::Smoke,
            "CHEGrenadeProjectile" => Self::He,
            "CFlashbangProjectile" => Self::Flash,
            "CMolotovProjectile" => Self::Molotov,
            other => Self::Other(other.to_string()),
        }
    }

    fn as_str(&self) -> &str {
        match self {
            Self::Smoke => "CSmokeGrenadeProjectile",
            Self::He => "CHEGrenadeProjectile",
            Self::Flash => "CFlashbangProjectile",
            Self::Molotov => "CMolotovProjectile",
            Self::Other(name) => name,
        }
    }
}

fn serialize_projectile_kind<S>(kind: &ProjectileKind, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(kind.as_str())
}

#[derive(Clone, Debug)]
struct C4Pos {
    tick: i32,
    x: f64,
    y: f64,
    z: f64,
}

struct TickData {
    rows: Vec<TickRow>,
    c4_positions: Vec<C4Pos>,
    weapon_names: Vec<String>,
}

struct TickRow {
    tick: i32,
    steamid: u64,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    pitch: Option<f64>,
    speed: Option<f64>,
    velocity_x: Option<f64>,
    velocity_y: Option<f64>,
    velocity_z: Option<f64>,
    airborne: Option<bool>,
    walking: Option<bool>,
    duck_amount: Option<f64>,
    hp: i64,
    armor: i64,
    money: Option<i64>,
    equipment_value: Option<i64>,
    helmet: bool,
    kit: bool,
    alive: bool,
    team: i64,
    active: Option<u16>,
    weapons: Vec<u16>,
    fire: bool,
    right_click: bool,
    use_key: bool,
}

struct ProjectileRow {
    tick: i32,
    entity_id: i64,
    kind: ProjectileKind,
    x: f64,
    y: f64,
    z: f64,
    thrower: Option<u64>,
}

#[derive(Clone, Debug)]
struct BlindSpan {
    player: u64,
    start: f64,
    end: f64,
    total: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlashEvent {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    thrower: Option<u64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    victim: Option<u64>,
    duration: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseEvent {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    player: Option<u64>,
    item: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    inventory_slot: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    was_sold: Option<bool>,
}

#[derive(Serialize)]
struct Event {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(rename = "type")]
    kind: String,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    player: Option<u64>,
    #[serde(rename = "hasKit", skip_serializing_if = "is_false")]
    has_kit: bool,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    killer: Option<u64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    victim: Option<u64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    assist: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weapon: Option<String>,
    #[serde(flatten)]
    kill: KillDetails,
    #[serde(skip_serializing_if = "Option::is_none")]
    winner: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DamageEvent {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    attacker: Option<u64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    victim: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weapon: Option<String>,
    damage_health: i64,
    damage_armor: i64,
    health_after: i64,
    armor_after: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    hitgroup: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisconnectEvent {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    player: Option<u64>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct KillDetails {
    #[serde(skip_serializing_if = "is_false")]
    hs: bool,
    #[serde(skip_serializing_if = "is_false")]
    flash_assist: bool,
    #[serde(skip_serializing_if = "is_false")]
    no_scope: bool,
    #[serde(skip_serializing_if = "is_false")]
    through_smoke: bool,
    #[serde(skip_serializing_if = "is_false")]
    attacker_blind: bool,
    #[serde(skip_serializing_if = "is_zero_i64")]
    penetrated: i64,
    #[serde(skip_serializing_if = "is_false")]
    dominated: bool,
    #[serde(skip_serializing_if = "is_false")]
    revenge: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Round {
    number: usize,
    start_tick: i32,
    freeze_end_tick: i32,
    end_tick: i32,
    duration: f64,
    winner: String,
    score_a: i32,
    score_b: i32,
    frames: Vec<Frame>,
    events: Vec<Event>,
    damages: Vec<DamageEvent>,
    disconnects: Vec<DisconnectEvent>,
    flashes: Vec<FlashEvent>,
    purchases: Vec<PurchaseEvent>,
    effects: Vec<UtilityEffect>,
    weapon_fires: Vec<WeaponFireEvent>,
    bullet_impacts: Vec<BulletImpactEvent>,
    projectile_frames: Vec<ProjectileFrame>,
}

#[derive(Serialize)]
struct UtilityEffect {
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    variant: Option<String>,
    start: f64,
    end: f64,
    x: f64,
    y: f64,
    z: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    team: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WeaponFireEvent {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    shooter: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weapon: Option<String>,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    team: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BulletImpactEvent {
    t: f64,
    tick: i32,
    sequence: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_u64_as_string"
    )]
    shooter: Option<u64>,
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Serialize)]
#[cfg_attr(not(test), allow(dead_code))]
struct Output {
    #[serde(rename = "schemaVersion")]
    schema_version: &'static str,
    #[serde(rename = "parserVersion")]
    parser_version: &'static str,
    meta: Meta,
    players: Vec<Player>,
    rounds: Vec<Round>,
}

#[derive(Serialize)]
struct ManifestOutput<'a> {
    #[serde(rename = "schemaVersion")]
    schema_version: &'static str,
    #[serde(rename = "parserVersion")]
    parser_version: &'static str,
    meta: &'a Meta,
    players: &'a [Player],
    rounds: Vec<ManifestRound>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestRound {
    number: usize,
    start_tick: i32,
    freeze_end_tick: i32,
    end_tick: i32,
    duration: f64,
    winner: String,
    score_a: i32,
    score_b: i32,
    frames: Vec<Frame>,
    events: Vec<Event>,
    damages: Vec<DamageEvent>,
    disconnects: Vec<DisconnectEvent>,
    flashes: Vec<FlashEvent>,
    purchases: Vec<PurchaseEvent>,
    effects: Vec<UtilityEffect>,
    weapon_fires: Vec<WeaponFireEvent>,
    bullet_impacts: Vec<BulletImpactEvent>,
    projectile_frames: Vec<ProjectileFrame>,
    round_file: String,
}

#[derive(Default)]
struct ParserStats {
    input_bytes: u64,
    decompressed_bytes: u64,
    read_demo_ms: u128,
    create_huffman_ms: u128,
    parse_header_ms: u128,
    parse_players_ms: u128,
    parse_events_ms: u128,
    sample_ticks_ms: u128,
    parse_ticks_ms: u128,
    group_ticks_ms: u128,
    parse_teams_ms: u128,
    parse_projectiles_ms: u128,
    group_projectiles_ms: u128,
    build_rounds_ms: u128,
    write_output_ms: u128,
    serialize_json_ms: u128,
    raw_json_bytes: u64,
    gz_flush_ms: u128,
    gzip_finish_ms: u128,
    fsync_ms: u128,
    output_gzip_bytes: u64,
    rounds: usize,
    players: usize,
    frames: usize,
    frame_players: usize,
    events: usize,
    kills: usize,
    bomb_events: usize,
    effects: usize,
    weapon_fires: usize,
    projectile_frames: usize,
    projectile_samples: usize,
    tick_rows: usize,
    c4_records: usize,
    projectile_rows: usize,
}

#[derive(Default)]
struct WriteStats {
    write_output_ms: u128,
    serialize_json_ms: u128,
    raw_json_bytes: u64,
    gz_flush_ms: u128,
    gzip_finish_ms: u128,
    fsync_ms: u128,
    output_gzip_bytes: u64,
}

#[derive(Clone, Debug)]
struct RoundSpan {
    start: i32,
    end: i32,
    round_end: i32,
    winner: String,
}

struct RoundBuildContext<'a> {
    args: &'a Args,
    events: &'a [Value],
    spans: &'a [RoundSpan],
    rows_by_tick: &'a BTreeMap<i32, Vec<TickRow>>,
    c4_by_tick: &'a BTreeMap<i32, C4Pos>,
    projectiles_by_tick: &'a BTreeMap<i32, Vec<ProjectilePos>>,
    weapon_names: &'a [String],
    round_scores: &'a [(i32, i32)],
    sample_step: i32,
}

struct ParsedDemoData {
    map: String,
    players: Vec<Player>,
    events: Vec<Value>,
    spans: Vec<RoundSpan>,
    rows_by_tick: BTreeMap<i32, Vec<TickRow>>,
    c4_by_tick: BTreeMap<i32, C4Pos>,
    projectiles_by_tick: BTreeMap<i32, Vec<ProjectilePos>>,
    weapon_names: Vec<String>,
    team_a: String,
    team_b: String,
    round_scores: Vec<(i32, i32)>,
    sample_rate: i32,
    sample_step: i32,
    duration_sec: f64,
    stats: ParserStats,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_zero_i64(value: &i64) -> bool {
    *value == 0
}

fn serialize_u64_as_string<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&value.to_string())
}

fn serialize_optional_u64_as_string<S>(
    value: &Option<u64>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value {
        Some(value) => serializer.serialize_some(&value.to_string()),
        None => serializer.serialize_none(),
    }
}

fn emit_progress(progress: f64, message: &str) {
    eprintln!("ROUNDLAB_PROGRESS {progress:.4} {message}");
}

#[cfg(not(target_arch = "wasm32"))]
type ParserInstant = Instant;

#[cfg(target_arch = "wasm32")]
type ParserInstant = f64;

fn parser_now() -> ParserInstant {
    #[cfg(not(target_arch = "wasm32"))]
    {
        Instant::now()
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
}

fn elapsed_ms(started: ParserInstant) -> u128 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        started.elapsed().as_millis()
    }
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() - started).max(0.0) as u128
    }
}

fn final_step_start(name: &str) -> ParserInstant {
    eprintln!("ROUNDLAB_FINAL start step={name}");
    parser_now()
}

fn final_step_done(name: &str, started: ParserInstant) {
    eprintln!(
        "ROUNDLAB_FINAL done step={name} duration_ms={}",
        elapsed_ms(started)
    );
}

fn timed<T, F>(slot: &mut u128, f: F) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    let started = parser_now();
    let result = f();
    *slot = elapsed_ms(started);
    result
}

fn emit_stats(stats: &ParserStats) {
    eprintln!("ROUNDLAB_STATS input_bytes={}", stats.input_bytes);
    eprintln!(
        "ROUNDLAB_STATS decompressed_bytes={}",
        stats.decompressed_bytes
    );
    eprintln!("ROUNDLAB_STATS read_demo_ms={}", stats.read_demo_ms);
    eprintln!(
        "ROUNDLAB_STATS create_huffman_ms={}",
        stats.create_huffman_ms
    );
    eprintln!("ROUNDLAB_STATS parse_header_ms={}", stats.parse_header_ms);
    eprintln!("ROUNDLAB_STATS parse_players_ms={}", stats.parse_players_ms);
    eprintln!("ROUNDLAB_STATS parse_events_ms={}", stats.parse_events_ms);
    eprintln!("ROUNDLAB_STATS sample_ticks_ms={}", stats.sample_ticks_ms);
    eprintln!("ROUNDLAB_STATS parse_ticks_ms={}", stats.parse_ticks_ms);
    eprintln!("ROUNDLAB_STATS group_ticks_ms={}", stats.group_ticks_ms);
    eprintln!("ROUNDLAB_STATS parse_teams_ms={}", stats.parse_teams_ms);
    eprintln!(
        "ROUNDLAB_STATS parse_projectiles_ms={}",
        stats.parse_projectiles_ms
    );
    eprintln!(
        "ROUNDLAB_STATS group_projectiles_ms={}",
        stats.group_projectiles_ms
    );
    eprintln!("ROUNDLAB_STATS build_rounds_ms={}", stats.build_rounds_ms);
    eprintln!("ROUNDLAB_STATS write_output_ms={}", stats.write_output_ms);
    eprintln!(
        "ROUNDLAB_STATS serialize_json_ms={}",
        stats.serialize_json_ms
    );
    eprintln!("ROUNDLAB_STATS raw_json_bytes={}", stats.raw_json_bytes);
    eprintln!("ROUNDLAB_STATS gz_flush_ms={}", stats.gz_flush_ms);
    eprintln!("ROUNDLAB_STATS gzip_finish_ms={}", stats.gzip_finish_ms);
    eprintln!("ROUNDLAB_STATS fsync_ms={}", stats.fsync_ms);
    eprintln!(
        "ROUNDLAB_STATS output_gzip_bytes={}",
        stats.output_gzip_bytes
    );
    eprintln!("ROUNDLAB_STATS rounds={}", stats.rounds);
    eprintln!("ROUNDLAB_STATS players={}", stats.players);
    eprintln!("ROUNDLAB_STATS frames={}", stats.frames);
    eprintln!("ROUNDLAB_STATS frame_players={}", stats.frame_players);
    eprintln!("ROUNDLAB_STATS events={}", stats.events);
    eprintln!("ROUNDLAB_STATS kills={}", stats.kills);
    eprintln!("ROUNDLAB_STATS bomb_events={}", stats.bomb_events);
    eprintln!("ROUNDLAB_STATS effects={}", stats.effects);
    eprintln!("ROUNDLAB_STATS weapon_fires={}", stats.weapon_fires);
    eprintln!(
        "ROUNDLAB_STATS projectile_frames={}",
        stats.projectile_frames
    );
    eprintln!(
        "ROUNDLAB_STATS projectile_samples={}",
        stats.projectile_samples
    );
    eprintln!("ROUNDLAB_STATS tick_rows={}", stats.tick_rows);
    eprintln!("ROUNDLAB_STATS c4_records={}", stats.c4_records);
    eprintln!("ROUNDLAB_STATS projectile_rows={}", stats.projectile_rows);
}

fn skip_fsync() -> bool {
    matches!(
        std::env::var("ROUNDLAB_PARSER_SKIP_FSYNC")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn main() {
    if let Err(err) = run() {
        eprintln!("parser error: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = parse_args()?;
    let (output, mut stats) = parse_demo_to_output_with_stats(&args)?;

    emit_progress(0.90, "Writing parser output...");
    let write_stats = write_json_gz(&args.output, &output)?;
    stats.write_output_ms = write_stats.write_output_ms;
    stats.serialize_json_ms = write_stats.serialize_json_ms;
    stats.raw_json_bytes = write_stats.raw_json_bytes;
    stats.gz_flush_ms = write_stats.gz_flush_ms;
    stats.gzip_finish_ms = write_stats.gzip_finish_ms;
    stats.fsync_ms = write_stats.fsync_ms;
    stats.output_gzip_bytes = write_stats.output_gzip_bytes;
    if args.stats {
        emit_stats(&stats);
    }
    emit_progress(0.9990, "Emitting parser OK on stderr...");
    let ok_started = final_step_start("emit-ok");
    eprintln!(
        "OK[rust] map={} rounds={} players={}",
        output.meta.map,
        output.rounds.len(),
        output.players.len()
    );
    final_step_done("emit-ok", ok_started);
    Ok(())
}

#[cfg(test)]
fn parse_demo_to_output(args: &Args) -> Result<Output> {
    parse_demo_to_output_with_stats(args).map(|(output, _)| output)
}

fn parse_demo_to_output_with_stats(args: &Args) -> Result<(Output, ParserStats)> {
    let mut data = parse_demo_data(args)?;
    let build_rounds_started = parser_now();
    let ctx = RoundBuildContext {
        args,
        events: &data.events,
        spans: &data.spans,
        rows_by_tick: &data.rows_by_tick,
        c4_by_tick: &data.c4_by_tick,
        projectiles_by_tick: &data.projectiles_by_tick,
        weapon_names: &data.weapon_names,
        round_scores: &data.round_scores,
        sample_step: data.sample_step,
    };
    let mut rounds = Vec::with_capacity(data.spans.len());
    for idx in 0..data.spans.len() {
        if let Some(round) = build_round_payload(&ctx, idx, rounds.len()) {
            rounds.push(round);
        }
        if idx > 200 {
            break;
        }
    }

    if rounds.is_empty() {
        bail!("parser produced no frames");
    }
    if looks_like_knife_round(rounds.first()) {
        rounds.remove(0);
        for (idx, round) in rounds.iter_mut().enumerate() {
            round.number = idx;
        }
    }
    data.stats.build_rounds_ms = elapsed_ms(build_rounds_started);
    let (score_a, score_b) = rounds
        .last()
        .map(|round| (round.score_a, round.score_b))
        .unwrap_or_default();

    let output = Output {
        schema_version: REPLAY_SCHEMA_VERSION,
        parser_version: PARSER_VERSION,
        meta: Meta {
            map: data.map,
            tick_rate: TICK_RATE,
            sample_rate: data.sample_rate,
            duration_sec: data.duration_sec,
            team_a: data.team_a,
            team_b: data.team_b,
            score_a,
            score_b,
        },
        players: data.players,
        rounds,
    };
    collect_output_stats(&mut data.stats, &output);
    Ok((output, data.stats))
}

fn parse_demo_data(args: &Args) -> Result<ParsedDemoData> {
    let input_bytes = fs::metadata(&args.input)
        .map(|m| m.len())
        .unwrap_or_default();
    let mut read_demo_ms = 0;
    let bytes = timed(&mut read_demo_ms, || read_demo(&args.input))?;
    let mut data = parse_demo_data_from_bytes(args, &bytes, input_bytes)?;
    data.stats.read_demo_ms = read_demo_ms;
    Ok(data)
}

fn parse_demo_data_from_bytes(
    args: &Args,
    bytes: &[u8],
    input_bytes: u64,
) -> Result<ParsedDemoData> {
    let mut stats = ParserStats {
        input_bytes,
        ..ParserStats::default()
    };
    stats.decompressed_bytes = bytes.len() as u64;
    let huf_started = parser_now();
    let huf = create_huffman_lookup_table();
    stats.create_huffman_ms = elapsed_ms(huf_started);

    let header = timed(&mut stats.parse_header_ms, || parse_header(bytes, &huf))?;
    let map = header.get("map_name").cloned().unwrap_or_default();
    let players = timed(&mut stats.parse_players_ms, || parse_players(bytes, &huf))?;
    let events = timed(&mut stats.parse_events_ms, || parse_events(bytes, &huf))?;
    let spans = round_spans(&events)
        .into_iter()
        .map(|span| playable_span(&events, &span))
        .collect::<Vec<_>>();
    if spans.is_empty() {
        bail!("parser found no playable rounds");
    }

    let sample_step = sample_step(&args.quality);
    let sample_rate = (TICK_RATE as i32 / sample_step).max(1);
    let wanted_ticks = timed(&mut stats.sample_ticks_ms, || {
        Ok(sample_ticks(&spans, sample_step, &events))
    })?;
    let tick_data = timed(&mut stats.parse_ticks_ms, || {
        parse_ticks(bytes, &huf, wanted_ticks)
    })?;
    stats.tick_rows = tick_data.rows.len();
    stats.c4_records = tick_data.c4_positions.len();
    let group_ticks_started = parser_now();
    let rows_by_tick = group_tick_rows(tick_data.rows);
    let c4_by_tick = group_c4_positions(tick_data.c4_positions);
    stats.group_ticks_ms = elapsed_ms(group_ticks_started);
    let team_rows = timed(&mut stats.parse_teams_ms, || {
        Ok(parse_team_rows(bytes, &huf, team_name_ticks(&spans)).unwrap_or_default())
    })?;
    let (team_a, team_b) = team_names_from_rows(&team_rows);
    let round_scores = round_scores_from_team_rows(&team_rows, &spans, &team_a, &team_b);
    let projectile_rows = if args.skip_projectiles {
        Vec::new()
    } else {
        timed(&mut stats.parse_projectiles_ms, || {
            parse_projectiles(bytes, &huf)
        })?
    };
    stats.projectile_rows = projectile_rows.len();
    let group_projectiles_started = parser_now();
    let projectiles_by_tick = group_projectile_rows(projectile_rows);
    stats.group_projectiles_ms = elapsed_ms(group_projectiles_started);

    let duration_sec = spans
        .last()
        .map(|r| f64::from(r.end) / TICK_RATE)
        .unwrap_or_default();

    Ok(ParsedDemoData {
        map,
        players,
        events,
        spans,
        rows_by_tick,
        c4_by_tick,
        projectiles_by_tick,
        weapon_names: tick_data.weapon_names,
        team_a,
        team_b,
        round_scores,
        sample_rate,
        sample_step,
        duration_sec,
        stats,
    })
}

fn build_round_payload(
    ctx: &RoundBuildContext<'_>,
    span_idx: usize,
    output_number: usize,
) -> Option<Round> {
    let span = &ctx.spans[span_idx];
    let mut frames = Vec::new();
    let flashes = round_flashes(ctx.events, span);
    let blind_spans = blind_spans_from_flashes(&flashes);
    let next_span = ctx.spans.get(span_idx + 1);
    let post_round_event_end = post_round_event_end_tick(span, next_span);
    let has_explicit_bomb_exploded =
        has_explicit_bomb_exploded(ctx.events, span, post_round_event_end);
    let has_bomb_planted = has_bomb_planted(ctx.events, span, post_round_event_end);
    let has_post_round_world_kill =
        has_post_round_world_kill(ctx.events, span, post_round_event_end);
    let has_long_post_round_window =
        span.end.saturating_sub(span.round_end) >= TICK_RATE as i32 * 8;
    let span_events = ctx
        .events
        .iter()
        .filter(|event| {
            let tick = get_i64(event, "tick").unwrap_or_default() as i32;
            tick >= span.start && tick <= span.end
        })
        .collect::<Vec<_>>();
    let mut event_idx = 0;
    let mut bomb_planted = false;
    let mut bomb_resolved = false;
    let mut last_bomb: Option<BombState> = None;
    let mut plant_starts: HashMap<u64, i32> = HashMap::new();
    let mut utility_starts: HashMap<u64, (String, i32)> = HashMap::new();
    for tick in (span.start..=span.end).step_by(ctx.sample_step as usize) {
        while event_idx < span_events.len() {
            let event = span_events[event_idx];
            let event_tick = get_i64(event, "tick").unwrap_or_default() as i32;
            if event_tick > tick {
                break;
            }
            match get_str(event, "event_name").unwrap_or("") {
                "bomb_beginplant" => {
                    if let Some(player) =
                        get_u64(event, "user_steamid").or_else(|| get_u64(event, "player_steamid"))
                    {
                        plant_starts.insert(player, event_tick);
                    }
                }
                "player_death" => {
                    if let Some(player) = get_u64(event, "user_steamid") {
                        plant_starts.remove(&player);
                        utility_starts.remove(&player);
                    }
                }
                "bomb_planted" => {
                    bomb_planted = true;
                    bomb_resolved = false;
                    if let Some(player) =
                        get_u64(event, "user_steamid").or_else(|| get_u64(event, "player_steamid"))
                    {
                        plant_starts.remove(&player);
                    } else {
                        plant_starts.clear();
                    }
                    let planter_row = get_u64(event, "user_steamid").and_then(|id| {
                        player_row_at_tick(ctx.rows_by_tick, event_tick, id, span.start)
                    });
                    let x = get_f64(event, "x")
                        .or_else(|| get_f64(event, "X"))
                        .or_else(|| planter_row.map(|row| row.x))
                        .or_else(|| last_bomb.as_ref().map(|bomb| bomb.x));
                    let y = get_f64(event, "y")
                        .or_else(|| get_f64(event, "Y"))
                        .or_else(|| planter_row.map(|row| row.y))
                        .or_else(|| last_bomb.as_ref().map(|bomb| bomb.y));
                    let z = get_f64(event, "z")
                        .or_else(|| get_f64(event, "Z"))
                        .or_else(|| planter_row.map(|row| row.z))
                        .or_else(|| last_bomb.as_ref().map(|bomb| bomb.z));
                    if let (Some(x), Some(y), Some(z)) = (x, y, z) {
                        last_bomb = Some(BombState {
                            x,
                            y,
                            z,
                            status: "planted".into(),
                            carrier: None,
                        });
                    }
                }
                "bomb_defused" | "bomb_exploded" => {
                    bomb_planted = false;
                    bomb_resolved = true;
                    last_bomb = None;
                    plant_starts.clear();
                    utility_starts.clear();
                }
                "round_end" | "round_officially_ended" => {
                    if get_str(event, "event_name") == Some("round_end")
                        && should_synthesize_bomb_explosion_from_round_end(
                            event,
                            span,
                            has_bomb_planted,
                            has_long_post_round_window,
                            has_post_round_world_kill,
                            next_span.is_none(),
                            has_explicit_bomb_exploded,
                        )
                    {
                        bomb_planted = false;
                        bomb_resolved = true;
                        last_bomb = None;
                    }
                    plant_starts.clear();
                    utility_starts.clear();
                }
                _ => {}
            }
            event_idx += 1;
        }
        let Some(rows) = ctx.rows_by_tick.get(&tick) else {
            continue;
        };
        let t = seconds_since(span.start, tick);
        let mut stale_plants = Vec::new();
        let mut seen_players = HashSet::new();
        let mut players = Vec::new();
        for row in rows {
            let player_id = row.steamid;
            seen_players.insert(player_id);
            let active = weapon_name(ctx.weapon_names, row.active);
            let alive = row.alive;
            let pressed = action_pressed(row);
            let active_action = if let Some(start_tick) = plant_starts.get(&player_id).copied() {
                let elapsed = seconds_since(start_tick, tick);
                if alive && elapsed <= 3.2 {
                    Some(ActiveAction {
                        kind: "plant".into(),
                        item: "C4".into(),
                        elapsed,
                        duration: Some(3.2),
                    })
                } else {
                    stale_plants.push(player_id);
                    None
                }
            } else if alive && pressed && is_utility_action_weapon(active) {
                let start_tick = match utility_starts.get(&player_id) {
                    Some((item, start_tick)) if item == active => *start_tick,
                    _ => {
                        utility_starts.insert(player_id, (active.to_string(), tick));
                        tick
                    }
                };
                Some(ActiveAction {
                    kind: "utility".into(),
                    item: active.to_string(),
                    elapsed: seconds_since(start_tick, tick),
                    duration: None,
                })
            } else {
                utility_starts.remove(&player_id);
                None
            };
            if let Some(player) =
                player_pos_from_row(row, ctx.weapon_names, &blind_spans, t, active_action)
            {
                players.push(player);
            } else {
                plant_starts.remove(&player_id);
                utility_starts.remove(&player_id);
            }
        }
        for player in stale_plants {
            plant_starts.remove(&player);
        }
        utility_starts.retain(|player, _| seen_players.contains(player));
        if players.is_empty() {
            continue;
        }
        let exact_c4 = ctx.c4_by_tick.get(&tick);
        let bomb = if bomb_resolved {
            None
        } else if bomb_planted {
            last_bomb
                .as_ref()
                .filter(|bomb| bomb.status == "planted")
                .cloned()
        } else if let Some(carrier) = players.iter().find(|player| player.has_bomb) {
            let bomb = BombState {
                x: carrier.x,
                y: carrier.y,
                z: carrier.z,
                status: "carried".into(),
                carrier: Some(carrier.id),
            };
            last_bomb = Some(bomb.clone());
            Some(bomb)
        } else if let Some(c4) = exact_c4 {
            let dropped = BombState {
                x: c4.x,
                y: c4.y,
                z: c4.z,
                status: "dropped".into(),
                carrier: None,
            };
            last_bomb = Some(dropped.clone());
            Some(dropped)
        } else if let Some(bomb) = last_bomb.clone() {
            if bomb.status == "carried" || bomb.status == "dropped" {
                let dropped = BombState {
                    status: "dropped".into(),
                    carrier: None,
                    ..bomb
                };
                last_bomb = Some(dropped.clone());
                Some(dropped)
            } else {
                None
            }
        } else {
            None
        };
        frames.push(Frame {
            t,
            players,
            bomb,
            projectiles: Vec::new(),
        });
    }

    if frames.is_empty() {
        return None;
    }
    if frames[0].t > 0.05 {
        let first = Frame {
            t: 0.0,
            players: frames[0].players.clone(),
            bomb: frames[0].bomb.clone(),
            projectiles: Vec::new(),
        };
        frames.insert(0, first);
    }

    let projectile_frames = if ctx.args.skip_projectiles {
        Vec::new()
    } else {
        ctx.projectiles_by_tick
            .range(span.start..=span.end)
            .filter_map(|(tick, projectiles)| {
                if projectiles.is_empty() {
                    return None;
                }
                Some(ProjectileFrame {
                    t: seconds_since(span.start, *tick),
                    projectiles: projectiles.clone(),
                })
            })
            .collect::<Vec<_>>()
    };

    let mut effects = round_effects(ctx.events, span, ctx.rows_by_tick);
    adjust_decoy_effects_from_projectiles(&mut effects, &projectile_frames);
    add_missing_terminal_flash_effects(&mut effects, &projectile_frames, span, ctx.rows_by_tick);

    Some(Round {
        number: output_number,
        start_tick: span.start,
        freeze_end_tick: span.start,
        end_tick: span.end,
        duration: seconds_since(span.start, span.end),
        winner: span.winner.clone(),
        score_a: ctx
            .round_scores
            .get(span_idx)
            .map(|score| score.0)
            .unwrap_or_default(),
        score_b: ctx
            .round_scores
            .get(span_idx)
            .map(|score| score.1)
            .unwrap_or_default(),
        events: round_events(ctx.events, span, ctx.spans.get(span_idx + 1)),
        damages: round_damages(ctx.events, span),
        disconnects: round_disconnects(ctx.events, span),
        flashes,
        purchases: round_purchases(
            ctx.events,
            span,
            span_idx.checked_sub(1).and_then(|idx| ctx.spans.get(idx)),
        ),
        effects,
        weapon_fires: if ctx.args.skip_weapon_fires {
            Vec::new()
        } else {
            round_weapon_fires(ctx.events, span, ctx.rows_by_tick)
        },
        bullet_impacts: round_bullet_impacts(ctx.events, span),
        projectile_frames,
        frames,
    })
}

fn playable_span(events: &[Value], span: &RoundSpan) -> RoundSpan {
    let duration = seconds_since(span.start, span.end);
    if duration < 170.0 {
        return span.clone();
    }
    let first_action = events
        .iter()
        .filter_map(|event| {
            let tick = get_i64(event, "tick")? as i32;
            if tick <= span.start || tick >= span.end {
                return None;
            }
            let name = get_str(event, "event_name").unwrap_or("");
            let weapon = get_str(event, "weapon").unwrap_or("");
            let real_weapon = !weapon.is_empty() && weapon != "world" && !is_knife_or_bomb(weapon);
            let is_action = (name == "weapon_fire" && real_weapon)
                || name == "bomb_planted"
                || (name == "player_death" && real_weapon);
            if is_action {
                Some(tick)
            } else {
                None
            }
        })
        .min();
    let Some(tick) = first_action else {
        return span.clone();
    };
    if seconds_since(span.start, tick) < 90.0 {
        return span.clone();
    }
    RoundSpan {
        start: (tick - 15 * TICK_RATE as i32).max(span.start),
        end: span.end,
        round_end: span.round_end,
        winner: span.winner.clone(),
    }
}

fn looks_like_knife_round(round: Option<&Round>) -> bool {
    let Some(round) = round else {
        return false;
    };
    if round.duration > 95.0 {
        return false;
    }
    let weapons = round
        .events
        .iter()
        .filter_map(|event| event.weapon.as_deref())
        .chain(
            round
                .frames
                .iter()
                .flat_map(|frame| &frame.players)
                .flat_map(|player| {
                    std::iter::once(player.active.as_str())
                        .chain(player.weapons.iter().map(String::as_str))
                }),
        );
    let mut seen_weapon = false;
    for weapon in weapons.filter(|weapon| !weapon.is_empty()) {
        seen_weapon = true;
        if !is_knife_or_bomb(weapon) {
            return false;
        }
    }
    seen_weapon
}

fn is_knife_or_bomb(weapon: &str) -> bool {
    let lower = weapon.to_ascii_lowercase();
    lower.contains("knife")
        || lower.contains("bayonet")
        || lower.contains("karambit")
        || weapon_is_bomb(weapon)
}

fn weapon_is_bomb(weapon: &str) -> bool {
    let lower = weapon.to_ascii_lowercase();
    lower.contains("c4")
        || lower.contains("bomb")
        || lower.contains("weapon_c4")
        || lower.contains("planted_c4")
        || lower == "c4"
        || lower == "bomb"
}

fn is_utility_action_weapon(weapon: &str) -> bool {
    let lower = weapon.to_ascii_lowercase();
    if lower.is_empty()
        || weapon_is_bomb(weapon)
        || lower.contains("knife")
        || lower.contains("bayonet")
        || lower.contains("karambit")
    {
        return false;
    }
    lower.contains("grenade")
        || lower.contains("flashbang")
        || lower.contains("molotov")
        || lower.contains("incendiary")
        || lower.contains("decoy")
}

fn action_pressed(row: &TickRow) -> bool {
    row.fire || row.right_click
}

fn parse_args() -> Result<Args> {
    parse_args_from(std::env::args().skip(1))
}

fn parse_args_from<I, S>(args: I) -> Result<Args>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out = Args {
        quality: "full".into(),
        ..Args::default()
    };
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_ref() {
            "-in" => {
                out.input = it
                    .next()
                    .ok_or_else(|| anyhow!("-in needs a value"))?
                    .as_ref()
                    .to_string()
            }
            "-out" => {
                out.output = it
                    .next()
                    .ok_or_else(|| anyhow!("-out needs a value"))?
                    .as_ref()
                    .to_string()
            }
            "-quality" => {
                out.quality = it
                    .next()
                    .ok_or_else(|| anyhow!("-quality needs a value"))?
                    .as_ref()
                    .to_ascii_lowercase()
            }
            "-stats" => out.stats = true,
            "-skipProjectiles" => out.skip_projectiles = true,
            "-skipWeaponFires" => out.skip_weapon_fires = true,
            _ => bail!("unknown argument: {}", arg.as_ref()),
        }
    }
    if out.input.is_empty() || out.output.is_empty() {
        bail!("usage: parser -in demo.dem[.zst] -out out.json.gz [-quality full|high|medium|low]");
    }
    if !matches!(out.quality.as_str(), "full" | "high" | "medium" | "low") {
        bail!(
            "invalid -quality {}, expected full|high|medium|low",
            out.quality
        );
    }
    Ok(out)
}

#[cfg_attr(not(test), allow(dead_code))]
fn collect_output_stats(stats: &mut ParserStats, output: &Output) {
    stats.players = output.players.len();
    for round in &output.rounds {
        add_round_stats(stats, round);
    }
}

fn add_round_stats(stats: &mut ParserStats, round: &Round) {
    stats.rounds += 1;
    stats.frames += round.frames.len();
    stats.events += round.events.len();
    stats.effects += round.effects.len();
    stats.weapon_fires += round.weapon_fires.len();
    stats.projectile_frames += round.projectile_frames.len();
    for frame in &round.frames {
        stats.frame_players += frame.players.len();
    }
    for projectile_frame in &round.projectile_frames {
        stats.projectile_samples += projectile_frame.projectiles.len();
    }
    for event in &round.events {
        match event.kind.as_str() {
            "kill" => stats.kills += 1,
            "bomb_planted" | "bomb_defuse_start" | "bomb_defuse_abort" | "bomb_defused"
            | "bomb_exploded" => stats.bomb_events += 1,
            _ => {}
        }
    }
}

/// Maximum allowed size, both for the raw input file and for the decompressed
/// payload. 1 GB is well above any legitimate CS2 demo and tight enough to
/// reject zstd bombs before they exhaust RAM.
const MAX_DEMO_SIZE: u64 = 1024 * 1024 * 1024;

#[cfg(not(target_arch = "wasm32"))]
fn read_demo(path: &str) -> Result<Vec<u8>> {
    // Check file size BEFORE reading to avoid allocating multi-GB buffers
    // for plain .dem files or for the compressed payload of a .dem.zst.
    let metadata = fs::metadata(path).with_context(|| format!("stat {path}"))?;
    if metadata.len() > MAX_DEMO_SIZE {
        bail!(
            "demo file too large: {} bytes > {} bytes limit",
            metadata.len(),
            MAX_DEMO_SIZE
        );
    }

    let file = fs::File::open(path).with_context(|| format!("open {path}"))?;
    let mut reader = BufReader::new(file);

    // Peek the first 4 bytes to detect zstd without committing to a full read.
    let mut magic = [0u8; 4];
    let peeked = read_up_to(&mut reader, &mut magic)?;
    let is_zst = (peeked == 4 && magic == ZSTD_MAGIC) || path.to_lowercase().ends_with(".zst");

    if !is_zst {
        // Plain .dem: read into memory, capped at MAX_DEMO_SIZE. metadata.len()
        // already enforced the cap above, but this keeps the contract local.
        let mut buf = Vec::with_capacity(metadata.len() as usize + peeked);
        buf.extend_from_slice(&magic[..peeked]);
        read_capped(&mut reader, &mut buf, MAX_DEMO_SIZE).context("read demo")?;
        return Ok(buf);
    }

    // .dem.zst: decompress streaming, abort the moment we exceed MAX_DEMO_SIZE.
    // zstd::stream::Decoder wraps a Read source, so we stitch the peeked magic
    // back in front via `Chain` and feed that to the decoder.
    let stitched = std::io::Cursor::new(magic[..peeked].to_vec()).chain(reader);
    let mut decoder = zstd::stream::Decoder::new(stitched).context("zstd init")?;
    let mut decoded = Vec::new();
    read_capped(&mut decoder, &mut decoded, MAX_DEMO_SIZE)
        .context("decompress zstd demo (streaming, capped)")?;
    Ok(decoded)
}

#[cfg(target_arch = "wasm32")]
fn read_demo(path: &str) -> Result<Vec<u8>> {
    bail!("filesystem demo reads are not available in the WASM parser: {path}");
}

/// Read up to buf.len() bytes from `r`. Returns the number of bytes actually
/// read (may be less than buf.len() if EOF was hit). Unlike `Read::read`, it
/// keeps pulling until either `buf` is full or EOF.
fn read_up_to<R: Read>(r: &mut R, buf: &mut [u8]) -> Result<usize> {
    let mut off = 0;
    while off < buf.len() {
        match r.read(&mut buf[off..]) {
            Ok(0) => break,
            Ok(n) => off += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(off)
}

/// Stream-copy from `r` into `out`, refusing to push past `cap` bytes total
/// (counting whatever `out` already contains). Returns Err the moment a chunk
/// would push us over the cap, so a zstd bomb cannot allocate beyond the cap
/// + one chunk size.
fn read_capped<R: Read>(r: &mut R, out: &mut Vec<u8>, cap: u64) -> Result<()> {
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let n = match r.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.into()),
        };
        if (out.len() as u64).saturating_add(n as u64) > cap {
            bail!(
                "decompressed demo exceeds {} bytes limit (already produced {} bytes; refusing to allocate more)",
                cap,
                out.len()
            );
        }
        out.extend_from_slice(&chunk[..n]);
    }
}

fn settings<'a>(
    huf: &'a Vec<(u8, u8)>,
    events: Vec<String>,
    player_props: Vec<String>,
    other_props: Vec<String>,
    ticks: Vec<i32>,
    parse_ents: bool,
) -> Result<ParserInputs<'a>> {
    let real_player = rm_user_friendly_names(&player_props).map_err(|e| anyhow!("{e}"))?;
    let real_other = rm_user_friendly_names(&other_props).map_err(|e| anyhow!("{e}"))?;
    let mut names = AHashMap::default();
    for (real, friendly) in real_player.iter().zip(&player_props) {
        names.insert(real.clone(), friendly.clone());
    }
    for (real, friendly) in real_other.iter().zip(&other_props) {
        names.insert(real.clone(), friendly.clone());
    }

    Ok(ParserInputs {
        real_name_to_og_name: names,
        wanted_players: vec![],
        wanted_player_props: real_player,
        wanted_other_props: real_other,
        wanted_events: events,
        wanted_prop_states: AHashMap::<String, Variant>::default(),
        parse_ents,
        wanted_ticks: ticks,
        parse_projectiles: false,
        parse_grenades: false,
        only_header: true,
        list_props: false,
        only_convars: false,
        huffman_lookup_table: huf,
        order_by_steamid: false,
        fallback_bytes: None,
    })
}

fn parse_header(bytes: &[u8], huf: &Vec<(u8, u8)>) -> Result<HashMap<String, String>> {
    let settings = settings(huf, vec![], vec![], vec![], vec![], false)?;
    let mut parser = FirstPassParser::new(&settings);
    Ok(parser
        .parse_header_only(bytes)
        .map_err(|e| anyhow!("{e}"))?
        .into_iter()
        .collect())
}

fn parse_players(bytes: &[u8], huf: &Vec<(u8, u8)>) -> Result<Vec<Player>> {
    let settings = settings(huf, vec![], vec![], vec![], vec![], false)?;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let mut seen = HashSet::new();
    let mut players = Vec::new();
    for raw in serde_json::to_value(output.player_md)?
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        let steam_id = get_u64(&raw, "steamid").unwrap_or_default();
        if steam_id == 0 || !seen.insert(steam_id) {
            continue;
        }
        let team_num = get_i64(&raw, "team_number").unwrap_or_default();
        players.push(Player {
            steam_id,
            name: get_str(&raw, "name").unwrap_or("").to_string(),
            team: team_name(team_num).to_string(),
        });
    }
    Ok(players)
}

fn parse_events(bytes: &[u8], huf: &Vec<(u8, u8)>) -> Result<Vec<Value>> {
    let settings = settings(
        huf,
        vec![
            "round_start".into(),
            "round_freeze_end".into(),
            "round_end".into(),
            "round_officially_ended".into(),
            "player_death".into(),
            "player_hurt".into(),
            "player_disconnect".into(),
            "bomb_beginplant".into(),
            "bomb_planted".into(),
            "bomb_dropped".into(),
            "bomb_pickup".into(),
            "bomb_begindefuse".into(),
            "bomb_abortdefuse".into(),
            "bomb_defused".into(),
            "bomb_exploded".into(),
            "player_blind".into(),
            "weapon_fire".into(),
            "bullet_impact".into(),
            "item_purchase".into(),
            "item_sold".into(),
            "flashbang_detonate".into(),
            "hegrenade_detonate".into(),
            "smokegrenade_detonate".into(),
            "smokegrenade_expired".into(),
            "inferno_startburn".into(),
            "inferno_expire".into(),
            "molotov_detonate".into(),
            "decoy_detonate".into(),
        ],
        vec!["X".into(), "Y".into(), "team_num".into()],
        vec!["total_rounds_played".into(), "round_win_reason".into()],
        vec![],
        true,
    )?;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let mut events = serde_json::to_value(output.game_events)?
        .as_array()
        .cloned()
        .unwrap_or_default();
    events.sort_by_key(|e| get_i64(e, "tick").unwrap_or_default());
    Ok(events)
}

fn parse_ticks(bytes: &[u8], huf: &Vec<(u8, u8)>, ticks: Vec<i32>) -> Result<TickData> {
    let settings = settings(
        huf,
        vec![],
        vec![
            "X".into(),
            "Y".into(),
            "Z".into(),
            "yaw".into(),
            "pitch".into(),
            "velocity".into(),
            "velocity_X".into(),
            "velocity_Y".into(),
            "velocity_Z".into(),
            "is_airborne".into(),
            "is_walking".into(),
            "duck_amount".into(),
            "health".into(),
            "armor_value".into(),
            "balance".into(),
            "current_equip_value".into(),
            "has_helmet".into(),
            "has_defuser".into(),
            "is_alive".into(),
            "team_num".into(),
            "active_weapon_name".into(),
            "inventory".into(),
            "FIRE".into(),
            "RIGHTCLICK".into(),
            "USE".into(),
        ],
        vec![],
        ticks,
        true,
    )?;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let c4_positions = output
        .c4_records
        .into_iter()
        .filter_map(|record| {
            Some(C4Pos {
                tick: record.tick?,
                x: f64::from(record.x?),
                y: f64::from(record.y?),
                z: f64::from(record.z?),
            })
        })
        .collect();
    let helper = OutputSerdeHelperStruct {
        prop_infos: output.prop_controller.prop_infos,
        inner: output.df.into_iter().collect(),
    };
    let (rows, weapon_names) = tick_rows_from_helper(&helper);
    Ok(TickData {
        rows,
        c4_positions,
        weapon_names,
    })
}

fn tick_rows_from_helper(helper: &OutputSerdeHelperStruct) -> (Vec<TickRow>, Vec<String>) {
    let row_count = helper
        .inner
        .values()
        .next()
        .map(PropColumn::len)
        .unwrap_or_default();
    let mut rows = Vec::with_capacity(row_count);
    let mut weapon_ids = HashMap::new();
    let mut weapon_names = Vec::new();
    for idx in 0..row_count {
        let Some(tick) = helper_i64(helper, "tick", idx).map(|tick| tick as i32) else {
            continue;
        };
        let Some(steamid) = helper_u64(helper, "steamid", idx) else {
            continue;
        };
        let active = helper_str(helper, "active_weapon_name", idx)
            .filter(|name| !name.is_empty())
            .and_then(|name| intern_weapon_name(name, &mut weapon_ids, &mut weapon_names));
        let weapons = helper_string_vec(helper, "inventory", idx)
            .unwrap_or_default()
            .into_iter()
            .filter(|name| !name.is_empty())
            .filter_map(|name| intern_weapon_name(&name, &mut weapon_ids, &mut weapon_names))
            .collect();
        rows.push(TickRow {
            tick,
            steamid,
            x: helper_f64(helper, "X", idx).unwrap_or_default(),
            y: helper_f64(helper, "Y", idx).unwrap_or_default(),
            z: helper_f64(helper, "Z", idx).unwrap_or_default(),
            yaw: helper_f64(helper, "yaw", idx).unwrap_or_default(),
            pitch: helper_f64(helper, "pitch", idx),
            speed: helper_f64(helper, "velocity", idx),
            velocity_x: helper_f64(helper, "velocity_X", idx),
            velocity_y: helper_f64(helper, "velocity_Y", idx),
            velocity_z: helper_f64(helper, "velocity_Z", idx),
            airborne: helper_bool(helper, "is_airborne", idx),
            walking: helper_bool(helper, "is_walking", idx),
            duck_amount: helper_f64(helper, "duck_amount", idx),
            hp: helper_i64(helper, "health", idx).unwrap_or_default(),
            armor: helper_i64(helper, "armor_value", idx).unwrap_or_default(),
            money: helper_i64(helper, "balance", idx),
            equipment_value: helper_i64(helper, "current_equip_value", idx),
            helmet: helper_bool(helper, "has_helmet", idx).unwrap_or(false),
            kit: helper_bool(helper, "has_defuser", idx).unwrap_or(false),
            alive: helper_bool(helper, "is_alive", idx).unwrap_or(false),
            team: helper_i64(helper, "team_num", idx).unwrap_or_default(),
            active,
            weapons,
            fire: helper_bool(helper, "FIRE", idx).unwrap_or(false),
            right_click: helper_bool(helper, "RIGHTCLICK", idx).unwrap_or(false),
            use_key: helper_bool(helper, "USE", idx).unwrap_or(false),
        });
    }
    (rows, weapon_names)
}

fn intern_weapon_name(
    name: &str,
    ids: &mut HashMap<String, u16>,
    names: &mut Vec<String>,
) -> Option<u16> {
    if let Some(id) = ids.get(name) {
        return Some(*id);
    }
    let id = u16::try_from(names.len()).ok()?;
    ids.insert(name.to_string(), id);
    names.push(name.to_string());
    Some(id)
}

fn parse_team_rows(bytes: &[u8], huf: &Vec<(u8, u8)>, ticks: Vec<i32>) -> Result<Vec<Value>> {
    let settings = settings(
        huf,
        vec![],
        vec![],
        vec![
            "team_name".into(),
            "team_clan_name".into(),
            "team_rounds_total".into(),
        ],
        ticks,
        true,
    )?;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let helper = OutputSerdeHelperStruct {
        prop_infos: output.prop_controller.prop_infos,
        inner: output.df.into_iter().collect(),
    };
    Ok(soa_to_aos(helper)
        .into_iter()
        .map(|row| serde_json::to_value(row).unwrap_or(Value::Null))
        .collect())
}

fn parse_projectiles(bytes: &[u8], huf: &Vec<(u8, u8)>) -> Result<Vec<ProjectileRow>> {
    let mut settings = settings(huf, vec![], vec![], vec![], vec![], true)?;
    settings.parse_projectiles = true;
    settings.parse_grenades = true;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let helper = OutputSerdeHelperStruct {
        prop_infos: output.prop_controller.prop_infos,
        inner: output.df.into_iter().collect(),
    };
    Ok(projectile_rows_from_helper(&helper))
}

fn projectile_rows_from_helper(helper: &OutputSerdeHelperStruct) -> Vec<ProjectileRow> {
    let row_count = helper
        .inner
        .values()
        .next()
        .map(PropColumn::len)
        .unwrap_or_default();
    let mut rows = Vec::with_capacity(row_count);
    for idx in 0..row_count {
        let Some(tick) = helper_i64(helper, "tick", idx).map(|tick| tick as i32) else {
            continue;
        };
        let Some(x) = helper_f64(helper, "x", idx) else {
            continue;
        };
        let Some(y) = helper_f64(helper, "y", idx) else {
            continue;
        };
        let Some(z) = helper_f64(helper, "z", idx) else {
            continue;
        };
        rows.push(ProjectileRow {
            tick,
            entity_id: helper_i64(helper, "entity_id", idx).unwrap_or(i64::from(tick)),
            kind: ProjectileKind::from_name(
                helper_str(helper, "grenade_type", idx).unwrap_or("grenade"),
            ),
            x,
            y,
            z,
            thrower: helper_u64(helper, "steamid", idx),
        });
    }
    rows
}

fn round_spans(events: &[Value]) -> Vec<RoundSpan> {
    let starts = events
        .iter()
        .filter_map(|e| {
            let name = get_str(e, "event_name")?;
            if name != "round_freeze_end" && name != "round_start" {
                return None;
            }
            let tick = get_i64(e, "tick")? as i32;
            Some((tick, name == "round_freeze_end"))
        })
        .filter(|(t, _)| *t > 0)
        .collect::<Vec<_>>();
    let mut starts = starts;
    starts.sort_unstable_by_key(|(tick, freeze_end)| (*tick, !*freeze_end));
    let starts = starts
        .into_iter()
        .fold(Vec::<(i32, bool)>::new(), |mut acc, item| {
            if acc.last().is_some_and(|last| last.0 == item.0) {
                if item.1 {
                    acc.pop();
                    acc.push(item);
                }
            } else {
                acc.push(item);
            }
            acc
        });
    let ends = events
        .iter()
        .filter(|e| get_str(e, "event_name") == Some("round_end"))
        .filter_map(|e| {
            let tick = get_i64(e, "tick")? as i32;
            if tick <= 0 {
                return None;
            }
            Some((tick, get_str(e, "winner").unwrap_or("").to_string()))
        })
        .collect::<Vec<_>>();
    let officials = events
        .iter()
        .filter(|e| get_str(e, "event_name") == Some("round_officially_ended"))
        .filter_map(|e| get_i64(e, "tick").map(|t| t as i32))
        .filter(|t| *t > 0)
        .collect::<Vec<_>>();

    let mut spans = Vec::new();
    let mut prev_end = 0;
    for (end, winner) in ends {
        let selected = starts
            .iter()
            .rev()
            .find(|(tick, freeze_end)| *freeze_end && *tick > prev_end && *tick < end)
            .or_else(|| {
                starts
                    .iter()
                    .rev()
                    .find(|(tick, _)| *tick > prev_end && *tick < end)
            });
        let Some((start, _)) = selected else {
            prev_end = end;
            continue;
        };
        let official_end = officials
            .iter()
            .find(|tick| **tick >= end && **tick <= end + (TICK_RATE as i32 * 10))
            .copied()
            .unwrap_or(end);
        spans.push(RoundSpan {
            start: *start,
            end: official_end,
            round_end: end,
            winner,
        });
        prev_end = official_end;
    }
    spans
}

fn sample_step(quality: &str) -> i32 {
    match quality.to_ascii_lowercase().as_str() {
        "low" => 64,
        "medium" | "med" => 32,
        "high" => 16,
        _ => 1,
    }
}

fn sample_ticks(spans: &[RoundSpan], step: i32, events: &[Value]) -> Vec<i32> {
    let mut ticks = Vec::new();
    for span in spans {
        let mut tick = span.start;
        while tick <= span.end {
            ticks.push(tick);
            tick += step;
        }
        ticks.push(span.end);
    }
    for event in events {
        if matches!(
            get_str(event, "event_name").unwrap_or(""),
            "weapon_fire"
                | "round_freeze_end"
                | "bomb_beginplant"
                | "bomb_planted"
                | "bomb_dropped"
                | "bomb_pickup"
                | "bomb_begindefuse"
                | "bomb_abortdefuse"
                | "bomb_defused"
                | "bomb_exploded"
        ) {
            if let Some(tick) = get_i64(event, "tick") {
                ticks.push(tick as i32);
            }
        }
    }
    ticks.sort_unstable();
    ticks.dedup();
    ticks
}

fn team_name_ticks(spans: &[RoundSpan]) -> Vec<i32> {
    let mut ticks = Vec::new();
    for span in spans {
        ticks.push(span.start);
        ticks.push(span.start + TICK_RATE as i32);
        ticks.push(span.end);
        ticks.push(span.round_end);
    }
    if let Some(last) = spans.last() {
        ticks.push(last.end);
    }
    ticks.sort_unstable();
    ticks.dedup();
    ticks
}

fn team_names_from_rows(rows: &[Value]) -> (String, String) {
    let mut ct = None;
    let mut t = None;
    for row in rows {
        let side = get_str(row, "team_name").unwrap_or("").trim();
        let clan = get_str(row, "team_clan_name").unwrap_or("").trim();
        if clan.is_empty()
            || matches!(
                clan,
                "CT" | "T" | "TERRORIST" | "Counter-Terrorists" | "Terrorists"
            )
        {
            continue;
        }
        match side {
            "CT" if ct.is_none() => ct = Some(clan.to_string()),
            "TERRORIST" | "T" if t.is_none() => t = Some(clan.to_string()),
            _ => {}
        }
    }
    (
        ct.unwrap_or_else(|| "CT".into()),
        t.unwrap_or_else(|| "T".into()),
    )
}

fn round_scores_from_team_rows(
    rows: &[Value],
    spans: &[RoundSpan],
    team_a: &str,
    team_b: &str,
) -> Vec<(i32, i32)> {
    let mut out = Vec::with_capacity(spans.len());
    let mut last = (0, 0);
    for span in spans {
        if let Some(score) = team_scores_at_tick(rows, span.round_end, team_a, team_b) {
            last = score;
        }
        out.push(last);
    }
    out
}

fn team_scores_at_tick(
    rows: &[Value],
    target_tick: i32,
    team_a: &str,
    team_b: &str,
) -> Option<(i32, i32)> {
    let mut score_a = None;
    let mut score_b = None;
    for row in rows {
        let tick = get_i64(row, "tick").unwrap_or_default() as i32;
        if tick > target_tick {
            continue;
        }
        let clan = get_str(row, "team_clan_name").unwrap_or("").trim();
        let Some(score) = get_i64(row, "team_rounds_total").map(|score| score as i32) else {
            continue;
        };
        if clan == team_a {
            score_a = Some(score);
        } else if clan == team_b {
            score_b = Some(score);
        }
    }
    match (score_a, score_b) {
        (Some(a), Some(b)) => Some((a, b)),
        _ => None,
    }
}

fn helper_column<'a>(helper: &'a OutputSerdeHelperStruct, name: &str) -> Option<&'a PropColumn> {
    let prop = helper
        .prop_infos
        .iter()
        .find(|prop| prop.prop_friendly_name == name)?;
    helper.inner.get(&prop.id)
}

fn helper_i64(helper: &OutputSerdeHelperStruct, name: &str, idx: usize) -> Option<i64> {
    match helper_column(helper, name)?.data.as_ref()? {
        VarVec::I32(values) => values.get(idx).copied().flatten().map(i64::from),
        VarVec::U32(values) => values.get(idx).copied().flatten().map(i64::from),
        VarVec::U64(values) => values
            .get(idx)
            .copied()
            .flatten()
            .and_then(|value| i64::try_from(value).ok()),
        VarVec::F32(values) => values.get(idx).copied().flatten().map(|value| value as i64),
        VarVec::String(values) => values.get(idx)?.as_deref()?.parse::<i64>().ok(),
        _ => None,
    }
}

fn helper_u64(helper: &OutputSerdeHelperStruct, name: &str, idx: usize) -> Option<u64> {
    match helper_column(helper, name)?.data.as_ref()? {
        VarVec::U64(values) => values.get(idx).copied().flatten(),
        VarVec::U32(values) => values.get(idx).copied().flatten().map(u64::from),
        VarVec::I32(values) => values
            .get(idx)
            .copied()
            .flatten()
            .and_then(|value| u64::try_from(value).ok()),
        VarVec::String(values) => values.get(idx)?.as_deref()?.parse::<u64>().ok(),
        _ => None,
    }
}

fn helper_f64(helper: &OutputSerdeHelperStruct, name: &str, idx: usize) -> Option<f64> {
    match helper_column(helper, name)?.data.as_ref()? {
        VarVec::F32(values) => values.get(idx).copied().flatten().map(f64::from),
        VarVec::I32(values) => values.get(idx).copied().flatten().map(f64::from),
        VarVec::U32(values) => values.get(idx).copied().flatten().map(f64::from),
        VarVec::U64(values) => values.get(idx).copied().flatten().map(|value| value as f64),
        VarVec::String(values) => values.get(idx)?.as_deref()?.parse::<f64>().ok(),
        _ => None,
    }
}

fn helper_bool(helper: &OutputSerdeHelperStruct, name: &str, idx: usize) -> Option<bool> {
    match helper_column(helper, name)?.data.as_ref()? {
        VarVec::Bool(values) => values.get(idx).copied().flatten(),
        VarVec::I32(values) => values.get(idx).copied().flatten().map(|value| value != 0),
        VarVec::U32(values) => values.get(idx).copied().flatten().map(|value| value != 0),
        VarVec::U64(values) => values.get(idx).copied().flatten().map(|value| value != 0),
        VarVec::String(values) => values.get(idx)?.as_deref()?.parse::<bool>().ok(),
        _ => None,
    }
}

fn helper_str<'a>(helper: &'a OutputSerdeHelperStruct, name: &str, idx: usize) -> Option<&'a str> {
    match helper_column(helper, name)?.data.as_ref()? {
        VarVec::String(values) => values.get(idx)?.as_deref(),
        _ => None,
    }
}

fn helper_string_vec(
    helper: &OutputSerdeHelperStruct,
    name: &str,
    idx: usize,
) -> Option<Vec<String>> {
    match helper_column(helper, name)?.data.as_ref()? {
        VarVec::StringVec(values) => values.get(idx).cloned(),
        _ => None,
    }
}

fn group_tick_rows(rows: Vec<TickRow>) -> BTreeMap<i32, Vec<TickRow>> {
    let mut out: BTreeMap<i32, Vec<TickRow>> = BTreeMap::new();
    for row in rows {
        out.entry(row.tick).or_default().push(row);
    }
    out
}

fn group_c4_positions(records: Vec<C4Pos>) -> BTreeMap<i32, C4Pos> {
    let mut out = BTreeMap::new();
    for record in records {
        out.insert(record.tick, record);
    }
    out
}

fn group_projectile_rows(rows: Vec<ProjectileRow>) -> BTreeMap<i32, Vec<ProjectilePos>> {
    #[derive(Clone)]
    struct Track {
        id: i64,
        kind: ProjectileKind,
        thrower: Option<u64>,
        x: f64,
        y: f64,
        z: f64,
        last_tick: i32,
    }

    fn dist2(a: &ProjectilePos, b: &Track) -> f64 {
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        dx * dx + dy * dy + dz * dz
    }

    let mut by_tick: BTreeMap<i32, Vec<ProjectilePos>> = BTreeMap::new();
    for row in rows {
        by_tick.entry(row.tick).or_default().push(ProjectilePos {
            id: row.entity_id,
            kind: row.kind,
            x: row.x,
            y: row.y,
            z: row.z,
            thrower: row.thrower,
        });
    }

    let mut out: BTreeMap<i32, Vec<ProjectilePos>> = BTreeMap::new();
    let mut tracks: Vec<Track> = Vec::new();
    let mut next_id = 1_000_000_000_i64;

    for (tick, projectiles) in by_tick {
        let mut used_tracks = HashSet::new();
        let mut frame_projectiles: Vec<ProjectilePos> = Vec::new();

        for projectile in projectiles {
            // demoparser2 can emit multiple rows with the same transient
            // entity id in one tick. The visual identity is type + thrower +
            // continuity, not entity_id.
            if frame_projectiles.iter().any(|existing| {
                existing.kind == projectile.kind && existing.thrower == projectile.thrower && {
                    let dx = existing.x - projectile.x;
                    let dy = existing.y - projectile.y;
                    let dz = existing.z - projectile.z;
                    dx * dx + dy * dy + dz * dz < 6.0 * 6.0
                }
            }) {
                continue;
            }

            let mut best_idx = None;
            let mut best_dist = f64::INFINITY;
            for (idx, track) in tracks.iter().enumerate() {
                if used_tracks.contains(&idx) {
                    continue;
                }
                if track.kind != projectile.kind || track.thrower != projectile.thrower {
                    continue;
                }
                let tick_gap = tick - track.last_tick;
                if tick_gap <= 0 || tick_gap > 24 {
                    continue;
                }
                let max_dist = (f64::from(tick_gap) / TICK_RATE * 2400.0).max(128.0);
                let d = dist2(&projectile, track);
                if d <= max_dist * max_dist && d < best_dist {
                    best_dist = d;
                    best_idx = Some(idx);
                }
            }

            let stable_id = if let Some(idx) = best_idx {
                used_tracks.insert(idx);
                tracks[idx].x = projectile.x;
                tracks[idx].y = projectile.y;
                tracks[idx].z = projectile.z;
                tracks[idx].last_tick = tick;
                tracks[idx].id
            } else {
                let id = next_id;
                next_id += 1;
                tracks.push(Track {
                    id,
                    kind: projectile.kind.clone(),
                    thrower: projectile.thrower,
                    x: projectile.x,
                    y: projectile.y,
                    z: projectile.z,
                    last_tick: tick,
                });
                id
            };

            frame_projectiles.push(ProjectilePos {
                id: stable_id,
                ..projectile
            });
        }

        tracks.retain(|track| tick - track.last_tick <= 24);
        if !frame_projectiles.is_empty() {
            out.insert(tick, frame_projectiles);
        }
    }

    out
}

fn player_pos_from_row(
    row: &TickRow,
    weapon_names: &[String],
    blind_spans: &[BlindSpan],
    t: f64,
    active_action: Option<ActiveAction>,
) -> Option<PlayerPos> {
    if !row.alive {
        return None;
    }
    let id = row.steamid;
    let blind = blind_spans
        .iter()
        .find(|b| b.player == id && t >= b.start && t <= b.end);
    let active = weapon_name(weapon_names, row.active);
    let has_bomb = weapon_is_bomb(active)
        || row
            .weapons
            .iter()
            .filter_map(|id| weapon_names.get(*id as usize))
            .any(|weapon| weapon_is_bomb(weapon));
    Some(PlayerPos {
        id,
        x: row.x,
        y: row.y,
        z: row.z,
        yaw: row.yaw,
        pitch: row.pitch,
        speed: row.speed,
        velocity_x: row.velocity_x,
        velocity_y: row.velocity_y,
        velocity_z: row.velocity_z,
        airborne: row.airborne,
        walking: row.walking,
        duck_amount: row.duck_amount,
        hp: row.hp,
        armor: row.armor,
        money: row.money,
        equipment_value: row.equipment_value,
        helmet: row.helmet,
        kit: row.kit,
        has_bomb,
        team: row.team,
        active: active.to_string(),
        weapons: row
            .weapons
            .iter()
            .filter_map(|id| weapon_names.get(*id as usize).cloned())
            .collect(),
        flash_left: blind.map(|b| (b.end - t).max(0.0)),
        flash_total: blind.map(|b| b.total),
        use_key: row.use_key,
        active_action,
    })
}

fn weapon_name(weapon_names: &[String], id: Option<u16>) -> &str {
    id.and_then(|id| weapon_names.get(id as usize))
        .map(String::as_str)
        .unwrap_or("")
}

fn event_flag(event: &Value, key: &str) -> bool {
    get_bool(event, key).unwrap_or_else(|| get_i64(event, key).unwrap_or_default() != 0)
}

fn kill_details(event: &Value) -> KillDetails {
    KillDetails {
        hs: event_flag(event, "headshot"),
        flash_assist: event_flag(event, "assistedflash"),
        no_scope: event_flag(event, "noscope"),
        through_smoke: event_flag(event, "thrusmoke"),
        attacker_blind: event_flag(event, "attackerblind"),
        penetrated: get_i64(event, "penetrated").unwrap_or_default().max(0),
        dominated: event_flag(event, "dominated"),
        revenge: event_flag(event, "revenge"),
    }
}

fn round_events(events: &[Value], span: &RoundSpan, next_span: Option<&RoundSpan>) -> Vec<Event> {
    let mut out = Vec::new();
    let post_round_event_end = post_round_event_end_tick(span, next_span);
    let has_explicit_bomb_exploded = has_explicit_bomb_exploded(events, span, post_round_event_end);
    let has_bomb_planted = has_bomb_planted(events, span, post_round_event_end);
    let has_post_round_world_kill = has_post_round_world_kill(events, span, post_round_event_end);
    let has_long_post_round_window =
        span.end.saturating_sub(span.round_end) >= TICK_RATE as i32 * 8;
    let mut active_defuser = None;
    for (sequence, event) in events.iter().enumerate() {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        let event_name = get_str(event, "event_name").unwrap_or("");
        if !event_tick_in_round_window(tick, event_name, span, post_round_event_end) {
            continue;
        }
        let t = seconds_since(span.start, tick);
        match event_name {
            "player_death" => out.push(Event {
                t,
                tick,
                sequence,
                kind: "kill".into(),
                player: None,
                has_kit: false,
                killer: get_u64(event, "attacker_steamid"),
                victim: get_u64(event, "user_steamid"),
                assist: get_u64(event, "assister_steamid"),
                weapon: get_str(event, "weapon").map(str::to_string),
                kill: kill_details(event),
                winner: None,
            }),
            "bomb_planted" => out.push(simple_event(t, tick, sequence, "bomb_planted")),
            "bomb_begindefuse" => {
                if let Some(player) = active_defuser {
                    out.push(bomb_defuse_abort_event(t, tick, sequence, Some(player)));
                }
                let player = get_u64(event, "user_steamid");
                out.push(Event {
                    t,
                    tick,
                    sequence,
                    kind: "bomb_defuse_start".into(),
                    player,
                    has_kit: get_bool(event, "haskit").unwrap_or(false),
                    killer: None,
                    victim: None,
                    assist: None,
                    weapon: None,
                    kill: KillDetails::default(),
                    winner: None,
                });
                active_defuser = player;
            }
            "bomb_abortdefuse" => {
                let player = get_u64(event, "user_steamid");
                out.push(bomb_defuse_abort_event(t, tick, sequence, player));
                active_defuser = None;
            }
            "bomb_defused" => {
                out.push(simple_event(t, tick, sequence, "bomb_defused"));
                active_defuser = None;
            }
            "bomb_exploded" => {
                if let Some(player) = active_defuser.take() {
                    out.push(bomb_defuse_abort_event(t, tick, sequence, Some(player)));
                }
                out.push(simple_event(t, tick, sequence, "bomb_exploded"));
            }
            "round_end" => out.push(Event {
                t,
                tick,
                sequence,
                kind: "round_end".into(),
                player: None,
                has_kit: false,
                killer: None,
                victim: None,
                assist: None,
                weapon: None,
                kill: KillDetails::default(),
                winner: Some(span.winner.clone()),
            }),
            _ => {}
        }
        if event_name == "round_end"
            && should_synthesize_bomb_explosion_from_round_end(
                event,
                span,
                has_bomb_planted,
                has_long_post_round_window,
                has_post_round_world_kill,
                next_span.is_none(),
                has_explicit_bomb_exploded,
            )
        {
            if let Some(player) = active_defuser.take() {
                out.push(bomb_defuse_abort_event(t, tick, sequence, Some(player)));
            }
            out.push(simple_event(t, tick, sequence, "bomb_exploded"));
        }
    }
    out
}

fn round_damages(events: &[Value], span: &RoundSpan) -> Vec<DamageEvent> {
    events
        .iter()
        .enumerate()
        .filter_map(|(sequence, event)| {
            if get_str(event, "event_name") != Some("player_hurt") {
                return None;
            }
            let tick = get_i64(event, "tick")? as i32;
            if !event_tick_in_round_window(tick, "player_hurt", span, span.end) {
                return None;
            }
            Some(DamageEvent {
                t: seconds_since(span.start, tick),
                tick,
                sequence,
                attacker: get_u64(event, "attacker_steamid").filter(|id| *id != 0),
                victim: get_u64(event, "user_steamid").filter(|id| *id != 0),
                weapon: get_str(event, "weapon")
                    .filter(|weapon| !weapon.is_empty())
                    .map(str::to_string),
                damage_health: get_i64(event, "dmg_health").unwrap_or_default().max(0),
                damage_armor: get_i64(event, "dmg_armor").unwrap_or_default().max(0),
                health_after: get_i64(event, "health").unwrap_or_default().max(0),
                armor_after: get_i64(event, "armor").unwrap_or_default().max(0),
                hitgroup: get_str(event, "hitgroup")
                    .filter(|hitgroup| !hitgroup.is_empty())
                    .map(str::to_string),
            })
        })
        .collect()
}

fn round_disconnects(events: &[Value], span: &RoundSpan) -> Vec<DisconnectEvent> {
    events
        .iter()
        .enumerate()
        .filter_map(|(sequence, event)| {
            if get_str(event, "event_name") != Some("player_disconnect") {
                return None;
            }
            let tick = get_i64(event, "tick")? as i32;
            if !event_tick_in_round_window(tick, "player_disconnect", span, span.end) {
                return None;
            }
            Some(DisconnectEvent {
                t: seconds_since(span.start, tick),
                tick,
                sequence,
                player: get_u64(event, "user_steamid").filter(|id| *id != 0),
            })
        })
        .collect()
}

fn event_tick_in_round_window(
    tick: i32,
    event_name: &str,
    span: &RoundSpan,
    post_round_event_end: i32,
) -> bool {
    let include_post_round_event = tick > span.end
        && tick <= post_round_event_end
        && matches!(
            event_name,
            "player_death"
                | "bomb_begindefuse"
                | "bomb_abortdefuse"
                | "bomb_defused"
                | "bomb_exploded"
        );
    tick >= span.start && (tick <= span.end || include_post_round_event)
}

fn post_round_event_end_tick(span: &RoundSpan, next_span: Option<&RoundSpan>) -> i32 {
    next_span
        .map(|next| next.start.saturating_sub(1))
        .unwrap_or_else(|| span.end + (10 * TICK_RATE as i32))
        .min(span.end + (10 * TICK_RATE as i32))
}

fn has_explicit_bomb_exploded(
    events: &[Value],
    span: &RoundSpan,
    post_round_event_end: i32,
) -> bool {
    events.iter().any(|event| {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        get_str(event, "event_name") == Some("bomb_exploded")
            && event_tick_in_round_window(tick, "bomb_exploded", span, post_round_event_end)
    })
}

fn has_bomb_planted(events: &[Value], span: &RoundSpan, post_round_event_end: i32) -> bool {
    events.iter().any(|event| {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        get_str(event, "event_name") == Some("bomb_planted")
            && event_tick_in_round_window(tick, "bomb_planted", span, post_round_event_end)
    })
}

fn has_post_round_world_kill(
    events: &[Value],
    span: &RoundSpan,
    post_round_event_end: i32,
) -> bool {
    events.iter().any(|event| {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        get_str(event, "event_name") == Some("player_death")
            && tick > span.round_end
            && event_tick_in_round_window(tick, "player_death", span, post_round_event_end)
            && get_str(event, "weapon").is_some_and(is_world_weapon)
    })
}

fn should_synthesize_bomb_explosion_from_round_end(
    event: &Value,
    span: &RoundSpan,
    has_bomb_planted: bool,
    has_long_post_round_window: bool,
    has_post_round_world_kill: bool,
    is_final_round: bool,
    has_explicit_bomb_exploded: bool,
) -> bool {
    !has_explicit_bomb_exploded
        && (round_end_reason_is_bomb_exploded(event)
            || should_synthesize_ct_killed_bomb_explosion(
                event,
                span,
                has_bomb_planted,
                has_long_post_round_window,
                has_post_round_world_kill,
                is_final_round,
            ))
}

fn round_end_reason_is_bomb_exploded(event: &Value) -> bool {
    get_str(event, "reason") == Some("bomb_exploded") || get_i64(event, "reason") == Some(1)
}

fn round_end_reason_is_ct_killed(event: &Value) -> bool {
    get_str(event, "reason") == Some("ct_killed") || get_i64(event, "round_win_reason") == Some(9)
}

fn should_synthesize_ct_killed_bomb_explosion(
    event: &Value,
    span: &RoundSpan,
    has_bomb_planted: bool,
    has_long_post_round_window: bool,
    has_post_round_world_kill: bool,
    is_final_round: bool,
) -> bool {
    span.winner == "T"
        && has_bomb_planted
        && round_end_reason_is_ct_killed(event)
        && (has_long_post_round_window || has_post_round_world_kill || is_final_round)
}

fn is_world_weapon(weapon: &str) -> bool {
    weapon.eq_ignore_ascii_case("world")
}

fn bomb_defuse_abort_event(t: f64, tick: i32, sequence: usize, player: Option<u64>) -> Event {
    Event {
        t,
        tick,
        sequence,
        kind: "bomb_defuse_abort".into(),
        player,
        has_kit: false,
        killer: None,
        victim: None,
        assist: None,
        weapon: None,
        kill: KillDetails::default(),
        winner: None,
    }
}

fn simple_event(t: f64, tick: i32, sequence: usize, kind: &str) -> Event {
    Event {
        t,
        tick,
        sequence,
        kind: kind.into(),
        player: None,
        has_kit: false,
        killer: None,
        victim: None,
        assist: None,
        weapon: None,
        kill: KillDetails::default(),
        winner: None,
    }
}

fn round_flashes(events: &[Value], span: &RoundSpan) -> Vec<FlashEvent> {
    let mut out = Vec::new();
    for (sequence, event) in events.iter().enumerate() {
        if get_str(event, "event_name") != Some("player_blind") {
            continue;
        }
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        if tick < span.start || tick > span.end {
            continue;
        }
        let duration = get_f64(event, "blind_duration").unwrap_or(0.0);
        if duration <= 0.0 {
            continue;
        }
        out.push(FlashEvent {
            t: seconds_since(span.start, tick),
            tick,
            sequence,
            thrower: get_u64(event, "attacker_steamid").filter(|id| *id != 0),
            victim: get_u64(event, "user_steamid").filter(|id| *id != 0),
            duration,
        });
    }
    out
}

fn blind_spans_from_flashes(flashes: &[FlashEvent]) -> Vec<BlindSpan> {
    flashes
        .iter()
        .filter_map(|flash| {
            let player = flash.victim?;
            Some(BlindSpan {
                player,
                start: flash.t,
                end: flash.t + flash.duration,
                total: flash.duration,
            })
        })
        .collect()
}

fn round_purchases(
    events: &[Value],
    span: &RoundSpan,
    previous_span: Option<&RoundSpan>,
) -> Vec<PurchaseEvent> {
    let lower_bound = previous_span
        .map(|previous| previous.end.saturating_add(1))
        .unwrap_or(0);
    let purchase_start = events
        .iter()
        .filter(|event| get_str(event, "event_name") == Some("round_start"))
        .filter_map(|event| get_i64(event, "tick").map(|tick| tick as i32))
        .filter(|tick| *tick >= lower_bound && *tick <= span.start)
        .max()
        .unwrap_or(span.start);

    events
        .iter()
        .enumerate()
        .filter_map(|(sequence, event)| {
            if get_str(event, "event_name") != Some("item_purchase") {
                return None;
            }
            let tick = get_i64(event, "tick")? as i32;
            if tick < purchase_start || tick > span.end {
                return None;
            }
            let item = get_str(event, "item_name")
                .or_else(|| get_str(event, "weapon"))
                .filter(|item| !item.trim().is_empty())?
                .to_string();
            Some(PurchaseEvent {
                t: seconds_since(span.start, tick),
                tick,
                sequence,
                player: get_u64(event, "steamid")
                    .or_else(|| get_u64(event, "user_steamid"))
                    .filter(|id| *id != 0),
                item,
                cost: get_i64(event, "cost").filter(|cost| *cost >= 0),
                inventory_slot: get_i64(event, "inventory_slot").filter(|slot| *slot >= 0),
                was_sold: get_bool(event, "was_sold"),
            })
        })
        .collect()
}

fn round_effects(
    events: &[Value],
    span: &RoundSpan,
    rows_by_tick: &BTreeMap<i32, Vec<TickRow>>,
) -> Vec<UtilityEffect> {
    let mut out = Vec::new();
    for event in events {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        if tick < span.start || tick > span.end {
            continue;
        }
        let Some(kind) = effect_kind(get_str(event, "event_name").unwrap_or("")) else {
            continue;
        };
        let planter_row = if kind == "bomb_planted" {
            get_u64(event, "user_steamid")
                .and_then(|id| player_row_at_tick(rows_by_tick, tick, id, span.start))
        } else {
            None
        };
        let x = get_f64(event, "x")
            .or_else(|| get_f64(event, "X"))
            .or_else(|| planter_row.map(|row| row.x))
            .unwrap_or_default();
        let y = get_f64(event, "y")
            .or_else(|| get_f64(event, "Y"))
            .or_else(|| planter_row.map(|row| row.y))
            .unwrap_or_default();
        let z = get_f64(event, "z")
            .or_else(|| get_f64(event, "Z"))
            .or_else(|| planter_row.map(|row| row.z))
            .unwrap_or_default();
        if x == 0.0 && y == 0.0 && z == 0.0 {
            continue;
        }
        let duration = match kind {
            "smoke" => 22.0,
            "flash" => 0.8,
            "he" => 0.9,
            "fire" => 7.0,
            "decoy" => 15.0,
            "bomb_planted" => 40.0,
            _ => 1.0,
        };
        let mut start = seconds_since(span.start, tick);
        if kind == "decoy" {
            // demoparser2 exposes decoy_detonate when the decoy finishes its
            // active sound/lure phase on some CS2 demos, not when it lands.
            // Use the event as the end marker so the visible wobble starts
            // when the decoy becomes active instead of ~15s late.
            start = (start - duration).max(0.0_f64);
        }
        out.push(UtilityEffect {
            kind: kind.into(),
            variant: effect_variant(get_str(event, "event_name").unwrap_or("")).map(str::to_string),
            start,
            end: start + duration,
            x,
            y,
            z,
            team: get_i64(event, "user_team_num").or_else(|| get_i64(event, "team_num")),
        });
    }
    clamp_fire_effects_from_expire(events, span, &mut out);
    out.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

fn clamp_fire_effects_from_expire(
    events: &[Value],
    span: &RoundSpan,
    effects: &mut [UtilityEffect],
) {
    // An inferno is made of several flame cells. Their `inferno_expire`
    // events do not arrive in a guaranteed order and the first cell to expire
    // is not the end of the whole area. Collect the latest matching expiry for
    // each effect before mutating it; otherwise the first event shortens
    // `effect.end` and makes every later cell ineligible.
    let mut latest_expire_by_effect = vec![None::<f64>; effects.len()];
    for event in events {
        if get_str(event, "event_name") != Some("inferno_expire") {
            continue;
        }
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        if tick < span.start || tick > span.end {
            continue;
        }
        let x = get_f64(event, "x").or_else(|| get_f64(event, "X"));
        let y = get_f64(event, "y").or_else(|| get_f64(event, "Y"));
        let z = get_f64(event, "z")
            .or_else(|| get_f64(event, "Z"))
            .unwrap_or_default();
        let (Some(x), Some(y)) = (x, y) else {
            continue;
        };
        if x == 0.0 && y == 0.0 && z == 0.0 {
            continue;
        }
        let expire = seconds_since(span.start, tick);
        let mut best_idx = None;
        let mut best_dist = f64::INFINITY;
        for (idx, effect) in effects.iter().enumerate() {
            if effect.kind != "fire" || effect.start > expire || effect.end < expire {
                continue;
            }
            let d = squared_distance(effect.x, effect.y, effect.z, x, y, z);
            if d <= 220.0 * 220.0 && d < best_dist {
                best_idx = Some(idx);
                best_dist = d;
            }
        }
        if let Some(idx) = best_idx {
            latest_expire_by_effect[idx] =
                Some(latest_expire_by_effect[idx].map_or(expire, |current| current.max(expire)));
        }
    }
    for (effect, expire) in effects.iter_mut().zip(latest_expire_by_effect) {
        if let Some(expire) = expire {
            effect.end = expire.max(effect.start + 0.25);
        }
    }
}

fn adjust_decoy_effects_from_projectiles(
    effects: &mut [UtilityEffect],
    projectile_frames: &[ProjectileFrame],
) {
    let mut decoy_tracks: HashMap<i64, Vec<(f64, f64, f64, f64)>> = HashMap::new();
    for frame in projectile_frames {
        for projectile in &frame.projectiles {
            if !is_decoy_projectile(&projectile.kind) {
                continue;
            }
            decoy_tracks.entry(projectile.id).or_default().push((
                frame.t,
                projectile.x,
                projectile.y,
                projectile.z,
            ));
        }
    }

    for effect in effects.iter_mut().filter(|effect| effect.kind == "decoy") {
        let Some(track) = decoy_tracks.values().min_by(|left, right| {
            let left_distance = final_track_distance(left, effect);
            let right_distance = final_track_distance(right, effect);
            left_distance
                .partial_cmp(&right_distance)
                .unwrap_or(std::cmp::Ordering::Equal)
        }) else {
            continue;
        };
        if final_track_distance(track, effect) > 100.0 * 100.0 {
            continue;
        }
        let stationary_start = first_stationary_projectile_time(track).unwrap_or(effect.start);
        if stationary_start < effect.end {
            effect.start = stationary_start;
        }
    }
}

fn is_decoy_projectile(kind: &ProjectileKind) -> bool {
    matches!(kind, ProjectileKind::Other(name) if name.contains("Decoy"))
}

fn final_track_distance(track: &[(f64, f64, f64, f64)], effect: &UtilityEffect) -> f64 {
    track
        .last()
        .map(|(_, x, y, z)| squared_distance(*x, *y, *z, effect.x, effect.y, effect.z))
        .unwrap_or(f64::MAX)
}

fn first_stationary_projectile_time(track: &[(f64, f64, f64, f64)]) -> Option<f64> {
    const WINDOW: usize = 4;
    const MAX_MOVE_SQUARED: f64 = 0.0001;
    for idx in 0..track.len() {
        let window = track.get(idx..idx + WINDOW)?;
        let (_, x, y, z) = track[idx];
        let max_distance = window
            .iter()
            .map(|(_, wx, wy, wz)| squared_distance(x, y, z, *wx, *wy, *wz))
            .fold(0.0_f64, f64::max);
        if max_distance <= MAX_MOVE_SQUARED {
            return Some(track[idx].0);
        }
    }
    track.last().map(|(t, _, _, _)| *t)
}

fn add_missing_terminal_flash_effects(
    effects: &mut Vec<UtilityEffect>,
    projectile_frames: &[ProjectileFrame],
    span: &RoundSpan,
    rows_by_tick: &BTreeMap<i32, Vec<TickRow>>,
) {
    let duration = seconds_since(span.start, span.end);
    let mut last_flash_by_id: HashMap<i64, &ProjectilePos> = HashMap::new();
    let mut last_t_by_id: HashMap<i64, f64> = HashMap::new();
    for frame in projectile_frames {
        for projectile in &frame.projectiles {
            if projectile.kind != ProjectileKind::Flash {
                continue;
            }
            last_flash_by_id.insert(projectile.id, projectile);
            last_t_by_id.insert(projectile.id, frame.t);
        }
    }

    for (id, projectile) in last_flash_by_id {
        let Some(last_t) = last_t_by_id.get(&id).copied() else {
            continue;
        };
        if duration - last_t > 0.25 {
            continue;
        }
        let start = (last_t + 1.0 / TICK_RATE).min(duration);
        if has_nearby_flash_effect(effects, start, projectile.x, projectile.y, projectile.z) {
            continue;
        }
        let team = projectile
            .thrower
            .and_then(|id| player_row_at_tick(rows_by_tick, span.end, id, span.start))
            .map(|row| row.team);
        effects.push(UtilityEffect {
            kind: "flash".into(),
            variant: None,
            start,
            end: start + 0.8,
            x: projectile.x,
            y: projectile.y,
            z: projectile.z,
            team,
        });
    }
    effects.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

fn has_nearby_flash_effect(effects: &[UtilityEffect], start: f64, x: f64, y: f64, z: f64) -> bool {
    effects.iter().any(|effect| {
        effect.kind == "flash"
            && (effect.start - start).abs() <= 0.25
            && squared_distance(effect.x, effect.y, effect.z, x, y, z) <= 100.0 * 100.0
    })
}

fn squared_distance(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    let dz = az - bz;
    dx * dx + dy * dy + dz * dz
}

fn effect_kind(event_name: &str) -> Option<&'static str> {
    match event_name {
        "smokegrenade_detonate" => Some("smoke"),
        "flashbang_detonate" => Some("flash"),
        "hegrenade_detonate" => Some("he"),
        "inferno_startburn" | "molotov_detonate" => Some("fire"),
        "decoy_detonate" => Some("decoy"),
        "bomb_planted" => Some("bomb_planted"),
        _ => None,
    }
}

fn effect_variant(event_name: &str) -> Option<&'static str> {
    match event_name {
        "molotov_detonate" => Some("molotov"),
        _ => None,
    }
}

fn round_weapon_fires(
    events: &[Value],
    span: &RoundSpan,
    rows_by_tick: &BTreeMap<i32, Vec<TickRow>>,
) -> Vec<WeaponFireEvent> {
    let mut out = Vec::new();
    for (sequence, event) in events.iter().enumerate() {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        if tick < span.start || tick > span.end {
            continue;
        }
        if get_str(event, "event_name") != Some("weapon_fire") {
            continue;
        }
        let shooter = get_u64(event, "user_steamid")
            .or_else(|| get_u64(event, "attacker_steamid"))
            .or_else(|| get_u64(event, "steamid"));
        let row = shooter.and_then(|id| player_row_at_tick(rows_by_tick, tick, id, span.start));
        out.push(WeaponFireEvent {
            t: seconds_since(span.start, tick),
            tick,
            sequence,
            shooter,
            weapon: get_str(event, "weapon").map(str::to_string),
            x: row.map(|r| r.x).unwrap_or_default(),
            y: row.map(|r| r.y).unwrap_or_default(),
            z: row.map(|r| r.z).unwrap_or_default(),
            yaw: row.map(|r| r.yaw).unwrap_or_default(),
            team: row.map(|r| r.team),
        });
    }
    out
}

fn round_bullet_impacts(events: &[Value], span: &RoundSpan) -> Vec<BulletImpactEvent> {
    events
        .iter()
        .enumerate()
        .filter_map(|(sequence, event)| {
            if get_str(event, "event_name") != Some("bullet_impact") {
                return None;
            }
            let tick = get_i64(event, "tick")? as i32;
            if tick < span.start || tick > span.end {
                return None;
            }
            Some(BulletImpactEvent {
                t: seconds_since(span.start, tick),
                tick,
                sequence,
                shooter: get_u64(event, "user_steamid")
                    .or_else(|| get_u64(event, "attacker_steamid"))
                    .or_else(|| get_u64(event, "steamid"))
                    .filter(|id| *id != 0),
                x: get_f64(event, "x").or_else(|| get_f64(event, "X"))?,
                y: get_f64(event, "y").or_else(|| get_f64(event, "Y"))?,
                z: get_f64(event, "z").or_else(|| get_f64(event, "Z"))?,
            })
        })
        .collect()
}

fn player_row_at_tick(
    rows_by_tick: &BTreeMap<i32, Vec<TickRow>>,
    tick: i32,
    steam_id: u64,
    earliest_tick: i32,
) -> Option<&TickRow> {
    rows_by_tick
        .range(earliest_tick..=tick)
        .rev()
        .find_map(|(_, rows)| rows.iter().find(|row| row.steamid == steam_id))
}

fn seconds_since(start: i32, tick: i32) -> f64 {
    f64::from(tick - start).max(0.0) / TICK_RATE
}

fn team_name(team: i64) -> &'static str {
    match team {
        2 => "T",
        3 => "CT",
        _ => "SPEC",
    }
}

fn get_field<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    let raw = v.as_object()?.get(key)?;
    match raw {
        Value::Object(map) => map.get("Some").or(Some(raw)),
        _ => Some(raw),
    }
}

fn get_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    let value = get_field(v, key)?;
    value
        .as_str()
        .or_else(|| value.as_object()?.get("String")?.as_str())
}

fn get_u64(v: &Value, key: &str) -> Option<u64> {
    let value = get_field(v, key)?;
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    if let Some(s) = value.as_str() {
        return s.parse().ok();
    }
    let map = value.as_object()?;
    map.get("U64")
        .and_then(Value::as_u64)
        .or_else(|| map.get("String")?.as_str()?.parse().ok())
}

fn get_i64(v: &Value, key: &str) -> Option<i64> {
    let value = get_field(v, key)?;
    if let Some(n) = value.as_i64() {
        return Some(n);
    }
    let map = value.as_object()?;
    map.get("I32")
        .and_then(Value::as_i64)
        .or_else(|| map.get("U32").and_then(Value::as_i64))
}

fn get_f64(v: &Value, key: &str) -> Option<f64> {
    let value = get_field(v, key)?;
    if let Some(n) = value.as_f64() {
        return Some(n);
    }
    value.as_object()?.get("F32")?.as_f64()
}

fn get_bool(v: &Value, key: &str) -> Option<bool> {
    let value = get_field(v, key)?;
    value
        .as_bool()
        .or_else(|| value.as_object()?.get("Bool")?.as_bool())
}

struct CountingWriter<W> {
    inner: W,
    bytes: u64,
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let written = self.inner.write(buf)?;
        self.bytes += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

fn manifest_round_from_round(round: &Round, round_file: String) -> ManifestRound {
    ManifestRound {
        number: round.number,
        start_tick: round.start_tick,
        freeze_end_tick: round.freeze_end_tick,
        end_tick: round.end_tick,
        duration: round.duration,
        winner: round.winner.clone(),
        score_a: round.score_a,
        score_b: round.score_b,
        frames: Vec::new(),
        events: Vec::new(),
        damages: Vec::new(),
        disconnects: Vec::new(),
        flashes: Vec::new(),
        purchases: Vec::new(),
        effects: Vec::new(),
        weapon_fires: Vec::new(),
        bullet_impacts: Vec::new(),
        projectile_frames: Vec::new(),
        round_file,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
fn write_json_gz(path: &str, output: &Output) -> Result<WriteStats> {
    let write_started = final_step_start("write_json_gz");
    let mut stats = WriteStats::default();
    let output_path = Path::new(path);
    let rounds_dir = split_rounds_dir(output_path)?;
    let staging_rounds_dir = temp_sibling_path(&rounds_dir, "tmp")?;
    let backup_rounds_dir = temp_sibling_path(&rounds_dir, "backup")?;
    let temp_manifest_path = temp_sibling_path(output_path, "tmp")?;
    let backup_manifest_path = temp_sibling_path(output_path, "backup")?;
    remove_path_if_exists(&staging_rounds_dir)?;
    remove_path_if_exists(&backup_rounds_dir)?;
    remove_path_if_exists(&temp_manifest_path)?;
    remove_path_if_exists(&backup_manifest_path)?;
    fs::create_dir_all(&staging_rounds_dir)
        .with_context(|| format!("create rounds staging dir {}", staging_rounds_dir.display()))?;
    let mut staging_cleanup = CleanupPath::new(staging_rounds_dir.clone());
    let mut temp_manifest_cleanup = CleanupPath::new(temp_manifest_path.clone());

    emit_progress(0.94, "Serializing split parser JSON...");
    let round_dir_name = rounds_dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("invalid rounds dir name"))?
        .to_string();
    let mut round_results: Vec<(usize, ManifestRound, WriteStats)> = output
        .rounds
        .par_iter()
        .enumerate()
        .map(|(idx, round)| {
            let file_name = format!("round-{:03}.json.gz", round.number);
            let relative = format!("{round_dir_name}/{file_name}");
            let round_path = staging_rounds_dir.join(&file_name);
            let write_stats = write_gzip_json_quiet(&round_path, round)?;
            Ok((idx, manifest_round_from_round(round, relative), write_stats))
        })
        .collect::<Result<Vec<_>>>()?;
    round_results.sort_by_key(|(idx, _, _)| *idx);
    let mut manifest_rounds = Vec::with_capacity(round_results.len());
    for (_, manifest_round, write_stats) in round_results {
        add_parallel_write_stats(&mut stats, write_stats);
        manifest_rounds.push(manifest_round);
    }

    let manifest = ManifestOutput {
        schema_version: REPLAY_SCHEMA_VERSION,
        parser_version: PARSER_VERSION,
        meta: &output.meta,
        players: &output.players,
        rounds: manifest_rounds,
    };
    add_write_stats(
        &mut stats,
        write_gzip_json(&temp_manifest_path, &manifest, "manifest")?,
    );
    let commit_started = final_step_start("commit_split_output");
    commit_split_output(
        output_path,
        &rounds_dir,
        &staging_rounds_dir,
        &temp_manifest_path,
        &backup_rounds_dir,
        &backup_manifest_path,
    )?;
    staging_cleanup.disarm();
    temp_manifest_cleanup.disarm();
    final_step_done("commit_split_output", commit_started);

    stats.write_output_ms = elapsed_ms(write_started);
    final_step_done("write_json_gz", write_started);
    Ok(stats)
}

fn split_rounds_dir(path: &Path) -> Result<PathBuf> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("invalid output path"))?;
    let stem = name
        .strip_suffix(".json.gz")
        .or_else(|| name.strip_suffix(".gz"))
        .unwrap_or(name);
    Ok(path.with_file_name(stem))
}

fn temp_sibling_path(path: &Path, marker: &str) -> Result<PathBuf> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("invalid path"))?;
    Ok(path.with_file_name(format!(".{name}.{marker}-{}", unique_suffix())))
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.is_dir() {
        fs::remove_dir_all(path).with_context(|| format!("remove dir {}", path.display()))?;
    } else {
        fs::remove_file(path).with_context(|| format!("remove file {}", path.display()))?;
    }
    Ok(())
}

struct CleanupPath {
    path: PathBuf,
    armed: bool,
}

impl CleanupPath {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for CleanupPath {
    fn drop(&mut self) {
        if self.armed {
            let _ = remove_path_if_exists(&self.path);
        }
    }
}

fn commit_split_output(
    output_path: &Path,
    rounds_dir: &Path,
    staging_rounds_dir: &Path,
    temp_manifest_path: &Path,
    backup_rounds_dir: &Path,
    backup_manifest_path: &Path,
) -> Result<()> {
    let had_rounds = rounds_dir.exists();
    if had_rounds {
        fs::rename(rounds_dir, backup_rounds_dir).with_context(|| {
            format!(
                "backup old rounds dir {} -> {}",
                rounds_dir.display(),
                backup_rounds_dir.display()
            )
        })?;
    }

    if let Err(err) = fs::rename(staging_rounds_dir, rounds_dir) {
        if had_rounds {
            let _ = fs::rename(backup_rounds_dir, rounds_dir);
        }
        return Err(err).with_context(|| {
            format!(
                "commit rounds dir {} -> {}",
                staging_rounds_dir.display(),
                rounds_dir.display()
            )
        });
    }

    let had_manifest = output_path.exists();
    if had_manifest {
        if let Err(err) = fs::rename(output_path, backup_manifest_path) {
            rollback_rounds_dir(rounds_dir, backup_rounds_dir, had_rounds);
            return Err(err).with_context(|| {
                format!(
                    "backup old manifest {} -> {}",
                    output_path.display(),
                    backup_manifest_path.display()
                )
            });
        }
    }

    if let Err(err) = fs::rename(temp_manifest_path, output_path) {
        rollback_rounds_dir(rounds_dir, backup_rounds_dir, had_rounds);
        if had_manifest {
            let _ = fs::rename(backup_manifest_path, output_path);
        }
        return Err(err).with_context(|| {
            format!(
                "commit manifest {} -> {}",
                temp_manifest_path.display(),
                output_path.display()
            )
        });
    }

    if had_rounds {
        best_effort_remove_path("old rounds backup", backup_rounds_dir);
    }
    if had_manifest {
        best_effort_remove_path("old manifest backup", backup_manifest_path);
    }
    Ok(())
}

fn best_effort_remove_path(label: &str, path: &Path) {
    if let Err(err) = remove_path_if_exists(path) {
        eprintln!(
            "ROUNDLAB_WARNING cleanup_failed label={label} path={} error={err:#}",
            path.display()
        );
    }
}

fn rollback_rounds_dir(rounds_dir: &Path, backup_rounds_dir: &Path, had_rounds: bool) {
    let _ = remove_path_if_exists(rounds_dir);
    if had_rounds {
        let _ = fs::rename(backup_rounds_dir, rounds_dir);
    }
}

fn add_write_stats(total: &mut WriteStats, next: WriteStats) {
    total.serialize_json_ms += next.serialize_json_ms;
    total.raw_json_bytes += next.raw_json_bytes;
    total.gz_flush_ms += next.gz_flush_ms;
    total.gzip_finish_ms += next.gzip_finish_ms;
    total.fsync_ms += next.fsync_ms;
    total.output_gzip_bytes += next.output_gzip_bytes;
}

#[cfg_attr(not(test), allow(dead_code))]
fn add_parallel_write_stats(total: &mut WriteStats, next: WriteStats) {
    total.serialize_json_ms = total.serialize_json_ms.max(next.serialize_json_ms);
    total.raw_json_bytes += next.raw_json_bytes;
    total.gz_flush_ms = total.gz_flush_ms.max(next.gz_flush_ms);
    total.gzip_finish_ms = total.gzip_finish_ms.max(next.gzip_finish_ms);
    total.fsync_ms = total.fsync_ms.max(next.fsync_ms);
    total.output_gzip_bytes += next.output_gzip_bytes;
}

fn write_gzip_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<WriteStats> {
    write_gzip_json_inner(path, value, Some(label))
}

fn write_gzip_json_quiet<T: Serialize>(path: &Path, value: &T) -> Result<WriteStats> {
    write_gzip_json_inner(path, value, None)
}

fn write_gzip_json_inner<T: Serialize>(
    path: &Path,
    value: &T,
    label: Option<&str>,
) -> Result<WriteStats> {
    let mut stats = WriteStats::default();
    let create_step = label.map(|label| format!("{label}:File::create"));
    let create_started = create_step.as_deref().map(final_step_start);
    let file = fs::File::create(path).with_context(|| format!("create {}", path.display()))?;
    if let (Some(step), Some(started)) = (create_step.as_deref(), create_started) {
        final_step_done(step, started);
    }
    let mut gz = GzEncoder::new(file, parser_gzip_compression());

    let serialize_step = label.map(|label| format!("{label}:serde_json::to_writer"));
    let serialize_started = serialize_step.as_deref().map(final_step_start);
    let serialize_timer = parser_now();
    {
        let counting = CountingWriter {
            inner: &mut gz,
            bytes: 0,
        };
        let mut buffered = BufWriter::with_capacity(JSON_WRITE_BUFFER_BYTES, counting);
        serde_json::to_writer(&mut buffered, value)?;
        buffered.flush()?;
        stats.raw_json_bytes = buffered.get_ref().bytes;
    }
    stats.serialize_json_ms = elapsed_ms(serialize_timer);
    if let (Some(step), Some(started)) = (serialize_step.as_deref(), serialize_started) {
        final_step_done(step, started);
    }

    let flush_step = label.map(|label| format!("{label}:gz.flush"));
    let flush_started = flush_step.as_deref().map(final_step_start);
    let flush_timer = parser_now();
    gz.flush()?;
    stats.gz_flush_ms = elapsed_ms(flush_timer);
    if let (Some(step), Some(started)) = (flush_step.as_deref(), flush_started) {
        final_step_done(step, started);
    }

    let finish_step = label.map(|label| format!("{label}:gz.finish"));
    let finish_started = finish_step.as_deref().map(final_step_start);
    let finish_timer = parser_now();
    let file = gz.finish()?;
    stats.gzip_finish_ms = elapsed_ms(finish_timer);
    if let (Some(step), Some(started)) = (finish_step.as_deref(), finish_started) {
        final_step_done(step, started);
    }

    if skip_fsync() {
        emit_progress(
            0.995,
            "Skipping parser disk fsync (ROUNDLAB_PARSER_SKIP_FSYNC).",
        );
    } else {
        let sync_step = label.map(|label| format!("{label}:File::sync_all"));
        let sync_started = sync_step.as_deref().map(final_step_start);
        let sync_timer = parser_now();
        file.sync_all()?;
        stats.fsync_ms = elapsed_ms(sync_timer);
        if let (Some(step), Some(started)) = (sync_step.as_deref(), sync_started) {
            final_step_done(step, started);
        }
    }
    drop(file);
    stats.output_gzip_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or_default();
    Ok(stats)
}

fn parser_gzip_compression() -> Compression {
    std::env::var("ROUNDLAB_PARSER_GZIP_LEVEL")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|level| *level <= 9)
        .map(Compression::new)
        .unwrap_or_default()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn parse_demo_bytes_to_json(
    bytes: &[u8],
    quality: Option<String>,
    skip_projectiles: bool,
    skip_weapon_fires: bool,
) -> std::result::Result<String, JsValue> {
    let args = Args {
        input: String::new(),
        output: String::new(),
        quality: quality.unwrap_or_else(|| "full".to_string()),
        skip_projectiles,
        skip_weapon_fires,
        stats: false,
    };
    let (output, _) = parse_demo_data_from_bytes(&args, bytes, bytes.len() as u64)
        .and_then(|mut data| {
            let build_rounds_started = parser_now();
            let ctx = RoundBuildContext {
                args: &args,
                events: &data.events,
                spans: &data.spans,
                rows_by_tick: &data.rows_by_tick,
                c4_by_tick: &data.c4_by_tick,
                projectiles_by_tick: &data.projectiles_by_tick,
                weapon_names: &data.weapon_names,
                round_scores: &data.round_scores,
                sample_step: data.sample_step,
            };
            let mut rounds = Vec::with_capacity(data.spans.len());
            for idx in 0..data.spans.len() {
                if let Some(round) = build_round_payload(&ctx, idx, rounds.len()) {
                    rounds.push(round);
                }
                if idx > 200 {
                    break;
                }
            }
            if rounds.is_empty() {
                bail!("parser produced no frames");
            }
            if looks_like_knife_round(rounds.first()) {
                rounds.remove(0);
                for (idx, round) in rounds.iter_mut().enumerate() {
                    round.number = idx;
                }
            }
            data.stats.build_rounds_ms = elapsed_ms(build_rounds_started);
            let (score_a, score_b) = rounds
                .last()
                .map(|round| (round.score_a, round.score_b))
                .unwrap_or_default();
            let output = Output {
                schema_version: REPLAY_SCHEMA_VERSION,
                parser_version: PARSER_VERSION,
                meta: Meta {
                    map: data.map,
                    tick_rate: TICK_RATE,
                    sample_rate: data.sample_rate,
                    duration_sec: data.duration_sec,
                    team_a: data.team_a,
                    team_b: data.team_b,
                    score_a,
                    score_b,
                },
                players: data.players,
                rounds,
            };
            collect_output_stats(&mut data.stats, &output);
            Ok((output, data.stats))
        })
        .map_err(|err| JsValue::from_str(&format!("{err:#}")))?;
    serde_json::to_string(&output).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        add_missing_terminal_flash_effects, adjust_decoy_effects_from_projectiles,
        blind_spans_from_flashes, build_round_payload, commit_split_output, group_projectile_rows,
        looks_like_knife_round, parse_args_from, parse_demo_to_output, parser_gzip_compression,
        player_pos_from_row, read_capped, read_demo, round_bullet_impacts, round_damages,
        round_disconnects, round_effects, round_events, round_flashes, round_purchases,
        round_weapon_fires, sample_step, sample_ticks, seconds_since, write_json_gz, ActiveAction,
        Args, BombState, DamageEvent, DisconnectEvent, Event, Frame, KillDetails, Output, Player,
        ProjectileFrame, ProjectileKind, ProjectilePos, ProjectileRow, Round, RoundBuildContext,
        RoundSpan, TickRow, UtilityEffect, WeaponFireEvent, MAX_DEMO_SIZE, PARSER_VERSION,
        REPLAY_SCHEMA_VERSION,
    };
    use flate2::{read::GzDecoder, Compression};
    use serde::Deserialize;
    use serde_json::{json, Value};
    use std::{
        collections::{BTreeMap, HashMap, HashSet},
        env,
        io::{Read, Write},
        path::Path,
    };

    #[derive(Debug, Default, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct ReplayMetrics {
        rounds: usize,
        players: usize,
        frames: usize,
        frame_players: usize,
        frames_with_players: usize,
        frames_with_bomb_state: usize,
        players_with_weapons: usize,
        events: usize,
        kills: usize,
        bomb_events: usize,
        effects: usize,
        weapon_fires: usize,
        projectile_frames: usize,
        projectile_samples: usize,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExpectedReplaySnapshot {
        file_name: String,
        label: String,
        map: String,
        score_a: i32,
        score_b: i32,
        metrics: ReplayMetrics,
        round_metrics: Vec<RoundReplayMetrics>,
        round_event_signatures: Vec<RoundEventSignatures>,
        round_terminal_event_signatures: Vec<RoundTerminalEventSignatures>,
        round_effect_signatures: Vec<RoundEffectSignatures>,
        round_weapon_fire_signatures: Vec<RoundWeaponFireSignatures>,
        round_bomb_state_signatures: Vec<RoundBombStateSignatures>,
        round_active_action_signatures: Vec<RoundActiveActionSignatures>,
        round_projectile_track_signatures: Vec<RoundProjectileTrackSignatures>,
        medium_skip_metrics: ReplayMetrics,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundReplayMetrics {
        number: usize,
        score_a: i32,
        score_b: i32,
        frames: usize,
        events: usize,
        kills: usize,
        bomb_events: usize,
        effects: usize,
        weapon_fires: usize,
        projectile_frames: usize,
        projectile_samples: usize,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundEventSignatures {
        number: usize,
        kills: Vec<String>,
        bomb_events: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundTerminalEventSignatures {
        number: usize,
        terminal_events: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundEffectSignatures {
        number: usize,
        effects: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundWeaponFireSignatures {
        number: usize,
        weapon_fires: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundBombStateSignatures {
        number: usize,
        bomb_states: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundActiveActionSignatures {
        number: usize,
        active_actions: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct RoundProjectileTrackSignatures {
        number: usize,
        projectile_tracks: Vec<String>,
    }

    struct ProjectileTrackSummary<'a> {
        id: i64,
        kind: &'a ProjectileKind,
        thrower: Option<u64>,
        start_t: f64,
        end_t: f64,
        samples: usize,
        start: &'a ProjectilePos,
        end: &'a ProjectilePos,
    }

    struct BombStateWindow<'a> {
        start_t: f64,
        end_t: f64,
        samples: usize,
        end_cause: String,
        start_bomb: &'a BombState,
        end_bomb: &'a BombState,
    }

    struct ActiveActionWindow<'a> {
        player: u64,
        start_t: f64,
        end_t: f64,
        samples: usize,
        start_elapsed: f64,
        end_elapsed: f64,
        action: &'a ActiveAction,
    }

    struct EnvVarGuard {
        key: &'static str,
        old_value: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let guard = Self {
                key,
                old_value: env::var(key).ok(),
            };
            env::set_var(key, value);
            guard
        }

        fn remove(key: &'static str) -> Self {
            let guard = Self {
                key,
                old_value: env::var(key).ok(),
            };
            env::remove_var(key);
            guard
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.old_value {
                env::set_var(self.key, value);
            } else {
                env::remove_var(self.key);
            }
        }
    }

    /// A small plain (non-zstd) file is read back verbatim.
    #[test]
    fn read_demo_plain_passthrough() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiny.dem");
        std::fs::write(&path, b"hello world").unwrap();
        let bytes = read_demo(path.to_str().unwrap()).unwrap();
        assert_eq!(bytes, b"hello world");
    }

    /// A zstd payload that decompresses to MORE than MAX_DEMO_SIZE must be
    /// rejected before the full plaintext is allocated. We craft a high-ratio
    /// zstd by compressing a buffer of zeros that, once decompressed, exceeds
    /// the cap. The compressed file itself stays small.
    #[test]
    fn read_demo_zstd_bomb_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bomb.dem.zst");

        // Build a compressed stream that decompresses to (cap + 1 MB) zeros.
        let plaintext_size = (MAX_DEMO_SIZE as usize) + (1024 * 1024);
        let mut encoder = zstd::stream::Encoder::new(Vec::new(), 3).unwrap();
        // Stream the plaintext in chunks so we never materialize it whole on
        // the test side either.
        let chunk = vec![0u8; 64 * 1024];
        let mut written = 0usize;
        while written < plaintext_size {
            let n = chunk.len().min(plaintext_size - written);
            encoder.write_all(&chunk[..n]).unwrap();
            written += n;
        }
        let compressed = encoder.finish().unwrap();
        // Sanity: the bomb-on-disk is small; the cap-rejection must come from
        // the streaming decoder, not from the metadata.len() check.
        assert!(
            (compressed.len() as u64) < MAX_DEMO_SIZE,
            "compressed bomb unexpectedly large: {} bytes",
            compressed.len()
        );
        std::fs::write(&path, &compressed).unwrap();

        let err = read_demo(path.to_str().unwrap()).unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("decompressed") && msg.contains("limit"),
            "expected decompressed-limit error, got: {msg}"
        );
    }

    /// read_capped refuses to allocate past `cap` even if the source still has
    /// data to give. Catches regressions in the cap arithmetic.
    #[test]
    fn read_capped_rejects_overflow() {
        let src = vec![1u8; 1024];
        let mut out = Vec::new();
        let err = read_capped(&mut src.as_slice(), &mut out, 256).unwrap_err();
        assert!(format!("{err}").contains("limit"));
        // out grew up to (cap + one chunk) at most. With chunk=64 KiB and
        // cap=256, the very first chunk already trips the check, so out stays
        // empty.
        assert!(out.len() <= 64 * 1024);
    }

    #[test]
    fn parse_args_from_accepts_quality_and_skip_flags() {
        let args = parse_args_from([
            "-in",
            "demo.dem.zst",
            "-out",
            "out.json.gz",
            "-quality",
            "HIGH",
            "-skipProjectiles",
            "-skipWeaponFires",
            "-stats",
        ])
        .expect("parse args");
        assert_eq!(args.input, "demo.dem.zst");
        assert_eq!(args.output, "out.json.gz");
        assert_eq!(args.quality, "high");
        assert!(args.skip_projectiles);
        assert!(args.skip_weapon_fires);
        assert!(args.stats);
    }

    #[test]
    fn parse_args_from_rejects_invalid_quality() {
        let err = parse_args_from([
            "-in",
            "demo.dem",
            "-out",
            "out.json.gz",
            "-quality",
            "turbo",
        ])
        .unwrap_err();
        assert!(format!("{err:#}").contains("invalid -quality"));
    }

    #[test]
    fn parse_args_from_rejects_unknown_arguments() {
        let err = parse_args_from(["-in", "demo.dem", "-out", "out.json.gz", "-wat"]).unwrap_err();
        assert!(format!("{err:#}").contains("unknown argument: -wat"));
    }

    #[test]
    fn sample_step_matches_cli_quality_contract() {
        assert_eq!(sample_step("full"), 1);
        assert_eq!(sample_step("high"), 16);
        assert_eq!(sample_step("medium"), 32);
        assert_eq!(sample_step("low"), 64);
    }

    #[test]
    fn sample_ticks_include_exact_freeze_end_for_economy_snapshot() {
        let spans = vec![RoundSpan {
            start: 100,
            end: 300,
            round_end: 300,
            winner: "T".into(),
        }];
        let events = vec![json!({
            "tick": 173,
            "event_name": "round_freeze_end"
        })];

        let ticks = sample_ticks(&spans, 64, &events);

        assert!(ticks.contains(&173));
    }

    #[test]
    fn round_events_keeps_post_round_kills_before_next_round() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "CT".into(),
        };
        let next_span = RoundSpan {
            start: 250,
            end: 350,
            round_end: 350,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 210,
                "event_name": "player_death",
                "attacker_steamid": 1_u64,
                "user_steamid": 1_u64,
                "weapon": "world"
            }),
            json!({
                "tick": 260,
                "event_name": "player_death",
                "attacker_steamid": 2_u64,
                "user_steamid": 3_u64,
                "weapon": "ak47"
            }),
        ];

        let parsed = round_events(&events, &span, Some(&next_span));

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].kind, "kill");
        assert_eq!(parsed[0].killer, Some(1));
        assert_eq!(parsed[0].victim, Some(1));
        assert_eq!(parsed[0].weapon.as_deref(), Some("world"));
    }

    #[test]
    fn round_events_keeps_post_round_bomb_events_before_next_round() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "T".into(),
        };
        let next_span = RoundSpan {
            start: 250,
            end: 350,
            round_end: 350,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "tick": 210,
                "event_name": "bomb_exploded"
            }),
            json!({
                "tick": 260,
                "event_name": "bomb_exploded"
            }),
        ];

        let parsed = round_events(&events, &span, Some(&next_span));

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].kind, "bomb_exploded");
        assert_eq!(parsed[0].t, seconds_since(span.start, 210));
    }

    #[test]
    fn round_events_synthesizes_bomb_exploded_from_round_end_reason() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "T".into(),
        };
        let events = vec![json!({
            "tick": 200,
            "event_name": "round_end",
            "reason": "bomb_exploded"
        })];

        let parsed = round_events(&events, &span, None);

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].kind, "round_end");
        assert_eq!(parsed[1].kind, "bomb_exploded");
        assert_eq!(parsed[1].t, seconds_since(span.start, 200));
    }

    #[test]
    fn round_frames_clear_bomb_after_synthesized_explosion() {
        let args = Args {
            input: "demo.dem".into(),
            output: "out.json.gz".into(),
            quality: "full".into(),
            skip_projectiles: false,
            skip_weapon_fires: false,
            stats: false,
        };
        let events = vec![
            json!({
                "event_name": "bomb_planted",
                "tick": 5,
                "user_steamid": 7_u64,
                "x": 10.0,
                "y": 20.0,
                "z": 0.0
            }),
            json!({
                "event_name": "round_end",
                "tick": 10,
                "reason": "bomb_exploded"
            }),
        ];
        let spans = vec![RoundSpan {
            start: 0,
            end: 20,
            round_end: 10,
            winner: "T".into(),
        }];
        let weapon_names = vec!["weapon_c4".to_string()];
        let mut rows_by_tick = BTreeMap::new();
        for tick in 0..=20 {
            rows_by_tick.insert(
                tick,
                vec![TickRow {
                    tick,
                    steamid: 7,
                    x: tick as f64,
                    y: 0.0,
                    z: 0.0,
                    yaw: 0.0,
                    pitch: None,
                    speed: None,
                    velocity_x: None,
                    velocity_y: None,
                    velocity_z: None,
                    airborne: None,
                    walking: None,
                    duck_amount: None,
                    hp: 100,
                    armor: 0,
                    money: None,
                    equipment_value: None,
                    helmet: false,
                    kit: false,
                    alive: true,
                    team: 2,
                    active: Some(0),
                    weapons: vec![0],
                    fire: false,
                    right_click: false,
                    use_key: false,
                }],
            );
        }
        let c4_by_tick = BTreeMap::new();
        let projectiles_by_tick = BTreeMap::new();
        let round_scores = vec![(0, 1)];
        let ctx = RoundBuildContext {
            args: &args,
            events: &events,
            spans: &spans,
            rows_by_tick: &rows_by_tick,
            c4_by_tick: &c4_by_tick,
            projectiles_by_tick: &projectiles_by_tick,
            weapon_names: &weapon_names,
            round_scores: &round_scores,
            sample_step: 1,
        };

        let round = build_round_payload(&ctx, 0, 0).expect("round payload");
        let planted_at = seconds_since(0, 5);
        let exploded_at = seconds_since(0, 10);

        assert!(
            round.frames.iter().any(|frame| frame.t >= planted_at
                && frame.t < exploded_at
                && frame
                    .bomb
                    .as_ref()
                    .is_some_and(|bomb| bomb.status == "planted")),
            "expected planted bomb before synthesized explosion"
        );
        assert!(
            round
                .frames
                .iter()
                .filter(|frame| frame.t >= exploded_at)
                .all(|frame| frame.bomb.is_none()),
            "bomb must not remain visible after synthesized explosion"
        );
    }

    #[test]
    fn round_frames_track_bomb_carry_drop_pickup_plant_and_defuse() {
        let args = Args {
            input: "demo.dem".into(),
            output: "out.json.gz".into(),
            quality: "full".into(),
            skip_projectiles: false,
            skip_weapon_fires: false,
            stats: false,
        };
        let events = vec![
            json!({
                "event_name": "bomb_planted",
                "tick": 4,
                "user_steamid": 8_u64,
                "x": 400.0,
                "y": 40.0,
                "z": 4.0
            }),
            json!({
                "event_name": "bomb_defused",
                "tick": 5
            }),
        ];
        let spans = vec![RoundSpan {
            start: 0,
            end: 6,
            round_end: 6,
            winner: "CT".into(),
        }];
        let weapon_names = vec!["weapon_c4".to_string(), "ak47".to_string()];
        let mut rows_by_tick = BTreeMap::new();
        for tick in 0..=6 {
            let (steamid, x, y, active, weapons) = match tick {
                0 => (7, 10.0, 1.0, Some(0), vec![0]),
                3..=6 => (8, 300.0 + tick as f64, 30.0, Some(0), vec![0]),
                _ => (7, 20.0 + tick as f64, 2.0, Some(1), vec![1]),
            };
            rows_by_tick.insert(
                tick,
                vec![TickRow {
                    tick,
                    steamid,
                    x,
                    y,
                    z: tick as f64,
                    yaw: 0.0,
                    pitch: None,
                    speed: None,
                    velocity_x: None,
                    velocity_y: None,
                    velocity_z: None,
                    airborne: None,
                    walking: None,
                    duck_amount: None,
                    hp: 100,
                    armor: 0,
                    money: None,
                    equipment_value: None,
                    helmet: false,
                    kit: false,
                    alive: true,
                    team: 2,
                    active,
                    weapons,
                    fire: false,
                    right_click: false,
                    use_key: false,
                }],
            );
        }
        let mut c4_by_tick = BTreeMap::new();
        c4_by_tick.insert(
            1,
            super::C4Pos {
                tick: 1,
                x: 100.0,
                y: 10.0,
                z: 1.0,
            },
        );
        let projectiles_by_tick = BTreeMap::new();
        let round_scores = vec![(1, 0)];
        let ctx = RoundBuildContext {
            args: &args,
            events: &events,
            spans: &spans,
            rows_by_tick: &rows_by_tick,
            c4_by_tick: &c4_by_tick,
            projectiles_by_tick: &projectiles_by_tick,
            weapon_names: &weapon_names,
            round_scores: &round_scores,
            sample_step: 1,
        };

        let round = build_round_payload(&ctx, 0, 0).expect("round payload");
        let bomb_at = |t: f64| {
            round
                .frames
                .iter()
                .find(|frame| (frame.t - t).abs() < 0.001)
                .and_then(|frame| frame.bomb.as_ref())
        };

        let carried_before_drop = bomb_at(0.0).expect("carried bomb before drop");
        assert_eq!(carried_before_drop.status, "carried");
        assert_eq!(carried_before_drop.carrier, Some(7));

        let dropped = bomb_at(1.0 / super::TICK_RATE).expect("dropped bomb");
        assert_eq!(dropped.status, "dropped");
        assert_eq!(dropped.carrier, None);
        assert_eq!((dropped.x, dropped.y, dropped.z), (100.0, 10.0, 1.0));

        let persisted_drop = bomb_at(2.0 / super::TICK_RATE).expect("persisted dropped bomb");
        assert_eq!(persisted_drop.status, "dropped");
        assert_eq!(
            (persisted_drop.x, persisted_drop.y, persisted_drop.z),
            (100.0, 10.0, 1.0)
        );

        let picked_up = bomb_at(3.0 / super::TICK_RATE).expect("picked up bomb");
        assert_eq!(picked_up.status, "carried");
        assert_eq!(picked_up.carrier, Some(8));

        let planted = bomb_at(4.0 / super::TICK_RATE).expect("planted bomb");
        assert_eq!(planted.status, "planted");
        assert_eq!(planted.carrier, None);
        assert_eq!((planted.x, planted.y, planted.z), (400.0, 40.0, 4.0));

        assert!(
            bomb_at(5.0 / super::TICK_RATE).is_none(),
            "bomb must clear after defuse"
        );
    }

    #[test]
    fn round_frames_clear_bomb_after_explicit_explosion() {
        let args = Args {
            input: "demo.dem".into(),
            output: "out.json.gz".into(),
            quality: "full".into(),
            skip_projectiles: false,
            skip_weapon_fires: false,
            stats: false,
        };
        let events = vec![
            json!({
                "event_name": "bomb_planted",
                "tick": 5,
                "user_steamid": 7_u64,
                "x": 10.0,
                "y": 20.0,
                "z": 0.0
            }),
            json!({
                "event_name": "bomb_exploded",
                "tick": 10
            }),
        ];
        let spans = vec![RoundSpan {
            start: 0,
            end: 20,
            round_end: 10,
            winner: "T".into(),
        }];
        let weapon_names = vec!["weapon_c4".to_string()];
        let mut rows_by_tick = BTreeMap::new();
        for tick in 0..=20 {
            rows_by_tick.insert(
                tick,
                vec![TickRow {
                    tick,
                    steamid: 7,
                    x: tick as f64,
                    y: 0.0,
                    z: 0.0,
                    yaw: 0.0,
                    pitch: None,
                    speed: None,
                    velocity_x: None,
                    velocity_y: None,
                    velocity_z: None,
                    airborne: None,
                    walking: None,
                    duck_amount: None,
                    hp: 100,
                    armor: 0,
                    money: None,
                    equipment_value: None,
                    helmet: false,
                    kit: false,
                    alive: true,
                    team: 2,
                    active: Some(0),
                    weapons: vec![0],
                    fire: false,
                    right_click: false,
                    use_key: false,
                }],
            );
        }
        let c4_by_tick = BTreeMap::new();
        let projectiles_by_tick = BTreeMap::new();
        let round_scores = vec![(0, 1)];
        let ctx = RoundBuildContext {
            args: &args,
            events: &events,
            spans: &spans,
            rows_by_tick: &rows_by_tick,
            c4_by_tick: &c4_by_tick,
            projectiles_by_tick: &projectiles_by_tick,
            weapon_names: &weapon_names,
            round_scores: &round_scores,
            sample_step: 1,
        };

        let round = build_round_payload(&ctx, 0, 0).expect("round payload");
        let planted_at = seconds_since(0, 5);
        let exploded_at = seconds_since(0, 10);

        assert!(
            round.frames.iter().any(|frame| frame.t >= planted_at
                && frame.t < exploded_at
                && frame
                    .bomb
                    .as_ref()
                    .is_some_and(|bomb| bomb.status == "planted")),
            "expected planted bomb before explicit explosion"
        );
        assert!(
            round
                .frames
                .iter()
                .filter(|frame| frame.t >= exploded_at)
                .all(|frame| frame.bomb.is_none()),
            "bomb must not remain visible after explicit explosion"
        );
    }

    #[test]
    fn round_frames_fallback_drop_uses_last_carried_position_without_c4_position() {
        let args = Args {
            input: "demo.dem".into(),
            output: "out.json.gz".into(),
            quality: "full".into(),
            skip_projectiles: false,
            skip_weapon_fires: false,
            stats: false,
        };
        let events = Vec::new();
        let spans = vec![RoundSpan {
            start: 0,
            end: 2,
            round_end: 2,
            winner: "CT".into(),
        }];
        let weapon_names = vec!["weapon_c4".to_string(), "ak47".to_string()];
        let mut rows_by_tick = BTreeMap::new();
        for tick in 0..=2 {
            let (active, weapons) = if tick == 0 {
                (Some(0), vec![0])
            } else {
                (Some(1), vec![1])
            };
            rows_by_tick.insert(
                tick,
                vec![TickRow {
                    tick,
                    steamid: 7,
                    x: 100.0 + tick as f64,
                    y: 200.0,
                    z: 10.0,
                    yaw: 0.0,
                    pitch: None,
                    speed: None,
                    velocity_x: None,
                    velocity_y: None,
                    velocity_z: None,
                    airborne: None,
                    walking: None,
                    duck_amount: None,
                    hp: 100,
                    armor: 0,
                    money: None,
                    equipment_value: None,
                    helmet: false,
                    kit: false,
                    alive: true,
                    team: 2,
                    active,
                    weapons,
                    fire: false,
                    right_click: false,
                    use_key: false,
                }],
            );
        }
        let c4_by_tick = BTreeMap::new();
        let projectiles_by_tick = BTreeMap::new();
        let round_scores = vec![(1, 0)];
        let ctx = RoundBuildContext {
            args: &args,
            events: &events,
            spans: &spans,
            rows_by_tick: &rows_by_tick,
            c4_by_tick: &c4_by_tick,
            projectiles_by_tick: &projectiles_by_tick,
            weapon_names: &weapon_names,
            round_scores: &round_scores,
            sample_step: 1,
        };

        let round = build_round_payload(&ctx, 0, 0).expect("round payload");
        let carried = round
            .frames
            .iter()
            .find(|frame| frame.t == 0.0)
            .and_then(|frame| frame.bomb.as_ref())
            .expect("carried bomb");
        assert_eq!(carried.status, "carried");
        assert_eq!(carried.carrier, Some(7));

        let dropped = round
            .frames
            .iter()
            .find(|frame| (frame.t - (1.0 / super::TICK_RATE)).abs() < 0.001)
            .and_then(|frame| frame.bomb.as_ref())
            .expect("fallback dropped bomb");
        assert_eq!(dropped.status, "dropped");
        assert_eq!(dropped.carrier, None);
        assert_eq!((dropped.x, dropped.y, dropped.z), (100.0, 200.0, 10.0));
    }

    #[test]
    fn round_events_does_not_duplicate_explicit_bomb_exploded() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 200,
                "event_name": "round_end",
                "reason": "bomb_exploded"
            }),
            json!({
                "tick": 205,
                "event_name": "bomb_exploded"
            }),
        ];

        let parsed = round_events(&events, &span, None);
        let bomb_exploded: Vec<_> = parsed
            .iter()
            .filter(|event| event.kind == "bomb_exploded")
            .collect();

        assert_eq!(bomb_exploded.len(), 1);
        assert_eq!(bomb_exploded[0].t, seconds_since(span.start, 205));
    }

    #[test]
    fn round_events_synthesizes_ct_killed_bomb_explosion_after_long_post_round() {
        let span = RoundSpan {
            start: 100,
            end: 720,
            round_end: 200,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 150,
                "event_name": "bomb_planted"
            }),
            json!({
                "tick": 200,
                "event_name": "round_end",
                "reason": "ct_killed"
            }),
        ];

        let parsed = round_events(&events, &span, None);

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].kind, "bomb_planted");
        assert_eq!(parsed[1].kind, "round_end");
        assert_eq!(parsed[2].kind, "bomb_exploded");
        assert_eq!(parsed[2].t, seconds_since(span.start, 200));
    }

    #[test]
    fn round_events_does_not_synthesize_ct_killed_bomb_explosion_too_broadly() {
        let span = RoundSpan {
            start: 100,
            end: 300,
            round_end: 200,
            winner: "T".into(),
        };
        let next_span = RoundSpan {
            start: 400,
            end: 500,
            round_end: 500,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "tick": 150,
                "event_name": "bomb_planted"
            }),
            json!({
                "tick": 200,
                "event_name": "round_end",
                "reason": "ct_killed"
            }),
        ];

        let parsed = round_events(&events, &span, Some(&next_span));

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].kind, "bomb_planted");
        assert_eq!(parsed[1].kind, "round_end");
    }

    #[test]
    fn round_events_synthesizes_ct_killed_bomb_explosion_before_world_kills() {
        let span = RoundSpan {
            start: 100,
            end: 300,
            round_end: 200,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 150,
                "event_name": "bomb_planted"
            }),
            json!({
                "tick": 200,
                "event_name": "round_end",
                "reason": "ct_killed"
            }),
            json!({
                "tick": 260,
                "event_name": "player_death",
                "attacker_steamid": 1_u64,
                "user_steamid": 1_u64,
                "weapon": "world"
            }),
        ];

        let parsed = round_events(&events, &span, None);

        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[1].kind, "round_end");
        assert_eq!(parsed[2].kind, "bomb_exploded");
        assert_eq!(parsed[3].kind, "kill");
    }

    #[test]
    fn round_events_keeps_all_post_round_kill_shapes_after_bomb_explosion() {
        let span = RoundSpan {
            start: 100,
            end: 220,
            round_end: 200,
            winner: "T".into(),
        };
        let next_span = RoundSpan {
            start: 360,
            end: 500,
            round_end: 500,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "tick": 180,
                "event_name": "bomb_planted"
            }),
            json!({
                "tick": 205,
                "event_name": "bomb_exploded"
            }),
            json!({
                "tick": 206,
                "event_name": "player_death",
                "attacker_steamid": 10_u64,
                "user_steamid": 20_u64,
                "assister_steamid": 30_u64,
                "weapon": "ak47",
                "headshot": true
            }),
            json!({
                "tick": 207,
                "event_name": "player_death",
                "attacker_steamid": 40_u64,
                "user_steamid": 40_u64,
                "weapon": "molotov"
            }),
            json!({
                "tick": 208,
                "event_name": "player_death",
                "user_steamid": 50_u64,
                "weapon": "world"
            }),
        ];

        let parsed = round_events(&events, &span, Some(&next_span));
        let kills = parsed
            .iter()
            .filter(|event| event.kind == "kill")
            .collect::<Vec<_>>();

        assert_eq!(kills.len(), 3, "post-round kills after explosion were lost");
        assert_eq!(kills[0].killer, Some(10));
        assert_eq!(kills[0].victim, Some(20));
        assert_eq!(kills[0].assist, Some(30));
        assert_eq!(kills[0].weapon.as_deref(), Some("ak47"));
        assert!(kills[0].kill.hs);
        assert_eq!(kills[1].killer, Some(40));
        assert_eq!(kills[1].victim, Some(40));
        assert_eq!(kills[1].weapon.as_deref(), Some("molotov"));
        assert_eq!(kills[2].killer, None);
        assert_eq!(kills[2].victim, Some(50));
        assert_eq!(kills[2].weapon.as_deref(), Some("world"));
    }

    #[test]
    fn round_events_preserves_every_killfeed_modifier() {
        let span = RoundSpan {
            start: 100,
            end: 300,
            round_end: 300,
            winner: "CT".into(),
        };
        let events = vec![json!({
            "tick": 190,
            "event_name": "player_death",
            "attacker_steamid": 10_u64,
            "user_steamid": 20_u64,
            "assister_steamid": 30_u64,
            "weapon": "awp",
            "headshot": true,
            "assistedflash": true,
            "noscope": true,
            "thrusmoke": true,
            "attackerblind": true,
            "penetrated": 2,
            "dominated": 1,
            "revenge": 1
        })];

        let parsed = round_events(&events, &span, None);
        let kill = parsed.iter().find(|event| event.kind == "kill").unwrap();

        assert!(kill.kill.hs);
        assert!(kill.kill.flash_assist);
        assert!(kill.kill.no_scope);
        assert!(kill.kill.through_smoke);
        assert!(kill.kill.attacker_blind);
        assert_eq!(kill.kill.penetrated, 2);
        assert!(kill.kill.dominated);
        assert!(kill.kill.revenge);
    }

    #[test]
    fn round_events_synthesizes_ct_killed_bomb_explosion_on_final_round() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 150,
                "event_name": "bomb_planted"
            }),
            json!({
                "tick": 200,
                "event_name": "round_end",
                "reason": "ct_killed"
            }),
        ];

        let parsed = round_events(&events, &span, None);

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].kind, "bomb_planted");
        assert_eq!(parsed[1].kind, "round_end");
        assert_eq!(parsed[2].kind, "bomb_exploded");
    }

    #[test]
    fn round_events_synthesizes_abort_between_repeated_defuse_starts() {
        let span = RoundSpan {
            start: 100,
            end: 300,
            round_end: 300,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "tick": 150,
                "event_name": "bomb_begindefuse",
                "user_steamid": 7_u64
            }),
            json!({
                "tick": 170,
                "event_name": "bomb_begindefuse",
                "user_steamid": 7_u64
            }),
        ];

        let parsed = round_events(&events, &span, None);

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].kind, "bomb_defuse_start");
        assert_eq!(parsed[1].kind, "bomb_defuse_abort");
        assert_eq!(parsed[1].player, Some(7));
        assert_eq!(parsed[1].t, seconds_since(span.start, 170));
        assert_eq!(parsed[2].kind, "bomb_defuse_start");
    }

    #[test]
    fn round_events_synthesizes_abort_when_bomb_explodes_during_defuse() {
        let span = RoundSpan {
            start: 100,
            end: 300,
            round_end: 300,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 150,
                "event_name": "bomb_begindefuse",
                "user_steamid": 7_u64
            }),
            json!({
                "tick": 220,
                "event_name": "bomb_exploded"
            }),
        ];

        let parsed = round_events(&events, &span, None);

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].kind, "bomb_defuse_start");
        assert_eq!(parsed[1].kind, "bomb_defuse_abort");
        assert_eq!(parsed[1].player, Some(7));
        assert_eq!(parsed[2].kind, "bomb_exploded");
    }

    #[test]
    fn terminal_flash_effects_are_synthesized_from_projectiles() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "T".into(),
        };
        let projectile_frames = vec![ProjectileFrame {
            t: seconds_since(span.start, 199),
            projectiles: vec![ProjectilePos {
                id: 42,
                kind: ProjectileKind::Flash,
                x: 10.0,
                y: 20.0,
                z: 30.0,
                thrower: None,
            }],
        }];
        let mut effects = Vec::new();

        add_missing_terminal_flash_effects(
            &mut effects,
            &projectile_frames,
            &span,
            &BTreeMap::new(),
        );

        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0].kind, "flash");
        assert_eq!(effects[0].start, seconds_since(span.start, 200));
        assert_eq!(effects[0].x, 10.0);
    }

    #[test]
    fn terminal_flash_effects_do_not_duplicate_existing_effects() {
        let span = RoundSpan {
            start: 100,
            end: 200,
            round_end: 200,
            winner: "T".into(),
        };
        let projectile_frames = vec![ProjectileFrame {
            t: seconds_since(span.start, 199),
            projectiles: vec![ProjectilePos {
                id: 42,
                kind: ProjectileKind::Flash,
                x: 10.0,
                y: 20.0,
                z: 30.0,
                thrower: None,
            }],
        }];
        let mut effects = vec![UtilityEffect {
            kind: "flash".into(),
            variant: None,
            start: seconds_since(span.start, 200),
            end: seconds_since(span.start, 200) + 0.8,
            x: 10.0,
            y: 20.0,
            z: 30.0,
            team: None,
        }];

        add_missing_terminal_flash_effects(
            &mut effects,
            &projectile_frames,
            &span,
            &BTreeMap::new(),
        );

        assert_eq!(effects.len(), 1);
    }

    #[test]
    fn decoy_effect_start_uses_projectile_stationary_time() {
        let mut effects = vec![UtilityEffect {
            kind: "decoy".into(),
            variant: None,
            start: 20.0,
            end: 35.0,
            x: 100.0,
            y: 200.0,
            z: 10.0,
            team: Some(2),
        }];
        let mut projectile_frames = Vec::new();
        for idx in 0..20 {
            let t = idx as f64;
            let moving = idx < 4;
            projectile_frames.push(ProjectileFrame {
                t,
                projectiles: vec![ProjectilePos {
                    id: 7,
                    kind: ProjectileKind::Other("CDecoyProjectile".into()),
                    x: if moving { idx as f64 * 25.0 } else { 100.0 },
                    y: 200.0,
                    z: 10.0,
                    thrower: None,
                }],
            });
        }

        adjust_decoy_effects_from_projectiles(&mut effects, &projectile_frames);

        assert_eq!(effects[0].start, 4.0);
        assert_eq!(effects[0].end, 35.0);
    }

    #[test]
    fn fire_effect_end_uses_nearby_inferno_expire() {
        let span = RoundSpan {
            start: 100,
            end: 800,
            round_end: 800,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "event_name": "inferno_startburn",
                "tick": 164,
                "x": 100.0,
                "y": 200.0,
                "z": 20.0,
                "team_num": 2,
            }),
            json!({
                "event_name": "inferno_expire",
                "tick": 292,
                "x": 108.0,
                "y": 196.0,
                "z": 20.0,
            }),
        ];

        let effects = round_effects(&events, &span, &BTreeMap::new());

        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0].kind, "fire");
        assert!((effects[0].start - seconds_since(span.start, 164)).abs() < 0.001);
        assert!((effects[0].end - seconds_since(span.start, 292)).abs() < 0.001);
    }

    #[test]
    fn fire_effect_ignores_far_inferno_expire() {
        let span = RoundSpan {
            start: 100,
            end: 800,
            round_end: 800,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "event_name": "inferno_startburn",
                "tick": 164,
                "x": 100.0,
                "y": 200.0,
                "z": 20.0,
            }),
            json!({
                "event_name": "inferno_expire",
                "tick": 292,
                "x": 900.0,
                "y": 900.0,
                "z": 20.0,
            }),
        ];

        let effects = round_effects(&events, &span, &BTreeMap::new());

        assert_eq!(effects.len(), 1);
        assert!((effects[0].end - (effects[0].start + 7.0)).abs() < 0.001);
    }

    #[test]
    fn fire_effect_uses_latest_nearby_cell_expire() {
        let span = RoundSpan {
            start: 100,
            end: 900,
            round_end: 900,
            winner: "CT".into(),
        };
        let events = vec![
            json!({
                "event_name": "inferno_startburn",
                "tick": 164,
                "x": 100.0,
                "y": 200.0,
                "z": 20.0,
            }),
            json!({
                "event_name": "inferno_expire",
                "tick": 516,
                "x": 108.0,
                "y": 196.0,
                "z": 20.0,
            }),
            json!({
                "event_name": "inferno_expire",
                "tick": 612,
                "x": 112.0,
                "y": 204.0,
                "z": 20.0,
            }),
        ];

        let effects = round_effects(&events, &span, &BTreeMap::new());

        assert_eq!(effects.len(), 1);
        assert!((effects[0].end - seconds_since(span.start, 612)).abs() < 0.001);
    }

    #[test]
    fn projectile_grouping_keeps_id_across_small_terminal_snap() {
        let rows = vec![
            ProjectileRow {
                tick: 100,
                entity_id: 10,
                kind: ProjectileKind::Smoke,
                x: 257.1,
                y: -567.7,
                z: 1704.4,
                thrower: Some(76561198089762164),
            },
            ProjectileRow {
                tick: 101,
                entity_id: 11,
                kind: ProjectileKind::Smoke,
                x: 254.6,
                y: -606.8,
                z: 1613.9,
                thrower: Some(76561198089762164),
            },
            ProjectileRow {
                tick: 102,
                entity_id: 11,
                kind: ProjectileKind::Smoke,
                x: 254.6,
                y: -606.8,
                z: 1613.9,
                thrower: Some(76561198089762164),
            },
        ];

        let grouped = group_projectile_rows(rows);
        let ids = grouped
            .values()
            .flat_map(|projectiles| projectiles.iter().map(|projectile| projectile.id))
            .collect::<Vec<_>>();

        assert_eq!(ids, vec![1_000_000_000, 1_000_000_000, 1_000_000_000]);
    }

    #[test]
    fn projectile_grouping_removes_physical_duplicates_in_same_tick() {
        let rows = vec![
            ProjectileRow {
                tick: 100,
                entity_id: 10,
                kind: ProjectileKind::Flash,
                x: 100.0,
                y: 200.0,
                z: 300.0,
                thrower: Some(76561198089762164),
            },
            ProjectileRow {
                tick: 100,
                entity_id: 11,
                kind: ProjectileKind::Flash,
                x: 103.0,
                y: 204.0,
                z: 300.0,
                thrower: Some(76561198089762164),
            },
            ProjectileRow {
                tick: 100,
                entity_id: 12,
                kind: ProjectileKind::Flash,
                x: 107.0,
                y: 200.0,
                z: 300.0,
                thrower: Some(76561198089762164),
            },
        ];

        let grouped = group_projectile_rows(rows);
        let projectiles = grouped.get(&100).expect("projectile frame");

        assert_eq!(projectiles.len(), 2);
        assert_eq!(projectiles[0].id, 1_000_000_000);
        assert_eq!(projectiles[1].id, 1_000_000_001);
        assert_eq!(projectiles[0].x, 100.0);
        assert_eq!(projectiles[1].x, 107.0);
    }

    #[test]
    fn round_weapon_fires_use_exact_shooter_pose_when_available() {
        let span = RoundSpan {
            start: 100,
            end: 120,
            round_end: 120,
            winner: "T".into(),
        };
        let events = vec![json!({
            "tick": 110,
            "event_name": "weapon_fire",
            "user_steamid": 7_u64,
            "weapon": "ak47"
        })];
        let mut rows_by_tick = BTreeMap::new();
        rows_by_tick.insert(
            110,
            vec![TickRow {
                tick: 110,
                steamid: 7,
                x: 123.0,
                y: 456.0,
                z: 78.0,
                yaw: 270.0,
                pitch: None,
                speed: None,
                velocity_x: None,
                velocity_y: None,
                velocity_z: None,
                airborne: None,
                walking: None,
                duck_amount: None,
                hp: 100,
                armor: 100,
                money: None,
                equipment_value: None,
                helmet: true,
                kit: false,
                alive: true,
                team: 2,
                active: None,
                weapons: Vec::new(),
                fire: false,
                right_click: false,
                use_key: false,
            }],
        );

        let fires = round_weapon_fires(&events, &span, &rows_by_tick);

        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].t, seconds_since(span.start, 110));
        assert_eq!(fires[0].tick, 110);
        assert_eq!(fires[0].sequence, 0);
        assert_eq!(fires[0].shooter, Some(7));
        assert_eq!(fires[0].weapon.as_deref(), Some("ak47"));
        assert_eq!((fires[0].x, fires[0].y, fires[0].z), (123.0, 456.0, 78.0));
        assert_eq!(fires[0].yaw, 270.0);
        assert_eq!(fires[0].team, Some(2));
    }

    #[test]
    fn round_weapon_fires_use_previous_shooter_pose_when_exact_tick_is_missing() {
        let span = RoundSpan {
            start: 100,
            end: 120,
            round_end: 120,
            winner: "CT".into(),
        };
        let events = vec![json!({
            "tick": 110,
            "event_name": "weapon_fire",
            "user_steamid": 7_u64,
            "weapon": "m4a1_silencer"
        })];
        let mut rows_by_tick = BTreeMap::new();
        rows_by_tick.insert(
            110,
            vec![TickRow {
                tick: 110,
                steamid: 8,
                x: 1.0,
                y: 2.0,
                z: 3.0,
                yaw: 4.0,
                pitch: None,
                speed: None,
                velocity_x: None,
                velocity_y: None,
                velocity_z: None,
                airborne: None,
                walking: None,
                duck_amount: None,
                hp: 100,
                armor: 100,
                money: None,
                equipment_value: None,
                helmet: true,
                kit: true,
                alive: true,
                team: 3,
                active: None,
                weapons: Vec::new(),
                fire: false,
                right_click: false,
                use_key: false,
            }],
        );
        rows_by_tick.insert(
            109,
            vec![TickRow {
                tick: 109,
                steamid: 8,
                x: 10.0,
                y: 20.0,
                z: 30.0,
                yaw: 40.0,
                pitch: None,
                speed: None,
                velocity_x: None,
                velocity_y: None,
                velocity_z: None,
                airborne: None,
                walking: None,
                duck_amount: None,
                hp: 100,
                armor: 100,
                money: None,
                equipment_value: None,
                helmet: true,
                kit: true,
                alive: true,
                team: 3,
                active: None,
                weapons: Vec::new(),
                fire: false,
                right_click: false,
                use_key: false,
            }],
        );
        rows_by_tick.insert(
            108,
            vec![TickRow {
                tick: 108,
                steamid: 7,
                x: -321.0,
                y: 654.0,
                z: 12.0,
                yaw: 91.0,
                pitch: None,
                speed: None,
                velocity_x: None,
                velocity_y: None,
                velocity_z: None,
                airborne: None,
                walking: None,
                duck_amount: None,
                hp: 87,
                armor: 50,
                money: None,
                equipment_value: None,
                helmet: true,
                kit: true,
                alive: true,
                team: 3,
                active: None,
                weapons: Vec::new(),
                fire: false,
                right_click: false,
                use_key: false,
            }],
        );

        let fires = round_weapon_fires(&events, &span, &rows_by_tick);

        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].t, seconds_since(span.start, 110));
        assert_eq!(fires[0].shooter, Some(7));
        assert_eq!(fires[0].weapon.as_deref(), Some("m4a1_silencer"));
        assert_eq!((fires[0].x, fires[0].y, fires[0].z), (-321.0, 654.0, 12.0));
        assert_eq!(fires[0].yaw, 91.0);
        assert_eq!(fires[0].team, Some(3));
    }

    #[test]
    fn round_weapon_fires_keep_event_when_shooter_pose_is_unavailable() {
        let span = RoundSpan {
            start: 100,
            end: 120,
            round_end: 120,
            winner: "T".into(),
        };
        let events = vec![
            json!({
                "tick": 110,
                "event_name": "weapon_fire",
                "user_steamid": 7_u64,
                "weapon": "deagle"
            }),
            json!({
                "tick": 111,
                "event_name": "weapon_fire",
                "weapon": "flashbang"
            }),
        ];
        let mut rows_by_tick = BTreeMap::new();
        rows_by_tick.insert(
            99,
            vec![TickRow {
                tick: 99,
                steamid: 7,
                x: 999.0,
                y: 999.0,
                z: 999.0,
                yaw: 180.0,
                pitch: None,
                speed: None,
                velocity_x: None,
                velocity_y: None,
                velocity_z: None,
                airborne: None,
                walking: None,
                duck_amount: None,
                hp: 100,
                armor: 100,
                money: None,
                equipment_value: None,
                helmet: true,
                kit: false,
                alive: true,
                team: 2,
                active: None,
                weapons: Vec::new(),
                fire: false,
                right_click: false,
                use_key: false,
            }],
        );

        let fires = round_weapon_fires(&events, &span, &rows_by_tick);

        assert_eq!(fires.len(), 2);
        assert_eq!(fires[0].tick, 110);
        assert_eq!(fires[0].sequence, 0);
        assert_eq!(fires[1].tick, 111);
        assert_eq!(fires[1].sequence, 1);
        assert_eq!(fires[0].shooter, Some(7));
        assert_eq!(fires[0].weapon.as_deref(), Some("deagle"));
        assert_eq!((fires[0].x, fires[0].y, fires[0].z), (0.0, 0.0, 0.0));
        assert_eq!(fires[0].yaw, 0.0);
        assert_eq!(fires[0].team, None);
        assert_eq!(fires[1].shooter, None);
        assert_eq!(fires[1].weapon.as_deref(), Some("flashbang"));
        assert_eq!((fires[1].x, fires[1].y, fires[1].z), (0.0, 0.0, 0.0));
        assert_eq!(fires[1].yaw, 0.0);
        assert_eq!(fires[1].team, None);
    }

    #[test]
    fn round_bullet_impacts_preserve_exact_event_coordinates_and_order() {
        let span = RoundSpan {
            start: 1_000,
            end: 2_000,
            round_end: 2_000,
            winner: "CT".into(),
        };
        let steam_id = 76_561_198_073_049_527_u64;
        let events = vec![
            json!({
                "event_name": "bullet_impact",
                "tick": 1_064,
                "user_steamid": steam_id,
                "x": 12.5,
                "y": -24.25,
                "z": 73.0
            }),
            json!({
                "event_name": "bullet_impact",
                "tick": 1_096,
                "user_steamid": 0,
                "X": -10.0,
                "Y": 20.0,
                "Z": 30.0
            }),
            json!({
                "event_name": "bullet_impact",
                "tick": 1_128,
                "user_steamid": steam_id,
                "x": 1.0,
                "y": 2.0
            }),
            json!({
                "event_name": "bullet_impact",
                "tick": 2_001,
                "user_steamid": steam_id,
                "x": 1.0,
                "y": 2.0,
                "z": 3.0
            }),
            json!({
                "event_name": "weapon_fire",
                "tick": 1_064,
                "user_steamid": steam_id,
                "x": 99.0,
                "y": 99.0,
                "z": 99.0
            }),
        ];

        let impacts = round_bullet_impacts(&events, &span);

        assert_eq!(impacts.len(), 2);
        assert_eq!(impacts[0].t, 1.0);
        assert_eq!(impacts[0].tick, 1_064);
        assert_eq!(impacts[0].sequence, 0);
        assert_eq!(impacts[0].shooter, Some(steam_id));
        assert_eq!(
            (impacts[0].x, impacts[0].y, impacts[0].z),
            (12.5, -24.25, 73.0)
        );
        assert_eq!(impacts[1].t, 1.5);
        assert_eq!(impacts[1].sequence, 1);
        assert_eq!(impacts[1].shooter, None);
        assert_eq!(
            (impacts[1].x, impacts[1].y, impacts[1].z),
            (-10.0, 20.0, 30.0)
        );

        let serialized = serde_json::to_value(&impacts[0]).unwrap();
        assert_eq!(serialized["shooter"], steam_id.to_string());
    }

    #[test]
    fn player_frames_preserve_pitch_velocity_and_movement_state() {
        let row = TickRow {
            tick: 1_064,
            steamid: 7,
            x: 100.0,
            y: 200.0,
            z: 64.0,
            yaw: 90.0,
            pitch: Some(-12.5),
            speed: Some(155.25),
            velocity_x: Some(120.0),
            velocity_y: Some(-98.0),
            velocity_z: Some(4.0),
            airborne: Some(true),
            walking: Some(false),
            duck_amount: Some(0.65),
            hp: 100,
            armor: 50,
            money: Some(3_500),
            equipment_value: Some(4_200),
            helmet: true,
            kit: false,
            alive: true,
            team: 2,
            active: None,
            weapons: Vec::new(),
            fire: false,
            right_click: false,
            use_key: false,
        };

        let player = player_pos_from_row(&row, &[], &[], 1.0, None).expect("alive player");

        assert_eq!(player.pitch, Some(-12.5));
        assert_eq!(player.speed, Some(155.25));
        assert_eq!(player.velocity_x, Some(120.0));
        assert_eq!(player.velocity_y, Some(-98.0));
        assert_eq!(player.velocity_z, Some(4.0));
        assert_eq!(player.airborne, Some(true));
        assert_eq!(player.walking, Some(false));
        assert_eq!(player.duck_amount, Some(0.65));
        let serialized = serde_json::to_value(player).unwrap();
        assert_eq!(serialized["velocityX"], 120.0);
        assert_eq!(serialized["velocityY"], -98.0);
        assert_eq!(serialized["velocityZ"], 4.0);
        assert_eq!(serialized["duckAmount"], 0.65);
    }

    #[test]
    fn round_flashes_preserve_thrower_victim_duration_and_drive_blind_frames() {
        let span = RoundSpan {
            start: 1_000,
            end: 2_000,
            round_end: 2_000,
            winner: "CT".into(),
        };
        let thrower = 76_561_198_073_049_527_u64;
        let victim = 76_561_198_073_049_528_u64;
        let events = vec![
            json!({
                "event_name": "player_blind",
                "tick": 1_064,
                "attacker_steamid": thrower,
                "user_steamid": victim,
                "blind_duration": 3.25
            }),
            json!({
                "event_name": "player_blind",
                "tick": 1_128,
                "attacker_steamid": thrower,
                "blind_duration": 0.5
            }),
            json!({
                "event_name": "player_blind",
                "tick": 1_192,
                "attacker_steamid": thrower,
                "user_steamid": victim,
                "blind_duration": 0.0
            }),
            json!({
                "event_name": "player_blind",
                "tick": 2_001,
                "attacker_steamid": thrower,
                "user_steamid": victim,
                "blind_duration": 2.0
            }),
        ];

        let flashes = round_flashes(&events, &span);

        assert_eq!(flashes.len(), 2);
        assert_eq!(flashes[0].t, 1.0);
        assert_eq!(flashes[0].tick, 1_064);
        assert_eq!(flashes[0].sequence, 0);
        assert_eq!(flashes[0].thrower, Some(thrower));
        assert_eq!(flashes[0].victim, Some(victim));
        assert_eq!(flashes[0].duration, 3.25);
        assert_eq!(flashes[1].sequence, 1);
        assert_eq!(flashes[1].victim, None);

        let blind_spans = blind_spans_from_flashes(&flashes);
        assert_eq!(blind_spans.len(), 1);
        assert_eq!(blind_spans[0].player, victim);
        assert_eq!(blind_spans[0].start, 1.0);
        assert_eq!(blind_spans[0].end, 4.25);
        assert_eq!(blind_spans[0].total, 3.25);

        let serialized = serde_json::to_value(&flashes[0]).unwrap();
        assert_eq!(serialized["thrower"], thrower.to_string());
        assert_eq!(serialized["victim"], victim.to_string());
    }

    #[test]
    fn round_purchases_include_freeze_time_and_preserve_sellback_facts() {
        let previous_span = RoundSpan {
            start: 100,
            end: 800,
            round_end: 780,
            winner: "T".into(),
        };
        let span = RoundSpan {
            start: 1_000,
            end: 2_000,
            round_end: 1_950,
            winner: "CT".into(),
        };
        let player = 76_561_198_073_049_527_u64;
        let events = vec![
            json!({
                "event_name": "item_purchase",
                "tick": 700,
                "steamid": player,
                "item_name": "Glock-18",
                "cost": 200
            }),
            json!({ "event_name": "round_start", "tick": 900 }),
            json!({
                "event_name": "item_purchase",
                "tick": 920,
                "steamid": player,
                "item_name": "AK-47",
                "cost": 2_700,
                "inventory_slot": 1,
                "was_sold": true
            }),
            json!({
                "event_name": "item_purchase",
                "tick": 1_100,
                "steamid": player,
                "item_name": "Flashbang",
                "cost": 200,
                "inventory_slot": 3,
                "was_sold": false
            }),
            json!({
                "event_name": "item_purchase",
                "tick": 1_120,
                "steamid": player,
                "cost": 300
            }),
        ];

        let purchases = round_purchases(&events, &span, Some(&previous_span));

        assert_eq!(purchases.len(), 2);
        assert_eq!(purchases[0].t, 0.0);
        assert_eq!(purchases[0].tick, 920);
        assert_eq!(purchases[0].sequence, 2);
        assert_eq!(purchases[0].player, Some(player));
        assert_eq!(purchases[0].item, "AK-47");
        assert_eq!(purchases[0].cost, Some(2_700));
        assert_eq!(purchases[0].inventory_slot, Some(1));
        assert_eq!(purchases[0].was_sold, Some(true));
        assert_eq!(purchases[1].t, 1.5625);
        assert_eq!(purchases[1].item, "Flashbang");
        assert_eq!(purchases[1].was_sold, Some(false));

        let serialized = serde_json::to_value(&purchases[0]).unwrap();
        assert_eq!(serialized["player"], player.to_string());
        assert_eq!(serialized["inventorySlot"], 1);
        assert_eq!(serialized["wasSold"], true);
    }

    #[test]
    fn knife_round_detection_allows_long_pregame_duels() {
        let round = Round {
            number: 0,
            start_tick: 0,
            freeze_end_tick: 0,
            end_tick: 5_000,
            duration: 80.0,
            winner: "T".into(),
            score_a: 1,
            score_b: 0,
            frames: vec![Frame {
                t: 0.0,
                players: Vec::new(),
                bomb: None,
                projectiles: Vec::new(),
            }],
            events: vec![Event {
                t: 10.0,
                tick: 640,
                sequence: 0,
                kind: "kill".into(),
                player: None,
                has_kit: false,
                killer: Some(1),
                victim: Some(2),
                assist: None,
                weapon: Some("knife_m9_bayonet".into()),
                kill: KillDetails::default(),
                winner: None,
            }],
            damages: Vec::new(),
            disconnects: Vec::new(),
            flashes: Vec::new(),
            purchases: Vec::new(),
            effects: Vec::new(),
            weapon_fires: Vec::new(),
            bullet_impacts: Vec::new(),
            projectile_frames: Vec::new(),
        };

        assert!(looks_like_knife_round(Some(&round)));
    }

    #[test]
    fn round_damages_preserve_complete_player_hurt_facts() {
        let span = RoundSpan {
            start: 1_000,
            end: 2_000,
            round_end: 2_000,
            winner: "CT".into(),
        };
        let events = vec![
            serde_json::json!({
                "event_name": "player_hurt",
                "tick": 1_064,
                "attacker_steamid": 10_u64,
                "user_steamid": 20_u64,
                "weapon": "ak47",
                "dmg_health": 27,
                "dmg_armor": 4,
                "health": 73,
                "armor": 96,
                "hitgroup": "chest"
            }),
            serde_json::json!({
                "event_name": "player_hurt",
                "tick": 2_001,
                "attacker_steamid": 10_u64,
                "user_steamid": 20_u64,
                "dmg_health": 73
            }),
        ];

        let damages = round_damages(&events, &span);

        assert_eq!(damages.len(), 1);
        let damage = &damages[0];
        assert_eq!(damage.t, 1.0);
        assert_eq!(damage.tick, 1_064);
        assert_eq!(damage.sequence, 0);
        assert_eq!(damage.attacker, Some(10));
        assert_eq!(damage.victim, Some(20));
        assert_eq!(damage.weapon.as_deref(), Some("ak47"));
        assert_eq!(damage.damage_health, 27);
        assert_eq!(damage.damage_armor, 4);
        assert_eq!(damage.health_after, 73);
        assert_eq!(damage.armor_after, 96);
        assert_eq!(damage.hitgroup.as_deref(), Some("chest"));
    }

    #[test]
    fn round_disconnects_preserve_player_and_exact_tick() {
        let span = RoundSpan {
            start: 1_000,
            end: 2_000,
            round_end: 2_000,
            winner: "CT".into(),
        };
        let events = vec![
            serde_json::json!({
                "event_name": "player_disconnect",
                "tick": 1_128,
                "user_steamid": 76_561_198_073_049_527_u64
            }),
            serde_json::json!({
                "event_name": "player_disconnect",
                "tick": 2_001,
                "user_steamid": 10_u64
            }),
        ];

        let disconnects = round_disconnects(&events, &span);

        assert_eq!(disconnects.len(), 1);
        assert_eq!(disconnects[0].t, 2.0);
        assert_eq!(disconnects[0].tick, 1_128);
        assert_eq!(disconnects[0].sequence, 0);
        assert_eq!(disconnects[0].player, Some(76_561_198_073_049_527));
    }

    #[test]
    fn replay_v2_serializes_steam_ids_without_precision_loss() {
        let steam_id = 76_561_198_073_049_527_u64;
        let player = serde_json::to_value(Player {
            steam_id,
            name: "Player".into(),
            team: "T".into(),
        })
        .unwrap();
        let damage = serde_json::to_value(DamageEvent {
            t: 1.0,
            tick: 64,
            sequence: 0,
            attacker: Some(steam_id),
            victim: Some(steam_id + 1),
            weapon: Some("ak47".into()),
            damage_health: 27,
            damage_armor: 4,
            health_after: 73,
            armor_after: 96,
            hitgroup: Some("chest".into()),
        })
        .unwrap();

        assert_eq!(player["steamId"], steam_id.to_string());
        assert_eq!(damage["attacker"], steam_id.to_string());
        assert_eq!(damage["victim"], (steam_id + 1).to_string());
    }

    #[test]
    fn knife_round_detection_rejects_real_weapon_rounds() {
        let round = Round {
            number: 0,
            start_tick: 0,
            freeze_end_tick: 0,
            end_tick: 5_000,
            duration: 80.0,
            winner: "CT".into(),
            score_a: 0,
            score_b: 1,
            frames: Vec::new(),
            events: vec![Event {
                t: 10.0,
                tick: 640,
                sequence: 0,
                kind: "kill".into(),
                player: None,
                has_kit: false,
                killer: Some(1),
                victim: Some(2),
                assist: None,
                weapon: Some("ak47".into()),
                kill: KillDetails::default(),
                winner: None,
            }],
            damages: Vec::new(),
            disconnects: Vec::new(),
            flashes: Vec::new(),
            purchases: Vec::new(),
            effects: Vec::new(),
            weapon_fires: Vec::new(),
            bullet_impacts: Vec::new(),
            projectile_frames: Vec::new(),
        };

        assert!(!looks_like_knife_round(Some(&round)));
    }

    #[test]
    fn parser_gzip_compression_defaults_to_standard_and_allows_override() {
        EnvVarGuard::remove("ROUNDLAB_PARSER_GZIP_LEVEL");
        assert_eq!(
            parser_gzip_compression().level(),
            Compression::default().level()
        );

        {
            let _guard = EnvVarGuard::set("ROUNDLAB_PARSER_GZIP_LEVEL", "6");
            assert_eq!(parser_gzip_compression().level(), 6);
        }
        {
            let _guard = EnvVarGuard::set("ROUNDLAB_PARSER_GZIP_LEVEL", "99");
            assert_eq!(
                parser_gzip_compression().level(),
                Compression::default().level()
            );
        }
    }

    #[test]
    fn roundlab_test_demo_produces_replay_json_when_configured() {
        let inputs = configured_test_demo_paths();
        if inputs.is_empty() {
            eprintln!(
                "skipping parser integration test: ROUNDLAB_TEST_DEMOS/ROUNDLAB_TEST_DEMO is not set"
            );
            return;
        }

        for input in inputs {
            let dir = tempfile::tempdir().unwrap();
            let output_path = dir.path().join("parsed.json.gz");
            let args = Args {
                input,
                output: output_path.to_string_lossy().into_owned(),
                quality: "full".into(),
                skip_projectiles: false,
                skip_weapon_fires: false,
                stats: true,
            };

            let output = parse_demo_to_output(&args).unwrap();
            assert_replay_output_is_usable(&output);
            assert_round_level_replay_integrity(&output);
            assert_projectiles_are_not_duplicated_in_frames(&output);
            if let Some(expected) = expected_snapshot_for_demo(&args.input) {
                assert_reference_demo_snapshot(&output, &expected);
            }

            write_json_gz(&args.output, &output).unwrap();
            let json = read_gzip_json(&output_path);
            assert_manifest_json_contract(&json);
            assert_eq!(
                json["rounds"].as_array().unwrap().len(),
                output.rounds.len()
            );
            assert!(json["meta"]["tickRate"].as_f64().unwrap_or_default() > 0.0);
            assert!(json["players"].as_array().unwrap().len() >= output.players.len());
            assert_split_output_is_usable(&output_path, &json, &output);
            if let Some(expected) = expected_snapshot_for_demo(&args.input) {
                assert_split_reference_demo_snapshot(&json, &expected);
            }
        }
    }

    #[test]
    fn roundlab_test_demo_honors_quality_and_skip_options_when_configured() {
        let inputs = configured_test_demo_paths();
        if inputs.is_empty() {
            eprintln!(
                "skipping parser integration test: ROUNDLAB_TEST_DEMOS/ROUNDLAB_TEST_DEMO is not set"
            );
            return;
        }

        for input in inputs {
            let dir = tempfile::tempdir().unwrap();
            let output_path = dir.path().join("parsed-medium-skip.json.gz");
            let args = Args {
                input,
                output: output_path.to_string_lossy().into_owned(),
                quality: "medium".into(),
                skip_projectiles: true,
                skip_weapon_fires: true,
                stats: true,
            };

            let output = parse_demo_to_output(&args).unwrap();
            assert_core_replay_output_is_usable(&output);
            assert_round_level_core_integrity(&output);
            assert_eq!(output.meta.sample_rate, 2);
            assert_skip_options_removed_heavy_payloads(&output);
            if let Some(expected) = expected_snapshot_for_demo(&args.input) {
                assert_reference_demo_identity(&output, &expected);
                assert_metrics_match_reference(
                    &collect_replay_metrics(&output),
                    &expected.medium_skip_metrics,
                    &expected.label,
                );
            }

            write_json_gz(&args.output, &output).unwrap();
            let json = read_gzip_json(&output_path);
            assert_split_output_omits_skipped_payloads(&output_path, &json, &output);
        }
    }

    #[test]
    fn commit_split_output_rolls_back_when_manifest_commit_fails() {
        let dir = tempfile::tempdir().unwrap();
        let output_path = dir.path().join("parsed.json.gz");
        let rounds_dir = dir.path().join("parsed");
        let staging_rounds_dir = dir.path().join("staging-rounds");
        let missing_temp_manifest = dir.path().join("missing-manifest.json.gz");
        let backup_rounds_dir = dir.path().join("backup-rounds");
        let backup_manifest_path = dir.path().join("backup-manifest.json.gz");

        std::fs::create_dir_all(&rounds_dir).unwrap();
        std::fs::write(rounds_dir.join("round-000.json.gz"), b"old-round").unwrap();
        std::fs::write(&output_path, b"old-manifest").unwrap();
        std::fs::create_dir_all(&staging_rounds_dir).unwrap();
        std::fs::write(staging_rounds_dir.join("round-000.json.gz"), b"new-round").unwrap();

        let err = commit_split_output(
            &output_path,
            &rounds_dir,
            &staging_rounds_dir,
            &missing_temp_manifest,
            &backup_rounds_dir,
            &backup_manifest_path,
        )
        .unwrap_err();
        assert!(
            format!("{err:#}").contains("commit manifest"),
            "unexpected error: {err:#}"
        );
        assert_eq!(std::fs::read(&output_path).unwrap(), b"old-manifest");
        assert_eq!(
            std::fs::read(rounds_dir.join("round-000.json.gz")).unwrap(),
            b"old-round"
        );
        assert!(
            !backup_rounds_dir.exists(),
            "round backup should be restored"
        );
        assert!(
            !backup_manifest_path.exists(),
            "manifest backup should be restored"
        );
    }

    #[test]
    fn commit_split_output_replaces_existing_output_and_cleans_backups() {
        let dir = tempfile::tempdir().unwrap();
        let output_path = dir.path().join("parsed.json.gz");
        let rounds_dir = dir.path().join("parsed");
        let staging_rounds_dir = dir.path().join("staging-rounds");
        let temp_manifest_path = dir.path().join("new-manifest.json.gz");
        let backup_rounds_dir = dir.path().join("backup-rounds");
        let backup_manifest_path = dir.path().join("backup-manifest.json.gz");

        std::fs::create_dir_all(&rounds_dir).unwrap();
        std::fs::write(rounds_dir.join("round-000.json.gz"), b"old-round").unwrap();
        std::fs::write(&output_path, b"old-manifest").unwrap();
        std::fs::create_dir_all(&staging_rounds_dir).unwrap();
        std::fs::write(staging_rounds_dir.join("round-000.json.gz"), b"new-round").unwrap();
        std::fs::write(&temp_manifest_path, b"new-manifest").unwrap();

        commit_split_output(
            &output_path,
            &rounds_dir,
            &staging_rounds_dir,
            &temp_manifest_path,
            &backup_rounds_dir,
            &backup_manifest_path,
        )
        .expect("commit split output");

        assert_eq!(std::fs::read(&output_path).unwrap(), b"new-manifest");
        assert_eq!(
            std::fs::read(rounds_dir.join("round-000.json.gz")).unwrap(),
            b"new-round"
        );
        assert!(!staging_rounds_dir.exists());
        assert!(!temp_manifest_path.exists());
        assert!(!backup_rounds_dir.exists());
        assert!(!backup_manifest_path.exists());
    }

    fn assert_split_output_is_usable(output_path: &Path, manifest: &Value, output: &Output) {
        let rounds = manifest["rounds"]
            .as_array()
            .expect("manifest rounds array");
        let base_dir = output_path.parent().expect("output path parent");
        let mut split_total_frames = 0usize;
        let mut split_total_events = 0usize;
        let mut split_total_damages = 0usize;
        let mut split_total_kills = 0usize;
        let mut split_total_bomb_events = 0usize;
        let mut split_total_effects = 0usize;
        let mut split_total_weapon_fires = 0usize;
        let mut split_total_projectile_frames = 0usize;
        let mut split_frames_with_players = 0usize;
        let mut split_frames_with_bomb_state = 0usize;
        let mut split_players_with_weapons = 0usize;
        let mut split_frames_with_embedded_projectiles = 0usize;

        for (idx, manifest_round) in rounds.iter().enumerate() {
            assert_manifest_round_json_contract(manifest_round);
            assert_eq!(
                manifest_round["frames"].as_array().unwrap().len(),
                0,
                "manifest round should not contain frame payloads"
            );
            assert_eq!(
                manifest_round["events"].as_array().unwrap().len(),
                0,
                "manifest round should not contain event payloads"
            );
            assert_eq!(
                manifest_round["damages"].as_array().unwrap().len(),
                0,
                "manifest round should not contain damage payloads"
            );
            assert_eq!(
                manifest_round["disconnects"].as_array().unwrap().len(),
                0,
                "manifest round should not contain disconnect payloads"
            );
            let round_file = manifest_round["roundFile"]
                .as_str()
                .expect("manifest roundFile");
            assert!(
                !round_file.contains("..") && !round_file.starts_with('/'),
                "roundFile must stay relative and safe: {round_file}"
            );
            let round_path = base_dir.join(round_file);
            assert!(
                round_path.exists(),
                "missing split round file: {round_file}"
            );
            let round_json = read_gzip_json(&round_path);
            assert_round_json_contract(&round_json);
            assert_eq!(
                round_json["number"].as_u64().unwrap(),
                output.rounds[idx].number as u64
            );
            assert!(
                round_json.get("roundFile").is_none(),
                "full round payload must not recursively point to another roundFile"
            );

            let frames = round_json["frames"].as_array().expect("round frames array");
            let events = round_json["events"].as_array().expect("round events array");
            let damages = round_json["damages"]
                .as_array()
                .expect("round damages array");
            let disconnects = round_json["disconnects"]
                .as_array()
                .expect("round disconnects array");
            let effects = round_json
                .get("effects")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            let weapon_fires = round_json
                .get("weaponFires")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            let projectile_frames = round_json
                .get("projectileFrames")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();

            assert_eq!(frames.len(), output.rounds[idx].frames.len());
            assert_eq!(events.len(), output.rounds[idx].events.len());
            assert_eq!(damages.len(), output.rounds[idx].damages.len());
            assert_eq!(disconnects.len(), output.rounds[idx].disconnects.len());
            assert_eq!(effects, output.rounds[idx].effects.len());
            assert_eq!(weapon_fires, output.rounds[idx].weapon_fires.len());
            assert_eq!(
                projectile_frames,
                output.rounds[idx].projectile_frames.len()
            );

            split_total_frames += frames.len();
            split_total_events += events.len();
            split_total_damages += damages.len();
            split_total_effects += effects;
            split_total_weapon_fires += weapon_fires;
            split_total_projectile_frames += projectile_frames;

            for frame in frames {
                let players = frame
                    .get("players")
                    .and_then(Value::as_array)
                    .expect("frame players array");
                if !players.is_empty() {
                    split_frames_with_players += 1;
                }
                if frame.get("bomb").is_some_and(|bomb| !bomb.is_null()) {
                    split_frames_with_bomb_state += 1;
                }
                if frame
                    .get("projectiles")
                    .and_then(Value::as_array)
                    .is_some_and(|projectiles| !projectiles.is_empty())
                {
                    split_frames_with_embedded_projectiles += 1;
                }
                split_players_with_weapons += players
                    .iter()
                    .filter(|player| {
                        player
                            .get("active")
                            .and_then(Value::as_str)
                            .is_some_and(|active| !active.is_empty())
                            || player
                                .get("weapons")
                                .and_then(Value::as_array)
                                .is_some_and(|weapons| !weapons.is_empty())
                    })
                    .count();
            }

            for event in events {
                match event
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "kill" => split_total_kills += 1,
                    "bomb_planted" | "bomb_defuse_start" | "bomb_defuse_abort" | "bomb_defused"
                    | "bomb_exploded" => split_total_bomb_events += 1,
                    _ => {}
                }
            }
        }

        assert!(split_total_frames > 0, "split output lost replay frames");
        assert!(
            split_frames_with_players > 0,
            "split output lost frame player payloads"
        );
        assert!(
            split_frames_with_bomb_state > 0,
            "split output lost bomb state in frames"
        );
        assert!(
            split_players_with_weapons > 0,
            "split output lost weapon state in frames"
        );
        assert!(split_total_events > 0, "split output lost events");
        assert!(split_total_damages > 0, "split output lost damage events");
        assert!(split_total_kills > 0, "split output lost kill events");
        assert!(split_total_bomb_events > 0, "split output lost bomb events");
        assert!(split_total_effects > 0, "split output lost utility effects");
        assert!(
            split_total_weapon_fires > 0,
            "split output lost weapon fire events"
        );
        assert!(
            split_total_projectile_frames > 0,
            "split output lost projectile frames"
        );
        assert_eq!(
            split_frames_with_embedded_projectiles, 0,
            "split output duplicated projectile payloads in frames"
        );
    }

    fn assert_manifest_json_contract(manifest: &Value) {
        assert_object_has_keys(
            manifest,
            &[
                "schemaVersion",
                "parserVersion",
                "meta",
                "players",
                "rounds",
            ],
            "manifest",
        );
        assert_eq!(
            manifest["schemaVersion"].as_str(),
            Some(REPLAY_SCHEMA_VERSION)
        );
        assert_eq!(manifest["parserVersion"].as_str(), Some(PARSER_VERSION));
        assert_object_has_keys(
            &manifest["meta"],
            &[
                "map",
                "tickRate",
                "sampleRate",
                "durationSec",
                "teamA",
                "teamB",
                "scoreA",
                "scoreB",
            ],
            "manifest meta",
        );
        let players = manifest["players"]
            .as_array()
            .expect("manifest players array");
        if let Some(player) = players.first() {
            assert_object_has_keys(player, &["steamId", "name", "team"], "manifest player");
            assert!(
                player["steamId"].is_string(),
                "manifest player Steam ID must be lossless"
            );
        }
    }

    fn assert_manifest_round_json_contract(round: &Value) {
        assert_object_has_keys(
            round,
            &[
                "number",
                "startTick",
                "freezeEndTick",
                "endTick",
                "duration",
                "winner",
                "scoreA",
                "scoreB",
                "frames",
                "events",
                "damages",
                "disconnects",
                "effects",
                "weaponFires",
                "projectileFrames",
                "roundFile",
            ],
            "manifest round",
        );
    }

    fn assert_round_json_contract(round: &Value) {
        assert_object_has_keys(
            round,
            &[
                "number",
                "startTick",
                "freezeEndTick",
                "endTick",
                "duration",
                "winner",
                "scoreA",
                "scoreB",
                "frames",
                "events",
                "damages",
                "disconnects",
                "effects",
                "weaponFires",
                "projectileFrames",
            ],
            "split round",
        );
        assert!(
            round.get("roundFile").is_none(),
            "split round must not contain roundFile"
        );

        let frames = round["frames"].as_array().expect("round frames array");
        if let Some(frame) = frames.first() {
            assert_object_has_keys(frame, &["t", "players"], "frame");
            if let Some(bomb) = frame.get("bomb").filter(|bomb| !bomb.is_null()) {
                assert_object_has_keys(bomb, &["x", "y", "z", "status"], "frame bomb");
            }
            if let Some(projectiles) = frame.get("projectiles").and_then(Value::as_array) {
                if let Some(projectile) = projectiles.first() {
                    assert_projectile_json_contract(projectile, "frame projectile");
                }
            }
            if let Some(player) = frame["players"]
                .as_array()
                .and_then(|players| players.first())
            {
                assert_object_has_keys(
                    player,
                    &["id", "x", "y", "z", "yaw", "hp", "armor", "team"],
                    "frame player",
                );
                assert!(player["id"].is_string(), "frame player ID must be lossless");
                if let Some(action) = player
                    .get("activeAction")
                    .filter(|action| !action.is_null())
                {
                    assert_object_has_keys(
                        action,
                        &["type", "item", "elapsed"],
                        "frame player activeAction",
                    );
                }
            }
        }

        let events = round["events"].as_array().expect("round events array");
        if let Some(event) = events.first() {
            assert_object_has_keys(event, &["t", "tick", "sequence", "type"], "round event");
        }
        let damages = round["damages"].as_array().expect("round damages array");
        if let Some(damage) = damages.first() {
            assert_object_has_keys(
                damage,
                &[
                    "t",
                    "tick",
                    "sequence",
                    "damageHealth",
                    "damageArmor",
                    "healthAfter",
                    "armorAfter",
                ],
                "damage event",
            );
            if let Some(attacker) = damage.get("attacker") {
                assert!(attacker.is_string(), "damage attacker ID must be lossless");
            }
            if let Some(victim) = damage.get("victim") {
                assert!(victim.is_string(), "damage victim ID must be lossless");
            }
        }
        let disconnects = round["disconnects"]
            .as_array()
            .expect("round disconnects array");
        if let Some(disconnect) = disconnects.first() {
            assert_object_has_keys(disconnect, &["t", "tick", "sequence"], "disconnect event");
            if let Some(player) = disconnect.get("player") {
                assert!(player.is_string(), "disconnect player ID must be lossless");
            }
        }
        if let Some(kill) = events
            .iter()
            .find(|event| event.get("type").and_then(Value::as_str) == Some("kill"))
        {
            assert_object_has_keys(kill, &["t", "type", "victim", "weapon"], "kill event");
            assert!(
                kill["victim"].is_string(),
                "kill victim ID must be lossless"
            );
        }
        if let Some(bomb_event) = events.iter().find(|event| {
            matches!(
                event.get("type").and_then(Value::as_str),
                Some("bomb_planted")
                    | Some("bomb_defuse_start")
                    | Some("bomb_defuse_abort")
                    | Some("bomb_defused")
                    | Some("bomb_exploded")
            )
        }) {
            assert_object_has_keys(bomb_event, &["t", "type"], "bomb event");
        }

        let effects = round["effects"].as_array().expect("round effects array");
        if let Some(effect) = effects.first() {
            assert_object_has_keys(effect, &["type", "start", "end", "x", "y", "z"], "effect");
        }

        let weapon_fires = round["weaponFires"]
            .as_array()
            .expect("round weaponFires array");
        if let Some(fire) = weapon_fires.first() {
            assert_object_has_keys(fire, &["t", "x", "y", "z", "yaw"], "weapon fire");
        }

        let projectile_frames = round["projectileFrames"]
            .as_array()
            .expect("round projectileFrames array");
        if let Some(projectile_frame) = projectile_frames.first() {
            assert_object_has_keys(projectile_frame, &["t", "projectiles"], "projectile frame");
            if let Some(projectile) = projectile_frame["projectiles"]
                .as_array()
                .and_then(|projectiles| projectiles.first())
            {
                assert_projectile_json_contract(projectile, "projectile frame projectile");
            }
        }
    }

    fn assert_projectile_json_contract(projectile: &Value, context: &str) {
        assert_object_has_keys(projectile, &["id", "type", "x", "y", "z"], context);
    }

    fn assert_object_has_keys(value: &Value, keys: &[&str], context: &str) {
        let object = value.as_object().unwrap_or_else(|| {
            panic!("{context} must be a JSON object, got {value}");
        });
        for key in keys {
            assert!(
                object.contains_key(*key),
                "{context} missing JSON key `{key}` in {value}"
            );
        }
    }

    fn assert_split_output_omits_skipped_payloads(
        output_path: &Path,
        manifest: &Value,
        output: &Output,
    ) {
        let rounds = manifest["rounds"]
            .as_array()
            .expect("manifest rounds array");
        let base_dir = output_path.parent().expect("output path parent");
        let mut total_frames = 0usize;
        let mut total_events = 0usize;
        let mut total_damages = 0usize;
        let mut total_effects = 0usize;
        let mut frames_with_embedded_projectiles = 0usize;
        let mut total_weapon_fires = 0usize;
        let mut total_projectile_frames = 0usize;

        assert_eq!(rounds.len(), output.rounds.len());
        for (idx, manifest_round) in rounds.iter().enumerate() {
            let round_file = manifest_round["roundFile"]
                .as_str()
                .expect("manifest roundFile");
            let round_path = base_dir.join(round_file);
            let round_json = read_gzip_json(&round_path);
            let frames = round_json["frames"].as_array().expect("round frames array");
            let events = round_json["events"].as_array().expect("round events array");
            let damages = round_json["damages"]
                .as_array()
                .expect("round damages array");
            let disconnects = round_json["disconnects"]
                .as_array()
                .expect("round disconnects array");
            let effects = round_json
                .get("effects")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            let weapon_fires = round_json
                .get("weaponFires")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            let projectile_frames = round_json
                .get("projectileFrames")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();

            assert_eq!(frames.len(), output.rounds[idx].frames.len());
            assert_eq!(events.len(), output.rounds[idx].events.len());
            assert_eq!(damages.len(), output.rounds[idx].damages.len());
            assert_eq!(disconnects.len(), output.rounds[idx].disconnects.len());
            assert_eq!(effects, output.rounds[idx].effects.len());
            assert_eq!(weapon_fires, 0, "skipWeaponFires leaked split data");
            assert_eq!(
                projectile_frames, 0,
                "skipProjectiles leaked split projectileFrames"
            );

            total_frames += frames.len();
            total_events += events.len();
            total_damages += damages.len();
            total_effects += effects;
            total_weapon_fires += weapon_fires;
            total_projectile_frames += projectile_frames;
            frames_with_embedded_projectiles += frames
                .iter()
                .filter(|frame| {
                    frame
                        .get("projectiles")
                        .and_then(Value::as_array)
                        .is_some_and(|projectiles| !projectiles.is_empty())
                })
                .count();
        }

        assert!(total_frames > 0, "split skip output lost replay frames");
        assert!(total_events > 0, "split skip output lost events");
        assert!(total_damages > 0, "split skip output lost damage events");
        assert!(total_effects > 0, "split skip output lost effects");
        assert_eq!(total_weapon_fires, 0);
        assert_eq!(total_projectile_frames, 0);
        assert_eq!(
            frames_with_embedded_projectiles, 0,
            "skipProjectiles leaked embedded frame projectiles"
        );
    }

    fn assert_replay_output_is_usable(output: &Output) {
        assert_core_replay_output_is_usable(output);
        let metrics = collect_replay_metrics(output);
        assert!(metrics.weapon_fires > 0, "expected weapon fire events");
        assert!(
            metrics.projectile_frames > 0,
            "expected projectile trajectory frames"
        );
    }

    fn assert_core_replay_output_is_usable(output: &Output) {
        assert!(output.meta.tick_rate > 0.0, "tick rate must be positive");
        assert!(output.meta.sample_rate > 0, "sample rate must be positive");
        assert!(!output.players.is_empty(), "expected parsed players");
        assert!(!output.rounds.is_empty(), "expected parsed rounds");

        for round in &output.rounds {
            assert!(
                round.end_tick >= round.start_tick,
                "round tick range is invalid"
            );
            assert!(!round.frames.is_empty(), "round has no frames");
        }

        let metrics = collect_replay_metrics(output);
        assert!(metrics.frames > 0, "expected replay frames");
        assert!(
            metrics.frames_with_players > 0,
            "expected frames with players"
        );
        assert!(
            metrics.frames_with_bomb_state > 0,
            "expected bomb state in frames"
        );
        assert!(
            metrics.players_with_weapons > 0,
            "expected weapon state in frames"
        );
        assert!(metrics.events > 0, "expected round events");
        assert!(metrics.kills > 0, "expected kill events");
        assert!(
            output.rounds.iter().any(|round| !round.damages.is_empty()),
            "expected damage events"
        );
        assert!(metrics.bomb_events > 0, "expected bomb events");
        assert!(metrics.effects > 0, "expected utility/bomb effects");
    }

    fn assert_round_level_replay_integrity(output: &Output) {
        assert_round_level_core_integrity(output);

        for round in &output.rounds {
            let label = format!("round {}", round.number);
            assert_weapon_fires_are_structurally_valid(&round.weapon_fires, &label);
            assert_projectile_frames_are_structurally_valid(&round.projectile_frames, &label);
        }
    }

    fn assert_round_level_core_integrity(output: &Output) {
        let mut previous_score = (0, 0);
        for round in &output.rounds {
            let label = format!("round {}", round.number);
            assert!(
                round.score_a >= previous_score.0 && round.score_b >= previous_score.1,
                "{label} score regressed: previous={previous_score:?} current=({}, {})",
                round.score_a,
                round.score_b
            );
            previous_score = (round.score_a, round.score_b);
            assert_events_are_structurally_valid(&round.events, round.duration, &label);
            assert_damages_are_structurally_valid(&round.damages, round, &label);
            assert_disconnects_are_structurally_valid(&round.disconnects, round, &label);
            assert_effects_are_structurally_valid(&round.effects, round.duration, &label);
            assert_frames_are_structurally_valid(&round.frames, &round.events, &label);
        }

        assert_eq!(
            previous_score.0, output.meta.score_a,
            "final round score A must match meta score"
        );
        assert_eq!(
            previous_score.1, output.meta.score_b,
            "final round score B must match meta score"
        );
    }

    fn assert_events_are_structurally_valid(events: &[Event], duration: f64, label: &str) {
        let mut previous_t = 0.0;
        let mut previous = (0, 0usize);
        for event in events {
            assert!(event.t.is_finite(), "{label} event has invalid time");
            assert!(
                event.t + 0.001 >= previous_t,
                "{label} events are not time sorted"
            );
            assert!(
                event.t <= duration + 20.0,
                "{label} event extends too far past round duration: t={} duration={duration}",
                event.t
            );
            previous_t = event.t;
            assert!(
                event.tick > previous.0 || event.tick == previous.0 && event.sequence >= previous.1,
                "{label} event tick/sequence values are not sorted"
            );
            previous = (event.tick, event.sequence);

            match event.kind.as_str() {
                "kill" => {
                    assert!(event.victim.is_some(), "{label} kill missing victim");
                    assert!(
                        event
                            .weapon
                            .as_deref()
                            .is_some_and(|weapon| !weapon.is_empty()),
                        "{label} kill missing weapon"
                    );
                }
                "bomb_planted" | "bomb_defuse_start" | "bomb_defuse_abort" | "bomb_defused"
                | "bomb_exploded" | "round_end" => {}
                other => panic!("{label} unexpected event type: {other}"),
            }
        }
    }

    fn assert_damages_are_structurally_valid(damages: &[DamageEvent], round: &Round, label: &str) {
        let mut previous = (round.start_tick, 0usize, 0.0);
        for damage in damages {
            assert!(damage.t.is_finite(), "{label} damage has invalid time");
            assert!(
                damage.tick > previous.0
                    || damage.tick == previous.0 && damage.sequence >= previous.1,
                "{label} damages are not chronologically sorted"
            );
            assert!(
                damage.t + 0.001 >= previous.2,
                "{label} damage times are not sorted"
            );
            assert!(
                damage.tick >= round.start_tick && damage.tick <= round.end_tick,
                "{label} damage tick is outside the round"
            );
            assert!(
                damage.t <= round.duration + 0.001,
                "{label} damage is past round duration"
            );
            assert!(damage.victim.is_some(), "{label} damage missing victim");
            assert!(
                damage
                    .weapon
                    .as_deref()
                    .is_none_or(|weapon| !weapon.is_empty()),
                "{label} damage contains an empty weapon"
            );
            assert!(
                damage.damage_health >= 0
                    && damage.damage_armor >= 0
                    && damage.health_after >= 0
                    && damage.armor_after >= 0,
                "{label} damage contains a negative value"
            );
            assert!(
                damage
                    .hitgroup
                    .as_deref()
                    .is_some_and(|hitgroup| !hitgroup.is_empty()),
                "{label} damage missing hitgroup"
            );
            previous = (damage.tick, damage.sequence, damage.t);
        }
    }

    fn assert_disconnects_are_structurally_valid(
        disconnects: &[DisconnectEvent],
        round: &Round,
        label: &str,
    ) {
        let mut previous = (round.start_tick, 0usize, 0.0);
        for disconnect in disconnects {
            assert!(
                disconnect.tick > previous.0
                    || disconnect.tick == previous.0 && disconnect.sequence >= previous.1,
                "{label} disconnects are not chronologically sorted"
            );
            assert!(
                disconnect.t + 0.001 >= previous.2,
                "{label} disconnect times are not sorted"
            );
            assert!(
                disconnect.tick >= round.start_tick && disconnect.tick <= round.end_tick,
                "{label} disconnect tick is outside the round"
            );
            assert!(
                disconnect.player.is_some(),
                "{label} disconnect is missing its player"
            );
            previous = (disconnect.tick, disconnect.sequence, disconnect.t);
        }
    }

    fn assert_effects_are_structurally_valid(
        effects: &[UtilityEffect],
        duration: f64,
        label: &str,
    ) {
        for effect in effects {
            assert!(
                effect.start.is_finite()
                    && effect.end.is_finite()
                    && effect.x.is_finite()
                    && effect.y.is_finite()
                    && effect.z.is_finite(),
                "{label} effect has invalid numeric fields"
            );
            assert!(
                effect.end + 0.001 >= effect.start,
                "{label} effect ends before it starts"
            );
            assert!(
                effect.start <= duration + 0.001,
                "{label} effect starts past round duration"
            );
            match effect.kind.as_str() {
                "smoke" | "flash" | "he" | "fire" | "decoy" | "bomb_planted" => {}
                other => panic!("{label} unexpected effect type: {other}"),
            }
        }
    }

    fn assert_frames_are_structurally_valid(frames: &[Frame], events: &[Event], label: &str) {
        let bomb_resolved_at = events
            .iter()
            .filter(|event| matches!(event.kind.as_str(), "bomb_defused" | "bomb_exploded"))
            .map(|event| event.t)
            .min_by(|left, right| left.total_cmp(right));
        let mut previous_t = 0.0;
        for frame in frames {
            assert!(frame.t.is_finite(), "{label} frame has invalid time");
            assert!(
                frame.t + 0.001 >= previous_t,
                "{label} frames are not time sorted"
            );
            previous_t = frame.t;
            if let Some(bomb) = &frame.bomb {
                assert!(
                    bomb.x.is_finite() && bomb.y.is_finite() && bomb.z.is_finite(),
                    "{label} bomb has invalid coordinates"
                );
                match bomb.status.as_str() {
                    "carried" => assert!(
                        bomb.carrier.is_some(),
                        "{label} carried bomb missing carrier"
                    ),
                    "dropped" | "planted" => {
                        assert!(bomb.carrier.is_none(), "{label} static bomb has carrier")
                    }
                    other => panic!("{label} unexpected bomb status: {other}"),
                }
                if let Some(resolved_at) = bomb_resolved_at {
                    assert!(
                        frame.t + 0.001 < resolved_at,
                        "{label} bomb remains visible after resolution at {resolved_at}"
                    );
                }
            }
            for player in &frame.players {
                assert!(
                    player.x.is_finite()
                        && player.y.is_finite()
                        && player.z.is_finite()
                        && player.yaw.is_finite(),
                    "{label} player has invalid coordinates/yaw"
                );
                assert!(
                    matches!(player.team, 2 | 3),
                    "{label} player has unexpected team {}",
                    player.team
                );
            }
        }
    }

    fn assert_weapon_fires_are_structurally_valid(fires: &[WeaponFireEvent], label: &str) {
        let mut previous_t = 0.0;
        for fire in fires {
            assert!(fire.t.is_finite(), "{label} weapon fire has invalid time");
            assert!(
                fire.t + 0.001 >= previous_t,
                "{label} weapon fires are not time sorted"
            );
            previous_t = fire.t;
            assert!(
                fire.x.is_finite()
                    && fire.y.is_finite()
                    && fire.z.is_finite()
                    && fire.yaw.is_finite(),
                "{label} weapon fire has invalid pose"
            );
            if let Some(team) = fire.team {
                assert!(
                    matches!(team, 2 | 3),
                    "{label} weapon fire has invalid team {team}"
                );
            }
            if fire.shooter.is_some() {
                assert!(
                    fire.weapon
                        .as_deref()
                        .is_some_and(|weapon| !weapon.is_empty()),
                    "{label} shooter weapon fire missing weapon"
                );
            }
        }
    }

    fn assert_projectile_frames_are_structurally_valid(frames: &[ProjectileFrame], label: &str) {
        type ProjectileTrackKey = (i64, String, Option<u64>);
        type ProjectileTrackPoint = (f64, f64, f64, f64);

        let mut previous_t = 0.0;
        let mut tracks: HashMap<ProjectileTrackKey, Vec<ProjectileTrackPoint>> = HashMap::new();
        for frame in frames {
            assert!(
                frame.t.is_finite(),
                "{label} projectile frame has invalid time"
            );
            assert!(
                frame.t + 0.001 >= previous_t,
                "{label} projectile frames are not time sorted"
            );
            previous_t = frame.t;
            let mut seen = HashSet::new();
            for projectile in &frame.projectiles {
                assert!(
                    projectile.x.is_finite()
                        && projectile.y.is_finite()
                        && projectile.z.is_finite(),
                    "{label} projectile has invalid coordinates"
                );
                let key = (
                    projectile.id,
                    projectile_kind_label(&projectile.kind),
                    projectile.thrower,
                );
                assert!(
                    seen.insert(key),
                    "{label} duplicate projectile in one frame"
                );
                for existing in tracks.keys() {
                    let (existing_id, existing_kind, existing_thrower) = existing;
                    if *existing_id == projectile.id
                        || existing_kind != projectile_kind_label(&projectile.kind)
                        || *existing_thrower != projectile.thrower
                    {
                        continue;
                    }
                    let Some(existing_points) = tracks.get(existing) else {
                        continue;
                    };
                    let Some((existing_t, existing_x, existing_y, existing_z)) =
                        existing_points.last().copied()
                    else {
                        continue;
                    };
                    if (existing_t - frame.t).abs() > 0.001 {
                        continue;
                    }
                    let distance = ((existing_x - projectile.x).powi(2)
                        + (existing_y - projectile.y).powi(2)
                        + (existing_z - projectile.z).powi(2))
                    .sqrt();
                    assert!(
                        distance >= 6.0,
                        "{label} physically duplicated projectile in one frame: current=({}, {}, {:?}) existing={existing:?} distance={distance}",
                        projectile.id,
                        projectile_kind_label(&projectile.kind),
                        projectile.thrower,
                    );
                }
                tracks
                    .entry((
                        projectile.id,
                        projectile_kind_label(&projectile.kind).to_string(),
                        projectile.thrower,
                    ))
                    .or_default()
                    .push((frame.t, projectile.x, projectile.y, projectile.z));
            }
        }
        for (key, points) in tracks {
            for pair in points.windows(2) {
                let (left_t, left_x, left_y, left_z) = pair[0];
                let (right_t, right_x, right_y, right_z) = pair[1];
                let dt = right_t - left_t;
                assert!(
                    dt > 0.0,
                    "{label} projectile track {:?} has non-increasing samples",
                    key
                );
                assert!(
                    dt <= 0.25,
                    "{label} projectile track {:?} has a time break: {left_t}->{right_t}",
                    key
                );
                let distance = ((right_x - left_x).powi(2)
                    + (right_y - left_y).powi(2)
                    + (right_z - left_z).powi(2))
                .sqrt();
                assert!(
                    !(dt <= 0.1 && distance > 900.0),
                    "{label} projectile track {:?} teleported: dt={dt} distance={distance}",
                    key
                );
            }
        }
    }

    fn projectile_kind_label(kind: &ProjectileKind) -> &str {
        match kind {
            ProjectileKind::Smoke => "smoke",
            ProjectileKind::He => "he",
            ProjectileKind::Flash => "flash",
            ProjectileKind::Molotov => "molotov",
            ProjectileKind::Other(name) => name.as_str(),
        }
    }

    fn assert_skip_options_removed_heavy_payloads(output: &Output) {
        let metrics = collect_replay_metrics(output);
        assert_eq!(metrics.weapon_fires, 0, "skipWeaponFires leaked events");
        assert_eq!(
            metrics.projectile_frames, 0,
            "skipProjectiles leaked projectile frames"
        );
        assert_eq!(
            metrics.projectile_samples, 0,
            "skipProjectiles leaked projectile samples"
        );
        let embedded_projectiles = output
            .rounds
            .iter()
            .flat_map(|round| &round.frames)
            .filter(|frame| !frame.projectiles.is_empty())
            .count();
        assert_eq!(
            embedded_projectiles, 0,
            "skipProjectiles leaked frame projectiles"
        );
    }

    fn assert_projectiles_are_not_duplicated_in_frames(output: &Output) {
        let embedded_projectiles = output
            .rounds
            .iter()
            .flat_map(|round| &round.frames)
            .filter(|frame| !frame.projectiles.is_empty())
            .count();
        assert_eq!(
            embedded_projectiles, 0,
            "projectileFrames should be the only projectile sample payload"
        );
    }

    fn configured_test_demo_paths() -> Vec<String> {
        if let Ok(raw) = env::var("ROUNDLAB_TEST_DEMOS") {
            return env::split_paths(&raw)
                .filter(|path| !path.as_os_str().is_empty())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
        }

        env::var("ROUNDLAB_TEST_DEMO")
            .ok()
            .filter(|path| !path.is_empty())
            .map(|path| vec![path])
            .unwrap_or_default()
    }

    fn expected_snapshot_for_demo(input: &str) -> Option<ExpectedReplaySnapshot> {
        let file_name = Path::new(input).file_name()?.to_str()?;
        let snapshots: Vec<ExpectedReplaySnapshot> =
            serde_json::from_str(include_str!("../reference_demos.json"))
                .expect("valid parser/reference_demos.json");
        snapshots
            .into_iter()
            .find(|demo| demo.file_name == file_name)
    }

    fn assert_reference_demo_snapshot(output: &Output, expected: &ExpectedReplaySnapshot) {
        assert_reference_demo_identity(output, expected);
        assert_metrics_match_reference(
            &collect_replay_metrics(output),
            &expected.metrics,
            &expected.label,
        );
        assert_round_metrics_match_reference(
            &collect_round_metrics(output),
            &expected.round_metrics,
            &expected.label,
        );
        assert_round_event_signatures_match_reference(
            &collect_round_event_signatures(output),
            &expected.round_event_signatures,
            &expected.label,
        );
        assert_round_terminal_event_signatures_match_reference(
            &collect_round_terminal_event_signatures(output),
            &expected.round_terminal_event_signatures,
            &expected.label,
        );
        assert_round_effect_signatures_match_reference(
            &collect_round_effect_signatures(output),
            &expected.round_effect_signatures,
            &expected.label,
        );
        assert_round_weapon_fire_signatures_match_reference(
            &collect_round_weapon_fire_signatures(output),
            &expected.round_weapon_fire_signatures,
            &expected.label,
        );
        assert_round_bomb_state_signatures_match_reference(
            &collect_round_bomb_state_signatures(output),
            &expected.round_bomb_state_signatures,
            &expected.label,
        );
        assert_round_active_action_signatures_match_reference(
            &collect_round_active_action_signatures(output),
            &expected.round_active_action_signatures,
            &expected.label,
        );
        assert_round_projectile_track_signatures_match_reference(
            &collect_round_projectile_track_signatures(output),
            &expected.round_projectile_track_signatures,
            &expected.label,
        );
    }

    fn assert_reference_demo_identity(output: &Output, expected: &ExpectedReplaySnapshot) {
        assert_eq!(
            output.meta.map, expected.map,
            "reference demo map changed for {}",
            expected.label
        );
        assert_eq!(
            output.meta.score_a, expected.score_a,
            "reference demo score A changed for {}",
            expected.label
        );
        assert_eq!(
            output.meta.score_b, expected.score_b,
            "reference demo score B changed for {}",
            expected.label
        );
    }

    fn assert_split_reference_demo_snapshot(manifest: &Value, expected: &ExpectedReplaySnapshot) {
        assert_eq!(
            manifest["meta"]["map"].as_str().unwrap_or_default(),
            expected.map,
            "split manifest map changed for {}",
            expected.label
        );
        assert_eq!(
            manifest["meta"]["scoreA"].as_i64().unwrap_or_default(),
            expected.score_a as i64,
            "split manifest score A changed for {}",
            expected.label
        );
        assert_eq!(
            manifest["meta"]["scoreB"].as_i64().unwrap_or_default(),
            expected.score_b as i64,
            "split manifest score B changed for {}",
            expected.label
        );
        let metrics = collect_manifest_metrics(manifest);
        assert_eq!(
            metrics.rounds, expected.metrics.rounds,
            "split manifest round count changed for {}",
            expected.label
        );
        assert_eq!(
            metrics.players, expected.metrics.players,
            "split manifest player count changed for {}",
            expected.label
        );
    }

    fn assert_metrics_match_reference(
        actual: &ReplayMetrics,
        expected: &ReplayMetrics,
        label: &str,
    ) {
        macro_rules! exact {
            ($field:ident) => {
                assert_eq!(
                    actual.$field,
                    expected.$field,
                    "{} {} changed: actual={} expected={}",
                    label,
                    stringify!($field),
                    actual.$field,
                    expected.$field
                );
            };
        }

        exact!(rounds);
        exact!(players);
        exact!(frames);
        exact!(frame_players);
        exact!(frames_with_players);
        exact!(frames_with_bomb_state);
        exact!(players_with_weapons);
        exact!(events);
        exact!(kills);
        exact!(bomb_events);
        exact!(effects);
        exact!(weapon_fires);
        exact!(projectile_frames);
        exact!(projectile_samples);
    }

    fn assert_round_metrics_match_reference(
        actual: &[RoundReplayMetrics],
        expected: &[RoundReplayMetrics],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round metric count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} metrics changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_event_signatures_match_reference(
        actual: &[RoundEventSignatures],
        expected: &[RoundEventSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round event signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} event signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_terminal_event_signatures_match_reference(
        actual: &[RoundTerminalEventSignatures],
        expected: &[RoundTerminalEventSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round terminal event signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} terminal event signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_effect_signatures_match_reference(
        actual: &[RoundEffectSignatures],
        expected: &[RoundEffectSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round effect signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} effect signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_weapon_fire_signatures_match_reference(
        actual: &[RoundWeaponFireSignatures],
        expected: &[RoundWeaponFireSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round weapon fire signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} weapon fire signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_bomb_state_signatures_match_reference(
        actual: &[RoundBombStateSignatures],
        expected: &[RoundBombStateSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round bomb-state signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} bomb-state signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_active_action_signatures_match_reference(
        actual: &[RoundActiveActionSignatures],
        expected: &[RoundActiveActionSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round active-action signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} active-action signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn assert_round_projectile_track_signatures_match_reference(
        actual: &[RoundProjectileTrackSignatures],
        expected: &[RoundProjectileTrackSignatures],
        label: &str,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{label} round projectile-track signature count changed"
        );
        for (idx, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(
                actual, expected,
                "{label} round {idx} projectile-track signatures changed: actual={actual:?} expected={expected:?}"
            );
        }
    }

    fn collect_replay_metrics(output: &Output) -> ReplayMetrics {
        let mut metrics = ReplayMetrics {
            rounds: output.rounds.len(),
            players: output.players.len(),
            ..ReplayMetrics::default()
        };

        for round in &output.rounds {
            metrics.frames += round.frames.len();
            metrics.events += round.events.len();
            metrics.effects += round.effects.len();
            metrics.weapon_fires += round.weapon_fires.len();
            metrics.projectile_frames += round.projectile_frames.len();

            for frame in &round.frames {
                metrics.frame_players += frame.players.len();
                if !frame.players.is_empty() {
                    metrics.frames_with_players += 1;
                }
                if frame.bomb.is_some() {
                    metrics.frames_with_bomb_state += 1;
                }
                metrics.players_with_weapons += frame
                    .players
                    .iter()
                    .filter(|player| !player.active.is_empty() || !player.weapons.is_empty())
                    .count();
            }
            for projectile_frame in &round.projectile_frames {
                metrics.projectile_samples += projectile_frame.projectiles.len();
            }
            for event in &round.events {
                match event.kind.as_str() {
                    "kill" => metrics.kills += 1,
                    "bomb_planted" | "bomb_defuse_start" | "bomb_defuse_abort" | "bomb_defused"
                    | "bomb_exploded" => metrics.bomb_events += 1,
                    _ => {}
                }
            }
        }

        metrics
    }

    fn collect_round_metrics(output: &Output) -> Vec<RoundReplayMetrics> {
        output
            .rounds
            .iter()
            .map(|round| {
                let kills = round
                    .events
                    .iter()
                    .filter(|event| event.kind == "kill")
                    .count();
                let bomb_events = round
                    .events
                    .iter()
                    .filter(|event| {
                        matches!(
                            event.kind.as_str(),
                            "bomb_planted"
                                | "bomb_defuse_start"
                                | "bomb_defuse_abort"
                                | "bomb_defused"
                                | "bomb_exploded"
                        )
                    })
                    .count();
                let projectile_samples = round
                    .projectile_frames
                    .iter()
                    .map(|frame| frame.projectiles.len())
                    .sum();
                RoundReplayMetrics {
                    number: round.number,
                    score_a: round.score_a,
                    score_b: round.score_b,
                    frames: round.frames.len(),
                    events: round.events.len(),
                    kills,
                    bomb_events,
                    effects: round.effects.len(),
                    weapon_fires: round.weapon_fires.len(),
                    projectile_frames: round.projectile_frames.len(),
                    projectile_samples,
                }
            })
            .collect()
    }

    fn collect_round_event_signatures(output: &Output) -> Vec<RoundEventSignatures> {
        output
            .rounds
            .iter()
            .map(|round| RoundEventSignatures {
                number: round.number,
                kills: round
                    .events
                    .iter()
                    .filter(|event| event.kind == "kill")
                    .map(kill_signature)
                    .collect(),
                bomb_events: round
                    .events
                    .iter()
                    .filter(|event| {
                        matches!(
                            event.kind.as_str(),
                            "bomb_planted"
                                | "bomb_defuse_start"
                                | "bomb_defuse_abort"
                                | "bomb_defused"
                                | "bomb_exploded"
                        )
                    })
                    .map(bomb_event_signature)
                    .collect(),
            })
            .collect()
    }

    fn collect_round_terminal_event_signatures(
        output: &Output,
    ) -> Vec<RoundTerminalEventSignatures> {
        output
            .rounds
            .iter()
            .map(|round| {
                let round_end_t = round_end_time(round);
                RoundTerminalEventSignatures {
                    number: round.number,
                    terminal_events: round
                        .events
                        .iter()
                        .filter(|event| is_terminal_event(event, round_end_t))
                        .map(terminal_event_signature)
                        .collect(),
                }
            })
            .collect()
    }

    fn collect_round_effect_signatures(output: &Output) -> Vec<RoundEffectSignatures> {
        output
            .rounds
            .iter()
            .map(|round| {
                let mut effects = round
                    .effects
                    .iter()
                    .map(effect_signature)
                    .collect::<Vec<_>>();
                effects.sort();
                RoundEffectSignatures {
                    number: round.number,
                    effects,
                }
            })
            .collect()
    }

    fn collect_round_weapon_fire_signatures(output: &Output) -> Vec<RoundWeaponFireSignatures> {
        output
            .rounds
            .iter()
            .map(|round| {
                let mut weapon_fires = round
                    .weapon_fires
                    .iter()
                    .map(weapon_fire_signature)
                    .collect::<Vec<_>>();
                weapon_fires.sort();
                RoundWeaponFireSignatures {
                    number: round.number,
                    weapon_fires,
                }
            })
            .collect()
    }

    fn collect_round_bomb_state_signatures(output: &Output) -> Vec<RoundBombStateSignatures> {
        output
            .rounds
            .iter()
            .map(|round| RoundBombStateSignatures {
                number: round.number,
                bomb_states: bomb_state_windows(round)
                    .iter()
                    .map(bomb_state_signature)
                    .collect(),
            })
            .collect()
    }

    fn collect_round_active_action_signatures(output: &Output) -> Vec<RoundActiveActionSignatures> {
        output
            .rounds
            .iter()
            .map(|round| {
                let mut active_actions = active_action_windows(round)
                    .iter()
                    .map(active_action_signature)
                    .collect::<Vec<_>>();
                active_actions.sort();
                RoundActiveActionSignatures {
                    number: round.number,
                    active_actions,
                }
            })
            .collect()
    }

    fn collect_round_projectile_track_signatures(
        output: &Output,
    ) -> Vec<RoundProjectileTrackSignatures> {
        output
            .rounds
            .iter()
            .map(|round| {
                let mut projectile_tracks = projectile_track_summaries(round)
                    .iter()
                    .map(projectile_track_signature)
                    .collect::<Vec<_>>();
                projectile_tracks.sort();
                RoundProjectileTrackSignatures {
                    number: round.number,
                    projectile_tracks,
                }
            })
            .collect()
    }

    fn projectile_track_summaries(round: &Round) -> Vec<ProjectileTrackSummary<'_>> {
        type ProjectileTrackKey = (i64, String, Option<u64>);

        let mut tracks: HashMap<ProjectileTrackKey, ProjectileTrackSummary<'_>> = HashMap::new();
        for frame in &round.projectile_frames {
            for projectile in &frame.projectiles {
                let key = (
                    projectile.id,
                    projectile_kind_label(&projectile.kind).to_string(),
                    projectile.thrower,
                );
                tracks
                    .entry(key)
                    .and_modify(|summary| {
                        summary.end_t = frame.t;
                        summary.samples += 1;
                        summary.end = projectile;
                    })
                    .or_insert_with(|| ProjectileTrackSummary {
                        id: projectile.id,
                        kind: &projectile.kind,
                        thrower: projectile.thrower,
                        start_t: frame.t,
                        end_t: frame.t,
                        samples: 1,
                        start: projectile,
                        end: projectile,
                    });
            }
        }
        tracks.into_values().collect()
    }

    fn active_action_windows(round: &Round) -> Vec<ActiveActionWindow<'_>> {
        let mut windows = Vec::new();
        let mut current: HashMap<u64, ActiveActionWindow<'_>> = HashMap::new();

        for frame in &round.frames {
            let mut seen_action_players = HashSet::new();
            for player in &frame.players {
                let Some(action) = player.active_action.as_ref() else {
                    if let Some(window) = current.remove(&player.id) {
                        windows.push(window);
                    }
                    continue;
                };
                seen_action_players.insert(player.id);
                match current.get_mut(&player.id) {
                    Some(window) if active_action_matches(window.action, action) => {
                        window.end_t = frame.t;
                        window.samples += 1;
                        window.end_elapsed = action.elapsed;
                        window.action = action;
                    }
                    Some(_) => {
                        if let Some(window) = current.remove(&player.id) {
                            windows.push(window);
                        }
                        current.insert(
                            player.id,
                            new_active_action_window(player.id, frame.t, action),
                        );
                    }
                    None => {
                        current.insert(
                            player.id,
                            new_active_action_window(player.id, frame.t, action),
                        );
                    }
                }
            }

            let finished = current
                .keys()
                .copied()
                .filter(|player_id| !seen_action_players.contains(player_id))
                .collect::<Vec<_>>();
            for player_id in finished {
                if let Some(window) = current.remove(&player_id) {
                    windows.push(window);
                }
            }
        }

        windows.extend(current.into_values());
        windows
    }

    fn new_active_action_window(
        player: u64,
        frame_t: f64,
        action: &ActiveAction,
    ) -> ActiveActionWindow<'_> {
        ActiveActionWindow {
            player,
            start_t: frame_t,
            end_t: frame_t,
            samples: 1,
            start_elapsed: action.elapsed,
            end_elapsed: action.elapsed,
            action,
        }
    }

    fn active_action_matches(left: &ActiveAction, right: &ActiveAction) -> bool {
        left.kind == right.kind && left.item == right.item && left.duration == right.duration
    }

    fn bomb_state_windows(round: &Round) -> Vec<BombStateWindow<'_>> {
        let mut windows = Vec::new();
        let mut current: Option<BombStateWindow<'_>> = None;

        for frame in &round.frames {
            let Some(bomb) = frame.bomb.as_ref() else {
                close_bomb_state_window(round, &mut current, &mut windows, None);
                continue;
            };

            match current.as_mut() {
                Some(window)
                    if window.end_bomb.status == bomb.status
                        && window.end_bomb.carrier == bomb.carrier =>
                {
                    window.end_t = frame.t;
                    window.samples += 1;
                    window.end_bomb = bomb;
                }
                Some(_) => {
                    close_bomb_state_window(
                        round,
                        &mut current,
                        &mut windows,
                        Some(bomb.status.as_str()),
                    );
                    current = Some(BombStateWindow {
                        start_t: frame.t,
                        end_t: frame.t,
                        samples: 1,
                        end_cause: String::new(),
                        start_bomb: bomb,
                        end_bomb: bomb,
                    });
                }
                None => {
                    current = Some(BombStateWindow {
                        start_t: frame.t,
                        end_t: frame.t,
                        samples: 1,
                        end_cause: String::new(),
                        start_bomb: bomb,
                        end_bomb: bomb,
                    });
                }
            }
        }

        close_bomb_state_window(round, &mut current, &mut windows, None);
        windows
    }

    fn close_bomb_state_window<'a>(
        round: &Round,
        current: &mut Option<BombStateWindow<'a>>,
        windows: &mut Vec<BombStateWindow<'a>>,
        next_status: Option<&str>,
    ) {
        if let Some(mut window) = current.take() {
            window.end_cause = bomb_state_window_end_cause(round, window.end_t, next_status);
            windows.push(window);
        }
    }

    fn bomb_state_window_end_cause(round: &Round, end_t: f64, next_status: Option<&str>) -> String {
        if let Some(status) = next_status {
            return format!("to={status}");
        }
        if let Some(event) = round
            .events
            .iter()
            .filter(|event| matches!(event.kind.as_str(), "bomb_defused" | "bomb_exploded"))
            .filter(|event| event.t + 0.25 >= end_t && event.t <= end_t + 1.0)
            .min_by(|left, right| left.t.total_cmp(&right.t))
        {
            return format!("to={}@{:.3}", event.kind, bucket_signature_time(event.t));
        }
        if end_t + 0.25 >= round.duration {
            "to=round_end".into()
        } else {
            "to=none".into()
        }
    }

    fn round_end_time(round: &Round) -> f64 {
        round
            .events
            .iter()
            .find(|event| event.kind == "round_end")
            .map(|event| event.t)
            .unwrap_or(round.duration)
    }

    fn is_terminal_event(event: &Event, round_end_t: f64) -> bool {
        match event.kind.as_str() {
            "round_end" | "bomb_exploded" => true,
            "kill" => {
                let weapon = event
                    .weapon
                    .as_deref()
                    .map(normalized_signature_weapon)
                    .unwrap_or_default();
                event.t + 0.001 >= round_end_t
                    || weapon == "world"
                    || weapon == "c4"
                    || event.killer.is_some() && event.killer == event.victim
            }
            _ => false,
        }
    }

    fn terminal_event_signature(event: &Event) -> String {
        if event.kind == "kill" {
            format!(
                "{:.3}|{}|{}|{}|{}|{}|{}",
                bucket_signature_time(event.t),
                event.kind,
                optional_u64_signature(event.killer),
                optional_u64_signature(event.victim),
                optional_u64_signature(event.assist),
                event
                    .weapon
                    .as_deref()
                    .map(normalized_signature_weapon)
                    .unwrap_or_default(),
                event.kill.hs
            )
        } else {
            format!("{:.3}|{}|||||", bucket_signature_time(event.t), event.kind)
        }
    }

    fn kill_signature(event: &Event) -> String {
        format!(
            "{:.3}|{}|{}|{}|{}|{}",
            bucket_signature_time(event.t),
            optional_u64_signature(event.killer),
            optional_u64_signature(event.victim),
            optional_u64_signature(event.assist),
            event
                .weapon
                .as_deref()
                .map(normalized_signature_weapon)
                .unwrap_or_default(),
            event.kill.hs
        )
    }

    fn effect_signature(effect: &UtilityEffect) -> String {
        let duration = (effect.end - effect.start).max(0.0);
        format!(
            "{:.3}|{:.1}|{}|{}|{}|{}|{}|{}",
            bucket_signature_time(effect.start),
            bucket_signature_duration(duration),
            effect.kind,
            effect_signature_variant(effect),
            effect_signature_team(effect),
            bucket_signature_coord(effect.x),
            bucket_signature_coord(effect.y),
            bucket_signature_coord(effect.z)
        )
    }

    fn effect_signature_variant(effect: &UtilityEffect) -> &str {
        if effect.kind == "fire" {
            ""
        } else {
            effect.variant.as_deref().unwrap_or_default()
        }
    }

    fn effect_signature_team(effect: &UtilityEffect) -> String {
        if effect.kind == "bomb_planted" {
            String::new()
        } else {
            effect
                .team
                .map(|value| value.to_string())
                .unwrap_or_default()
        }
    }

    fn weapon_fire_signature(fire: &WeaponFireEvent) -> String {
        format!(
            "{:.3}|{}|{}|{}|{}|{}|{}|{}",
            bucket_signature_time(fire.t),
            optional_u64_signature(fire.shooter),
            fire.weapon
                .as_deref()
                .map(normalized_weapon_fire_signature_weapon)
                .unwrap_or_default(),
            optional_i64_signature(fire.team),
            bucket_signature_coord(fire.x),
            bucket_signature_coord(fire.y),
            bucket_signature_coord(fire.z),
            bucket_signature_yaw(fire.yaw)
        )
    }

    fn bomb_state_signature(window: &BombStateWindow<'_>) -> String {
        format!(
            "{}|{:.3}|{:.3}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            window.end_bomb.status,
            bucket_signature_time(window.start_t),
            bucket_signature_time(window.end_t),
            window.samples,
            window.end_cause,
            optional_u64_signature(window.end_bomb.carrier),
            bucket_signature_coord(window.start_bomb.x),
            bucket_signature_coord(window.start_bomb.y),
            bucket_signature_coord(window.start_bomb.z),
            bucket_signature_coord(window.end_bomb.x),
            bucket_signature_coord(window.end_bomb.y),
            bucket_signature_coord(window.end_bomb.z)
        )
    }

    fn active_action_signature(window: &ActiveActionWindow<'_>) -> String {
        format!(
            "{:.3}|{:.3}|{}|{}|{}|{}|{:.3}|{:.3}|{}",
            bucket_signature_time(window.start_t),
            bucket_signature_time(window.end_t),
            window.player,
            window.action.kind,
            normalized_active_action_item(&window.action.item),
            window.samples,
            bucket_signature_time(window.start_elapsed),
            bucket_signature_time(window.end_elapsed),
            optional_f64_signature(window.action.duration)
        )
    }

    fn projectile_track_signature(track: &ProjectileTrackSummary<'_>) -> String {
        format!(
            "{}|{}|{}|{:.3}|{:.3}|{}|{}|{}|{}|{}|{}|{}",
            track.id,
            projectile_kind_label(track.kind),
            optional_u64_signature(track.thrower),
            bucket_signature_time(track.start_t),
            bucket_signature_time(track.end_t),
            track.samples,
            bucket_signature_projectile_coord(track.start.x),
            bucket_signature_projectile_coord(track.start.y),
            bucket_signature_projectile_coord(track.start.z),
            bucket_signature_projectile_coord(track.end.x),
            bucket_signature_projectile_coord(track.end.y),
            bucket_signature_projectile_coord(track.end.z)
        )
    }

    fn normalized_active_action_item(value: &str) -> String {
        let trimmed = value.trim();
        if trimmed.eq_ignore_ascii_case("c4") {
            "c4".into()
        } else {
            normalized_base_signature_weapon(trimmed)
        }
    }

    fn bomb_event_signature(event: &Event) -> String {
        format!(
            "{:.3}|{}|{}",
            bucket_signature_time(event.t),
            event.kind,
            optional_u64_signature(event.player)
        )
    }

    fn bucket_signature_time(value: f64) -> f64 {
        (value / 0.25).round() * 0.25
    }

    fn bucket_signature_duration(value: f64) -> f64 {
        (value / 0.1).round() * 0.1
    }

    fn bucket_signature_coord(value: f64) -> i64 {
        ((value / 50.0).round() * 50.0) as i64
    }

    fn bucket_signature_projectile_coord(value: f64) -> i64 {
        ((value / 100.0).round() * 100.0) as i64
    }

    fn bucket_signature_yaw(value: f64) -> i64 {
        let normalized = value.rem_euclid(360.0);
        ((normalized / 15.0).round() as i64 * 15).rem_euclid(360)
    }

    fn optional_u64_signature(value: Option<u64>) -> String {
        value.map(|value| value.to_string()).unwrap_or_default()
    }

    fn optional_i64_signature(value: Option<i64>) -> String {
        value.map(|value| value.to_string()).unwrap_or_default()
    }

    fn optional_f64_signature(value: Option<f64>) -> String {
        value
            .map(|value| format!("{:.1}", bucket_signature_duration(value)))
            .unwrap_or_default()
    }

    fn normalized_signature_weapon(value: &str) -> String {
        let normalized = normalized_base_signature_weapon(value);
        match normalized.as_str() {
            "inferno" | "incendiary" | "molotov" => "fire".into(),
            _ => normalized,
        }
    }

    fn normalized_weapon_fire_signature_weapon(value: &str) -> String {
        normalized_base_signature_weapon(value)
    }

    fn normalized_base_signature_weapon(value: &str) -> String {
        let raw = value.trim().to_ascii_lowercase();
        let mut normalized = raw
            .strip_prefix("weapon_")
            .unwrap_or(raw.as_str())
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .collect::<String>();
        normalized = match normalized.as_str() {
            "glock18" => "glock".into(),
            "usps" | "uspsilencer" => "usp".into(),
            "hkp2000" => "p2000".into(),
            "deserteagle" => "deagle".into(),
            "elite" => "dualberettas".into(),
            "m4a1" | "m4a1silencer" | "m4a4" => "m4".into(),
            "decoygrenade" => "decoy".into(),
            "plantedc4" => "c4".into(),
            "incgrenade" | "incendiarygrenade" => "incendiary".into(),
            _ if normalized.starts_with("knife")
                || matches!(normalized.as_str(), "bayonet" | "karambit") =>
            {
                "knife".into()
            }
            _ => normalized,
        };
        normalized
    }

    fn collect_manifest_metrics(manifest: &Value) -> ReplayMetrics {
        ReplayMetrics {
            rounds: manifest["rounds"]
                .as_array()
                .map(Vec::len)
                .unwrap_or_default(),
            players: manifest["players"]
                .as_array()
                .map(Vec::len)
                .unwrap_or_default(),
            ..ReplayMetrics::default()
        }
    }

    fn read_gzip_json(path: &std::path::Path) -> Value {
        let file = std::fs::File::open(path).unwrap();
        let mut gz = GzDecoder::new(file);
        let mut raw = String::new();
        gz.read_to_string(&mut raw).unwrap();
        serde_json::from_str(&raw).unwrap()
    }
}
