//go:build windows

package main

import (
	"fmt"
	"strings"
	"syscall"
	"unsafe"
)

// passthruMsg is PASSTHRU_MSG from J2534-1 v04.04 (unsigned long is 32 bit on Windows).
type passthruMsg struct {
	ProtocolID     uint32
	RxStatus       uint32
	TxFlags        uint32
	Timestamp      uint32
	DataSize       uint32
	ExtraDataIndex uint32
	Data           [4128]byte
}

type dllPassThru struct {
	dll                                                   *syscall.DLL
	open, close, connect, disconnect, readMsgs, writeMsgs *syscall.Proc
	startFilter, ioctl, lastError                         *syscall.Proc
	dev                                                   uint32
}

const processBits = int(unsafe.Sizeof(uintptr(0)) * 8)

func loadPassThru(d Device) (PassThru, error) {
	if d.Bits != 0 && d.Bits != processBits {
		other := "liftside-bridge-32.exe"
		if d.Bits == 64 {
			other = "liftside-bridge-64.exe"
		}
		return nil, fmt.Errorf("%s has a %d-bit driver; this is the %d-bit bridge. Run %s instead", d.Name, d.Bits, processBits, other)
	}
	dll, err := syscall.LoadDLL(d.Library)
	if err != nil {
		return nil, fmt.Errorf("could not load the driver %s: %w", d.Library, err)
	}
	p := &dllPassThru{dll: dll}
	for name, slot := range map[string]**syscall.Proc{
		"PassThruOpen": &p.open, "PassThruClose": &p.close, "PassThruConnect": &p.connect,
		"PassThruDisconnect": &p.disconnect, "PassThruReadMsgs": &p.readMsgs, "PassThruWriteMsgs": &p.writeMsgs,
		"PassThruStartMsgFilter": &p.startFilter, "PassThruIoctl": &p.ioctl, "PassThruGetLastError": &p.lastError,
	} {
		proc, err := dll.FindProc(name)
		if err != nil {
			dll.Release()
			return nil, fmt.Errorf("%s is not a J2534 v04.04 driver (missing %s)", d.Library, name)
		}
		*slot = proc
	}
	return p, nil
}

func (p *dllPassThru) check(r uintptr, what string) error {
	if r == 0 {
		return nil
	}
	var buf [80]byte
	p.lastError.Call(uintptr(unsafe.Pointer(&buf[0])))
	msg := strings.TrimRight(string(buf[:]), "\x00")
	if msg == "" {
		msg = "no description"
	}
	return fmt.Errorf("%s failed: %s (J2534 code %d)", what, msg, r)
}

func (p *dllPassThru) Open() error {
	r, _, _ := p.open.Call(0, uintptr(unsafe.Pointer(&p.dev)))
	return p.check(r, "PassThruOpen")
}

func (p *dllPassThru) Close() error {
	r, _, _ := p.close.Call(uintptr(p.dev))
	return p.check(r, "PassThruClose")
}

func (p *dllPassThru) Connect(protocol, flags, baud uint32) (uint32, error) {
	var ch uint32
	r, _, _ := p.connect.Call(uintptr(p.dev), uintptr(protocol), uintptr(flags), uintptr(baud), uintptr(unsafe.Pointer(&ch)))
	return ch, p.check(r, "PassThruConnect")
}

func (p *dllPassThru) Disconnect(ch uint32) error {
	r, _, _ := p.disconnect.Call(uintptr(ch))
	return p.check(r, "PassThruDisconnect")
}

func toNative(protocol, txFlags uint32, data []byte) *passthruMsg {
	m := &passthruMsg{ProtocolID: protocol, TxFlags: txFlags, DataSize: uint32(len(data))}
	copy(m.Data[:], data)
	return m
}

func (p *dllPassThru) StartFlowControlFilter(ch uint32, mask, pattern, flow []byte, txFlags uint32) error {
	mk, pa, fl := toNative(protoISO15765, txFlags, mask), toNative(protoISO15765, txFlags, pattern), toNative(protoISO15765, txFlags, flow)
	var id uint32
	r, _, _ := p.startFilter.Call(uintptr(ch), filterFlowControl,
		uintptr(unsafe.Pointer(mk)), uintptr(unsafe.Pointer(pa)), uintptr(unsafe.Pointer(fl)), uintptr(unsafe.Pointer(&id)))
	return p.check(r, "PassThruStartMsgFilter")
}

func (p *dllPassThru) Write(ch uint32, m Msg, timeoutMs uint32) error {
	n := uint32(1)
	native := toNative(m.Protocol, m.TxFlags, m.Data)
	r, _, _ := p.writeMsgs.Call(uintptr(ch), uintptr(unsafe.Pointer(native)), uintptr(unsafe.Pointer(&n)), uintptr(timeoutMs))
	return p.check(r, "PassThruWriteMsgs")
}

func (p *dllPassThru) Read(ch uint32, max int, timeoutMs uint32) ([]Msg, error) {
	buf := make([]passthruMsg, max)
	n := uint32(max)
	r, _, _ := p.readMsgs.Call(uintptr(ch), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)), uintptr(timeoutMs))
	if r != 0 && r != errTimeout && r != errBufferEmpty {
		return nil, p.check(r, "PassThruReadMsgs")
	}
	out := make([]Msg, 0, n)
	for i := 0; i < int(n) && i < max; i++ {
		m := buf[i]
		size := m.DataSize
		if size > uint32(len(m.Data)) {
			size = uint32(len(m.Data))
		}
		out = append(out, Msg{Protocol: m.ProtocolID, RxStatus: m.RxStatus, TxFlags: m.TxFlags, Data: append([]byte(nil), m.Data[:size]...)})
	}
	return out, nil
}

func (p *dllPassThru) ClearRx(ch uint32) error {
	r, _, _ := p.ioctl.Call(uintptr(ch), ioctlClearRxBuf, 0, 0)
	return p.check(r, "PassThruIoctl(CLEAR_RX_BUFFER)")
}

func (p *dllPassThru) ReadVBatt() (uint32, error) {
	var mv uint32
	r, _, _ := p.ioctl.Call(uintptr(p.dev), ioctlReadVBatt, 0, uintptr(unsafe.Pointer(&mv)))
	return mv, p.check(r, "PassThruIoctl(READ_VBATT)")
}

// ---- Device discovery: HKLM\SOFTWARE\PassThruSupport.04.04\<vendor device> ----

const (
	keyWow6464 = 0x0100
	keyWow6432 = 0x0200
)

func regString(k syscall.Handle, name string) string {
	var typ, size uint32
	n, _ := syscall.UTF16PtrFromString(name)
	if syscall.RegQueryValueEx(k, n, nil, &typ, nil, &size) != nil || size == 0 {
		return ""
	}
	buf := make([]uint16, size/2+1)
	if syscall.RegQueryValueEx(k, n, nil, &typ, (*byte)(unsafe.Pointer(&buf[0])), &size) != nil {
		return ""
	}
	if typ == syscall.REG_DWORD {
		return fmt.Sprint(*(*uint32)(unsafe.Pointer(&buf[0])))
	}
	return syscall.UTF16ToString(buf)
}

func devicesInView(view uint32, bits int) []Device {
	root, _ := syscall.UTF16PtrFromString(`SOFTWARE\PassThruSupport.04.04`)
	var h syscall.Handle
	if syscall.RegOpenKeyEx(syscall.HKEY_LOCAL_MACHINE, root, 0, syscall.KEY_READ|view, &h) != nil {
		return nil
	}
	defer syscall.RegCloseKey(h)
	var out []Device
	for i := uint32(0); ; i++ {
		name := make([]uint16, 256)
		n := uint32(len(name))
		if err := syscall.RegEnumKeyEx(h, i, &name[0], &n, nil, nil, nil, nil); err != nil {
			break
		}
		var k syscall.Handle
		if syscall.RegOpenKeyEx(h, &name[0], 0, syscall.KEY_READ|view, &k) != nil {
			continue
		}
		d := Device{Name: regString(k, "Name"), Vendor: regString(k, "Vendor"), Library: regString(k, "FunctionLibrary"), Bits: bits}
		var protos []string
		for _, p := range []string{"ISO15765", "CAN", "ISO9141", "ISO14230", "J1850VPW", "J1850PWM"} {
			if regString(k, p) == "1" {
				protos = append(protos, p)
			}
		}
		d.Protocols = strings.Join(protos, ", ")
		if d.Name == "" {
			d.Name = syscall.UTF16ToString(name[:n])
		}
		syscall.RegCloseKey(k)
		if d.Library != "" {
			out = append(out, d)
		}
	}
	return out
}

func listDevices() ([]Device, error) {
	// Both registry views, so either build can list every driver and say which build loads it.
	devs := append(devicesInView(keyWow6432, 32), devicesInView(keyWow6464, 64)...)
	seen := map[string]bool{}
	var out []Device
	for _, d := range devs {
		key := d.Name + "|" + d.Library
		if !seen[key] {
			seen[key] = true
			out = append(out, d)
		}
	}
	if out == nil {
		return []Device{}, nil
	}
	return out, nil
}
