package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
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

// Max upload body size (4 GB). Railway doesn't document a hard cap, but very
// large bodies can be cut by edge proxies — we observe and log Content-Length
// to distinguish truncated uploads from disk issues.
const maxUploadBytes = 4 << 30

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	log.Printf("upload: remote=%s content-length=%d content-type=%q",
		r.RemoteAddr, r.ContentLength, r.Header.Get("Content-Type"))

	// Cap the request body so a runaway client can't fill the volume.
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)

	// Stream the multipart body directly — don't buffer the whole file.
	mr, err := r.MultipartReader()
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "not a multipart body: "+err.Error())
		return
	}

	var part *multipart.Part
	var filename string
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "multipart read failed: "+err.Error())
			return
		}
		if p.FormName() == "file" {
			part = p
			filename = p.FileName()
			break
		}
		_ = p.Close()
	}
	if part == nil {
		writeJSONError(w, http.StatusBadRequest, "no file field in form")
		return
	}
	defer part.Close()

	id := uuid.New().String()

	// Peek the first 4 bytes to decide zstd vs. raw. We stream the rest.
	peek, err := readAtMost(part, 4)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "read peek failed: "+err.Error())
		return
	}
	filenameLower := strings.ToLower(filename)
	isZst := strings.HasSuffix(filenameLower, ".zst") || bytes.Equal(peek, zstdMagic)
	log.Printf("upload: id=%s filename=%q is_zst=%v peek=%x", id, filename, isZst, peek)

	// Reassemble peek + remaining body into a single reader.
	body := io.MultiReader(bytes.NewReader(peek), part)

	// Build the decompressed-dem stream. For .zst, wrap with zstd decoder;
	// for raw .dem, pass body straight through. Either way the parser CLI
	// consumes it from stdin — we never materialize the .dem on disk.
	var demStream io.Reader = body
	var closeDec func()
	if isZst {
		log.Printf("upload: id=%s decompressing zstd on the fly", id)
		dec, derr := zstd.NewReader(body, zstd.WithDecoderConcurrency(1))
		if derr != nil {
			log.Printf("upload: id=%s zstd init failed: %v", id, derr)
			writeJSONError(w, http.StatusBadRequest, "zstd init failed: "+derr.Error())
			return
		}
		demStream = dec
		closeDec = dec.Close
	}
	if closeDec != nil {
		defer closeDec()
	}

	outPath := filepath.Join(parsedDir, id+".json.gz")
	cmd := exec.Command("/app/parser", "-in", "-", "-out", outPath)
	cmd.Stdin = demStream
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf
	// Run and collect errors. We intentionally don't set Stdout — parser
	// writes only to `-out`. Stderr is where it would panic.
	if err := cmd.Run(); err != nil {
		// If parser failed, the half-written .json.gz is useless — drop it.
		_ = os.Remove(outPath)
		log.Printf("upload: id=%s parser failed: %v (disk stats: %s)\nstderr:\n%s",
			id, err, diskStats(parsedDir), stderrBuf.String())
		writeJSONError(w, http.StatusInternalServerError,
			"parser failed: "+strings.TrimSpace(stderrBuf.String()))
		return
	}

	// Log success with disk stats so we can see how much the parsed output cost.
	if info, statErr := os.Stat(outPath); statErr == nil {
		log.Printf("upload: id=%s parsed ok (%d bytes output, disk stats: %s)",
			id, info.Size(), diskStats(parsedDir))
	} else {
		log.Printf("upload: id=%s parsed ok (stat failed: %v)", id, statErr)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func readAtMost(r io.Reader, n int) ([]byte, error) {
	buf := make([]byte, n)
	m, err := io.ReadFull(r, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	return buf[:m], nil
}

// diskStats returns a short human string describing free/total bytes on the
// filesystem containing path. Used for diagnostic logging when an upload fails.
func diskStats(path string) string {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return "statfs_err=" + err.Error()
	}
	free := uint64(st.Bavail) * uint64(st.Bsize)
	total := uint64(st.Blocks) * uint64(st.Bsize)
	return fmt.Sprintf("free=%dMB total=%dMB", free/1024/1024, total/1024/1024)
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
