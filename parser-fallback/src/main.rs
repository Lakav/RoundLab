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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerPos {
    id: u64,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    hp: i64,
    armor: i64,
    #[serde(skip_serializing_if = "is_false")]
    helmet: bool,
    #[serde(skip_serializing_if = "is_false")]
    kit: bool,
    team: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    active: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    weapons: Vec<String>,
}

#[derive(Serialize)]
struct Event {
    t: f64,
    #[serde(rename = "type")]
    kind: String,
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
    let spans = round_spans(&events);
    if spans.is_empty() {
        bail!("fallback parser found no playable rounds");
    }

    let sample_step = sample_step(&args.quality);
    let sample_rate = (TICK_RATE as i32 / sample_step).max(1);
    let wanted_ticks = sample_ticks(&spans, sample_step);
    let tick_rows = parse_ticks(&bytes, &huf, wanted_ticks)?;
    let rows_by_tick = group_tick_rows(tick_rows);

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
        for tick in (span.start..=span.end).step_by(sample_step as usize) {
            let Some(rows) = rows_by_tick.get(&tick) else {
                continue;
            };
            let players = rows
                .iter()
                .filter_map(player_pos_from_row)
                .collect::<Vec<_>>();
            if players.is_empty() {
                continue;
            }
            frames.push(Frame {
                t: seconds_since(span.start, tick),
                players,
            });
        }

        if frames.is_empty() {
            continue;
        }

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
            frames,
        });

        if idx > 200 {
            break;
        }
    }

    if rounds.is_empty() {
        bail!("fallback parser produced no frames");
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
            team_a: "CT".into(),
            team_b: "T".into(),
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
            "player_death".into(),
            "bomb_planted".into(),
            "bomb_defused".into(),
            "bomb_exploded".into(),
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
            "has_helmet".into(),
            "has_defuser".into(),
            "is_alive".into(),
            "team_num".into(),
            "active_weapon_name".into(),
            "inventory".into(),
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

fn round_spans(events: &[Value]) -> Vec<RoundSpan> {
    let starts = events
        .iter()
        .filter(|e| get_str(e, "event_name") == Some("round_freeze_end"))
        .filter_map(|e| get_i64(e, "tick").map(|t| t as i32))
        .filter(|t| *t > 0)
        .collect::<Vec<_>>();
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

    let mut spans = Vec::new();
    let mut end_idx = 0;
    for start in starts {
        while end_idx < ends.len() && ends[end_idx].0 <= start {
            end_idx += 1;
        }
        if end_idx >= ends.len() {
            break;
        }
        let (end, winner) = &ends[end_idx];
        if *end > start {
            spans.push(RoundSpan {
                start,
                end: *end,
                winner: winner.clone(),
            });
        }
        end_idx += 1;
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

fn sample_ticks(spans: &[RoundSpan], step: i32) -> Vec<i32> {
    let mut ticks = Vec::new();
    for span in spans {
        let mut tick = span.start;
        while tick <= span.end {
            ticks.push(tick);
            tick += step;
        }
        ticks.push(span.end);
    }
    ticks.sort_unstable();
    ticks.dedup();
    ticks
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

fn player_pos_from_row(row: &Value) -> Option<PlayerPos> {
    if !get_bool(row, "is_alive").unwrap_or(false) {
        return None;
    }
    let id = get_u64(row, "steamid")?;
    Some(PlayerPos {
        id,
        x: get_f64(row, "X").unwrap_or_default(),
        y: get_f64(row, "Y").unwrap_or_default(),
        z: get_f64(row, "Z").unwrap_or_default(),
        yaw: get_f64(row, "yaw").unwrap_or_default(),
        hp: get_i64(row, "health").unwrap_or_default(),
        armor: get_i64(row, "armor_value").unwrap_or_default(),
        helmet: get_bool(row, "has_helmet").unwrap_or(false),
        kit: get_bool(row, "has_defuser").unwrap_or(false),
        team: get_i64(row, "team_num").unwrap_or_default(),
        active: get_str(row, "active_weapon_name").unwrap_or("").to_string(),
        weapons: get_string_array(row, "inventory"),
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
                killer: get_u64(event, "attacker_steamid"),
                victim: get_u64(event, "user_steamid"),
                assist: get_u64(event, "assister_steamid"),
                weapon: get_str(event, "weapon").map(str::to_string),
                hs: get_bool(event, "headshot").unwrap_or(false),
                winner: None,
            }),
            "bomb_planted" => out.push(simple_event(t, "bomb_planted")),
            "bomb_defused" => out.push(simple_event(t, "bomb_defused")),
            "bomb_exploded" => out.push(simple_event(t, "bomb_exploded")),
            "round_end" => out.push(Event {
                t,
                kind: "round_end".into(),
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
        killer: None,
        victim: None,
        assist: None,
        weapon: None,
        hs: false,
        winner: None,
    }
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
