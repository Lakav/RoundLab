use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::Path,
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
use serde::Serialize;
use serde_json::Value;

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];
const TICK_RATE: f64 = 64.0;

#[derive(Debug, Default)]
struct Args {
    input: String,
    output: String,
    quality: String,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    projectiles: Vec<ProjectilePos>,
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
    team: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    active: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    weapons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flash_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flash_total: Option<f64>,
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

fn main() {
    if let Err(err) = run() {
        eprintln!("fallback parse error: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = parse_args()?;
    let bytes = read_demo(&args.input)?;
    let huf = create_huffman_lookup_table();

    let header = parse_header(&bytes, &huf)?;
    let map = header.get("map_name").cloned().unwrap_or_default();
    let players = parse_players(&bytes, &huf)?;
    let events = parse_events(&bytes, &huf)?;
    let spans = round_spans(&events)
        .into_iter()
        .map(|span| playable_span(&events, &span))
        .collect::<Vec<_>>();
    if spans.is_empty() {
        bail!("fallback parser found no playable rounds");
    }

    let sample_step = sample_step(&args.quality);
    let sample_rate = (TICK_RATE as i32 / sample_step).max(1);
    let wanted_ticks = sample_ticks(&spans, sample_step, &events);
    let tick_rows = parse_ticks(&bytes, &huf, wanted_ticks)?;
    let rows_by_tick = group_tick_rows(tick_rows);
    let team_rows = parse_team_rows(&bytes, &huf, team_name_ticks(&spans)).unwrap_or_default();
    let (team_a, team_b) = team_names_from_rows(&team_rows);
    let projectile_rows = parse_projectiles(&bytes, &huf)?;
    let projectiles_by_tick = group_projectile_rows(projectile_rows);

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
        let blind_spans = round_blinds(&events, &span);
        for tick in (span.start..=span.end).step_by(sample_step as usize) {
            let Some(rows) = rows_by_tick.get(&tick) else {
                continue;
            };
            let t = seconds_since(span.start, tick);
            let players = rows
                .iter()
                .filter_map(|row| player_pos_from_row(row, &blind_spans, t))
                .collect::<Vec<_>>();
            if players.is_empty() {
                continue;
            }
            frames.push(Frame {
                t,
                players,
                projectiles: projectiles_by_tick.get(&tick).cloned().unwrap_or_default(),
            });
        }

        if frames.is_empty() {
            continue;
        }
        if frames[0].t > 0.05 {
            let first = Frame {
                t: 0.0,
                players: frames[0].players.clone(),
                projectiles: Vec::new(),
            };
            frames.insert(0, first);
        }

        let projectile_frames = projectiles_by_tick
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
            .collect::<Vec<_>>();

        rounds.push(Round {
            number: rounds.len(),
            start_tick: span.start,
            freeze_end_tick: span.start,
            end_tick: span.end,
            duration: seconds_since(span.start, span.end),
            winner: span.winner.clone(),
            score_a: score_ct,
            score_b: score_t,
            events: round_events(&events, &span),
            effects: round_effects(&events, &span, &rows_by_tick),
            weapon_fires: round_weapon_fires(&events, &span, &rows_by_tick),
            projectile_frames,
            frames,
        });

        if idx > 200 {
            break;
        }
    }

    if rounds.is_empty() {
        bail!("fallback parser produced no frames");
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

    write_json_gz(&args.output, &output)?;
    eprintln!(
        "OK fallback map={} rounds={} players={}",
        output.meta.map,
        output.rounds.len(),
        output.players.len()
    );
    Ok(())
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
        .all(|weapon| is_knife_or_bomb(weapon))
}

fn is_knife_or_bomb(weapon: &str) -> bool {
    let lower = weapon.to_ascii_lowercase();
    lower.contains("knife")
        || lower.contains("bayonet")
        || lower.contains("karambit")
        || lower == "c4"
        || lower == "bomb"
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
            "-skipProjectiles" | "-skipWeaponFires" => {}
            _ => bail!("unknown argument: {arg}"),
        }
    }
    if out.input.is_empty() || out.output.is_empty() {
        bail!("usage: parser-fallback -in demo.dem[.zst] -out out.json.gz [-quality full|high|medium|low]");
    }
    Ok(out)
}

fn read_demo(path: &str) -> Result<Vec<u8>> {
    let raw = fs::read(path).with_context(|| format!("read {path}"))?;
    let is_zst = raw.starts_with(&ZSTD_MAGIC) || path.to_lowercase().ends_with(".zst");
    if !is_zst {
        return Ok(raw);
    }
    zstd::decode_all(raw.as_slice()).context("decompress zstd demo")
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
            "bomb_planted".into(),
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

fn parse_ticks(bytes: &[u8], huf: &Vec<(u8, u8)>, ticks: Vec<i32>) -> Result<Vec<Value>> {
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
        ],
        vec![],
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
        _ => 8,
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
                | "bomb_planted"
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

fn player_pos_from_row(row: &Value, blind_spans: &[BlindSpan], t: f64) -> Option<PlayerPos> {
    if !get_bool(row, "is_alive").unwrap_or(false) {
        return None;
    }
    let id = get_u64(row, "steamid")?;
    let blind = blind_spans
        .iter()
        .find(|b| b.player == id && t >= b.start && t <= b.end);
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
        team: get_i64(row, "team_num").unwrap_or_default(),
        active: get_str(row, "active_weapon_name").unwrap_or("").to_string(),
        weapons: get_string_array(row, "inventory"),
        flash_left: blind.map(|b| (b.end - t).max(0.0)),
        flash_total: blind.map(|b| b.total),
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
        let mut start = seconds_since(span.start, tick);
        if kind == "decoy" {
            start = (start - 1.0_f64).max(0.0_f64);
        }
        let duration = match kind {
            "smoke" => 18.0,
            "flash" => 0.8,
            "he" => 0.9,
            "fire" => 7.0,
            "decoy" => 15.0,
            "bomb_planted" => 45.0,
            _ => 1.0,
        };
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

fn player_row_at_tick<'a>(
    rows_by_tick: &'a BTreeMap<i32, Vec<Value>>,
    tick: i32,
    steam_id: u64,
) -> Option<&'a Value> {
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

fn write_json_gz(path: &str, output: &Output) -> Result<()> {
    let file = fs::File::create(Path::new(path)).with_context(|| format!("create {path}"))?;
    let mut gz = GzEncoder::new(file, Compression::default());
    serde_json::to_writer(&mut gz, output)?;
    gz.flush()?;
    gz.finish()?;
    Ok(())
}
