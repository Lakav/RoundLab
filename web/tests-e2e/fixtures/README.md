# Licensed browser-import fixture

`roundlab-licensed-2v2.dem.zst` is an adapted, compressed CS2 demo used only to
exercise RoundLab's real browser import path.

- Upstream project: [`markus-wa/cs-demos-2`](https://gitlab.com/markus-wa/cs-demos-2)
- Upstream commit: `0b0f78a1811d4d5184b06b55f250b586a213895b`
- Upstream archive: `s2.7z`, Git LFS object
  `af8227b333cdd881dc9ad49d19d936de04789069ef49b736cd3bf3e6bb37dd43`
- Original member: `s2/1_2v2_6thAug23_64cf951f9b4ce6b86c73b089.dem`
- Upstream author/licensor: Markus Walther
- Upstream license: MIT; the license text is preserved in
  `LICENSE.upstream.md`.
- Adaptation: the first 22 MiB are retained (the parser-visible match is
  complete: Overpass, 16 rounds, four players, 9–7), then compressed with
  Zstandard level 22. This removes trailing bytes that are not needed by the
  parser and does not rename or alter player records.
- Uncompressed adapted SHA-256:
  `7936e1c566e25d8141dfa789fb41962a41c6b964c3f5d00fd76d15d982753305`
- Compressed fixture SHA-256:
  `5f2cde70d7d73894364817af3b6446d872a5410bea76765fed704d81e00a2135`

The file is public test data, not a private or user-local demo. It still
contains public gamer handles and Steam identifiers from the recording. Do not
copy those values into diagnostics, screenshots, or unrelated fixtures.
