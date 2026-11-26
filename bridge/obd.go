package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Setup is one way a car's diagnostic CAN bus can be wired (ISO 15765-4).
type Setup struct {
	Name   string
	Family string // can11 | can29, matches the web app's ProtocolFamily
	Flags  uint32
	Baud   uint32
}

var setups = []Setup{
	{"ISO 15765-4 CAN (11 bit, 500 kbaud)", "can11", 0, 500000},
	{"ISO 15765-4 CAN (29 bit, 500 kbaud)", "can29", flagCAN29BitID, 500000},
	{"ISO 15765-4 CAN (11 bit, 250 kbaud)", "can11", 0, 250000},
	{"ISO 15765-4 CAN (29 bit, 250 kbaud)", "can29", flagCAN29BitID, 250000},
}

// Reply is one ECU's answer, without the CAN ID.
type Reply struct {
	Ecu  string
	Data []byte
}

// Session is an open device and channel to a car.
type Session struct {
	mu     sync.Mutex
	pt     PassThru
	ch     uint32
	Setup  Setup
	Ecus   []string
	Device string
}

var errNoCar = errors.New("the car did not answer on CAN. Turn the ignition on and check the cable. Cars older than about 2008 use K-line or J1850, which Liftside does not read through pass-thru yet")

func canID(id uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, id)
	return b
}

func (s *Session) setFilters() error {
	if s.Setup.Family == "can11" {
		for id := uint32(0x7E8); id <= 0x7EF; id++ {
			if err := s.pt.StartFlowControlFilter(s.ch, canID(0x7FF), canID(id), canID(id-8), txISO15765Pad); err != nil {
				return err
			}
		}
		return nil
	}
	// 29 bit: responses 18DAF1xx, requests 18DAxxF1. Engine 10, transmission 18 and the usual range.
	for _, ecu := range []uint32{0x10, 0x11, 0x17, 0x18, 0x19, 0x1A, 0x1E, 0x28} {
		if err := s.pt.StartFlowControlFilter(s.ch, canID(0x1FFFFFFF), canID(0x18DAF100|ecu), canID(0x18DA00F1|ecu<<8), txISO15765Pad|flagCAN29BitID); err != nil {
			return err
		}
	}
	return nil
}

// OpenSession opens the device and tries each CAN setup until the car answers 0100.
func OpenSession(pt PassThru, device string) (*Session, error) {
	if err := pt.Open(); err != nil {
		return nil, fmt.Errorf("could not open %s: %w", device, err)
	}
	var lastErr error
	for _, st := range setups {
		ch, err := pt.Connect(protoISO15765, st.Flags, st.Baud)
		if err != nil {
			lastErr = err
			continue
		}
		s := &Session{pt: pt, ch: ch, Setup: st, Device: device}
		if err := s.setFilters(); err != nil {
			lastErr = err
			pt.Disconnect(ch)
			continue
		}
		replies, err := s.Request([]byte{0x01, 0x00}, 600*time.Millisecond)
		if err == nil && len(replies) > 0 {
			seen := map[string]bool{}
			for _, r := range replies {
				if !seen[r.Ecu] {
					seen[r.Ecu] = true
					s.Ecus = append(s.Ecus, r.Ecu)
				}
			}
			return s, nil
		}
		pt.Disconnect(ch)
	}
	pt.Close()
	if lastErr != nil {
		return nil, fmt.Errorf("%w (last device error: %v)", errNoCar, lastErr)
	}
	return nil, errNoCar
}

// Request sends one functional OBD-II request and collects every ECU's reply.
// The J2534 device does ISO-TP segmentation and flow control itself.
func (s *Session) Request(payload []byte, timeout time.Duration) ([]Reply, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	target := uint32(0x7DF)
	flags := uint32(txISO15765Pad)
	if s.Setup.Family == "can29" {
		target = 0x18DB33F1
		flags |= flagCAN29BitID
	}
	_ = s.pt.ClearRx(s.ch)
	msg := Msg{Protocol: protoISO15765, TxFlags: flags, Data: append(canID(target), payload...)}
	if err := s.pt.Write(s.ch, msg, 200); err != nil {
		return nil, err
	}
	var out []Reply
	deadline := time.Now().Add(timeout)
	var quietUntil time.Time
	for {
		now := time.Now()
		if now.After(deadline) || (!quietUntil.IsZero() && now.After(quietUntil)) {
			return out, nil
		}
		msgs, err := s.pt.Read(s.ch, 16, 50)
		if err != nil {
			return out, err
		}
		for _, m := range msgs {
			if m.RxStatus&(rxTxMsgType|rxStartOfMessage|rxTxIndication) != 0 || len(m.Data) <= 4 {
				continue
			}
			data := m.Data[4:]
			// 7F xx 78: "response pending" — the ECU needs more time.
			if len(data) >= 3 && data[0] == 0x7F && data[2] == 0x78 {
				deadline = time.Now().Add(5 * time.Second)
				continue
			}
			id := binary.BigEndian.Uint32(m.Data[:4])
			ecu := fmt.Sprintf("%03X", id)
			if s.Setup.Family == "can29" {
				ecu = fmt.Sprintf("%02X", id&0xFF)
			}
			out = append(out, Reply{Ecu: ecu, Data: append([]byte(nil), data...)})
			// Other ECUs answer within ~50 ms (P2); wait a little for them, then return.
			quietUntil = time.Now().Add(150 * time.Millisecond)
		}
	}
}

// Volts is the battery voltage measured by the device on pin 16.
func (s *Session) Volts() (float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	mv, err := s.pt.ReadVBatt()
	if err != nil {
		return 0, err
	}
	return float64(mv) / 1000, nil
}

func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pt.Disconnect(s.ch)
	s.pt.Close()
}
