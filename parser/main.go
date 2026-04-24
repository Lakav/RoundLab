package main

import (
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"

	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	common "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/common"
	events "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
)

// Output schema (compact). Positions sampled at ~8 Hz (every 8 ticks @ 64 tick).
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
	ID         uint64   `json:"id"`
	X          float32  `json:"x"`
	Y          float32  `json:"y"`
	Z          float32  `json:"z"`
	Yaw        float32  `json:"yaw"`
	HP         int      `json:"hp"`
	Armor      int      `json:"armor"`
	Helmet     bool     `json:"helmet,omitempty"`
	Kit        bool     `json:"kit,omitempty"`
	HasBomb    bool     `json:"hasBomb,omitempty"`
	Team       uint8    `json:"team"`             // 2=T, 3=CT
	Active     string   `json:"active,omitempty"` // active weapon name
	Weapons    []string `json:"weapons,omitempty"`
	FlashLeft  float32  `json:"flashLeft,omitempty"`  // seconds remaining of full flash
	FlashTotal float32  `json:"flashTotal,omitempty"` // seconds total flash duration
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

type UtilityEffect struct {
	ID    int64   `json:"id,omitempty"`
	Type  string  `json:"type"` // smoke, flash, he, fire, decoy, bomb_planted
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
	Team  uint8   `json:"team,omitempty"` // 2=T, 3=CT
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
	Type   string  `json:"type"` // kill, bomb_planted, bomb_defused, bomb_exploded, round_end
	Killer uint64  `json:"killer,omitempty"`
	Victim uint64  `json:"victim,omitempty"`
	Assist uint64  `json:"assist,omitempty"`
	Weapon string  `json:"weapon,omitempty"`
	HS     bool    `json:"hs,omitempty"`
	Winner string  `json:"winner,omitempty"`
}

type Round struct {
	Number        int               `json:"number"`
	StartTick     int               `json:"startTick"`     // live round start, after freezetime
	FreezeEndTick int               `json:"freezeEndTick"` // same as StartTick once known
	EndTick       int               `json:"endTick"`
	Duration      float64           `json:"duration"`
	Winner        string            `json:"winner"`
	WinnerName    string            `json:"winnerName,omitempty"`
	ScoreA        int               `json:"scoreA"`
	ScoreB        int               `json:"scoreB"`
	Frames        []Frame           `json:"frames"`
	Events        []Event           `json:"events"`
	Effects       []UtilityEffect   `json:"effects,omitempty"`
	WeaponFires   []WeaponFireEvent `json:"weaponFires,omitempty"`
	LiveStarted   bool              `json:"-"`
	TeamScores    map[string]int    `json:"-"`
}

type Output struct {
	Meta    Meta     `json:"meta"`
	Players []Player `json:"players"`
	Rounds  []Round  `json:"rounds"`
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

func main() {
	in := flag.String("in", "", "input .dem file (use '-' for stdin)")
	out := flag.String("out", "", "output .json.gz file")
	flag.Parse()
	if *in == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "usage: parser -in demo.dem -out out.json.gz  (use -in - to read from stdin)")
		os.Exit(2)
	}

	var reader io.Reader
	if *in == "-" {
		reader = os.Stdin
	} else {
		f, err := os.Open(*in)
		if err != nil {
			panic(err)
		}
		defer f.Close()
		reader = f
	}

	p := dem.NewParser(reader)
	defer p.Close()

	header, err := p.ParseHeader()
	if err != nil {
		panic(err)
	}

	tickRate := header.FrameRate()
	if tickRate <= 0 {
		tickRate = 64
	}
	sampleEveryTicks := int(tickRate / 8)
	if sampleEveryTicks < 1 {
		sampleEveryTicks = 8
	}

	output := Output{
		Meta: Meta{
			Map:        header.MapName,
			TickRate:   tickRate,
			SampleRate: 8,
		},
		Players: []Player{},
		Rounds:  []Round{},
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
		if currentRound == nil || !currentRound.LiveStarted {
			return 0, false
		}
		tick := p.GameState().IngameTick()
		if tick < currentRound.StartTick {
			return 0, false
		}
		return float64(tick-currentRound.StartTick) / tickRate, true
	}

	rememberTeam := func(ts *common.TeamState, score int) {
		if ts == nil {
			return
		}
		name := ts.ClanName()
		if name == "" {
			name = fmt.Sprintf("team_%d", ts.ID())
		}
		teamScores[name] = score
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

	p.RegisterEventHandler(func(e events.RoundEnd) {
		if currentRound == nil {
			return
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
		output.Rounds = append(output.Rounds, *currentRound)
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

	p.RegisterEventHandler(func(e events.BombPlanted) {
		t, ok := roundTime()
		if !ok {
			return
		}
		bombPlanted = true
		if bomb := p.GameState().Bomb(); bomb != nil {
			pos := bomb.Position()
			currentRound.Effects = append(currentRound.Effects, UtilityEffect{
				Type:  "bomb_planted",
				Start: t,
				End:   t + 45,
				X:     float32(pos.X),
				Y:     float32(pos.Y),
				Z:     float32(pos.Z),
			})
		}
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_planted"})
	})
	p.RegisterEventHandler(func(e events.BombDefused) {
		t, ok := roundTime()
		if !ok {
			return
		}
		bombPlanted = false
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_defused"})
	})
	p.RegisterEventHandler(func(e events.BombExplode) {
		t, ok := roundTime()
		if !ok {
			return
		}
		bombPlanted = false
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
			End:   t + 18,
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
			ID:    e.Inferno.UniqueID(),
			Type:  "fire",
			Start: t,
			End:   t + 7,
			X:     float32(x / n),
			Y:     float32(y / n),
			Z:     float32(z / n),
			Team:  teamOf(e.Inferno.Thrower()),
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
		if (tick-currentRound.StartTick)%sampleEveryTicks != 0 {
			return
		}
		t := float64(tick-currentRound.StartTick) / tickRate
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
			frame.Projectiles = append(frame.Projectiles, ProjectilePos{
				ID:      proj.UniqueID(),
				Type:    proj.WeaponInstance.String(),
				X:       float32(pos.X),
				Y:       float32(pos.Y),
				Z:       float32(pos.Z),
				Thrower: thrower,
			})
		}
		for _, pl := range p.GameState().Participants().Playing() {
			if pl == nil || !pl.IsAlive() {
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
			flashLeft := float32(pl.FlashDurationTimeRemaining().Seconds())
			if flashLeft < 0 {
				flashLeft = 0
			}
			flashTotal := float32(pl.FlashDuration)
			frame.Players = append(frame.Players, PlayerPos{
				ID:         pl.SteamID64,
				X:          float32(pos.X),
				Y:          float32(pos.Y),
				Z:          float32(pos.Z),
				Yaw:        float32(pl.ViewDirectionX()),
				HP:         pl.Health(),
				Armor:      pl.Armor(),
				Helmet:     pl.HasHelmet(),
				Kit:        pl.HasDefuseKit(),
				HasBomb:    pl.SteamID64 == bombCarrier,
				Team:       uint8(pl.Team),
				Active:     active,
				Weapons:    weapons,
				FlashLeft:  flashLeft,
				FlashTotal: flashTotal,
			})
		}
		currentRound.Frames = append(currentRound.Frames, frame)
	})

	if err := p.ParseToEnd(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	// Flush a trailing round the demo never officially ended.
	if currentRound != nil {
		endTick := p.GameState().IngameTick()
		currentRound.EndTick = endTick
		if currentRound.LiveStarted && endTick > currentRound.StartTick {
			currentRound.Duration = float64(endTick-currentRound.StartTick) / tickRate
		}
		output.Rounds = append(output.Rounds, *currentRound)
		currentRound = nil
	}

	// Drop rounds with no frames (warmup, aborted) and renumber starting from 0.
	kept := output.Rounds[:0]
	for _, r := range output.Rounds {
		if len(r.Frames) == 0 {
			continue
		}
		r.Number = len(kept)
		kept = append(kept, r)
	}
	output.Rounds = kept

	// Final metadata (map name is populated during parse for CS2 demos)
	if h := p.Header(); h.MapName != "" {
		output.Meta.Map = h.MapName
	}
	output.Meta.DurationSec = float64(p.GameState().IngameTick()) / tickRate
	gs := p.GameState()
	if ct := gs.TeamCounterTerrorists(); ct != nil {
		rememberTeam(ct, ct.Score())
	}
	if tt := gs.TeamTerrorists(); tt != nil {
		rememberTeam(tt, tt.Score())
	}

	teamNames := []string{}
	for name := range teamScores {
		teamNames = append(teamNames, name)
	}
	sort.Slice(teamNames, func(i, j int) bool {
		return teamScores[teamNames[i]] > teamScores[teamNames[j]]
	})
	if len(teamNames) >= 2 {
		teamAName := teamNames[0]
		teamBName := teamNames[1]
		output.Meta.TeamA = teamAName
		output.Meta.TeamB = teamBName
		output.Meta.ScoreA = teamScores[teamAName]
		output.Meta.ScoreB = teamScores[teamBName]
		for i := range output.Rounds {
			output.Rounds[i].ScoreA = output.Rounds[i].TeamScores[teamAName]
			output.Rounds[i].ScoreB = output.Rounds[i].TeamScores[teamBName]
		}
	}

	// Write gzipped JSON
	of, err := os.Create(*out)
	if err != nil {
		panic(err)
	}
	defer of.Close()
	gz := gzip.NewWriter(of)
	defer gz.Close()
	enc := json.NewEncoder(gz)
	if err := enc.Encode(output); err != nil {
		panic(err)
	}

	fmt.Fprintf(os.Stderr, "OK map=%s rounds=%d players=%d\n",
		output.Meta.Map, len(output.Rounds), len(output.Players))
}
