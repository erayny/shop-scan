package main

import (
	"encoding/binary"
	"errors"
	"sync"
)

// simPassThru is a pretend J2534 device plugged into a pretend car. It behaves
// like real devices in the ways that matter: it echoes our own message back
// (loopback), sends a first-frame indication before multi-frame replies, and
// only hears the car on the right CAN setup.
type simPassThru struct {
	mu        sync.Mutex
	car       *simCar
	opened    bool
	connected bool
	flags     uint32
	baud      uint32
	queue     []Msg
}

type simEcu struct {
	id       uint32 // 11-bit response ID (7E8) or 29-bit source address (10)
	stored   []string
	pending  []string
	perm     []string
	isEngine bool
}

type simCar struct {
	name   string
	vin    string
	can29  bool
	milOn  bool
	ready  [3]byte
	ecus   []*simEcu
	millis uint32
}

func simCars() map[string]*simCar {
	return map[string]*simCar{
		"benz": {name: "2010 Mercedes-Benz S550", vin: "WDDNG8GB0AA000215", milOn: true, ready: [3]byte{0x07, 0xE5, 0x04}, millis: 12400,
			ecus: []*simEcu{
				{id: 0x7E8, stored: []string{"P0442", "P0446"}, pending: []string{"P0456"}, perm: []string{"P0442"}, isEngine: true},
				{id: 0x7E9},
			}},
		"lexus29": {name: "2015 Lexus (29-bit CAN)", vin: "JTHBK1GG0F2000123", can29: true, ready: [3]byte{0x07, 0xE5, 0x00}, millis: 13900,
			ecus: []*simEcu{{id: 0x10, isEngine: true}, {id: 0x18}}},
	}
}

func newSimPassThru(car string) (*simPassThru, error) {
	c, ok := simCars()[car]
	if !ok {
		return nil, errors.New("no such demo car: " + car)
	}
	return &simPassThru{car: c}, nil
}

func encDTC(code string) []byte {
	t := map[byte]byte{'P': 0, 'C': 1, 'B': 2, 'U': 3}[code[0]]
	hexv := func(c byte) byte {
		if c >= 'A' {
			return c - 'A' + 10
		}
		return c - '0'
	}
	a := t<<6 | hexv(code[1])<<4 | hexv(code[2])
	b := hexv(code[3])<<4 | hexv(code[4])
	return []byte{a, b}
}

func (s *simPassThru) Open() error  { s.opened = true; return nil }
func (s *simPassThru) Close() error { s.opened = false; s.connected = false; return nil }
func (s *simPassThru) Connect(protocol, flags, baud uint32) (uint32, error) {
	if !s.opened {
		return 0, errors.New("device not open")
	}
	if protocol != protoISO15765 {
		return 0, errors.New("unsupported protocol")
	}
	s.connected, s.flags, s.baud = true, flags, baud
	return 1, nil
}
func (s *simPassThru) Disconnect(ch uint32) error { s.connected = false; return nil }
func (s *simPassThru) StartFlowControlFilter(ch uint32, mask, pattern, flow []byte, txFlags uint32) error {
	if len(mask) != 4 || len(pattern) != 4 || len(flow) != 4 {
		return errors.New("bad filter")
	}
	return nil
}
func (s *simPassThru) ClearRx(ch uint32) error    { s.mu.Lock(); s.queue = nil; s.mu.Unlock(); return nil }
func (s *simPassThru) ReadVBatt() (uint32, error) { return s.car.millis, nil }

func (s *simPassThru) Read(ch uint32, max int, timeoutMs uint32) ([]Msg, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.queue)
	if n > max {
		n = max
	}
	out := s.queue[:n]
	s.queue = s.queue[n:]
	return out, nil
}

func (s *simPassThru) Write(ch uint32, m Msg, timeoutMs uint32) error {
	if !s.connected {
		return errors.New("not connected")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Loopback of our own frame, as many devices do.
	s.queue = append(s.queue, Msg{Protocol: m.Protocol, RxStatus: rxTxMsgType, Data: m.Data})
	onBus := s.baud == 500000 && (s.flags&flagCAN29BitID != 0) == s.car.can29
	if !onBus {
		return nil
	}
	req := m.Data[4:]
	for _, e := range s.car.ecus {
		data := s.answer(e, req)
		if data == nil {
			continue
		}
		var id uint32
		if s.car.can29 {
			id = 0x18DAF100 | e.id
		} else {
			id = e.id
		}
		hdr := make([]byte, 4)
		binary.BigEndian.PutUint32(hdr, id)
		if len(data) > 7 {
			s.queue = append(s.queue, Msg{Protocol: protoISO15765, RxStatus: rxStartOfMessage, Data: hdr})
		}
		s.queue = append(s.queue, Msg{Protocol: protoISO15765, Data: append(hdr, data...)})
	}
	return nil
}

func dtcReply(mode byte, codes []string) []byte {
	out := []byte{mode, byte(len(codes))}
	for _, c := range codes {
		out = append(out, encDTC(c)...)
	}
	return out
}

func (s *simPassThru) answer(e *simEcu, req []byte) []byte {
	c := s.car
	switch req[0] {
	case 0x01:
		switch req[1] {
		case 0x00:
			if e.isEngine {
				return []byte{0x41, 0x00, 0x18, 0x3B, 0x80, 0x00} // 04 05 0B 0C 0D 0F 10 11
			}
			return []byte{0x41, 0x00, 0x00, 0x18, 0x00, 0x00}
		case 0x01:
			a := byte(len(e.stored))
			if e.isEngine && c.milOn {
				a |= 0x80
			}
			if !e.isEngine {
				return []byte{0x41, 0x01, a, 0, 0, 0}
			}
			return []byte{0x41, 0x01, a, c.ready[0], c.ready[1], c.ready[2]}
		case 0x0C:
			if e.isEngine {
				return []byte{0x41, 0x0C, 0x0B, 0xB8}
			}
		case 0x05:
			if e.isEngine {
				return []byte{0x41, 0x05, 0x7B}
			}
		}
		return nil
	case 0x03:
		return dtcReply(0x43, e.stored)
	case 0x07:
		return dtcReply(0x47, e.pending)
	case 0x0A:
		return dtcReply(0x4A, e.perm)
	case 0x04:
		e.stored, e.pending = nil, nil
		if e.isEngine {
			c.milOn = false
			c.ready = [3]byte{0x17, c.ready[1], c.ready[1]}
		}
		return []byte{0x44}
	case 0x02:
		if e.isEngine && len(req) >= 2 && req[1] == 0x02 {
			if len(e.stored) == 0 {
				return []byte{0x42, 0x02, 0x00, 0x00, 0x00}
			}
			return append([]byte{0x42, 0x02, 0x00}, encDTC(e.stored[0])...)
		}
		return nil
	case 0x09:
		if e.isEngine && len(req) >= 2 && req[1] == 0x02 {
			return append([]byte{0x49, 0x02, 0x01}, []byte(c.vin)...)
		}
		return nil
	}
	return nil
}
