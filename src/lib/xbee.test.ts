import * as stream from 'node:stream';
import { describe, expect, it } from 'vitest';

import { Address64 } from './address.js';
import { fromHex, toHex } from './buffer-tools.js';
import { AtCommand, FrameType } from './constants.js';
import { XBee } from './xbee.js';
import type { IncomingFrameOf } from './frame-parser.js';

function createMockStream(mapping: Array<[string, string[]]>): stream.Duplex {
  const targetStream = new stream.PassThrough();
  const duplex = new stream.Duplex({
    read() {
      return;
    },
    write(data, encoding, callback) {
      targetStream.write(data, encoding, callback);
    },
  });

  targetStream.on('data', (data: Buffer) => {
    const hexData = toHex(data);
    expect(mapping.length, 'to be done receiving messages').toBeGreaterThan(0);
    const next = mapping.shift();
    if (!next) throw new Error('no more mapped messages');
    const [expected, responses] = next;
    expect(hexData).toEqual(expected);
    for (const response of responses) {
      duplex.push(fromHex(response));
    }
  });

  return duplex;
}

describe('XBee', () => {
  it('communicates with XBee via duplex stream', async () => {
    const mockStream = createMockStream([
      ['7e00040801415065', ['7e0006880141500001e4']], // AT command AP / response
    ]);
    const xbee = new XBee(mockStream);
    const apMode = await xbee.getParameter(AtCommand.AP);
    expect(apMode).toEqual(Uint8Array.from([0x01]));
    xbee.close();
  });

  it('exposes 64-bit address as Address64', async () => {
    const mockStream = createMockStream([
      ['7e0004080153485b', ['7e000988015348000013a20026']], // SH -> 0013a200
      ['7e00040802534c56', ['7e00098802534c0040aacaf82a']], // SL -> 40aacaf8
    ]);
    const xbee = new XBee(mockStream);
    const address = await xbee.address();
    expect(address).toBeInstanceOf(Address64);
    expect(address.toString()).toEqual('0013a20040aacaf8');
    xbee.close();
  });

  it('scans the network', async () => {
    const mockStream = createMockStream([
      ['7e000508014e543c18', ['7e000588014e5400d4']], // set discovery timeout
      [
        '7e000408024e4463',
        ['7e001988024e4400ed920013a20041aacaf82000fffe0100c105101ef0'],
      ],
    ]);
    const xbee = new XBee(mockStream);

    const devices: Array<IncomingFrameOf<FrameType.AtCommandResponse>> = [];
    for await (const device of xbee.scanNetwork({ timeoutMs: 100 })) {
      devices.push(device);
    }
    xbee.close();

    expect(devices).toMatchInlineSnapshot(`
      [
        {
          "command": "ND",
          "commandStatus": 0,
          "id": 2,
          "nodeIdentification": {
            "deviceType": 1,
            "digiManufacturerID": "101e",
            "digiProfileID": "c105",
            "nodeIdentifier": " ",
            "remote16": "ed92",
            "remote64": "0013a20041aacaf8",
            "remoteParent16": "fffe",
            "sourceEvent": 0,
          },
          "type": 136,
        },
      ]
    `);
  });

  it('supports Symbol.asyncDispose (`await using`)', async () => {
    const mockStream = createMockStream([
      ['7e00040801415065', ['7e0006880141500001e4']],
    ]);
    {
      await using xbee = new XBee(mockStream);
      const ap = await xbee.getParameter(AtCommand.AP);
      expect(ap).toEqual(Uint8Array.from([0x01]));
    }
    // stream should have been destroyed on dispose; no hang
  });

  it('times out getParameter when no response arrives', async () => {
    const mockStream = new stream.PassThrough();
    const xbee = new XBee(mockStream);
    await expect(
      xbee.getParameter(AtCommand.AP, { timeoutMs: 10 }),
    ).rejects.toThrow();
    xbee.close();
  });

  it('transmit resolves with ZigbeeTransmitStatus frame data', async () => {
    const mockStream = createMockStream([
      [
        '7e001210010013a20040aacaf8fffe0000deadbeef58',
        ['7e00078b01ffff00000075'],
      ],
    ]);
    const xbee = new XBee(mockStream);
    const result = await xbee.transmit(
      Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      '0013a20040aacaf8',
    );
    expect(result).toEqual({
      deliveryStatus: 0,
      transmitRetryCount: 0,
      discoveryStatus: 0,
      remote16: 'ffff',
    });
    xbee.close();
  });

  it('transmit serializes TX Requests on prior TX Status', async () => {
    const mockStream = createMockStream([
      [
        '7e001210010013a20040aacaf8fffe0000deadbeef58',
        ['7e00078b01ffff00000075'],
      ],
      ['7e001010020013a20040aacaf8fffe0000123449', ['7e00078b02ffff02010071']],
    ]);
    const xbee = new XBee(mockStream);

    // Both promises are created simultaneously; the second must not write
    // until the first's TX Status comes back. createMockStream's expectation
    // order enforces this — if the second frame hit the wire first, the
    // hex match for expected #1 would fail.
    const [r1, r2] = await Promise.all([
      xbee.transmit(
        Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
        '0013a20040aacaf8',
      ),
      xbee.transmit(Uint8Array.from([0x12, 0x34]), '0013a20040aacaf8'),
    ]);

    expect(r1.deliveryStatus).toEqual(0);
    expect(r2.deliveryStatus).toEqual(1);
    expect(r2.transmitRetryCount).toEqual(2);
    xbee.close();
  });

  it('transmit rejects on timeout but still releases the next TX', async () => {
    const mockStream = createMockStream([
      // First TX: write goes out but no status response — will time out.
      ['7e001210010013a20040aacaf8fffe0000deadbeef58', []],
      // Second TX: proceeds once the first's wait aborts, gets its status.
      ['7e001010020013a20040aacaf8fffe0000123449', ['7e00078b02ffff02010071']],
    ]);
    const xbee = new XBee(mockStream);

    const p1 = xbee.transmit(
      Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      '0013a20040aacaf8',
      { timeoutMs: 20 },
    );
    const p2 = xbee.transmit(Uint8Array.from([0x12, 0x34]), '0013a20040aacaf8');

    await expect(p1).rejects.toThrow();
    const r2 = await p2;
    expect(r2.deliveryStatus).toEqual(1);
    xbee.close();
  });
});

describe('Address64', () => {
  it('rejects invalid hex', () => {
    expect(() => Address64.fromHex('nothex')).toThrow();
    expect(() => Address64.fromHex('aabb')).toThrow();
  });

  it('round-trips via bytes', () => {
    const a = Address64.fromHex('0013A20040AACAF8');
    expect(a.toString()).toEqual('0013a20040aacaf8');
    expect(Address64.fromBytes(a.toBytes()).toString()).toEqual(
      '0013a20040aacaf8',
    );
  });
});
