fn main() {
    if let Err(err) = roundlab_parser::run_cli() {
        eprintln!("parser error: {err:#}");
        std::process::exit(1);
    }
}
