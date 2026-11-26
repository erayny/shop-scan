package main

// SAE J2534-1 (v04.04) values used by the bridge.
const (
	protoISO15765 = 6

	flagCAN29BitID = 0x00000100 // connect flag and TxFlag
	txISO15765Pad  = 0x00000040

	filterFlowControl = 3

	rxTxMsgType      = 0x01 // loopback of our own message
	rxStartOfMessage = 0x02 // first-frame indication, no payload yet
	rxTxIndication   = 0x08 // transmit done indication

	errTimeout     = 0x09
	errBufferEmpty = 0x10

	ioctlReadVBatt  = 0x03
	ioctlClearRxBuf = 0x08
)

// Msg is one J2534 message. For ISO15765 the first 4 bytes of Data are the CAN ID.
type Msg struct {
	Protocol uint32
	RxStatus uint32
	TxFlags  uint32
	Data     []byte
}

// Device is a J2534 pass-thru interface registered with Windows.
type Device struct {
	Name      string `json:"name"`
	Vendor    string `json:"vendor"`
	Library   string `json:"library"`
	Protocols string `json:"protocols"`
	Bits      int    `json:"bits"` // 32 or 64: which bridge build can load its driver
}

// PassThru is the part of the J2534 API the bridge uses. The Windows build
// implements it with the vendor's DLL; tests use simPassThru.
type PassThru interface {
	Open() error
	Close() error
	Connect(protocol, flags, baud uint32) (uint32, error)
	Disconnect(ch uint32) error
	StartFlowControlFilter(ch uint32, mask, pattern, flow []byte, txFlags uint32) error
	Write(ch uint32, m Msg, timeoutMs uint32) error
	// Read returns what arrived within timeoutMs; no messages is not an error.
	Read(ch uint32, max int, timeoutMs uint32) ([]Msg, error)
	ClearRx(ch uint32) error
	ReadVBatt() (millivolts uint32, err error)
}
