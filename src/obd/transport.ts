// A byte pipe to an ELM327-compatible adapter. Text in, text out.
export interface Transport {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(text: string): Promise<void>;
  onData(cb: (chunk: string) => void): void;
  onDisconnect(cb: () => void): void;
}

// GATT layouts used by common BLE OBD adapters. We try each in turn.
const KNOWN_SERVICES: string[] = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // many ELM327 BLE clones (notify FFF1, write FFF2)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style (FFE1 notify+write)
  '000018f0-0000-1000-8000-00805f9b34fb', // OBDLink CX / Vgate (2AF0 notify, 2AF1 write)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Vgate iCar Pro BLE
];

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export class BleTransport implements Transport {
  name = 'Bluetooth adapter';
  private device?: BluetoothDevice;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private dataCbs: ((c: string) => void)[] = [];
  private discCbs: (() => void)[] = [];
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  async connect(): Promise<void> {
    if (!bluetoothAvailable()) throw new Error('This browser cannot use Bluetooth. Open the app in Chrome on Android.');
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: KNOWN_SERVICES });
    this.name = this.device.name || 'Bluetooth adapter';
    this.device.addEventListener('gattserverdisconnected', () => this.discCbs.forEach((cb) => cb()));
    const server = await this.device.gatt!.connect();
    for (const uuid of KNOWN_SERVICES) {
      let service: BluetoothRemoteGATTService;
      try { service = await server.getPrimaryService(uuid); } catch { continue; }
      const chars = await service.getCharacteristics();
      const rx = chars.find((c) => c.properties.notify || c.properties.indicate);
      const tx = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (rx && tx) { this.rx = rx; this.tx = tx; break; }
    }
    if (!this.rx || !this.tx) {
      server.disconnect();
      throw new Error('That device is not a supported OBD adapter. Use a BLE ELM327-compatible adapter.');
    }
    this.rx.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      const chunk = this.decoder.decode(v);
      this.dataCbs.forEach((cb) => cb(chunk));
    });
    await this.rx.startNotifications();
  }

  async disconnect(): Promise<void> {
    this.device?.gatt?.disconnect();
  }

  async write(text: string): Promise<void> {
    const bytes = this.encoder.encode(text);
    for (let i = 0; i < bytes.length; i += 20) {
      const part = bytes.slice(i, i + 20);
      if (this.tx!.properties.writeWithoutResponse) await this.tx!.writeValueWithoutResponse(part);
      else await this.tx!.writeValueWithResponse(part);
    }
  }

  onData(cb: (c: string) => void) { this.dataCbs.push(cb); }
  onDisconnect(cb: () => void) { this.discCbs.push(cb); }
}
