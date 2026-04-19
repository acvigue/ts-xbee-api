# Migration guide: 2.x → 4.x

`ts-xbee-api` 4.0 is a breaking rewrite. The high-level API, naming conventions,
module format, and cancellation model have all changed. This document shows
what's different and walks through the common cookbook recipes on the new API.

## At a glance

| Area                  | 2.x                                  | 4.x                                                         |
| --------------------- | ------------------------------------ | ----------------------------------------------------------- |
| Module format         | CommonJS                             | ESM only                                                    |
| Cancellation          | `real-cancellable-promise`           | `AbortSignal` / `AbortSignal.timeout`                       |
| Enum names            | `FRAME_TYPE.AT_COMMAND`              | `FrameType.AtCommand`                                       |
| AT command enum       | `C.AT_COMMAND.NJ`                    | `AtCommand.NJ`                                              |
| Options keys          | `api_mode`, `raw_frames`, `vref_adc` | `apiMode`, `rawFrames`, `adcReferenceMv`                    |
| Frame type aliases    | `ParsableFrame` / `BuildableFrame`   | `IncomingFrame` / `OutgoingFrame`                           |
| `getParameter` return | hex string                           | `Uint8Array`                                                |
| Addresses             | `string` only                        | `Address64` class + hex-string accepted                     |
| Frame stream          | `stream.Readable` (Node-only)        | `AsyncIterable<IncomingFrame>`                              |
| Disposal              | `xbee.close()`                       | `close()` **or** `await using` / `Symbol.asyncDispose`      |
| Transmit options      | opaque `options: Uint8`              | typed bit flags under `digimesh.*` / shared `ReceiveOption` |

### Renamed enum members

`FRAME_TYPE.AT_COMMAND` → `FrameType.AtCommand`, `FRAME_TYPE.ZIGBEE_RECEIVE_PACKET`
→ `FrameType.ZigbeeReceivePacket`, etc. All members converted to PascalCase;
2-letter `AtCommand.NI` / `AtCommand.SH` preserve their identifiers since they
match the on-wire AT command bytes.

### Removed / moved

- `C.*` wildcard namespace removed. Import constants by name from the package root.
- `FRAME_TYPES` / `FRAME_NAMES` arrays and the `_NAMES` lookup tables removed — iterate over `FrameType` values directly.
- `PIN_MODE`, `PIN_COMMAND`, `PULLUP_RESISTOR`, `CHANGE_DETECTION` tables removed.
- `XBee.frameStream(type)` / `allFramesStream()` replaced by `xbee.frames(type)` / `xbee.allFrames()` returning `AsyncIterable`.
- `messageReceived` renamed to `emulateReceivedPacket` (same behaviour).
- `modemStatus()` split into `latestModemStatus()` (cached accessor) and `waitForModemStatus(opts?)` (async).

### Added in 4.0

- `Address64` / `Address16` classes for typed addresses.
- `XBeeTimeoutError`, `UnknownFrameTypeError` (renamed from `UnknownFrameType`).
- `protocols/digimesh.ts` module exposing `TxOption`, `TxMode`, `RxOption`, `RxMode`, `RX_MODE_MASK`, `RouteInformationSourceEvent`.
- Frame type parsers for `FrameType.RouteInformation` (`0x8D`) and `FrameType.AggregateAddressingUpdate` (`0x8E`).
- `XBee.transmit` third-arg `TransmitOptions` for options byte, broadcast radius, and 16-bit destination override.

---

## Cookbook

The snippets below assume a `SerialPort`-backed `XBee`:

```typescript
import { SerialPort } from 'serialport';
import { XBee, AtCommand, FrameType, digimesh } from '@acvigue/ts-xbee-api';

const serial = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 9600 });
await using xbee = new XBee(serial, { defaultTimeoutMs: 2_000 });
```

`await using` calls `close()` automatically when the block exits. If you need
manual control, drop the `using` keyword and call `xbee.close()` when done.

### 1. Run AT commands on the local XBee

All AT interactions return / accept raw bytes. Encoding numbers into those
bytes is the caller's job.

```typescript
// Read a parameter — returns Uint8Array
const apBytes = await xbee.getParameter(AtCommand.AP);
console.log('API mode:', apBytes[0]); // e.g. 1

// Read the node identifier (NI) as text
const niBytes = await xbee.getParameter(AtCommand.NI);
console.log('NI:', new TextDecoder().decode(niBytes));

// Convenience: 64-bit serial (SH + SL) as an Address64
const addr = await xbee.address();
console.log('my address:', addr.toString()); // '0013a200...'

// Write a parameter
await xbee.setParameter(AtCommand.NI, new TextEncoder().encode('rover-01'));

// Queue multiple parameter changes, then apply (matches ATWR / ATAC semantics)
await xbee.enqueueSetParameter(AtCommand.CE, Uint8Array.from([0x01]));
await xbee.enqueueSetParameter(AtCommand.NJ, Uint8Array.from([0xff]));
await xbee.setParameter(AtCommand.AC); // applies everything queued
await xbee.setParameter(AtCommand.WR); // persist to non-volatile memory
```

All of these accept `{ signal?, timeoutMs? }` as the final argument. Pass an
`AbortSignal` to cancel mid-flight, or `timeoutMs` to override the constructor
default for a single call.

```typescript
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(new Error('user cancelled')), 500);
const ap = await xbee.getParameter(AtCommand.AP, { signal: ctrl.signal });
```

### 2. Send a Discovery / Broadcast DigiMesh packet

DigiMesh uses the reserved 64-bit broadcast address `0x000000000000FFFF`. Every
node on the network receives the frame. For a point-multipoint broadcast (which
is what Discovery uses under the hood), set `TxMode.PointMultipoint`.

```typescript
import { Address64 } from '@acvigue/ts-xbee-api';

const BROADCAST = Address64.fromHex('000000000000FFFF');

xbee.transmit(new TextEncoder().encode('hello mesh'), BROADCAST, {
  options: digimesh.TxMode.PointMultipoint,
  broadcastRadius: 0, // 0 = use the firmware's NH (max unicast hops)
});
```

If what you actually want is the **Node Discovery** AT flow (ATND), use the
built-in generator — it wraps the AT command, times out after the configured
window, and yields each responder as it arrives:

```typescript
for await (const resp of xbee.scanNetwork({ timeoutMs: 10_000 })) {
  if (resp.command === AtCommand.ND && 'nodeIdentification' in resp) {
    console.log(
      'found',
      resp.nodeIdentification.remote64,
      resp.nodeIdentification.nodeIdentifier,
    );
  }
}
```

### 3. Send a DigiMesh packet with `TXOptions = 0x40`

`0x40` decodes as **`TxMode.PointMultipoint`** with no option flags set:

| Bits | Value  | Meaning                                                                                       |
| ---- | ------ | --------------------------------------------------------------------------------------------- |
| 7–6  | `0b01` | `TxMode.PointMultipoint` — skip route discovery/acks; treat as a flat broadcast-style unicast |
| 5    | `0`    | reserved in DigiMesh (Zigbee-only APS encrypt bit)                                            |
| 4    | `0`    | `TxOption.SendEncrypted` off                                                                  |
| 3    | `0`    | `TxOption.EnableUnicastTraceRoute` off                                                        |
| 2    | `0`    | `TxOption.EnableUnicastNack` off                                                              |
| 1    | `0`    | `TxOption.DisableRouteDiscovery` off                                                          |
| 0    | `0`    | `TxOption.DisableAck` off                                                                     |

Two equivalent ways to produce it:

```typescript
// Idiomatic: let the typed constants name what you're doing.
xbee.transmit(payload, destination, {
  options: digimesh.TxMode.PointMultipoint,
});

// Literal: if you already have the byte from a config system.
xbee.transmit(payload, destination, { options: 0x40 });
```

Combine flags with `|` as you would in C. For example, a DigiMesh-mode
transmission with ACKs disabled and trace-route telemetry enabled:

```typescript
xbee.transmit(payload, destination, {
  options:
    digimesh.TxMode.DigiMesh |
    digimesh.TxOption.DisableAck |
    digimesh.TxOption.EnableUnicastTraceRoute,
});
```

### 4. Receive TX Status

Every transmit request (that isn't sent with `DisableAck`) produces a
`ZigbeeTransmitStatus` frame carrying the same `id` the request was given. The
library tracks ids automatically, but if you want to correlate manually:

```typescript
import { DeliveryStatus } from '@acvigue/ts-xbee-api';

// Subscribe before transmitting so you don't miss the reply.
(async () => {
  for await (const status of xbee.frames(FrameType.ZigbeeTransmitStatus)) {
    console.log(
      `frame id=${status.id} delivery=${DeliveryStatus[status.deliveryStatus]}`,
      `retries=${status.transmitRetryCount} discovery=${status.discoveryStatus}`,
    );
    if (status.deliveryStatus !== DeliveryStatus.Success) {
      // handle failure (route not found, MAC ack failure, etc.)
    }
  }
})();

xbee.transmit(payload, destination, { options: digimesh.TxMode.DigiMesh });
```

`xbee.frames()` returns an `AsyncIterable`. `break` out of the `for await` to
unsubscribe; there's no separate "remove listener" call.

### 5. Receive DigiMesh packets

Inbound data arrives as `ZigbeeReceivePacket` (`0x90`) frames. Decode the
`receiveOptions` byte with the DigiMesh constants:

```typescript
for await (const rx of xbee.frames(FrameType.ZigbeeReceivePacket)) {
  const opts = rx.receiveOptions;
  const mode = opts & digimesh.RX_MODE_MASK; // bits 7-6
  const acknowledged = !!(opts & digimesh.RxOption.Acknowledged);
  const broadcast = !!(opts & digimesh.RxOption.Broadcast);
  const encrypted = !!(opts & digimesh.RxOption.SentEncrypted);

  console.log({
    from: rx.remote64,
    mode: digimesh.RxMode[mode], // 'DigiMesh' | 'PointMultipoint' | ...
    acknowledged,
    broadcast,
    encrypted,
    payload: new TextDecoder().decode(rx.data),
  });
}
```

If trace-route or NACK transmit options are enabled on your senders, you can
also subscribe to `FrameType.RouteInformation` (0x8D) to observe route
diagnostics:

```typescript
for await (const info of xbee.frames(FrameType.RouteInformation)) {
  if (info.sourceEvent === digimesh.RouteInformationSourceEvent.TraceRoute) {
    console.log(`hop via ${info.responder64} → ${info.receiver64}`);
  }
}
```

---

## Putting it together

A minimal DigiMesh ping-pong:

```typescript
import { SerialPort } from 'serialport';
import {
  Address64,
  AtCommand,
  DeliveryStatus,
  FrameType,
  XBee,
  digimesh,
} from '@acvigue/ts-xbee-api';

const BROADCAST = Address64.fromHex('000000000000FFFF');
const serial = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 9600 });

await using xbee = new XBee(serial, { defaultTimeoutMs: 2_000 });

// Log every transmit status in the background.
(async () => {
  for await (const status of xbee.frames(FrameType.ZigbeeTransmitStatus)) {
    console.log('tx', status.id, DeliveryStatus[status.deliveryStatus]);
  }
})();

// Log every received packet in the background.
(async () => {
  for await (const rx of xbee.frames(FrameType.ZigbeeReceivePacket)) {
    const mode = rx.receiveOptions & digimesh.RX_MODE_MASK;
    console.log('rx', rx.remote64, digimesh.RxMode[mode], rx.data);
  }
})();

// Identify ourselves, then broadcast a hello.
const me = await xbee.address();
console.log('this node:', me.toString());

xbee.transmit(new TextEncoder().encode('hello mesh'), BROADCAST, {
  options: digimesh.TxMode.PointMultipoint,
});

// Keep running; `await using` closes the stream when the block exits.
await new Promise((r) => setTimeout(r, 10_000));
```
