use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use ahash::AHashMap;
use anyhow::{anyhow, bail, Context, Result};
use flate2::{write::GzEncoder, Compression};
use parser::{
    first_pass::parser_settings::{rm_user_friendly_names, FirstPassParser, ParserInputs},
    parse_demo::{Parser, ParsingMode},
    second_pass::{
        parser_settings::create_huffman_lookup_table,
        variants::{soa_to_aos, OutputSerdeHelperStruct, Variant},
    },
};
use rayon::prelude::*;
use serde::Serialize;
use serde_json::Value;

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];
const TICK_RATE: f64 = 64.0;

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
    #[serde(skip_serializing_if = "Option::is_none")]
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
    id: u64,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    hp: i64,
    armor: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    money: Option<i64>,
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
    #[serde(rename = "type")]
    kind: String,
    x: f64,
    y: f64,
    z: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    thrower: Option<u64>,
}

#[derive(Clone, Debug)]
struct C4Pos {
    tick: i32,
    x: f64,
    y: f64,
    z: f64,
}

struct TickData {
    rows: Vec<Value>,
    c4_positions: Vec<C4Pos>,
}

#[derive(Clone, Debug)]
struct BlindSpan {
    player: u64,
    start: f64,
    end: f64,
    total: f64,
}

#[derive(Serialize)]
struct Event {
    t: f64,
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    player: Option<u64>,
    #[serde(rename = "hasKit", skip_serializing_if = "is_false")]
    has_kit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    killer: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    victim: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    assist: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weapon: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    hs: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    winner: Option<String>,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    effects: Vec<UtilityEffect>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    weapon_fires: Vec<WeaponFireEvent>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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
struct Output {
    meta: Meta,
    players: Vec<Player>,
    rounds: Vec<Round>,
}

#[derive(Serialize)]
struct ManifestOutput<'a> {
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    effects: Vec<UtilityEffect>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    weapon_fires: Vec<WeaponFireEvent>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
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

fn is_false(value: &bool) -> bool {
    !*value
}

fn emit_progress(progress: f64, message: &str) {
    eprintln!("ROUNDLAB_PROGRESS {progress:.4} {message}");
}

fn final_step_start(name: &str) -> Instant {
    eprintln!("ROUNDLAB_FINAL start step={name}");
    Instant::now()
}

fn final_step_done(name: &str, started: Instant) {
    eprintln!(
        "ROUNDLAB_FINAL done step={name} duration_ms={}",
        started.elapsed().as_millis()
    );
}

fn timed<T, F>(slot: &mut u128, f: F) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    let started = Instant::now();
    let result = f();
    *slot = started.elapsed().as_millis();
    result
}

fn elapsed_ms(started: Instant) -> u128 {
    started.elapsed().as_millis()
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
    let mut stats = ParserStats {
        input_bytes: fs::metadata(&args.input).map(|m| m.len()).unwrap_or_default(),
        ..ParserStats::default()
    };
    let bytes = timed(&mut stats.read_demo_ms, || read_demo(&args.input))?;
    stats.decompressed_bytes = bytes.len() as u64;
    let huf_started = Instant::now();
    let huf = create_huffman_lookup_table();
    stats.create_huffman_ms = elapsed_ms(huf_started);

    let header = timed(&mut stats.parse_header_ms, || parse_header(&bytes, &huf))?;
    let map = header.get("map_name").cloned().unwrap_or_default();
    let players = timed(&mut stats.parse_players_ms, || parse_players(&bytes, &huf))?;
    let events = timed(&mut stats.parse_events_ms, || parse_events(&bytes, &huf))?;
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
        parse_ticks(&bytes, &huf, wanted_ticks)
    })?;
    stats.tick_rows = tick_data.rows.len();
    stats.c4_records = tick_data.c4_positions.len();
    let group_ticks_started = Instant::now();
    let rows_by_tick = group_tick_rows(tick_data.rows);
    let c4_by_tick = group_c4_positions(tick_data.c4_positions);
    stats.group_ticks_ms = elapsed_ms(group_ticks_started);
    let team_rows = timed(&mut stats.parse_teams_ms, || {
        Ok(parse_team_rows(&bytes, &huf, team_name_ticks(&spans)).unwrap_or_default())
    })?;
    let (team_a, team_b) = team_names_from_rows(&team_rows);
    let projectile_rows = if args.skip_projectiles {
        Vec::new()
    } else {
        timed(&mut stats.parse_projectiles_ms, || {
            parse_projectiles(&bytes, &huf)
        })?
    };
    stats.projectile_rows = projectile_rows.len();
    let group_projectiles_started = Instant::now();
    let projectiles_by_tick = group_projectile_rows(projectile_rows);
    stats.group_projectiles_ms = elapsed_ms(group_projectiles_started);

    let build_rounds_started = Instant::now();
    let mut score_ct = 0;
    let mut score_t = 0;
    let mut rounds = Vec::with_capacity(spans.len());
    for (idx, span) in spans.iter().enumerate() {
        if span.winner == "CT" {
            score_ct += 1;
        } else if span.winner == "T" {
            score_t += 1;
        }

        let mut frames = Vec::new();
        let blind_spans = round_blinds(&events, span);
        let span_events = events
            .iter()
            .filter(|event| {
                let tick = get_i64(event, "tick").unwrap_or_default() as i32;
                tick >= span.start && tick <= span.end
            })
            .collect::<Vec<_>>();
        let mut event_idx = 0;
        let mut bomb_planted = false;
        let mut last_bomb: Option<BombState> = None;
        let mut plant_starts: HashMap<u64, i32> = HashMap::new();
        let mut utility_starts: HashMap<u64, (String, i32)> = HashMap::new();
        for tick in (span.start..=span.end).step_by(sample_step as usize) {
            while event_idx < span_events.len() {
                let event = span_events[event_idx];
                let event_tick = get_i64(event, "tick").unwrap_or_default() as i32;
                if event_tick > tick {
                    break;
                }
                match get_str(event, "event_name").unwrap_or("") {
                    "bomb_beginplant" => {
                        if let Some(player) = get_u64(event, "user_steamid")
                            .or_else(|| get_u64(event, "player_steamid"))
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
                        if let Some(player) = get_u64(event, "user_steamid")
                            .or_else(|| get_u64(event, "player_steamid"))
                        {
                            plant_starts.remove(&player);
                        } else {
                            plant_starts.clear();
                        }
                        let planter_row = get_u64(event, "user_steamid")
                            .and_then(|id| player_row_at_tick(&rows_by_tick, event_tick, id));
                        let x = get_f64(event, "x")
                            .or_else(|| get_f64(event, "X"))
                            .or_else(|| planter_row.and_then(|row| get_f64(row, "X")))
                            .or_else(|| last_bomb.as_ref().map(|bomb| bomb.x));
                        let y = get_f64(event, "y")
                            .or_else(|| get_f64(event, "Y"))
                            .or_else(|| planter_row.and_then(|row| get_f64(row, "Y")))
                            .or_else(|| last_bomb.as_ref().map(|bomb| bomb.y));
                        let z = get_f64(event, "z")
                            .or_else(|| get_f64(event, "Z"))
                            .or_else(|| planter_row.and_then(|row| get_f64(row, "Z")))
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
                        last_bomb = None;
                        plant_starts.clear();
                        utility_starts.clear();
                    }
                    "round_end" | "round_officially_ended" => {
                        plant_starts.clear();
                        utility_starts.clear();
                    }
                    _ => {}
                }
                event_idx += 1;
            }
            let Some(rows) = rows_by_tick.get(&tick) else {
                continue;
            };
            let t = seconds_since(span.start, tick);
            let mut stale_plants = Vec::new();
            let mut seen_players = HashSet::new();
            let mut players = Vec::new();
            for row in rows {
                let Some(player_id) = get_u64(row, "steamid") else {
                    continue;
                };
                seen_players.insert(player_id);
                let active = get_str(row, "active_weapon_name").unwrap_or("");
                let alive = get_bool(row, "is_alive").unwrap_or(false);
                let pressed = action_pressed(row);
                let active_action = if let Some(start_tick) = plant_starts.get(&player_id).copied()
                {
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
                if let Some(player) = player_pos_from_row(row, &blind_spans, t, active_action) {
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
            let exact_c4 = c4_by_tick.get(&tick);
            let bomb = if bomb_planted {
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
                projectiles: if args.skip_projectiles {
                    Vec::new()
                } else {
                    projectiles_by_tick.get(&tick).cloned().unwrap_or_default()
                },
            });
        }

        if frames.is_empty() {
            continue;
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

        let projectile_frames = if args.skip_projectiles {
            Vec::new()
        } else {
            projectiles_by_tick
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

        rounds.push(Round {
            number: rounds.len(),
            start_tick: span.start,
            freeze_end_tick: span.start,
            end_tick: span.end,
            duration: seconds_since(span.start, span.end),
            winner: span.winner.clone(),
            score_a: score_ct,
            score_b: score_t,
            events: round_events(&events, span),
            effects: round_effects(&events, span, &rows_by_tick),
            weapon_fires: if args.skip_weapon_fires {
                Vec::new()
            } else {
                round_weapon_fires(&events, span, &rows_by_tick)
            },
            projectile_frames,
            frames,
        });

        if idx > 200 {
            break;
        }
    }

    if rounds.is_empty() {
        bail!("parser produced no frames");
    }
    if looks_like_knife_round(rounds.first()) {
        rounds.remove(0);
        let mut ct = 0;
        let mut t = 0;
        for (idx, round) in rounds.iter_mut().enumerate() {
            if round.winner == "CT" {
                ct += 1;
            } else if round.winner == "T" {
                t += 1;
            }
            round.number = idx;
            round.score_a = ct;
            round.score_b = t;
        }
        score_ct = ct;
        score_t = t;
    }
    stats.build_rounds_ms = elapsed_ms(build_rounds_started);

    let duration_sec = spans
        .last()
        .map(|r| f64::from(r.end) / TICK_RATE)
        .unwrap_or_default();
    let output = Output {
        meta: Meta {
            map,
            tick_rate: TICK_RATE,
            sample_rate,
            duration_sec,
            team_a,
            team_b,
            score_a: score_ct,
            score_b: score_t,
        },
        players,
        rounds,
    };
    collect_output_stats(&mut stats, &output);
    Ok((output, stats))
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
    if round.duration > 75.0 {
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
    weapons
        .filter(|weapon| !weapon.is_empty())
        .all(is_knife_or_bomb)
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

fn action_pressed(row: &Value) -> bool {
    get_bool(row, "FIRE").unwrap_or(false) || get_bool(row, "RIGHTCLICK").unwrap_or(false)
}

fn parse_args() -> Result<Args> {
    let mut out = Args {
        quality: "full".into(),
        ..Args::default()
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-in" => out.input = it.next().ok_or_else(|| anyhow!("-in needs a value"))?,
            "-out" => out.output = it.next().ok_or_else(|| anyhow!("-out needs a value"))?,
            "-quality" => {
                out.quality = it.next().ok_or_else(|| anyhow!("-quality needs a value"))?
            }
            "-stats" => out.stats = true,
            "-skipProjectiles" => out.skip_projectiles = true,
            "-skipWeaponFires" => out.skip_weapon_fires = true,
            _ => bail!("unknown argument: {arg}"),
        }
    }
    if out.input.is_empty() || out.output.is_empty() {
        bail!("usage: parser -in demo.dem[.zst] -out out.json.gz [-quality full|high|medium|low]");
    }
    Ok(out)
}

fn collect_output_stats(stats: &mut ParserStats, output: &Output) {
    stats.rounds = output.rounds.len();
    stats.players = output.players.len();
    for round in &output.rounds {
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
}

/// Maximum allowed size, both for the raw input file and for the decompressed
/// payload. 1 GB is well above any legitimate CS2 demo and tight enough to
/// reject zstd bombs before they exhaust RAM.
const MAX_DEMO_SIZE: u64 = 1024 * 1024 * 1024;

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
        vec!["total_rounds_played".into()],
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
            "health".into(),
            "armor_value".into(),
            "balance".into(),
            "has_helmet".into(),
            "has_defuser".into(),
            "is_alive".into(),
            "team_num".into(),
            "active_weapon_name".into(),
            "inventory".into(),
            "flash_duration".into(),
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
        prop_infos: output.prop_controller.prop_infos.clone(),
        inner: output.df.clone().into(),
    };
    let rows = soa_to_aos(helper)
        .into_iter()
        .map(|row| serde_json::to_value(row).unwrap_or(Value::Null))
        .collect();
    Ok(TickData { rows, c4_positions })
}

fn parse_team_rows(bytes: &[u8], huf: &Vec<(u8, u8)>, ticks: Vec<i32>) -> Result<Vec<Value>> {
    let settings = settings(
        huf,
        vec![],
        vec![],
        vec!["team_name".into(), "team_clan_name".into()],
        ticks,
        true,
    )?;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let helper = OutputSerdeHelperStruct {
        prop_infos: output.prop_controller.prop_infos.clone(),
        inner: output.df.clone().into(),
    };
    Ok(soa_to_aos(helper)
        .into_iter()
        .map(|row| serde_json::to_value(row).unwrap_or(Value::Null))
        .collect())
}

fn parse_projectiles(bytes: &[u8], huf: &Vec<(u8, u8)>) -> Result<Vec<Value>> {
    let mut settings = settings(huf, vec![], vec![], vec![], vec![], true)?;
    settings.parse_projectiles = true;
    settings.parse_grenades = true;
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    let output = parser.parse_demo(bytes).map_err(|e| anyhow!("{e}"))?;
    let helper = OutputSerdeHelperStruct {
        prop_infos: output.prop_controller.prop_infos.clone(),
        inner: output.df.clone().into(),
    };
    Ok(soa_to_aos(helper)
        .into_iter()
        .map(|row| serde_json::to_value(row).unwrap_or(Value::Null))
        .collect())
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
    for span in spans.iter().take(4) {
        ticks.push(span.start);
        ticks.push(span.start + TICK_RATE as i32);
        ticks.push(span.end);
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

fn group_tick_rows(rows: Vec<Value>) -> BTreeMap<i32, Vec<Value>> {
    let mut out: BTreeMap<i32, Vec<Value>> = BTreeMap::new();
    for row in rows {
        if let Some(tick) = get_i64(&row, "tick") {
            out.entry(tick as i32).or_default().push(row);
        }
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

fn group_projectile_rows(rows: Vec<Value>) -> BTreeMap<i32, Vec<ProjectilePos>> {
    #[derive(Clone)]
    struct Track {
        id: i64,
        kind: String,
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
        let Some(tick) = get_i64(&row, "tick") else {
            continue;
        };
        let Some(x) = get_f64(&row, "x") else {
            continue;
        };
        let Some(y) = get_f64(&row, "y") else {
            continue;
        };
        let Some(z) = get_f64(&row, "z") else {
            continue;
        };
        by_tick.entry(tick as i32).or_default().push(ProjectilePos {
            id: get_i64(&row, "entity_id").unwrap_or(tick),
            kind: get_str(&row, "grenade_type")
                .unwrap_or("grenade")
                .to_string(),
            x,
            y,
            z,
            thrower: get_u64(&row, "steamid"),
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
                let max_dist = (f64::from(tick_gap) / TICK_RATE * 2400.0).max(90.0);
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
    row: &Value,
    blind_spans: &[BlindSpan],
    t: f64,
    active_action: Option<ActiveAction>,
) -> Option<PlayerPos> {
    if !get_bool(row, "is_alive").unwrap_or(false) {
        return None;
    }
    let id = get_u64(row, "steamid")?;
    let blind = blind_spans
        .iter()
        .find(|b| b.player == id && t >= b.start && t <= b.end);
    let active = get_str(row, "active_weapon_name").unwrap_or("").to_string();
    let weapons = get_string_array(row, "inventory");
    let has_bomb = weapon_is_bomb(&active) || weapons.iter().any(|weapon| weapon_is_bomb(weapon));
    Some(PlayerPos {
        id,
        x: get_f64(row, "X").unwrap_or_default(),
        y: get_f64(row, "Y").unwrap_or_default(),
        z: get_f64(row, "Z").unwrap_or_default(),
        yaw: get_f64(row, "yaw").unwrap_or_default(),
        hp: get_i64(row, "health").unwrap_or_default(),
        armor: get_i64(row, "armor_value").unwrap_or_default(),
        money: get_i64(row, "balance"),
        helmet: get_bool(row, "has_helmet").unwrap_or(false),
        kit: get_bool(row, "has_defuser").unwrap_or(false),
        has_bomb,
        team: get_i64(row, "team_num").unwrap_or_default(),
        active,
        weapons,
        flash_left: blind.map(|b| (b.end - t).max(0.0)),
        flash_total: blind.map(|b| b.total),
        use_key: get_bool(row, "USE").unwrap_or(false),
        active_action,
    })
}

fn round_events(events: &[Value], span: &RoundSpan) -> Vec<Event> {
    let mut out = Vec::new();
    for event in events {
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        if tick < span.start || tick > span.end {
            continue;
        }
        let t = seconds_since(span.start, tick);
        match get_str(event, "event_name").unwrap_or("") {
            "player_death" => out.push(Event {
                t,
                kind: "kill".into(),
                player: None,
                has_kit: false,
                killer: get_u64(event, "attacker_steamid"),
                victim: get_u64(event, "user_steamid"),
                assist: get_u64(event, "assister_steamid"),
                weapon: get_str(event, "weapon").map(str::to_string),
                hs: get_bool(event, "headshot").unwrap_or(false),
                winner: None,
            }),
            "bomb_planted" => out.push(simple_event(t, "bomb_planted")),
            "bomb_begindefuse" => out.push(Event {
                t,
                kind: "bomb_defuse_start".into(),
                player: get_u64(event, "user_steamid"),
                has_kit: get_bool(event, "haskit").unwrap_or(false),
                killer: None,
                victim: None,
                assist: None,
                weapon: None,
                hs: false,
                winner: None,
            }),
            "bomb_abortdefuse" => out.push(Event {
                t,
                kind: "bomb_defuse_abort".into(),
                player: get_u64(event, "user_steamid"),
                has_kit: false,
                killer: None,
                victim: None,
                assist: None,
                weapon: None,
                hs: false,
                winner: None,
            }),
            "bomb_defused" => out.push(simple_event(t, "bomb_defused")),
            "bomb_exploded" => out.push(simple_event(t, "bomb_exploded")),
            "round_end" => out.push(Event {
                t,
                kind: "round_end".into(),
                player: None,
                has_kit: false,
                killer: None,
                victim: None,
                assist: None,
                weapon: None,
                hs: false,
                winner: Some(span.winner.clone()),
            }),
            _ => {}
        }
    }
    out
}

fn simple_event(t: f64, kind: &str) -> Event {
    Event {
        t,
        kind: kind.into(),
        player: None,
        has_kit: false,
        killer: None,
        victim: None,
        assist: None,
        weapon: None,
        hs: false,
        winner: None,
    }
}

fn round_blinds(events: &[Value], span: &RoundSpan) -> Vec<BlindSpan> {
    let mut out = Vec::new();
    for event in events {
        if get_str(event, "event_name") != Some("player_blind") {
            continue;
        }
        let tick = get_i64(event, "tick").unwrap_or_default() as i32;
        if tick < span.start || tick > span.end {
            continue;
        }
        let Some(player) = get_u64(event, "user_steamid") else {
            continue;
        };
        let total = get_f64(event, "blind_duration").unwrap_or(0.0);
        if total <= 0.0 {
            continue;
        }
        let start = seconds_since(span.start, tick);
        out.push(BlindSpan {
            player,
            start,
            end: start + total,
            total,
        });
    }
    out
}

fn round_effects(
    events: &[Value],
    span: &RoundSpan,
    rows_by_tick: &BTreeMap<i32, Vec<Value>>,
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
            get_u64(event, "user_steamid").and_then(|id| player_row_at_tick(rows_by_tick, tick, id))
        } else {
            None
        };
        let x = get_f64(event, "x")
            .or_else(|| get_f64(event, "X"))
            .or_else(|| planter_row.and_then(|row| get_f64(row, "X")))
            .unwrap_or_default();
        let y = get_f64(event, "y")
            .or_else(|| get_f64(event, "Y"))
            .or_else(|| planter_row.and_then(|row| get_f64(row, "Y")))
            .unwrap_or_default();
        let z = get_f64(event, "z")
            .or_else(|| get_f64(event, "Z"))
            .or_else(|| planter_row.and_then(|row| get_f64(row, "Z")))
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
    out
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
    rows_by_tick: &BTreeMap<i32, Vec<Value>>,
) -> Vec<WeaponFireEvent> {
    let mut out = Vec::new();
    for event in events {
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
        let row = shooter.and_then(|id| player_row_at_tick(rows_by_tick, tick, id));
        out.push(WeaponFireEvent {
            t: seconds_since(span.start, tick),
            shooter,
            weapon: get_str(event, "weapon").map(str::to_string),
            x: row.and_then(|r| get_f64(r, "X")).unwrap_or_default(),
            y: row.and_then(|r| get_f64(r, "Y")).unwrap_or_default(),
            z: row.and_then(|r| get_f64(r, "Z")).unwrap_or_default(),
            yaw: row.and_then(|r| get_f64(r, "yaw")).unwrap_or_default(),
            team: row.and_then(|r| get_i64(r, "team_num")),
        });
    }
    out
}

fn player_row_at_tick(
    rows_by_tick: &BTreeMap<i32, Vec<Value>>,
    tick: i32,
    steam_id: u64,
) -> Option<&Value> {
    let rows = rows_by_tick.get(&tick).or_else(|| {
        rows_by_tick
            .range(..=tick)
            .next_back()
            .map(|(_, rows)| rows)
    })?;
    rows.iter()
        .find(|row| get_u64(row, "steamid") == Some(steam_id))
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

fn get_string_array(v: &Value, key: &str) -> Vec<String> {
    let Some(value) = get_field(v, key) else {
        return vec![];
    };
    let array = value
        .as_array()
        .or_else(|| value.as_object()?.get("StringVec")?.as_array());
    array
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
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
            Ok((
                idx,
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
                    effects: Vec::new(),
                    weapon_fires: Vec::new(),
                    projectile_frames: Vec::new(),
                    round_file: relative,
                },
                write_stats,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    round_results.sort_by_key(|(idx, _, _)| *idx);
    let mut manifest_rounds = Vec::with_capacity(round_results.len());
    for (_, manifest_round, write_stats) in round_results {
        add_parallel_write_stats(&mut stats, write_stats);
        manifest_rounds.push(manifest_round);
    }

    let manifest = ManifestOutput {
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
        remove_path_if_exists(backup_rounds_dir)?;
    }
    if had_manifest {
        remove_path_if_exists(backup_manifest_path)?;
    }
    Ok(())
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
    let mut gz = GzEncoder::new(file, Compression::default());

    let serialize_step = label.map(|label| format!("{label}:serde_json::to_writer"));
    let serialize_started = serialize_step.as_deref().map(final_step_start);
    let serialize_timer = Instant::now();
    {
        let mut counting = CountingWriter {
            inner: &mut gz,
            bytes: 0,
        };
        serde_json::to_writer(&mut counting, value)?;
        stats.raw_json_bytes = counting.bytes;
    }
    stats.serialize_json_ms = elapsed_ms(serialize_timer);
    if let (Some(step), Some(started)) = (serialize_step.as_deref(), serialize_started) {
        final_step_done(step, started);
    }

    let flush_step = label.map(|label| format!("{label}:gz.flush"));
    let flush_started = flush_step.as_deref().map(final_step_start);
    let flush_timer = Instant::now();
    gz.flush()?;
    stats.gz_flush_ms = elapsed_ms(flush_timer);
    if let (Some(step), Some(started)) = (flush_step.as_deref(), flush_started) {
        final_step_done(step, started);
    }

    let finish_step = label.map(|label| format!("{label}:gz.finish"));
    let finish_started = finish_step.as_deref().map(final_step_start);
    let finish_timer = Instant::now();
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
        let sync_timer = Instant::now();
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


#[cfg(test)]
mod tests {
    use super::{
        commit_split_output, parse_demo_to_output, read_capped, read_demo, write_json_gz, Args,
        Output, MAX_DEMO_SIZE,
    };
    use flate2::read::GzDecoder;
    use serde_json::Value;
    use std::{io::Read, io::Write, path::Path};

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
    fn roundlab_test_demo_produces_replay_json_when_configured() {
        let Ok(input) = std::env::var("ROUNDLAB_TEST_DEMO") else {
            eprintln!("skipping parser integration test: ROUNDLAB_TEST_DEMO is not set");
            return;
        };
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

        write_json_gz(&args.output, &output).unwrap();
        let json = read_gzip_json(&output_path);
        assert_eq!(json["rounds"].as_array().unwrap().len(), output.rounds.len());
        assert!(json["meta"]["tickRate"].as_f64().unwrap_or_default() > 0.0);
        assert!(json["players"].as_array().unwrap().len() >= output.players.len());
        assert_split_output_is_usable(&output_path, &json, &output);
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
        assert!(!backup_rounds_dir.exists(), "round backup should be restored");
        assert!(
            !backup_manifest_path.exists(),
            "manifest backup should be restored"
        );
    }

    fn assert_split_output_is_usable(output_path: &Path, manifest: &Value, output: &Output) {
        let rounds = manifest["rounds"].as_array().expect("manifest rounds array");
        let base_dir = output_path.parent().expect("output path parent");
        let mut split_total_frames = 0usize;
        let mut split_total_events = 0usize;
        let mut split_total_kills = 0usize;
        let mut split_total_bomb_events = 0usize;
        let mut split_total_effects = 0usize;
        let mut split_total_weapon_fires = 0usize;
        let mut split_total_projectile_frames = 0usize;
        let mut split_frames_with_players = 0usize;
        let mut split_players_with_weapons = 0usize;

        for (idx, manifest_round) in rounds.iter().enumerate() {
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
            let round_file = manifest_round["roundFile"]
                .as_str()
                .expect("manifest roundFile");
            assert!(
                !round_file.contains("..") && !round_file.starts_with('/'),
                "roundFile must stay relative and safe: {round_file}"
            );
            let round_path = base_dir.join(round_file);
            assert!(round_path.exists(), "missing split round file: {round_file}");
            let round_json = read_gzip_json(&round_path);
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
            assert_eq!(effects, output.rounds[idx].effects.len());
            assert_eq!(weapon_fires, output.rounds[idx].weapon_fires.len());
            assert_eq!(projectile_frames, output.rounds[idx].projectile_frames.len());

            split_total_frames += frames.len();
            split_total_events += events.len();
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
                match event.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "kill" => split_total_kills += 1,
                    "bomb_planted" | "bomb_defuse_start" | "bomb_defuse_abort"
                    | "bomb_defused" | "bomb_exploded" => split_total_bomb_events += 1,
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
            split_players_with_weapons > 0,
            "split output lost weapon state in frames"
        );
        assert!(split_total_events > 0, "split output lost events");
        assert!(split_total_kills > 0, "split output lost kill events");
        assert!(
            split_total_bomb_events > 0,
            "split output lost bomb events"
        );
        assert!(split_total_effects > 0, "split output lost utility effects");
        assert!(
            split_total_weapon_fires > 0,
            "split output lost weapon fire events"
        );
        assert!(
            split_total_projectile_frames > 0,
            "split output lost projectile frames"
        );
    }

    fn assert_replay_output_is_usable(output: &Output) {
        assert!(output.meta.tick_rate > 0.0, "tick rate must be positive");
        assert!(output.meta.sample_rate > 0, "sample rate must be positive");
        assert!(!output.players.is_empty(), "expected parsed players");
        assert!(!output.rounds.is_empty(), "expected parsed rounds");

        let mut total_frames = 0usize;
        let mut total_events = 0usize;
        let mut total_kills = 0usize;
        let mut total_bomb_events = 0usize;
        let mut total_effects = 0usize;
        let mut total_weapon_fires = 0usize;
        let mut total_projectile_frames = 0usize;
        let mut frames_with_players = 0usize;
        let mut players_with_weapons = 0usize;

        for round in &output.rounds {
            assert!(round.end_tick >= round.start_tick, "round tick range is invalid");
            assert!(!round.frames.is_empty(), "round has no frames");
            total_frames += round.frames.len();
            total_events += round.events.len();
            total_effects += round.effects.len();
            total_weapon_fires += round.weapon_fires.len();
            total_projectile_frames += round.projectile_frames.len();

            for frame in &round.frames {
                if !frame.players.is_empty() {
                    frames_with_players += 1;
                }
                players_with_weapons += frame
                    .players
                    .iter()
                    .filter(|player| !player.active.is_empty() || !player.weapons.is_empty())
                    .count();
            }
            for event in &round.events {
                match event.kind.as_str() {
                    "kill" => total_kills += 1,
                    "bomb_planted" | "bomb_defuse_start" | "bomb_defuse_abort" | "bomb_defused"
                    | "bomb_exploded" => total_bomb_events += 1,
                    _ => {}
                }
            }
        }

        assert!(total_frames > 0, "expected replay frames");
        assert!(frames_with_players > 0, "expected frames with players");
        assert!(players_with_weapons > 0, "expected weapon state in frames");
        assert!(total_events > 0, "expected round events");
        assert!(total_kills > 0, "expected kill events");
        assert!(total_bomb_events > 0, "expected bomb events");
        assert!(total_effects > 0, "expected utility/bomb effects");
        assert!(total_weapon_fires > 0, "expected weapon fire events");
        assert!(
            total_projectile_frames > 0,
            "expected projectile trajectory frames"
        );
    }

    fn read_gzip_json(path: &std::path::Path) -> Value {
        let file = std::fs::File::open(path).unwrap();
        let mut gz = GzDecoder::new(file);
        let mut raw = String::new();
        gz.read_to_string(&mut raw).unwrap();
        serde_json::from_str(&raw).unwrap()
    }
}
