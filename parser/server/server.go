package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/klauspost/compress/zstd"
)

const (
	demoDir   = "/data/demos"
	parsedDir = "/data/parsed"
)

// ------- Types mirroring web/src/lib/types.ts (only what we need) -------

type MatchMeta struct {
	Map         string  `json:"map"`
	TickRate    float64 `json:"tickRate"`
	SampleRate  float64 `json:"sampleRate"`
	DurationSec float64 `json:"durationSec"`
	TeamA       string  `json:"teamA"`
	TeamB       string  `json:"teamB"`
	ScoreA      int     `json:"scoreA"`
	ScoreB      int     `json:"scoreB"`
}

type Player struct {
	SteamID int64  `json:"steamId"`
	Name    string `json:"name"`
	Team    string `json:"team"`
}

type Round struct {
	Number        int             `json:"number"`
	StartTick     int             `json:"startTick"`
	FreezeEndTick *int            `json:"freezeEndTick,omitempty"`
	EndTick       int             `json:"endTick"`
	Duration      float64         `json:"duration"`
	Winner        string          `json:"winner"`
	WinnerName    *string         `json:"winnerName,omitempty"`
	ScoreA        *int            `json:"scoreA,omitempty"`
	ScoreB        *int            `json:"scoreB,omitempty"`
	Frames        json.RawMessage `json:"frames"`
	Events        json.RawMessage `json:"events"`
	Effects       json.RawMessage `json:"effects,omitempty"`
	WeaponFires   json.RawMessage `json:"weaponFires,omitempty"`
}

type MatchData struct {
	Meta    MatchMeta `json:"meta"`
	Players []Player  `json:"players"`
	Rounds  []Round   `json:"rounds"`
}

// ------- Cache (mirror of web/src/server/match-data.ts) -------

type cacheEntry struct {
	mtime time.Time
	data  *MatchData
}

var (
	matchCache    = sync.Map{} // id -> *cacheEntry
	roundGzCache  = sync.Map{} // "id:round" -> *roundGzEntry
	idPattern     = regexp.MustCompile(`^[a-f0-9-]{36}$`)
)

type roundGzEntry struct {
	mtime time.Time
	body  []byte
}

// ------- Server entrypoint -------

func main() {
	if err := os.MkdirAll(demoDir, 0o755); err != nil {
		log.Fatalf("mkdir demos: %v", err)
	}
	if err := os.MkdirAll(parsedDir, 0o755); err != nil {
		log.Fatalf("mkdir parsed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/upload", uploadHandler)
	mux.HandleFunc("/api/matches", matchesHandler)
	mux.HandleFunc("/api/match/", matchRouter) // /api/match/:id, /api/match/:id/metadata, /api/match/:id/round/:n

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           corsMiddleware(mux),
		ReadHeaderTimeout: 30 * time.Second,
		// Uploads can be big; no write timeout.
	}
	log.Printf("listening on :%s", port)
	log.Fatal(srv.ListenAndServe())
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ------- /api/upload -------

// zstdMagic is the first 4 bytes of any Zstandard frame.
var zstdMagic = []byte{0x28, 0xB5, 0x2F, 0xFD}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	// 4 GB max. Browsers will stream multipart.
	r.Body = http.MaxBytesReader(w, r.Body, 4<<30)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSONError(w, http.StatusBadRequest, "parse form failed: "+err.Error())
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "no file")
		return
	}
	defer file.Close()

	id := uuid.New().String()
	// First write whatever was uploaded to a temp path. We then inspect magic
	// bytes / filename to decide whether a decompression step is needed.
	tmpPath := filepath.Join(demoDir, id+".upload")
	demoPath := filepath.Join(demoDir, id+".dem")

	out, err := os.Create(tmpPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not create file")
		return
	}
	written, err := io.Copy(out, file)
	_ = out.Close()
	if err != nil {
		_ = os.Remove(tmpPath)
		writeJSONError(w, http.StatusInternalServerError, "could not save file")
		return
	}
	log.Printf("uploaded %q (%d bytes) -> %s", header.Filename, written, id)

	// Detect zstd either by filename or by magic bytes. Either signal alone is
	// enough — some browsers strip the .zst when it's a browser-compressed
	// download, and the magic-byte sniff is cheap and unambiguous.
	isZst := strings.HasSuffix(strings.ToLower(header.Filename), ".zst")
	if !isZst {
		magic, err := readMagic(tmpPath, 4)
		if err == nil && bytes.Equal(magic, zstdMagic) {
			isZst = true
		}
	}

	if isZst {
		log.Printf("decompressing zstd for %s", id)
		if err := decompressZstd(tmpPath, demoPath); err != nil {
			_ = os.Remove(tmpPath)
			_ = os.Remove(demoPath)
			log.Printf("zstd decompress failed for %s: %v", id, err)
			writeJSONError(w, http.StatusBadRequest, "zstd decompress failed: "+err.Error())
			return
		}
		_ = os.Remove(tmpPath)
	} else {
		// No decompression needed — just rename into place.
		if err := os.Rename(tmpPath, demoPath); err != nil {
			_ = os.Remove(tmpPath)
			writeJSONError(w, http.StatusInternalServerError, "could not place file")
			return
		}
	}

	outPath := filepath.Join(parsedDir, id+".json.gz")
	cmd := exec.Command("/app/parser", "-in", demoPath, "-out", outPath)
	stderr, err := cmd.CombinedOutput()
	// Always clean up the .dem once parsing is done (success or failure).
	_ = os.Remove(demoPath)
	if err != nil {
		log.Printf("parser failed for %s: %v\n%s", id, err, stderr)
		writeJSONError(w, http.StatusInternalServerError, "parser failed: "+strings.TrimSpace(string(stderr)))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func readMagic(path string, n int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, n)
	m, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	return buf[:m], nil
}

func decompressZstd(srcPath, dstPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dec, err := zstd.NewReader(src, zstd.WithDecoderConcurrency(1))
	if err != nil {
		return err
	}
	defer dec.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, dec); err != nil {
		_ = dst.Close()
		return err
	}
	return dst.Close()
}

// ------- /api/matches -------

func matchesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	entries, err := os.ReadDir(parsedDir)
	if err != nil {
		_, _ = w.Write([]byte("[]"))
		return
	}
	type item struct {
		ID        string `json:"id"`
		CreatedAt int64  `json:"createdAt"`
		Size      int64  `json:"size"`
	}
	items := make([]item, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".json.gz") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, item{
			ID:        strings.TrimSuffix(name, ".json.gz"),
			CreatedAt: info.ModTime().UnixMilli(),
			Size:      info.Size(),
		})
	}
	// newest first
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].CreatedAt > items[j-1].CreatedAt; j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
	_ = json.NewEncoder(w).Encode(items)
}

// ------- /api/match/:id, /api/match/:id/metadata, /api/match/:id/round/:n -------

func matchRouter(w http.ResponseWriter, r *http.Request) {
	// Path: /api/match/<id>[/metadata | /round/<n>]
	rest := strings.TrimPrefix(r.URL.Path, "/api/match/")
	if rest == "" || rest == r.URL.Path {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	parts := strings.Split(rest, "/")
	id := parts[0]
	if !idPattern.MatchString(id) {
		writeJSONError(w, http.StatusBadRequest, "bad id")
		return
	}

	switch len(parts) {
	case 1:
		// raw .json.gz pass-through
		serveRawMatch(w, r, id)
	case 2:
		if parts[1] == "metadata" {
			serveMetadata(w, r, id)
			return
		}
		writeJSONError(w, http.StatusNotFound, "not found")
	case 3:
		if parts[1] == "round" {
			serveRound(w, r, id, parts[2])
			return
		}
		writeJSONError(w, http.StatusNotFound, "not found")
	default:
		writeJSONError(w, http.StatusNotFound, "not found")
	}
}

func parsedPath(id string) string {
	return filepath.Join(parsedDir, id+".json.gz")
}

func serveRawMatch(w http.ResponseWriter, r *http.Request, id string) {
	f, err := os.Open(parsedPath(id))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = io.Copy(w, f)
}

func readMatchData(id string) (*MatchData, error) {
	p := parsedPath(id)
	info, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	if cached, ok := matchCache.Load(id); ok {
		ce := cached.(*cacheEntry)
		if ce.mtime.Equal(info.ModTime()) {
			return ce.data, nil
		}
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer gr.Close()
	var data MatchData
	if err := json.NewDecoder(gr).Decode(&data); err != nil {
		return nil, err
	}
	matchCache.Store(id, &cacheEntry{mtime: info.ModTime(), data: &data})
	return &data, nil
}

// toMatchMetadata: clone match but replace the heavy arrays in each round with empty arrays
func toMatchMetadata(src *MatchData) *MatchData {
	empty := json.RawMessage("[]")
	trimmed := make([]Round, len(src.Rounds))
	for i, r := range src.Rounds {
		trimmed[i] = Round{
			Number:        r.Number,
			StartTick:     r.StartTick,
			FreezeEndTick: r.FreezeEndTick,
			EndTick:       r.EndTick,
			Duration:      r.Duration,
			Winner:        r.Winner,
			WinnerName:    r.WinnerName,
			ScoreA:        r.ScoreA,
			ScoreB:        r.ScoreB,
			Frames:        empty,
			Events:        empty,
			Effects:       empty,
			WeaponFires:   empty,
		}
	}
	return &MatchData{
		Meta:    src.Meta,
		Players: src.Players,
		Rounds:  trimmed,
	}
}

func serveMetadata(w http.ResponseWriter, r *http.Request, id string) {
	data, err := readMatchData(id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	md := toMatchMetadata(data)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_ = json.NewEncoder(w).Encode(md)
}

func serveRound(w http.ResponseWriter, r *http.Request, id, roundStr string) {
	n, err := strconv.Atoi(roundStr)
	if err != nil || n < 0 {
		writeJSONError(w, http.StatusBadRequest, "bad round")
		return
	}
	data, err := readMatchData(id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	var found *Round
	for i := range data.Rounds {
		if data.Rounds[i].Number == n {
			found = &data.Rounds[i]
			break
		}
	}
	if found == nil {
		writeJSONError(w, http.StatusNotFound, "round not found")
		return
	}

	// Round gzip cache, keyed by id:round + mtime.
	info, _ := os.Stat(parsedPath(id))
	key := fmt.Sprintf("%s:%d", id, n)
	if cached, ok := roundGzCache.Load(key); ok {
		rg := cached.(*roundGzEntry)
		if info != nil && rg.mtime.Equal(info.ModTime()) {
			writeRoundGz(w, rg.body)
			return
		}
	}
	raw, err := json.Marshal(found)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "encode failed")
		return
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(raw); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "gzip failed")
		return
	}
	_ = gz.Close()
	body := buf.Bytes()
	if info != nil {
		roundGzCache.Store(key, &roundGzEntry{mtime: info.ModTime(), body: body})
	}
	writeRoundGz(w, body)
}

func writeRoundGz(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(body)
}
