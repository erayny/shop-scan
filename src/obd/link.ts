import type { Message, ProtocolFamily } from './decode';

/**
 * Anything that can send an OBD-II request to the car and return one message
 * per ECU reply. Implemented by the ELM327 adapter link (Bluetooth) and the
 * J2534 pass-thru link (Windows PC via Liftside Bridge). The scan engine only
 * talks to this interface.
 */
export interface ObdLink {
  readonly adapterName: string;
  readonly protocolName: string;
  readonly family: ProtocolFamily;
  readonly ecus: string[];
  /** Hex service + PID, e.g. "0902". Empty array on no answer. */
  request(cmd: string, timeoutMs?: number): Promise<Message[]>;
  voltage(): Promise<number | null>;
  close(): Promise<void>;
}
