# RoundLab

RoundLab is a CS2 demo review tool for uploading GOTV demos, parsing match data, and replaying rounds on a 2D radar with timeline controls and drawing tools.

## Current MVP

- Upload `.dem` and `.dem.zst` files.
- Parse CS2 demos with a Go parser built on `demoinfocs-golang`.
- Replay rounds on a 2D radar map.
- Scrub the round timeline, play/pause, and change playback speed.
- Draw annotations over the review.
- Show player HP, armor, helmet, defuse kit, weapons, and utility.

## Project Structure

```txt
parser/  Go demo parser
web/     Next.js web app
```

## Local Development

Build the parser:

```bash
cd parser
go build -o parser .
```

Run the web app:

```bash
cd web
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Notes

Demo files and parsed outputs are intentionally ignored by Git because they are large and should live in object storage later.
