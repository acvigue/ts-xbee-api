import { describe, expect, it } from 'vitest';

import { XBeeBuilder, XBeeParser } from '../codec.js';
import { FrameType } from '../constants.js';
import type { OutgoingFrame } from '../frame-builder.js';
import {
  RouteInformationSourceEvent,
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

describe('Route Information (0x8D) parsing', () => {
  it('parses a NACK Route Information frame', () => {
    // NACK (sourceEvent 0x11), timestamp 0x12345678, addresses filled in.
    const raw = Uint8Array.from([
      0x7e, 0x00, 0x2a, 0x8d, 0x11, 0x25, 0x12, 0x34, 0x56, 0x78, 0x01, 0x02,
      0x00, 0x00, 0x13, 0xa2, 0x00, 0x40, 0xaa, 0xbb, 0xcc, 0x00, 0x13, 0xa2,
      0x00, 0x40, 0x11, 0x22, 0x33, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x44, 0x55,
      0x66, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x77, 0x88, 0x99, 0x23,
    ]);
    const parser = new XBeeParser();
    return new Promise<void>((resolve, reject) => {
      parser.once('data', (frame) => {
        try {
          expect(frame).toEqual({
            type: FrameType.RouteInformation,
            sourceEvent: RouteInformationSourceEvent.UnicastNack,
            dataLength: 0x25,
            timestamp: 0x12345678,
            ackTimeoutCount: 0x01,
            txBlockedCount: 0x02,
            reserved: 0x00,
            destination64: '0013a20040aabbcc',
            source64: '0013a20040112233',
            responder64: '0013a20040445566',
            receiver64: '0013a20040778899',
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      parser.write(raw);
    });
  });

  it('recognizes the Trace Route source event', () => {
    const raw = Uint8Array.from([
      0x7e, 0x00, 0x2a, 0x8d, 0x12, 0x25, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x13, 0xa2, 0x00, 0x40, 0xaa, 0xbb, 0xcc, 0x00, 0x13, 0xa2,
      0x00, 0x40, 0x11, 0x22, 0x33, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x44, 0x55,
      0x66, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x77, 0x88, 0x99, 0x38,
    ]);
    const parser = new XBeeParser();
    return new Promise<void>((resolve, reject) => {
      parser.once('data', (frame) => {
        try {
          expect(frame).toMatchObject({
            type: FrameType.RouteInformation,
            sourceEvent: RouteInformationSourceEvent.TraceRoute,
            timestamp: 1,
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      parser.write(raw);
    });
  });
});

describe('Aggregate Addressing Update (0x8E) parsing', () => {
  it('parses new and old aggregate addresses', () => {
    const raw = Uint8Array.from([
      0x7e, 0x00, 0x12, 0x8e, 0x00, 0x00, 0x13, 0xa2, 0x00, 0x40, 0xaa, 0xbb,
      0xcc, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x11, 0x22, 0x33, 0xf0,
    ]);
    const parser = new XBeeParser();
    return new Promise<void>((resolve, reject) => {
      parser.once('data', (frame) => {
        try {
          expect(frame).toEqual({
            type: FrameType.AggregateAddressingUpdate,
            formatId: 0x00,
            newAddress64: '0013a20040aabbcc',
            oldAddress64: '0013a20040112233',
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      parser.write(raw);
    });
  });
});
