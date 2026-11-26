package main

import (
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var webFiles embed.FS

// Only standard OBD-II diagnostic services are allowed through the bridge:
// read live data, freeze frame, stored/pending/permanent codes, vehicle info,
// and clear codes. Nothing that writes to or reprograms a module.
var allowedService = map[byte]bool{0x01: true, 0x02: true, 0x03: true, 0x04: true, 0x07: true, 0x09: true, 0x0A: true}

var hexRe = regexp.MustCompile(`^([0-9A-Fa-f]{2}){1,7}$`)

type Server struct {
	mu      sync.Mutex
	port    int
	sess    *Session
	sim     string
	devices func() ([]Device, error)
	opener  func(Device) (PassThru, error)
}

func NewServer(port int, sim string) *Server {
	s := &Server{port: port, sim: sim, devices: listDevices, opener: loadPassThru}
	if sim != "" {
		s.devices = func() ([]Device, error) {
			return []Device{{Name: "Demo pass-thru (simulated " + sim + ")", Vendor: "Liftside", Library: "sim", Protocols: "ISO15765"}}, nil
		}
		s.opener = func(Device) (PassThru, error) { return newSimPassThru(sim) }
	}
	return s
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// guard blocks other websites: the Host must be this machine (stops DNS
// rebinding) and API calls must come from this page or no page at all.
func (s *Server) guard(next http.Handler) http.Handler {
	ok := map[string]bool{fmt.Sprintf("127.0.0.1:%d", s.port): true, fmt.Sprintf("localhost:%d", s.port): true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ok[r.Host] {
			fail(w, http.StatusForbidden, "forbidden host")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if o := r.Header.Get("Origin"); o != "" && o != "http://"+r.Host {
				fail(w, http.StatusForbidden, "forbidden origin")
				return
			}
			if r.Method == http.MethodPost && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				fail(w, http.StatusUnsupportedMediaType, "JSON only")
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(webFiles, "web")
	mux.Handle("/", http.FileServer(http.FS(sub)))

	mux.HandleFunc("GET /api/devices", func(w http.ResponseWriter, r *http.Request) {
		d, err := s.devices()
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"devices": d})
	})

	mux.HandleFunc("POST /api/connect", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Device string }
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil {
			fail(w, 400, "bad request")
			return
		}
		devs, _ := s.devices()
		var dev *Device
		for i := range devs {
			if devs[i].Name == body.Device {
				dev = &devs[i]
			}
		}
		if dev == nil {
			fail(w, 404, "That pass-thru device is not installed on this PC.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sess != nil {
			s.sess.Close()
			s.sess = nil
		}
		pt, err := s.opener(*dev)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		sess, err := OpenSession(pt, dev.Name)
		if err != nil {
			fail(w, 502, upperFirst(err.Error()))
			return
		}
		s.sess = sess
		writeJSON(w, 200, map[string]any{"device": dev.Name, "protocol": sess.Setup.Name, "family": sess.Setup.Family, "ecus": sess.Ecus})
	})

	mux.HandleFunc("POST /api/request", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Hex       string
			TimeoutMs int
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil || !hexRe.MatchString(body.Hex) {
			fail(w, 400, "bad request")
			return
		}
		payload, _ := hex.DecodeString(body.Hex)
		if !allowedService[payload[0]] {
			fail(w, 403, fmt.Sprintf("service %02X is not allowed: the bridge only reads OBD-II data and clears codes", payload[0]))
			return
		}
		t := time.Duration(min(max(body.TimeoutMs, 100), 10000)) * time.Millisecond
		s.mu.Lock()
		sess := s.sess
		s.mu.Unlock()
		if sess == nil {
			fail(w, 409, "Not connected to a car.")
			return
		}
		replies, err := sess.Request(payload, t)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		out := make([]map[string]string, 0, len(replies))
		for _, rp := range replies {
			out = append(out, map[string]string{"ecu": rp.Ecu, "data": strings.ToUpper(hex.EncodeToString(rp.Data))})
		}
		writeJSON(w, 200, map[string]any{"replies": out})
	})

	mux.HandleFunc("GET /api/voltage", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		sess := s.sess
		s.mu.Unlock()
		if sess == nil {
			writeJSON(w, 200, map[string]any{"volts": nil})
			return
		}
		v, err := sess.Volts()
		if err != nil {
			writeJSON(w, 200, map[string]any{"volts": nil})
			return
		}
		writeJSON(w, 200, map[string]any{"volts": v})
	})

	mux.HandleFunc("POST /api/disconnect", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sess != nil {
			s.sess.Close()
			s.sess = nil
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	return s.guard(mux)
}

func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sess != nil {
		s.sess.Close()
	}
}

func upperFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
