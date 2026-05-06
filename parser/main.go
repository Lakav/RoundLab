package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"
	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	common "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/common"
	events "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
)

// zstdMagic is the first 4 bytes of any Zstandard frame (RFC 8478).
var zstdMagic = []byte{0x28, 0xB5, 0x2F, 0xFD}

// qualityStep maps a human quality label directly to a tick step.
// `full` keeps every parser tick. Lower qualities are kept for CLI/debug use,
// but the desktop app always requests full fidelity.
func qualityStep(label string) int {
	switch strings.ToLower(label) {
	case "low":
		return 64
	case "medium", "med":
		return 32
	case "high":
		return 16
	case "full", "":
		return 1
	}
	return 1
}

// Output schema (compact). At full quality positions are captured every tick.
// Coordinates are game-world coords; frontend transforms to radar pixels.

type Meta struct {
	Map         string  `json:"map"`
	TickRate    float64 `json:"tickRate"`
	SampleRate  int     `json:"sampleRate"` // samples per second
	DurationSec float64 `json:"durationSec"`
	TeamA       string  `json:"teamA"`
	TeamB       string  `json:"teamB"`
	ScoreA      int     `json:"scoreA"`
	ScoreB      int     `json:"scoreB"`
	Partial     bool    `json:"partial,omitempty"` // true if parse aborted early
	ParseError  string  `json:"parseError,omitempty"` // error message if partial
}

type Player struct {
	SteamID uint64 `json:"steamId"`
	Name    string `json:"name"`
	Team    string `json:"team"` // "CT" | "T" | "SPEC"
}

type Frame struct {
	T           float64         `json:"t"`       // seconds from round start
	Players     []PlayerPos     `json:"players"` // only alive players
	Bomb        *BombState      `json:"bomb,omitempty"`
	Projectiles []ProjectilePos `json:"projectiles,omitempty"`
}

type PlayerPos struct {
	ID           uint64        `json:"id"`
	X            float32       `json:"x"`
	Y            float32       `json:"y"`
	Z            float32       `json:"z"`
	Yaw          float32       `json:"yaw"`
	HP           int           `json:"hp"`
	Armor        int           `json:"armor"`
	Money        int           `json:"money"`
	Helmet       bool          `json:"helmet,omitempty"`
	Kit          bool          `json:"kit,omitempty"`
	HasBomb      bool          `json:"hasBomb,omitempty"`
	Team         uint8         `json:"team"`             // 2=T, 3=CT
	Active       string        `json:"active,omitempty"` // active weapon name
	Weapons      []string      `json:"weapons,omitempty"`
	FlashLeft    float32       `json:"flashLeft,omitempty"`  // seconds remaining of full flash
	FlashTotal   float32       `json:"flashTotal,omitempty"` // seconds total flash duration
	Use          bool          `json:"use,omitempty"`
	ActiveAction *ActiveAction `json:"activeAction,omitempty"`
}

type ActiveAction struct {
	Type     string  `json:"type"` // plant, utility
	Item     string  `json:"item"`
	Elapsed  float64 `json:"elapsed"`
	Duration float64 `json:"duration,omitempty"`
}

type BombState struct {
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
	Z       float32 `json:"z"`
	Status  string  `json:"status"` // carried, dropped, planted
	Carrier uint64  `json:"carrier,omitempty"`
}

type ProjectilePos struct {
	ID      int64   `json:"id"`
	Type    string  `json:"type"`
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
	Z       float32 `json:"z"`
	Thrower uint64  `json:"thrower,omitempty"`
}

type ProjectileFrame struct {
	T           float64         `json:"t"`
	Projectiles []ProjectilePos `json:"projectiles"`
}

type UtilityEffect struct {
	ID      int64   `json:"id,omitempty"`
	Type    string  `json:"type"`              // smoke, flash, he, fire, decoy, bomb_planted
	Variant string  `json:"variant,omitempty"` // molotov, incendiary
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
	Z       float32 `json:"z"`
	Team    uint8   `json:"team,omitempty"` // 2=T, 3=CT
}

type WeaponFireEvent struct {
	T       float64 `json:"t"`
	Shooter uint64  `json:"shooter,omitempty"`
	Weapon  string  `json:"weapon,omitempty"`
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
	Z       float32 `json:"z"`
	Yaw     float32 `json:"yaw"`
	Team    uint8   `json:"team,omitempty"` // 2=T, 3=CT
}

type Event struct {
	T      float64 `json:"t"`
	Type   string  `json:"type"` // kill, bomb_planted, bomb_defuse_start, bomb_defuse_abort, bomb_defused, bomb_exploded, round_end
	Player uint64  `json:"player,omitempty"`
	HasKit bool    `json:"hasKit,omitempty"`
	Killer uint64  `json:"killer,omitempty"`
	Victim uint64  `json:"victim,omitempty"`
	Assist uint64  `json:"assist,omitempty"`
	Weapon string  `json:"weapon,omitempty"`
	HS     bool    `json:"hs,omitempty"`
	Winner string  `json:"winner,omitempty"`
}

type Round struct {
	Number           int               `json:"number"`
	StartTick        int               `json:"startTick"`     // live round start, after freezetime
	FreezeEndTick    int               `json:"freezeEndTick"` // same as StartTick once known
	EndTick          int               `json:"endTick"`
	Duration         float64           `json:"duration"`
	Winner           string            `json:"winner"`
	WinnerName       string            `json:"winnerName,omitempty"`
	ScoreA           int               `json:"scoreA"`
	ScoreB           int               `json:"scoreB"`
	Frames           []Frame           `json:"frames"`
	Events           []Event           `json:"events"`
	Effects          []UtilityEffect   `json:"effects,omitempty"`
	WeaponFires      []WeaponFireEvent `json:"weaponFires,omitempty"`
	ProjectileFrames []ProjectileFrame `json:"projectileFrames,omitempty"`
	LiveStarted      bool              `json:"-"`
	TeamScores       map[string]int    `json:"-"`
}

type Output struct {
	Meta    Meta     `json:"meta"`
	Players []Player `json:"players"`
	Rounds  []Round  `json:"rounds"`
}

type storedRound struct {
	Path    string
	Fires   int
	Effects int
}

type RoundSpool struct {
	Dir    string
	Rounds []storedRound
}

func newRoundSpool() (*RoundSpool, error) {
	dir, err := os.MkdirTemp("", "roundlab-parser-*")
	if err != nil {
		return nil, err
	}
	return &RoundSpool{Dir: dir}, nil
}

func (s *RoundSpool) Close() {
	if s != nil && s.Dir != "" {
		_ = os.RemoveAll(s.Dir)
		s.Dir = ""
	}
}

func (s *RoundSpool) Add(round Round) error {
	if len(round.Frames) == 0 {
		return nil
	}
	round.Number = len(s.Rounds)
	path := filepath.Join(s.Dir, fmt.Sprintf("round-%03d.json", len(s.Rounds)))
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(file)
	err = enc.Encode(round)
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	s.Rounds = append(s.Rounds, storedRound{
		Path:    path,
		Fires:   len(round.WeaponFires),
		Effects: len(round.Effects),
	})
	return nil
}

func (s *RoundSpool) Count() int {
	if s == nil {
		return 0
	}
	return len(s.Rounds)
}

func emitProgress(progress float64, message string) {
	fmt.Fprintf(os.Stderr, "ROUNDLAB_PROGRESS %.4f %s\n", progress, message)
}

func finalStepStart(name string) time.Time {
	fmt.Fprintf(os.Stderr, "ROUNDLAB_FINAL start step=%s\n", name)
	return time.Now()
}

func finalStepDone(name string, started time.Time) {
	fmt.Fprintf(os.Stderr, "ROUNDLAB_FINAL done step=%s duration_ms=%d\n", name, time.Since(started).Milliseconds())
}

func finalStepFailed(name string, started time.Time, err error) {
	fmt.Fprintf(os.Stderr, "ROUNDLAB_FINAL failed step=%s duration_ms=%d error=%q\n", name, time.Since(started).Milliseconds(), err)
}

func skipFsync() bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv("ROUNDLAB_PARSER_SKIP_FSYNC")))
	return raw == "1" || raw == "true" || raw == "yes" || raw == "on"
}

func readStoredRound(path string) (Round, error) {
	file, err := os.Open(path)
	if err != nil {
		return Round{}, err
	}
	defer file.Close()
	var round Round
	if err := json.NewDecoder(file).Decode(&round); err != nil {
		return Round{}, err
	}
	return round, nil
}

func teamStr(t common.Team) string {
	switch t {
	case common.TeamTerrorists:
		return "T"
	case common.TeamCounterTerrorists:
		return "CT"
	}
	return "SPEC"
}

func infernoVariant(thrower *common.Player) string {
	// demoinfocs explicitly says Source 2 doesn't network whether FireGrenadeStart
	// is molotov or incendiary. This is only a fallback; the frontend can refine
	// the variant from the actual projectile class when it is available.
	if thrower != nil && thrower.Team == common.TeamCounterTerrorists {
		return "incendiary"
	}
	return "molotov"
}

func isBombName(name string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "c4") || strings.Contains(n, "bomb")
}

func isUtilityActionName(name string) bool {
	n := strings.ToLower(name)
	if n == "" || isBombName(n) || strings.Contains(n, "knife") || strings.Contains(n, "bayonet") || strings.Contains(n, "karambit") {
		return false
	}
	return strings.Contains(n, "grenade") ||
		strings.Contains(n, "flashbang") ||
		strings.Contains(n, "molotov") ||
		strings.Contains(n, "incendiary") ||
		strings.Contains(n, "decoy")
}

func main() {
	configureMemoryBudget()

	in := flag.String("in", "", "input .dem or .dem.zst file (use '-' for stdin — zstd auto-detected)")
	out := flag.String("out", "", "output .json.gz file")
	quality := flag.String("quality", "full", "sampling quality: full (every tick), high (~4Hz), medium (~2Hz), low (~1Hz)")
	skipProjectiles := flag.Bool("skipProjectiles", false, "omit per-frame projectile positions")
	skipWeaponFires := flag.Bool("skipWeaponFires", false, "omit weapon fire events")
	flag.Parse()
	if *in == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "usage: parser -in demo.dem[.zst] -out out.json.gz [-quality full|high|medium|low]")
		os.Exit(2)
	}
	step := qualityStep(*quality)

	// Open the raw input. We then peek 4 bytes to detect a zstd stream and
	// transparently wrap it with the decoder. This lets callers pipe either
	// a plain .dem or a .dem.zst without flipping a flag.
	var rawReader io.Reader
	filenameLower := strings.ToLower(*in)
	if *in == "-" {
		rawReader = os.Stdin
	} else {
		f, err := os.Open(*in)
		if err != nil {
			panic(err)
		}
		defer f.Close()
		rawReader = f
	}
	buffered := bufio.NewReaderSize(rawReader, 1<<20)
	peek, _ := buffered.Peek(4)
	isZst := bytes.Equal(peek, zstdMagic) || strings.HasSuffix(filenameLower, ".zst")

	var reader io.Reader = buffered
	if isZst {
		fmt.Fprintln(os.Stderr, "detected zstd stream, decompressing on the fly")
		dec, err := zstd.NewReader(buffered)
		if err != nil {
			panic(fmt.Errorf("zstd init: %w", err))
		}
		defer dec.Close()
		reader = dec
	}

	// IgnorePacketEntitiesPanic swallows the "unable to find existing
	// entity N" panics that some CS2 (especially POV) demos trigger inside
	// sendtables2.OnPacketEntities. Without it, a single bad message kills
	// the whole goroutine and we lose every event past that point —
	// weapon fires, smoke starts, kills, the lot.
	cfg := dem.DefaultParserConfig
	cfg.IgnorePacketEntitiesPanic = true
	cfg.MsgQueueBufferSize = 0
	p := dem.NewParserWithConfig(reader, cfg)
	defer p.Close()

	header, err := p.ParseHeader()
	if err != nil {
		panic(err)
	}

	tickRate := header.FrameRate()
	if tickRate <= 0 {
		tickRate = 64
	}
	sampleEveryTicks := step
	sampleHz := int(tickRate) / sampleEveryTicks
	if sampleHz < 1 {
		sampleHz = 1
	}
	projectileEveryTicks := 1

	output := Output{
		Meta: Meta{
			Map:        header.MapName,
			TickRate:   tickRate,
			SampleRate: sampleHz,
		},
		Players: []Player{},
		Rounds:  []Round{},
	}
	roundSpool, err := newRoundSpool()
	if err != nil {
		panic(err)
	}
	defer roundSpool.Close()
	var storeErr error
	storeRound := func(round Round) {
		if storeErr != nil {
			return
		}
		storeErr = roundSpool.Add(round)
		if storeErr == nil {
			debug.FreeOSMemory()
		}
	}

	knownPlayers := map[uint64]bool{}
	teamScores := map[string]int{}
	var currentRound *Round
	roundNumber := 0
	roundStartTick := 0
	bombPlanted := false
	smokeEffects := map[int]int{}
	decoyEffects := map[int]int{}
	infernoEffects := map[int64]int{}
	detonatedProjectiles := map[int64]bool{}
	plantStarts := map[uint64]int{}
	type utilityActionStart struct {
		item string
		tick int
	}
	utilityStarts := map[uint64]utilityActionStart{}

	beginLiveRound := func(tick int) {
		if currentRound == nil || currentRound.LiveStarted {
			return
		}
		currentRound.StartTick = tick
		currentRound.FreezeEndTick = tick
		currentRound.LiveStarted = true
		currentRound.Frames = []Frame{}
		currentRound.Events = []Event{}
	}

	roundTime := func() (float64, bool) {
		if currentRound == nil {
			return 0, false
		}
		// Some CS2 demos don't fire RoundFreezetimeEnd reliably, so the
		// first WeaponFire / SmokeStart / etc. may arrive before
		// LiveStarted flips. Begin the live round lazily so we don't drop
		// these events on the floor.
		tick := p.GameState().IngameTick()
		if !currentRound.LiveStarted {
			if p.GameState().IsFreezetimePeriod() {
				return 0, false
			}
			beginLiveRound(tick)
		}
		if tick < currentRound.StartTick {
			return 0, false
		}
		return float64(tick-currentRound.StartTick) / tickRate, true
	}

	// teamSide tracks which side ("CT"/"T") a clan name belongs to so we can
	// assign teamA/teamB deterministically (CT first) even when only one team
	// has a usable clan name.
	teamSide := map[string]string{}

	rememberTeam := func(ts *common.TeamState, score int) {
		if ts == nil {
			return
		}
		name := ts.ClanName()
		if name == "" {
			// Fall back to the side label so the UI always shows something
			// meaningful instead of "team_3".
			switch ts.Team() {
			case common.TeamCounterTerrorists:
				name = "Counter-Terrorists"
			case common.TeamTerrorists:
				name = "Terrorists"
			default:
				name = fmt.Sprintf("team_%d", ts.ID())
			}
		}
		teamScores[name] = score
		teamSide[name] = teamStr(ts.Team())
	}

	addPlayer := func(pl *common.Player) {
		if pl == nil || pl.SteamID64 == 0 || knownPlayers[pl.SteamID64] {
			return
		}
		knownPlayers[pl.SteamID64] = true
		output.Players = append(output.Players, Player{
			SteamID: pl.SteamID64,
			Name:    pl.Name,
			Team:    teamStr(pl.Team),
		})
	}

	p.RegisterEventHandler(func(e events.RoundStart) {
		roundNumber++
		roundStartTick = p.GameState().IngameTick()
		bombPlanted = false
		smokeEffects = map[int]int{}
		decoyEffects = map[int]int{}
		infernoEffects = map[int64]int{}
		detonatedProjectiles = map[int64]bool{}
		plantStarts = map[uint64]int{}
		utilityStarts = map[uint64]utilityActionStart{}
		currentRound = &Round{
			Number:        roundNumber,
			StartTick:     roundStartTick,
			FreezeEndTick: roundStartTick,
			Frames:        []Frame{},
			Events:        []Event{},
			Effects:       []UtilityEffect{},
			TeamScores:    map[string]int{},
		}
	})

	p.RegisterEventHandler(func(e events.RoundFreezetimeEnd) {
		beginLiveRound(p.GameState().IngameTick())
	})

	p.RegisterEventHandler(func(e events.TeamClanNameUpdated) {
		if e.TeamState == nil || strings.TrimSpace(e.NewName) == "" {
			return
		}
		rememberTeam(e.TeamState, e.TeamState.Score())
		if currentRound != nil {
			currentRound.TeamScores[e.NewName] = e.TeamState.Score()
		}
	})

	p.RegisterEventHandler(func(e events.RoundEnd) {
		if currentRound == nil {
			return
		}
		plantStarts = map[uint64]int{}
		utilityStarts = map[uint64]utilityActionStart{}
		if t, ok := roundTime(); ok {
			currentRound.Events = append(currentRound.Events, Event{T: t, Type: "round_end", Winner: teamStr(e.Winner)})
		}
		if !currentRound.LiveStarted {
			beginLiveRound(roundStartTick)
		}
		currentRound.Winner = teamStr(e.Winner)
		if e.WinnerState != nil {
			currentRound.WinnerName = e.WinnerState.ClanName()
			rememberTeam(e.WinnerState, e.WinnerState.Score())
		}
		if e.LoserState != nil {
			rememberTeam(e.LoserState, e.LoserState.Score())
		}
		for name, score := range teamScores {
			currentRound.TeamScores[name] = score
		}
	})

	p.RegisterEventHandler(func(e events.RoundEndOfficial) {
		if currentRound == nil {
			return
		}
		endTick := p.GameState().IngameTick()
		currentRound.EndTick = endTick
		currentRound.Duration = float64(endTick-currentRound.StartTick) / tickRate
		storeRound(*currentRound)
		currentRound = nil
	})

	p.RegisterEventHandler(func(e events.Kill) {
		t, ok := roundTime()
		if !ok {
			return
		}
		ev := Event{T: t, Type: "kill", HS: e.IsHeadshot}
		if e.Killer != nil {
			ev.Killer = e.Killer.SteamID64
		}
		if e.Victim != nil {
			ev.Victim = e.Victim.SteamID64
			delete(plantStarts, e.Victim.SteamID64)
			delete(utilityStarts, e.Victim.SteamID64)
		}
		if e.Assister != nil {
			ev.Assist = e.Assister.SteamID64
		}
		if e.Weapon != nil {
			ev.Weapon = e.Weapon.String()
		}
		currentRound.Events = append(currentRound.Events, ev)
	})

	p.RegisterEventHandler(func(e events.WeaponFire) {
		if *skipWeaponFires {
			return
		}
		t, ok := roundTime()
		if !ok || currentRound == nil || e.Shooter == nil {
			return
		}
		pos := e.Shooter.Position()
		ev := WeaponFireEvent{
			T:       t,
			Shooter: e.Shooter.SteamID64,
			X:       float32(pos.X),
			Y:       float32(pos.Y),
			Z:       float32(pos.Z),
			Yaw:     float32(e.Shooter.ViewDirectionX()),
			Team:    uint8(e.Shooter.Team),
		}
		if e.Weapon != nil {
			ev.Weapon = e.Weapon.String()
		}
		currentRound.WeaponFires = append(currentRound.WeaponFires, ev)
	})

	p.RegisterEventHandler(func(e events.BombPlantBegin) {
		_, ok := roundTime()
		if !ok || e.Player == nil {
			return
		}
		plantStarts[e.Player.SteamID64] = p.GameState().IngameTick()
	})
	p.RegisterEventHandler(func(e events.BombPlantAborted) {
		if e.Player != nil {
			delete(plantStarts, e.Player.SteamID64)
		}
	})
	p.RegisterEventHandler(func(e events.BombPlanted) {
		t, ok := roundTime()
		if !ok {
			return
		}
		bombPlanted = true
		if e.Player != nil {
			delete(plantStarts, e.Player.SteamID64)
		} else {
			plantStarts = map[uint64]int{}
		}
		if bomb := p.GameState().Bomb(); bomb != nil {
			pos := bomb.Position()
			currentRound.Effects = append(currentRound.Effects, UtilityEffect{
				Type:  "bomb_planted",
				Start: t,
				End:   t + 40,
				X:     float32(pos.X),
				Y:     float32(pos.Y),
				Z:     float32(pos.Z),
			})
		}
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_planted"})
	})
	p.RegisterEventHandler(func(e events.BombDefuseStart) {
		t, ok := roundTime()
		if !ok {
			return
		}
		ev := Event{T: t, Type: "bomb_defuse_start", HasKit: e.HasKit}
		if e.Player != nil {
			ev.Player = e.Player.SteamID64
		}
		currentRound.Events = append(currentRound.Events, ev)
	})
	p.RegisterEventHandler(func(e events.BombDefuseAborted) {
		t, ok := roundTime()
		if !ok {
			return
		}
		ev := Event{T: t, Type: "bomb_defuse_abort"}
		if e.Player != nil {
			ev.Player = e.Player.SteamID64
		}
		currentRound.Events = append(currentRound.Events, ev)
	})
	p.RegisterEventHandler(func(e events.BombDefused) {
		t, ok := roundTime()
		if !ok {
			return
		}
		bombPlanted = false
		plantStarts = map[uint64]int{}
		utilityStarts = map[uint64]utilityActionStart{}
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_defused"})
	})
	p.RegisterEventHandler(func(e events.BombExplode) {
		t, ok := roundTime()
		if !ok {
			return
		}
		bombPlanted = false
		plantStarts = map[uint64]int{}
		utilityStarts = map[uint64]utilityActionStart{}
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_exploded"})
	})

	teamOf := func(pl *common.Player) uint8 {
		if pl == nil {
			return 0
		}
		return uint8(pl.Team)
	}

	p.RegisterEventHandler(func(e events.SmokeStart) {
		t, ok := roundTime()
		if !ok {
			return
		}
		idx := len(currentRound.Effects)
		smokeEffects[e.GrenadeEntityID] = idx
		currentRound.Effects = append(currentRound.Effects, UtilityEffect{
			ID:    int64(e.GrenadeEntityID),
			Type:  "smoke",
			Start: t,
			End:   t + 22,
			X:     float32(e.Position.X),
			Y:     float32(e.Position.Y),
			Z:     float32(e.Position.Z),
			Team:  teamOf(e.Thrower),
		})
	})
	p.RegisterEventHandler(func(e events.SmokeExpired) {
		t, ok := roundTime()
		if !ok {
			return
		}
		if idx, found := smokeEffects[e.GrenadeEntityID]; found && idx < len(currentRound.Effects) {
			currentRound.Effects[idx].End = t
		}
	})
	p.RegisterEventHandler(func(e events.FlashExplode) {
		t, ok := roundTime()
		if !ok {
			return
		}
		currentRound.Effects = append(currentRound.Effects, UtilityEffect{
			ID:    int64(e.GrenadeEntityID),
			Type:  "flash",
			Start: t,
			End:   t + 0.8,
			X:     float32(e.Position.X),
			Y:     float32(e.Position.Y),
			Z:     float32(e.Position.Z),
			Team:  teamOf(e.Thrower),
		})
	})
	p.RegisterEventHandler(func(e events.HeExplode) {
		t, ok := roundTime()
		if !ok {
			return
		}
		currentRound.Effects = append(currentRound.Effects, UtilityEffect{
			ID:    int64(e.GrenadeEntityID),
			Type:  "he",
			Start: t,
			End:   t + 0.9,
			X:     float32(e.Position.X),
			Y:     float32(e.Position.Y),
			Z:     float32(e.Position.Z),
			Team:  teamOf(e.Thrower),
		})
	})
	p.RegisterEventHandler(func(e events.DecoyStart) {
		t, ok := roundTime()
		if !ok {
			return
		}
		idx := len(currentRound.Effects)
		decoyEffects[e.GrenadeEntityID] = idx
		currentRound.Effects = append(currentRound.Effects, UtilityEffect{
			ID:    int64(e.GrenadeEntityID),
			Type:  "decoy",
			Start: t,
			End:   t + 15,
			X:     float32(e.Position.X),
			Y:     float32(e.Position.Y),
			Z:     float32(e.Position.Z),
			Team:  teamOf(e.Thrower),
		})
	})
	p.RegisterEventHandler(func(e events.DecoyExpired) {
		t, ok := roundTime()
		if !ok {
			return
		}
		if idx, found := decoyEffects[e.GrenadeEntityID]; found && idx < len(currentRound.Effects) {
			currentRound.Effects[idx].End = t
		}
	})
	p.RegisterEventHandler(func(e events.InfernoStart) {
		t, ok := roundTime()
		if !ok || e.Inferno == nil {
			return
		}
		fires := e.Inferno.Fires().Active().List()
		if len(fires) == 0 {
			return
		}
		var x, y, z float64
		for _, fire := range fires {
			x += fire.X
			y += fire.Y
			z += fire.Z
		}
		n := float64(len(fires))
		idx := len(currentRound.Effects)
		infernoEffects[e.Inferno.UniqueID()] = idx
		currentRound.Effects = append(currentRound.Effects, UtilityEffect{
			ID:      e.Inferno.UniqueID(),
			Type:    "fire",
			Variant: infernoVariant(e.Inferno.Thrower()),
			Start:   t,
			End:     t + 7,
			X:       float32(x / n),
			Y:       float32(y / n),
			Z:       float32(z / n),
			Team:    teamOf(e.Inferno.Thrower()),
		})
	})
	p.RegisterEventHandler(func(e events.GrenadeProjectileDestroy) {
		if e.Projectile != nil {
			detonatedProjectiles[e.Projectile.UniqueID()] = true
		}
	})
	p.RegisterEventHandler(func(e events.InfernoExpired) {
		t, ok := roundTime()
		if !ok || e.Inferno == nil {
			return
		}
		if idx, found := infernoEffects[e.Inferno.UniqueID()]; found && idx < len(currentRound.Effects) {
			currentRound.Effects[idx].End = t
		}
	})

	collectProjectiles := func() []ProjectilePos {
		if *skipProjectiles {
			return nil
		}
		projectiles := []ProjectilePos{}
		for _, proj := range p.GameState().GrenadeProjectiles() {
			if proj == nil || proj.WeaponInstance == nil {
				continue
			}
			if detonatedProjectiles[proj.UniqueID()] {
				continue
			}
			pos := proj.Position()
			var thrower uint64
			if proj.Thrower != nil {
				thrower = proj.Thrower.SteamID64
			}
			projectiles = append(projectiles, ProjectilePos{
				ID:      proj.UniqueID(),
				Type:    proj.WeaponInstance.String(),
				X:       float32(pos.X),
				Y:       float32(pos.Y),
				Z:       float32(pos.Z),
				Thrower: thrower,
			})
		}
		return projectiles
	}

	// Sample positions per frame
	p.RegisterEventHandler(func(e events.FrameDone) {
		if currentRound == nil {
			return
		}
		tick := p.GameState().IngameTick()
		if !currentRound.LiveStarted {
			if p.GameState().IsFreezetimePeriod() {
				return
			}
			beginLiveRound(tick)
		}
		t := float64(tick-currentRound.StartTick) / tickRate
		if (tick-currentRound.StartTick)%projectileEveryTicks == 0 {
			projectiles := collectProjectiles()
			if len(projectiles) > 0 {
				currentRound.ProjectileFrames = append(currentRound.ProjectileFrames, ProjectileFrame{
					T:           t,
					Projectiles: projectiles,
				})
			}
		}
		if (tick-currentRound.StartTick)%sampleEveryTicks != 0 {
			return
		}
		frame := Frame{T: t, Players: []PlayerPos{}}
		var bombCarrier uint64
		if bomb := p.GameState().Bomb(); bomb != nil && bomb.Carrier != nil {
			bombCarrier = bomb.Carrier.SteamID64
			pos := bomb.Position()
			frame.Bomb = &BombState{
				X:       float32(pos.X),
				Y:       float32(pos.Y),
				Z:       float32(pos.Z),
				Status:  "carried",
				Carrier: bombCarrier,
			}
		} else if bomb := p.GameState().Bomb(); bomb != nil {
			pos := bomb.Position()
			if pos.X != 0 || pos.Y != 0 || pos.Z != 0 {
				status := "dropped"
				if bombPlanted {
					status = "planted"
				}
				frame.Bomb = &BombState{
					X:      float32(pos.X),
					Y:      float32(pos.Y),
					Z:      float32(pos.Z),
					Status: status,
				}
			}
		}
		frame.Projectiles = collectProjectiles()
		for _, pl := range p.GameState().Participants().Playing() {
			if pl == nil {
				continue
			}
			addPlayer(pl)
			pos := pl.Position()
			weapons := []string{}
			active := ""
			for _, w := range pl.Weapons() {
				if w == nil {
					continue
				}
				name := w.String()
				weapons = append(weapons, name)
			}
			if aw := pl.ActiveWeapon(); aw != nil {
				active = aw.String()
			}
			var activeAction *ActiveAction
			if startTick, ok := plantStarts[pl.SteamID64]; ok && pl.IsAlive() {
				delete(utilityStarts, pl.SteamID64)
				elapsed := float64(tick-startTick) / tickRate
				if elapsed >= 0 && elapsed <= 3.2 {
					activeAction = &ActiveAction{
						Type:     "plant",
						Item:     "C4",
						Elapsed:  elapsed,
						Duration: 3.2,
					}
				}
			} else if active != "" && isUtilityActionName(active) && pl.IsAlive() &&
				(pl.IsPressingButton(common.ButtonAttack) || pl.IsPressingButton(common.ButtonAttack2)) {
				start, ok := utilityStarts[pl.SteamID64]
				if !ok || start.item != active {
					start = utilityActionStart{item: active, tick: tick}
					utilityStarts[pl.SteamID64] = start
				}
				activeAction = &ActiveAction{
					Type:    "utility",
					Item:    active,
					Elapsed: float64(tick-start.tick) / tickRate,
				}
			} else {
				delete(utilityStarts, pl.SteamID64)
			}
			flashLeft := float32(pl.FlashDurationTimeRemaining().Seconds())
			if flashLeft < 0 {
				flashLeft = 0
			}
			flashTotal := float32(pl.FlashDuration)
			// IsAlive() consults the underlying entity flags; Health() can lag
			// for one tick after death and report the pre-kill value, which
			// makes dead players look full-HP in the HUD.
			hp := pl.Health()
			if !pl.IsAlive() {
				hp = 0
			}
			frame.Players = append(frame.Players, PlayerPos{
				ID:           pl.SteamID64,
				X:            float32(pos.X),
				Y:            float32(pos.Y),
				Z:            float32(pos.Z),
				Yaw:          float32(pl.ViewDirectionX()),
				HP:           hp,
				Armor:        pl.Armor(),
				Money:        pl.Money(),
				Helmet:       pl.HasHelmet(),
				Kit:          pl.HasDefuseKit(),
				HasBomb:      pl.SteamID64 == bombCarrier,
				Team:         uint8(pl.Team),
				Active:       active,
				Weapons:      weapons,
				FlashLeft:    flashLeft,
				FlashTotal:   flashTotal,
				Use:          pl.IsPressingButton(common.ButtonUse),
				ActiveAction: activeAction,
			})
		}
		currentRound.Frames = append(currentRound.Frames, frame)
	})

	// demoinfocs's own recover() only catches EOF — every other panic
	// (notably the "unable to find existing entity N" from sendtables2 on
	// some CS2 demos) is re-panicked out of ParseToEnd. Wrap the call so
	// we keep the partial output we already have when that happens.
	var parseErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				parseErr = fmt.Errorf("parser panic: %v", r)
			}
		}()
		parseErr = p.ParseToEnd()
	}()
	if parseErr != nil {
		msg := strings.SplitN(parseErr.Error(), "\n", 2)[0]
		fmt.Fprintln(os.Stderr, "parse error (will keep partial):", msg)
		// We still try to write whatever we got. A demo that craps out on
		// round 18 is still way more useful than nothing — and definitely
		// better than falling through to the Rust fallback, which doesn't
		// emit weapon fires / utility effects / dead-player inventory.
	}

	// Flush a trailing round the demo never officially ended.
	if currentRound != nil {
		endTick := p.GameState().IngameTick()
		currentRound.EndTick = endTick
		if currentRound.LiveStarted && endTick > currentRound.StartTick {
			currentRound.Duration = float64(endTick-currentRound.StartTick) / tickRate
		}
		storeRound(*currentRound)
		currentRound = nil
	}
	if storeErr != nil {
		panic(storeErr)
	}

	// Final metadata (map name is populated during parse for CS2 demos)
	if h := p.Header(); h.MapName != "" {
		output.Meta.Map = h.MapName
	}
	output.Meta.DurationSec = float64(p.GameState().IngameTick()) / tickRate
	if parseErr != nil {
		output.Meta.Partial = true
		output.Meta.ParseError = strings.SplitN(parseErr.Error(), "\n", 2)[0]
	}
	gs := p.GameState()
	if ct := gs.TeamCounterTerrorists(); ct != nil {
		rememberTeam(ct, ct.Score())
	}
	if tt := gs.TeamTerrorists(); tt != nil {
		rememberTeam(tt, tt.Score())
	}

	// Assign teamA = CT, teamB = T so the HUD is deterministic. If a side is
	// missing (rare), fall back to score-sorted order.
	var teamAName, teamBName string
	for name, side := range teamSide {
		if side == "CT" && teamAName == "" {
			teamAName = name
		} else if side == "T" && teamBName == "" {
			teamBName = name
		}
	}
	if teamAName == "" || teamBName == "" {
		teamNames := []string{}
		for name := range teamScores {
			teamNames = append(teamNames, name)
		}
		sort.Slice(teamNames, func(i, j int) bool {
			return teamScores[teamNames[i]] > teamScores[teamNames[j]]
		})
		if teamAName == "" && len(teamNames) > 0 {
			teamAName = teamNames[0]
		}
		if teamBName == "" {
			for _, n := range teamNames {
				if n != teamAName {
					teamBName = n
					break
				}
			}
		}
	}
	if teamAName != "" {
		output.Meta.TeamA = teamAName
		output.Meta.ScoreA = teamScores[teamAName]
	}
	if teamBName != "" {
		output.Meta.TeamB = teamBName
		output.Meta.ScoreB = teamScores[teamBName]
	}
	// If we got nothing usable, surface the underlying parse error so the
	// caller can fall back to the Rust parser instead of silently producing
	// an empty match.
	if roundSpool.Count() == 0 {
		if parseErr != nil {
			fmt.Fprintln(os.Stderr, "no rounds parsed:", parseErr)
		} else {
			fmt.Fprintln(os.Stderr, "no rounds parsed")
		}
		// os.Exit bypasses defer, so clean up the temp spool manually.
		roundSpool.Close()
		os.Exit(1)
	}

	emitProgress(0.90, "Writing output...")
	if err := writeOutput(*out, output, roundSpool, teamAName, teamBName); err != nil {
		panic(err)
	}

	suffix := ""
	if parseErr != nil {
		suffix = " (partial — parse aborted mid-demo)"
	}
	totalFires, totalEffects := 0, 0
	for _, round := range roundSpool.Rounds {
		totalFires += round.Fires
		totalEffects += round.Effects
	}
	emitProgress(0.9990, "Emitting parser OK on stderr...")
	okStarted := finalStepStart("emit-ok")
	if _, err := fmt.Fprintf(os.Stderr,
		"OK[primary] map=%s rounds=%d players=%d fires=%d effects=%d%s\n",
		output.Meta.Map, roundSpool.Count(), len(output.Players),
		totalFires, totalEffects, suffix); err != nil {
		finalStepFailed("emit-ok", okStarted, err)
		panic(err)
	}
	finalStepDone("emit-ok", okStarted)
	emitProgress(0.9995, "Parser OK emitted; exiting process...")

	// Explicitly close the round spool and temp directory before os.Exit.
	// os.Exit bypasses defer, so we need to clean up manually.
	if roundSpool != nil {
		roundSpool.Close()
	}

	// Force immediate process exit on Windows. The output gzip is fully
	// written and fsynced — anything left in deferred Close() calls is
	// best-effort cleanup (zstd decoder goroutines, demoinfocs parser
	// state, scratch round spool). On Windows those defers can wedge a
	// goroutine inside klauspost/compress/zstd or sendtables2, leaving
	// the process alive after main() returns. Tauri then never sees the
	// stderr pipe close and the UI sits at 99% forever. Bypass the lot.
	syncStarted := finalStepStart("stdio-sync")
	if err := os.Stderr.Sync(); err != nil {
		finalStepFailed("stdio-sync-stderr", syncStarted, err)
	}
	if err := os.Stdout.Sync(); err != nil {
		finalStepFailed("stdio-sync-stdout", syncStarted, err)
	}
	finalStepDone("stdio-sync", syncStarted)
	_ = os.Stderr.Sync()
	_ = os.Stdout.Sync()
	os.Exit(0)
}

func writeOutput(path string, output Output, spool *RoundSpool, teamAName, teamBName string) (err error) {
	writeOutputStarted := finalStepStart("writeOutput")
	defer func() {
		if err != nil {
			finalStepFailed("writeOutput", writeOutputStarted, err)
		} else {
			finalStepDone("writeOutput", writeOutputStarted)
		}
	}()

	createStarted := finalStepStart("os.Create")
	of, err := os.Create(path)
	if err != nil {
		finalStepFailed("os.Create", createStarted, err)
		return err
	}
	finalStepDone("os.Create", createStarted)
	// Track whether the file/gzip have been closed cleanly so the deferred
	// safety net only fires on early-return error paths. Without this the
	// Windows pipe can swallow the final progress events while gzip.Close
	// flushes — leaving the UI stuck at 95%.
	closed := false
	defer func() {
		if !closed {
			of.Close()
		}
	}()

	gz, err := gzip.NewWriterLevel(of, gzip.BestSpeed)
	if err != nil {
		return err
	}
	defer func() {
		if !closed {
			gz.Close()
		}
	}()

	if _, err := gz.Write([]byte(`{"meta":`)); err != nil {
		return err
	}
	if err := writeJSON(gz, output.Meta); err != nil {
		return err
	}
	if _, err := gz.Write([]byte(`,"players":`)); err != nil {
		return err
	}
	if err := writeJSON(gz, output.Players); err != nil {
		return err
	}
	if _, err := gz.Write([]byte(`,"rounds":[`)); err != nil {
		return err
	}

	for idx, stored := range spool.Rounds {
		writeProgress := 0.90 + 0.08*(float64(idx)/float64(len(spool.Rounds)))
		emitProgress(writeProgress, fmt.Sprintf("Writing round %d/%d...", idx+1, len(spool.Rounds)))
		round, err := readStoredRound(stored.Path)
		if err != nil {
			return err
		}
		round.Number = idx
		round.ScoreA = round.TeamScores[teamAName]
		round.ScoreB = round.TeamScores[teamBName]
		if idx > 0 {
			if _, err := gz.Write([]byte(",")); err != nil {
				return err
			}
		}
		if err := writeJSON(gz, round); err != nil {
			return err
		}
		// Periodic flush keeps the deflate window from accumulating into a
		// single multi-second hit during gz.Close(). Critical on Windows
		// where the final flush + fsync was leaving the UI stuck at 99%.
		if idx%8 == 7 {
			if err := gz.Flush(); err != nil {
				return err
			}
		}
	}

	if _, err := gz.Write([]byte(`]}`)); err != nil {
		return err
	}

	emitProgress(0.985, "Finalizing gzip stream (gz.Close)...")
	gzipStarted := finalStepStart("gz.Close")
	if err := gz.Close(); err != nil {
		finalStepFailed("gz.Close", gzipStarted, err)
		return err
	}
	finalStepDone("gz.Close", gzipStarted)
	if skipFsync() {
		emitProgress(0.995, "Skipping disk fsync (ROUNDLAB_PARSER_SKIP_FSYNC).")
		skipStarted := finalStepStart("of.Sync.skip")
		finalStepDone("of.Sync.skip", skipStarted)
	} else {
		emitProgress(0.995, "Flushing output to disk (of.Sync)...")
		syncStarted := finalStepStart("of.Sync")
		if err := of.Sync(); err != nil {
			finalStepFailed("of.Sync", syncStarted, err)
			return err
		}
		finalStepDone("of.Sync", syncStarted)
	}
	emitProgress(0.997, "Closing output file (of.Close)...")
	closeStarted := finalStepStart("of.Close")
	if err := of.Close(); err != nil {
		finalStepFailed("of.Close", closeStarted, err)
		return err
	}
	finalStepDone("of.Close", closeStarted)
	closed = true
	return nil
}

func writeJSON(w io.Writer, value any) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(value)
}

func configureMemoryBudget() {
	debug.SetGCPercent(50)
	limitMb := int64(6144)
	if raw := os.Getenv("ROUNDLAB_PARSER_MEMORY_LIMIT_MB"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			limitMb = parsed
		}
	}
	debug.SetMemoryLimit(limitMb * 1024 * 1024)
}
