package main

import (
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"os"

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
	T       float64     `json:"t"`       // seconds from round start
	Players []PlayerPos `json:"players"` // only alive players
}

type PlayerPos struct {
	ID      uint64   `json:"id"`
	X       float32  `json:"x"`
	Y       float32  `json:"y"`
	Z       float32  `json:"z"`
	Yaw     float32  `json:"yaw"`
	HP      int      `json:"hp"`
	Armor   int      `json:"armor"`
	Helmet  bool     `json:"helmet,omitempty"`
	Kit     bool     `json:"kit,omitempty"`
	Team    uint8    `json:"team"` // 2=T, 3=CT
	Active  string   `json:"active,omitempty"` // active weapon name
	Weapons []string `json:"weapons,omitempty"`
}

type Event struct {
	T       float64 `json:"t"`
	Type    string  `json:"type"` // kill, bomb_planted, bomb_defused, bomb_exploded, round_end
	Killer  uint64  `json:"killer,omitempty"`
	Victim  uint64  `json:"victim,omitempty"`
	Assist  uint64  `json:"assist,omitempty"`
	Weapon  string  `json:"weapon,omitempty"`
	HS      bool    `json:"hs,omitempty"`
	Winner  string  `json:"winner,omitempty"`
}

type Round struct {
	Number    int     `json:"number"`
	StartTick int     `json:"startTick"`
	EndTick   int     `json:"endTick"`
	Duration  float64 `json:"duration"`
	Winner    string  `json:"winner"`
	Frames    []Frame `json:"frames"`
	Events    []Event `json:"events"`
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
	in := flag.String("in", "", "input .dem file")
	out := flag.String("out", "", "output .json.gz file")
	flag.Parse()
	if *in == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "usage: parser -in demo.dem -out out.json.gz")
		os.Exit(2)
	}

	f, err := os.Open(*in)
	if err != nil {
		panic(err)
	}
	defer f.Close()

	p := dem.NewParser(f)
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
	var currentRound *Round
	roundNumber := 0
	roundStartTick := 0

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
		currentRound = &Round{
			Number:    roundNumber,
			StartTick: roundStartTick,
			Frames:    []Frame{},
			Events:    []Event{},
		}
	})

	p.RegisterEventHandler(func(e events.RoundEnd) {
		if currentRound == nil {
			return
		}
		endTick := p.GameState().IngameTick()
		currentRound.EndTick = endTick
		currentRound.Duration = float64(endTick-currentRound.StartTick) / tickRate
		currentRound.Winner = teamStr(e.Winner)
		output.Rounds = append(output.Rounds, *currentRound)
		currentRound = nil
	})

	p.RegisterEventHandler(func(e events.Kill) {
		if currentRound == nil {
			return
		}
		t := float64(p.GameState().IngameTick()-currentRound.StartTick) / tickRate
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

	p.RegisterEventHandler(func(e events.BombPlanted) {
		if currentRound == nil {
			return
		}
		t := float64(p.GameState().IngameTick()-currentRound.StartTick) / tickRate
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_planted"})
	})
	p.RegisterEventHandler(func(e events.BombDefused) {
		if currentRound == nil {
			return
		}
		t := float64(p.GameState().IngameTick()-currentRound.StartTick) / tickRate
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_defused"})
	})
	p.RegisterEventHandler(func(e events.BombExplode) {
		if currentRound == nil {
			return
		}
		t := float64(p.GameState().IngameTick()-currentRound.StartTick) / tickRate
		currentRound.Events = append(currentRound.Events, Event{T: t, Type: "bomb_exploded"})
	})

	// Sample positions per frame
	p.RegisterEventHandler(func(e events.FrameDone) {
		if currentRound == nil {
			return
		}
		tick := p.GameState().IngameTick()
		if (tick-currentRound.StartTick)%sampleEveryTicks != 0 {
			return
		}
		t := float64(tick-currentRound.StartTick) / tickRate
		frame := Frame{T: t, Players: []PlayerPos{}}
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
			frame.Players = append(frame.Players, PlayerPos{
				ID:      pl.SteamID64,
				X:       float32(pos.X),
				Y:       float32(pos.Y),
				Z:       float32(pos.Z),
				Yaw:     float32(pl.ViewDirectionX()),
				HP:      pl.Health(),
				Armor:   pl.Armor(),
				Helmet:  pl.HasHelmet(),
				Kit:     pl.HasDefuseKit(),
				Team:    uint8(pl.Team),
				Active:  active,
				Weapons: weapons,
			})
		}
		currentRound.Frames = append(currentRound.Frames, frame)
	})

	if err := p.ParseToEnd(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	// Final metadata (map name is populated during parse for CS2 demos)
	if h := p.Header(); h.MapName != "" {
		output.Meta.Map = h.MapName
	}
	output.Meta.DurationSec = float64(p.GameState().IngameTick()) / tickRate
	gs := p.GameState()
	if ct := gs.TeamCounterTerrorists(); ct != nil {
		output.Meta.TeamA = ct.ClanName()
		output.Meta.ScoreA = ct.Score()
	}
	if tt := gs.TeamTerrorists(); tt != nil {
		output.Meta.TeamB = tt.ClanName()
		output.Meta.ScoreB = tt.Score()
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
