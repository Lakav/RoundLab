use wasm_bindgen::prelude::*;

use super::*;

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
                mechanics_formula_version: MECHANICS_FORMULA_VERSION,
                import_quality: import_quality(&args.quality),
                capabilities: parser_capabilities(&args),
                geometry_version: None,
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
