use super::*;

pub fn run() -> Result<()> {
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

fn parse_args() -> Result<Args> {
    parse_args_from(std::env::args().skip(1))
}

pub(crate) fn parse_args_from<I, S>(args: I) -> Result<Args>
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
