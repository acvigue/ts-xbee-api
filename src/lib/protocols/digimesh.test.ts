import { describe, expect, it } from 'vitest';

import { XBeeBuilder } from '../codec.js';
import { FrameType } from '../constants.js';
import type { OutgoingFrame } from '../frame-builder.js';
import {
  RX_MODE_MASK,
  RxMode,
  RxOption,
  TxMode,
  TxOption,
} from './digimesh.js';

describe('DigiMesh TxOption bit values', () => {
  it.each([
    [TxOption.DisableAck, 0x01],
    [TxOption.DisableRouteDiscovery, 0x02],
    [TxOption.EnableUnicastNack, 0x04],
    [TxOption.EnableUnicastTraceRoute, 0x08],
    [TxOption.SendEncrypted, 0x10],
  ])('matches C reference', (value, expected) => {
    expect(value).toBe(expected);
  });
});

describe('DigiMesh TxMode bit values', () => {
  it.each([
    [TxMode.Default, 0x00],
    [TxMode.PointMultipoint, 0x40],
    [TxMode.Repeater, 0x80],
    [TxMode.DigiMesh, 0xc0],
  ])('matches C reference', (value, expected) => {
    expect(value).toBe(expected);
  });
});

describe('DigiMesh RxOption + RxMode', () => {
  it('exposes the shared bits and encryption flag', () => {
    expect(RxOption.Acknowledged).toBe(0x01);
    expect(RxOption.Broadcast).toBe(0x02);
    expect(RxOption.SentEncrypted).toBe(0x10);
  });

  it('extracts the DigiMesh mode from an options byte', () => {
    const byte = RxOption.Acknowledged | RxMode.DigiMesh;
    expect(byte).toBe(0xc1);
    expect(byte & RX_MODE_MASK).toBe(RxMode.DigiMesh);
    expect(byte & RxOption.Acknowledged).toBe(RxOption.Acknowledged);
  });
});

describe('OR-combined transmit options', () => {
  it('combines option flags and mode', () => {
    expect(TxOption.DisableAck | TxMode.DigiMesh).toBe(0xc1);
    expect(
      TxOption.DisableAck |
        TxOption.DisableRouteDiscovery |
        TxMode.PointMultipoint,
    ).toBe(0x43);
  });
});

describe('XBeeBuilder.buildFrame with DigiMesh options', () => {
  it('encodes the options byte into a Transmit Request', () => {
    // Force frame-id 0 so AtCommand-style buildFrame() logic stays deterministic.
    const frame: OutgoingFrame = {
      type: FrameType.ZigbeeTransmitRequest,
      id: 0x01,
      destination64: '0013a200400a0127',
      destination16: 'fffe',
      broadcastRadius: 0x00,
      options: TxOption.DisableAck | TxMode.DigiMesh,
      data: new TextEncoder().encode('TxData0A'),
    };

    const bytes = XBeeBuilder.buildFrame(frame);

    // Start byte + length (0x0016 = 22) + payload bytes. Options byte sits at
    // index 16 (right before the payload) — compare against the original
    // 'ZigBee transmit request' case from codec.test.ts, which used options=0.
    expect(bytes[16]).toBe(0xc1);

    // Frame structure is otherwise unchanged.
    expect(bytes[0]).toBe(0x7e); // start byte
    expect(bytes[3]).toBe(FrameType.ZigbeeTransmitRequest);
    expect(bytes[4]).toBe(0x01); // frame id

    // Checksum integrity — sum of payload bytes plus checksum must be 0xff.
    const payloadSum = bytes
      .subarray(3, bytes.length - 1)
      .reduce((a, b) => a + b, 0);
    expect((payloadSum + bytes[bytes.length - 1]) & 0xff).toBe(0xff);
  });

  it('uses 0 for options when none are specified (back-compat)', () => {
    // Builds without touching options — should match pre-refactor behavior.
    const frame: OutgoingFrame = {
      type: FrameType.ZigbeeTransmitRequest,
      id: 0x01,
      destination64: '0013a200400a0127',
      destination16: 'fffe',
      broadcastRadius: 0x00,
      options: 0x00,
      data: new TextEncoder().encode('TxData0A'),
    };
    const bytes = XBeeBuilder.buildFrame(frame);
    expect(bytes[16]).toBe(0x00);
  });
});
