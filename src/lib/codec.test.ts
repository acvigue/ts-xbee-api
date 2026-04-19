/*
 * xbee-api
 * https://github.com/jouz/xbee-api
 *
 * Copyright (c) 2013 Jan Kolkmeier
 * Licensed under the MIT license.
 */

import * as stream from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { concat } from './buffer-tools.js';
import { AtCommand, FrameType, ReceiveOption } from './constants.js';
import { XBeeBuilder, XBeeParser } from './codec.js';
import type { OutgoingFrame } from './frame-builder.js';

describe('Options', () => {
  it('defaults to API mode 1', () => {
    const builder = new XBeeBuilder();
    expect(builder.options.apiMode).toEqual(1);
  });

  it('applies supplied options', () => {
    const builder = new XBeeBuilder({ apiMode: 2 });
    expect(builder.options.apiMode).toEqual(2);
  });
});

describe('frameId', () => {
  it('increments', () => {
    const builder = new XBeeBuilder();
    const a = builder.nextFrameId();
    const b = builder.nextFrameId();
    expect(a + 1).toEqual(b);
  });
});

describe('Frame building', () => {
  it('keeps frame id zero', () => {
    const frame: OutgoingFrame = {
      type: FrameType.AtCommand,
      id: 0x00,
      command: AtCommand.NJ,
      commandParameter: new Uint8Array(),
    };

    const expected = Uint8Array.from([
      0x7e, 0x00, 0x04, 0x08, 0x00, 0x4e, 0x4a, 0x5f,
    ]);

    expect(XBeeBuilder.buildFrame(frame)).toEqual(expected);
  });

  it('assigns an id when missing', () => {
    const frame: OutgoingFrame = {
      type: FrameType.AtCommand,
      command: AtCommand.NJ,
      commandParameter: new Uint8Array(),
    };

    const buf = XBeeBuilder.buildFrame(frame);
    expect(buf[4]).toEqual(1);
  });

  it('AT command', () => {
    const frame: OutgoingFrame = {
      type: FrameType.AtCommand,
      id: 0x52,
      command: AtCommand.NJ,
      commandParameter: new Uint8Array(),
    };

    const expected = Uint8Array.from([
      0x7e, 0x00, 0x04, 0x08, 0x52, 0x4e, 0x4a, 0x0d,
    ]);

    expect(XBeeBuilder.buildFrame(frame)).toEqual(expected);
  });

  it('AT command queue parameter value', () => {
    const frame: OutgoingFrame = {
      type: FrameType.AtCommandQueueParameterValue,
      id: 0x01,
      command: AtCommand.BD,
      commandParameter: Uint8Array.from([0x07]),
    };

    const expected = Uint8Array.from([
      0x7e, 0x00, 0x05, 0x09, 0x01, 0x42, 0x44, 0x07, 0x68,
    ]);

    expect(XBeeBuilder.buildFrame(frame)).toEqual(expected);
  });

  it('remote AT command request', () => {
    const frame: OutgoingFrame = {
      type: FrameType.RemoteAtCommandRequest,
      id: 0x01,
      destination64: '0013a20040401122',
      destination16: 'fffe',
      remoteCommandOptions: 0x02,
      command: AtCommand.BH,
      commandParameter: Uint8Array.from([0x01]),
    };

    const expected = Uint8Array.from([
      0x7e, 0x00, 0x10, 0x17, 0x01, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x40, 0x11,
      0x22, 0xff, 0xfe, 0x02, 0x42, 0x48, 0x01, 0xf5,
    ]);

    expect(XBeeBuilder.buildFrame(frame)).toEqual(expected);
  });

  it('ZigBee transmit request', () => {
    const frame: OutgoingFrame = {
      type: FrameType.ZigbeeTransmitRequest,
      id: 0x01,
      destination64: '0013a200400a0127',
      destination16: 'fffe',
      broadcastRadius: 0x00,
      options: 0x00,
      data: new TextEncoder().encode('TxData0A'),
    };

    const expected = Uint8Array.from([
      0x7e, 0x00, 0x16, 0x10, 0x01, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x0a, 0x01,
      0x27, 0xff, 0xfe, 0x00, 0x00, 0x54, 0x78, 0x44, 0x61, 0x74, 0x61, 0x30,
      0x41, 0x13,
    ]);

    expect(XBeeBuilder.buildFrame(frame)).toEqual(expected);
  });

  it('ZigBee receive packet (emulated)', () => {
    const frame: OutgoingFrame = {
      type: FrameType.ZigbeeReceivePacket,
      sender64: '0013A20087654321',
      sender16: '5614',
      receiveOptions: new Set([ReceiveOption.PacketAcknowledged]),
      data: new TextEncoder().encode('TxData'),
    };

    const expected = Uint8Array.from([
      0x7e, 0x00, 0x12, 0x90, 0x00, 0x13, 0xa2, 0x00, 0x87, 0x65, 0x43, 0x21,
      0x56, 0x14, 0x01, 0x54, 0x78, 0x44, 0x61, 0x74, 0x61, 0xb9,
    ]);

    expect(expected).toEqual(XBeeBuilder.buildFrame(frame));
  });
});

describe('Stream interface', () => {
  it('encodes and decodes through the streams', () => {
    const parser = new XBeeParser();
    const builder = new XBeeBuilder();

    const sendFrame: OutgoingFrame = {
      type: FrameType.ZigbeeTransmitRequest,
      id: 0x01,
      destination64: '0013a200400a0127',
      destination16: 'fffe',
      broadcastRadius: 0x00,
      options: 0x00,
      data: new TextEncoder().encode('TxData0A'),
    };
    const expectedBytes = Buffer.from([
      0x7e, 0x00, 0x16, 0x10, 0x01, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x0a, 0x01,
      0x27, 0xff, 0xfe, 0x00, 0x00, 0x54, 0x78, 0x44, 0x61, 0x74, 0x61, 0x30,
      0x41, 0x13,
    ]);
    const rawFrame0 = Uint8Array.from([
      0x7e, 0x00, 0x13, 0x97, 0x55, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b,
      0xaa, 0x7d, 0x84, 0x53, 0x4c, 0x00, 0x40, 0x52, 0x2b, 0xaa, 0xf0,
    ]);
    const rawFrame1 = Uint8Array.from([
      0x7e, 0x00, 0x07, 0x8b, 0x01, 0x7d, 0x84, 0x00, 0x00, 0x01, 0x71,
    ]);

    const mockserialR = new stream.Readable();
    const mockserialW = new stream.Writable();
    mockserialW._write = vi.fn();
    mockserialR._read = vi.fn();
    mockserialR.pipe(parser);
    builder.pipe(mockserialW);

    const onData = vi.fn((frame) => {
      if (frame.id === 0x01) {
        expect(frame.remote16).toEqual('7d84');
        expect(frame.transmitRetryCount).toEqual(0);
        expect(frame.deliveryStatus).toEqual(0);
        expect(frame.discoveryStatus).toEqual(1);
      } else if (frame.id === 0x55) {
        expect(frame.remote64).toEqual('0013a20040522baa');
        expect(frame.remote16).toEqual('7d84');
        expect(frame.command).toEqual('SL');
        expect(frame.commandStatus).toEqual(0);
        expect(frame.commandData).toEqual(
          Uint8Array.from([0x40, 0x52, 0x2b, 0xaa]),
        );
      }
    });
    parser.on('data', onData);

    builder.write(sendFrame);
    mockserialR.emit('data', rawFrame0);
    mockserialR.emit('data', rawFrame1);
    mockserialR.emit('end');

    expect(onData).toHaveBeenCalledTimes(2);
    expect(mockserialW._write).toHaveBeenCalledTimes(1);
    expect(mockserialW._write).toBeCalledWith(
      expectedBytes,
      'buffer',
      expect.anything(),
    );
  });
});

describe('Frame parsing', () => {
  it('AT remote command response', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toEqual({
        type: FrameType.RemoteCommandResponse,
        id: 0x55,
        remote64: '0013a20040522baa',
        remote16: '7d84',
        command: 'SL',
        commandStatus: 0,
        commandData: Uint8Array.from([0x40, 0x52, 0x2b, 0xaa]),
      });
    });

    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x13, 0x97, 0x55, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b,
      0xaa, 0x7d, 0x84, 0x53, 0x4c, 0x00, 0x40, 0x52, 0x2b, 0xaa, 0xf0,
    ]);
    parser.write(rawFrame);
  });

  it('AT command response, BD AT command', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        id: 0x01,
        command: 'BD',
        commandStatus: 0,
      });
    });

    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x05, 0x88, 0x01, 0x42, 0x44, 0x00, 0xf0,
    ]);
    parser.write(rawFrame);
  });

  it('AT command response, ND AT command with no data', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        id: 0x01,
        command: 'ND',
        commandStatus: 0,
        commandData: Uint8Array.from([]),
      });
    });

    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x05, 0x88, 0x01, 0x4e, 0x44, 0x00, 0xe4,
    ]);
    parser.write(rawFrame);
  });

  it('AT command response, ND AT command with data', () => {
    const parser = new XBeeParser({ apiMode: 2 });
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        id: 0x01,
        command: 'ND',
        commandStatus: 0,
        nodeIdentification: {
          remote16: 'fffe',
          remote64: '0013a20040d814a8',
          nodeIdentifier: '4d',
        },
      });
    });

    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x12, 0x88, 0x01, 0x4e, 0x44, 0x00, 0xff, 0xfe, 0x00, 0x7d,
      0x33, 0xa2, 0x00, 0x40, 0xd8, 0x14, 0xa8, 0x34, 0x64, 0x00, 0xc6,
    ]);
    parser.write(rawFrame);
  });

  it('transmit status', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote16: '7d84',
        id: 0x01,
        transmitRetryCount: 0,
        deliveryStatus: 0,
        discoveryStatus: 1,
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x07, 0x8b, 0x01, 0x7d, 0x84, 0x00, 0x00, 0x01, 0x71,
    ]);
    parser.write(rawFrame);
  });

  it('modem status', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({ modemStatus: 6 });
    });
    const rawFrame = Uint8Array.from([0x7e, 0x00, 0x02, 0x8a, 0x06, 0x6f]);
    parser.write(rawFrame);
  });

  it('receive packet', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a20040522baa',
        remote16: '7d84',
        receiveOptions: 1,
        data: Uint8Array.from([0x52, 0x78, 0x44, 0x61, 0x74, 0x61]),
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x12, 0x90, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b, 0xaa,
      0x7d, 0x84, 0x01, 0x52, 0x78, 0x44, 0x61, 0x74, 0x61, 0x0d,
    ]);
    parser.write(rawFrame);
  });

  it('leading garbage', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a20040522baa',
        remote16: '7d84',
        receiveOptions: 1,
        data: Uint8Array.from([0x52, 0x78, 0x44, 0x61, 0x74, 0x61]),
      });
    });
    const garbage = [];
    for (let i = 0; i < 520; i++) garbage.push(0x00);
    const garbageBuffer = Uint8Array.from(garbage);
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x12, 0x90, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b, 0xaa,
      0x7d, 0x84, 0x01, 0x52, 0x78, 0x44, 0x61, 0x74, 0x61, 0x0d,
    ]);
    const garbagedFrame = concat(garbageBuffer, rawFrame);
    parser.write(garbagedFrame);
  });

  it('receive packet with AO=1', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a20040c401a9',
        remote16: '0000',
        sourceEndpoint: 'e8',
        destinationEndpoint: 'e8',
        clusterId: '0011',
        profileId: 'c105',
        receiveOptions: 1,
        data: Uint8Array.from([
          0x74, 0x65, 0x73, 0x74, 0x20, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67,
          0x65,
        ]),
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x1e, 0x91, 0x00, 0x13, 0xa2, 0x00, 0x40, 0xc4, 0x01, 0xa9,
      0x00, 0x00, 0xe8, 0xe8, 0x00, 0x11, 0xc1, 0x05, 0x01, 0x74, 0x65, 0x73,
      0x74, 0x20, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x9e,
    ]);
    parser.write(rawFrame);
  });

  it('receive packet 16-bit IO', () => {
    const parser = new XBeeParser({ apiMode: 1 });
    parser.once('data', (frame) => {
      if (frame.type === FrameType.RxPacket16Io) {
        expect(frame.remote16).toEqual('1234');
        expect(frame.data.analogSamples.length).toEqual(
          frame.data.sampleQuantity,
        );
        expect(frame.data.channelMask).toEqual(0x0e58);
      } else {
        expect(frame.type).toEqual(FrameType.RxPacket16Io);
      }
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x10, 0x83, 0x12, 0x34, 0x1b, 0x00, 0x01, 0x0e, 0x58, 0x00,
      0x18, 0x00, 0x46, 0x01, 0x54, 0x02, 0x0a, 0xf5,
    ]);
    parser.write(rawFrame);
  });

  it('route record', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a2004068f65b',
        remote16: '6d32',
        receiveOptions: 0,
        hopCount: 3,
        addresses: [0x1234, 0x5678, 0x90ab],
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x13, 0xa1, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x68, 0xf6, 0x5b,
      0x6d, 0x32, 0x00, 0x03, 0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xbf,
    ]);
    parser.write(rawFrame);
  });

  it('ZigBee IO data sample rx', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a20040522baa',
        remote16: '7d84',
        receiveOptions: 1,
        numSamples: 1,
        digitalSamples: { DIO2: 1, DIO3: 0, DIO4: 1 },
        analogSamples: { AD1: 644 },
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x14, 0x92, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b, 0xaa,
      0x7d, 0x84, 0x01, 0x01, 0x00, 0x1c, 0x02, 0x00, 0x14, 0x02, 0x25, 0xf5,
    ]);
    parser.write(rawFrame);
  });

  it('AP=1 containing start byte', () => {
    const parser = new XBeeParser({ apiMode: 1 });
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a200415b7ed6',
        remote16: 'fffe',
        receiveOptions: 194,
        numSamples: 1,
        digitalSamples: {},
        analogSamples: { AD2: 1200, AD3: 1200 },
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x14, 0x92, 0x00, 0x13, 0xa2, 0x00, 0x41, 0x5b, 0x7e, 0xd6,
      0xff, 0xfe, 0xc2, 0x01, 0x00, 0x00, 0x0c, 0x03, 0xff, 0x03, 0xff, 0xf8,
    ]);
    parser.write(rawFrame);
  });

  it('multiple frames in one buffer', () => {
    const parser = new XBeeParser({ apiMode: 1 });
    let parsed = 0;

    parser.on('data', (frame) => {
      if (parsed === 0) {
        expect(frame).toMatchObject({
          remote64: '0013a20040522baa',
          remote16: '7d84',
          receiveOptions: 1,
          numSamples: 1,
          digitalSamples: { DIO2: 1, DIO3: 0, DIO4: 1 },
          analogSamples: { AD1: 644 },
        });
      } else if (parsed === 1) {
        expect(frame).toMatchObject({
          remote64: '0013a20041550883',
          remote16: 'fffe',
          receiveOptions: 194,
          numSamples: 1,
          digitalSamples: {},
          analogSamples: { AD2: 1200, AD3: 1200 },
        });
      }
      parsed++;
    });

    const rawFrames = Uint8Array.from([
      0x7e, 0x00, 0x14, 0x92, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b, 0xaa,
      0x7d, 0x84, 0x01, 0x01, 0x00, 0x1c, 0x02, 0x00, 0x14, 0x02, 0x25, 0xf5,
      0x7e, 0x00, 0x14, 0x92, 0x00, 0x13, 0xa2, 0x00, 0x41, 0x55, 0x08, 0x83,
      0xff, 0xfe, 0xc2, 0x01, 0x00, 0x00, 0x0c, 0x03, 0xff, 0x03, 0xff, 0xc7,
    ]);
    parser.write(rawFrames);
  });

  it('XBee sensor read indicator', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        remote64: '0013a20040522baa',
        remote16: 'dd6c',
        receiveOptions: 1,
        sensors: 0x03,
        sensorValues: {
          AD0: 40,
          AD1: 4120,
          AD2: 4680,
          AD3: 1640,
          T: 362,
          temperature: 22.625,
          relativeHumidity: 30.71,
          trueHumidity: 30.54,
          waterPresent: false,
        },
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x17, 0x94, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b, 0xaa,
      0xdd, 0x6c, 0x01, 0x03, 0x00, 0x02, 0x00, 0xce, 0x00, 0xea, 0x00, 0x52,
      0x01, 0x6a, 0x8b,
    ]);
    parser.write(rawFrame);
  });

  it('node identification indicator', () => {
    const parser = new XBeeParser();
    parser.once('data', (frame) => {
      expect(frame).toMatchObject({
        sender64: '0013a20040522baa',
        sender16: '7d84',
        receiveOptions: 2,
        remote16: '7d84',
        remote64: '0013a20040522baa',
        nodeIdentifier: ' ',
        remoteParent16: 'fffe',
        deviceType: 1,
        sourceEvent: 1,
      });
    });
    const rawFrame = Uint8Array.from([
      0x7e, 0x00, 0x20, 0x95, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b, 0xaa,
      0x7d, 0x84, 0x02, 0x7d, 0x84, 0x00, 0x13, 0xa2, 0x00, 0x40, 0x52, 0x2b,
      0xaa, 0x20, 0x00, 0xff, 0xfe, 0x01, 0x01, 0xc1, 0x05, 0x10, 0x1e, 0x1b,
    ]);
    parser.write(rawFrame);
  });

  it('escaping (AP=2)', () => {
    const parser = new XBeeParser({ apiMode: 2 });
    let parsed = 0;

    parser.on('data', (frame) => {
      if (frame.type !== FrameType.ZigbeeTransmitStatus) {
        expect(frame.type).toEqual(FrameType.ZigbeeTransmitStatus);
        return;
      }
      const expectedIds = [0x7d, 0x7e, 0x62, 0x64, 0x65, 0x66];
      expect(frame.id).toEqual(expectedIds[parsed]);
      parsed++;
    });

    const rawFrame0 = Uint8Array.from([
      0x7e, 0x0, 0x7, 0x8b, 0x7d, 0x5d, 0x2a, 0x6a, 0x0, 0x0, 0x0, 0x63,
    ]);
    parser.write(rawFrame0);

    const rawFrame1 = Uint8Array.from([
      0x7e, 0x0, 0x7, 0x8b, 0x7d, 0x5e, 0x2a, 0x6a, 0x0, 0x0, 0x0, 0x62,
    ]);
    parser.write(rawFrame1);

    const rawFrame2 = Uint8Array.from([
      0x7e, 0x0, 0x7, 0x8b, 0x62, 0x2a, 0x6a, 0x0, 0x0, 0x0, 0x7d, 0x5e,
    ]);
    parser.write(rawFrame2);

    const rawFrame3 = Uint8Array.from([
      0x7e, 0x0, 0x7, 0x8b, 0x64, 0x2a, 0x6a, 0x0, 0x0, 0x0, 0x7c,
    ]);
    parser.write(rawFrame3);

    const rawFrame4 = Uint8Array.from([
      0x7e, 0x0, 0x7, 0x8b, 0x65, 0x2a, 0x6a, 0x0, 0x0, 0x0, 0x7b,
    ]);
    parser.write(rawFrame4);

    const rawFrame5 = Uint8Array.from([
      0x7e, 0x0, 0x7, 0x8b, 0x66, 0x2a, 0x6a, 0x0, 0x0, 0x0, 0x7a,
    ]);
    parser.write(rawFrame5);
  });
});
