package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func open(t *testing.T, car string) *Session {
	t.Helper()
	pt, err := newSimPassThru(car)
	if err != nil {
		t.Fatal(err)
	}
	s, err := OpenSession(pt, "Demo")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestDetects11BitCAN(t *testing.T) {
	s := open(t, "benz")
	if s.Setup.Family != "can11" || s.Setup.Baud != 500000 {
		t.Fatalf("setup %+v", s.Setup)
	}
	if strings.Join(s.Ecus, ",") != "7E8,7E9" {
		t.Fatalf("ecus %v", s.Ecus)
	}
}

func TestDetects29BitCAN(t *testing.T) {
	s := open(t, "lexus29")
	if s.Setup.Family != "can29" {
		t.Fatalf("setup %+v", s.Setup)
	}
	if strings.Join(s.Ecus, ",") != "10,18" {
		t.Fatalf("ecus %v", s.Ecus)
	}
}

func TestLoopbackAndFirstFrameIgnored_VINRead(t *testing.T) {
	s := open(t, "benz")
	r, err := s.Request([]byte{0x09, 0x02}, time.Second)
	if err != nil || len(r) != 1 || r[0].Ecu != "7E8" {
		t.Fatalf("replies %+v err %v", r, err)
	}
	if got := string(r[0].Data[3:]); got != "WDDNG8GB0AA000215" {
		t.Fatalf("vin %q", got)
	}
}

func TestCodesAndClear(t *testing.T) {
	s := open(t, "benz")
	r, _ := s.Request([]byte{0x03}, time.Second)
	if len(r) != 2 || r[0].Data[1] != 2 {
		t.Fatalf("03 replies %+v", r)
	}
	s.Request([]byte{0x04}, time.Second)
	r, _ = s.Request([]byte{0x03}, time.Second)
	if r[0].Data[1] != 0 {
		t.Fatalf("codes not cleared %+v", r)
	}
	r, _ = s.Request([]byte{0x0A}, time.Second)
	if r[0].Data[1] != 1 {
		t.Fatalf("permanent code should stay %+v", r)
	}
}

func TestVoltage(t *testing.T) {
	v, err := open(t, "benz").Volts()
	if err != nil || v != 12.4 {
		t.Fatalf("volts %v %v", v, err)
	}
}

func do(t *testing.T, h http.Handler, method, path, body string, hdr map[string]string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:8534"
	if method == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		if k == "Host" {
			req.Host = v
		} else {
			req.Header.Set(k, v)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestServerFlow(t *testing.T) {
	h := NewServer(8534, "benz").Handler()
	code, out := do(t, h, "GET", "/api/devices", "", nil)
	devs := out["devices"].([]any)
	if code != 200 || len(devs) != 1 {
		t.Fatalf("devices %d %v", code, out)
	}
	name := devs[0].(map[string]any)["name"].(string)
	code, out = do(t, h, "POST", "/api/connect", `{"device":"`+name+`"}`, nil)
	if code != 200 || out["family"] != "can11" {
		t.Fatalf("connect %d %v", code, out)
	}
	code, out = do(t, h, "POST", "/api/request", `{"hex":"0101","timeoutMs":1000}`, nil)
	reps := out["replies"].([]any)
	if code != 200 || len(reps) != 2 || reps[0].(map[string]any)["data"] != "410182"+"07E504" {
		t.Fatalf("request %d %v", code, out)
	}
	code, out = do(t, h, "GET", "/api/voltage", "", nil)
	if out["volts"].(float64) != 12.4 {
		t.Fatalf("voltage %v", out)
	}
}

func TestServerRefusesWritesAndStrangers(t *testing.T) {
	h := NewServer(8534, "benz").Handler()
	do(t, h, "POST", "/api/connect", `{"device":"Demo pass-thru (simulated benz)"}`, nil)
	cases := []struct {
		name, method, path, body string
		hdr                      map[string]string
		want                     int
	}{
		{"UDS write data by identifier", "POST", "/api/request", `{"hex":"2EF190"}`, nil, 403},
		{"UDS programming session", "POST", "/api/request", `{"hex":"1002"}`, nil, 403},
		{"not hex", "POST", "/api/request", `{"hex":"zz"}`, nil, 400},
		{"too long", "POST", "/api/request", `{"hex":"0102030405060708"}`, nil, 400},
		{"DNS rebinding host", "GET", "/api/devices", "", map[string]string{"Host": "evil.example:8534"}, 403},
		{"other website", "POST", "/api/request", `{"hex":"03"}`, map[string]string{"Origin": "https://evil.example"}, 403},
		{"form post", "POST", "/api/request", `hex=03`, map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, 415},
		{"unknown device", "POST", "/api/connect", `{"device":"nope"}`, nil, 404},
	}
	for _, c := range cases {
		code, out := do(t, h, c.method, c.path, c.body, c.hdr)
		if code != c.want {
			t.Errorf("%s: got %d %v, want %d", c.name, code, out, c.want)
		}
	}
}

func TestNoCarAnswer(t *testing.T) {
	pt, _ := newSimPassThru("benz")
	pt.car.ecus = nil
	if _, err := OpenSession(pt, "Demo"); err == nil || !strings.Contains(err.Error(), "ignition") {
		t.Fatalf("want ignition hint, got %v", err)
	}
}
