package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/google/uuid"
)

const (
	dataDir   = "/data"
	demoDir   = "/data/demos"
	parsedDir = "/data/parsed"
)

func main() {
	os.MkdirAll(demoDir, 0755)
	os.MkdirAll(parsedDir, 0755)

	http.HandleFunc("/api/upload", corsMiddleware(uploadHandler))
	http.HandleFunc("/api/match/", corsMiddleware(matchHandler))
	http.HandleFunc("/api/matches", corsMiddleware(matchesHandler))
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 2GB max
	if err := r.ParseMultipartForm(2 << 30); err != nil {
		http.Error(w, `{"error":"parse form failed: `+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"no file"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	id := uuid.New().String()
	demoPath := filepath.Join(demoDir, id+".dem")

	out, err := os.Create(demoPath)
	if err != nil {
		http.Error(w, `{"error":"could not create file"}`, http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		http.Error(w, `{"error":"could not save file"}`, http.StatusInternalServerError)
		return
	}

	log.Printf("Received %s (%d bytes) as %s", header.Filename, header.Size, id)

	// Run parser
	outPath := filepath.Join(parsedDir, id+".json.gz")
	cmd := exec.Command("/app/parser", "-in", demoPath, "-out", outPath)
	stderr, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Parser failed: %v\nOutput: %s", err, stderr)
		http.Error(w, `{"error":"parser failed","stderr":"`+string(stderr)+`"}`, http.StatusInternalServerError)
		return
	}

	// Clean up the .dem file (keep only parsed)
	os.Remove(demoPath)

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"id":"%s"}`, id)
}

func matchHandler(w http.ResponseWriter, r *http.Request) {
	id := filepath.Base(r.URL.Path)
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	parsedPath := filepath.Join(parsedDir, id+".json.gz")
	f, err := os.Open(parsedPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	io.Copy(w, f)
}

func matchesHandler(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(parsedDir)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("["))
	first := true
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		// strip .json.gz
		if len(name) < 9 || name[len(name)-8:] != ".json.gz" {
			continue
		}
		id := name[:len(name)-8]
		info, _ := e.Info()
		if !first {
			w.Write([]byte(","))
		}
		first = false
		fmt.Fprintf(w, `{"id":"%s","createdAt":%d,"size":%d}`, id, info.ModTime().UnixMilli(), info.Size())
	}
	w.Write([]byte("]"))
}

// satisfy `uuid` if not used
var _ = uuid.New
