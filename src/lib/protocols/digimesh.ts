/**
 * DigiMesh protocol constants — bit flags for the transmit/receive options
 * bytes used by Transmit Request (0x10) and Receive Packet (0x90) frames.
 *
 * Mirrors the `XBEE_TX_OPT_*` / `XBEE_RX_OPT_*` #defines in Digi's ansic
 * library (`xbee_ansic_library/include/xbee/{wpan,device}.h`).
 *
 * @example
 *   import { XBee, digimesh } from '@acvigue/ts-xbee-api';
 *   xbee.transmit(data, addr, {
 *     options: digimesh.TxOption.DisableAck | digimesh.TxMode.DigiMesh,
 *   });
 */

/** DigiMesh transmit option bits (bits 0–4 of the transmit options byte). */
export enum TxOption {
  DisableAck = 1 << 0, //              0x01
  DisableRouteDiscovery = 1 << 1, //   0x02
  EnableUnicastNack = 1 << 2, //       0x04
  EnableUnicastTraceRoute = 1 << 3, // 0x08
  SendEncrypted = 1 << 4, //           0x10
}

/** DigiMesh transmission mode (bits 6–7 of the transmit options byte). */
export enum TxMode {
  Default = 0 << 6, //         0x00
  PointMultipoint = 1 << 6, // 0x40
  Repeater = 2 << 6, //        0x80
  DigiMesh = 3 << 6, //        0xc0
}

/** DigiMesh receive option bits. */
export enum RxOption {
  Acknowledged = 0x01,
  Broadcast = 0x02,
  SentEncrypted = 0x10,
}

/** DigiMesh receive transmission mode (bits 6–7 of the receive options byte). */
export enum RxMode {
  Unspecified = 0 << 6, //     0x00
  PointMultipoint = 1 << 6, // 0x40
  Repeater = 2 << 6, //        0x80
  DigiMesh = 3 << 6, //        0xc0
}

/** Mask for extracting the transmission mode from a receive options byte. */
export const RX_MODE_MASK = 0xc0;

/**
 * Values for the `sourceEvent` field of a Route Information frame (0x8D).
 * Tells you which transmit option caused the frame to be emitted.
 */
export enum RouteInformationSourceEvent {
  /** Emitted because `TxOption.EnableUnicastNack` was set. */
  UnicastNack = 0x11,
  /** Emitted because `TxOption.EnableUnicastTraceRoute` was set. */
  TraceRoute = 0x12,
}
