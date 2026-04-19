/*
 * xbee-api
 * https://github.com/jouz/xbee-api
 *
 * Copyright (c) 2013 Jan Kolkmeier
 * Licensed under the MIT license.
 */

import {
  ANALOG_CHANNELS,
  AtCommand,
  CommandStatus,
  DIGITAL_CHANNELS,
  FrameType,
} from './constants.js';
import { BufferReader } from './buffer-tools.js';

type Uint8 = number;
type Uint16 = number;

type NodeIdentificationTarget = {
  remote16: string;
  remote64: string;
  nodeIdentifier: string;
  remoteParent16?: string;
  deviceType?: number;
  sourceEvent?: number;
  digiProfileID?: string;
  digiManufacturerID?: string;
};

function parseNodeIdentificationPayload(
  frame: NodeIdentificationTarget,
  reader: BufferReader,
): void {
  frame.remote16 = reader.nextString(2, 'hex');
  frame.remote64 = reader.nextString(8, 'hex');
  frame.nodeIdentifier = reader.nextStringZero('utf8');

  if (reader.buf.length > reader.tell()) {
    frame.remoteParent16 = reader.nextString(2, 'hex');
    frame.deviceType = reader.nextUInt8();
    frame.sourceEvent = reader.nextUInt8();
    frame.digiProfileID = reader.nextString(2, 'hex');
    frame.digiManufacturerID = reader.nextString(2, 'hex');
  }
}

type IOSampleTarget = {
  digitalSamples?: Record<string, number>;
  analogSamples?: Record<string, number>;
  numSamples?: number;
  commandStatus?: number;
};

function parseIOSamplePayload(
  frame: IOSampleTarget,
  reader: BufferReader,
  options: { adcReferenceMv?: number | null },
): void {
  frame.digitalSamples = {};
  frame.analogSamples = {};
  frame.numSamples = 0;
  // When parsing responses to ATIS, there is no data if IO lines are not enabled
  if (frame.commandStatus !== undefined && frame.commandStatus !== 0) return;
  frame.numSamples = reader.nextUInt8();
  const mskD = reader.nextUInt16BE();
  const mskA = reader.nextUInt8();

  if (mskD > 0) {
    const valD = reader.nextUInt16BE();
    for (const dbit of Object.keys(DIGITAL_CHANNELS.MASK).map(Number) as Array<
      keyof typeof DIGITAL_CHANNELS.MASK
    >) {
      if ((mskD & (1 << dbit)) >> dbit) {
        frame.digitalSamples[DIGITAL_CHANNELS.MASK[dbit][0]] =
          (valD & (1 << dbit)) >> dbit;
      }
    }
  }

  if (mskA > 0) {
    for (const abit of Object.keys(ANALOG_CHANNELS.MASK).map(Number) as Array<
      keyof typeof ANALOG_CHANNELS.MASK
    >) {
      if ((mskA & (1 << abit)) >> abit) {
        const valA = reader.nextUInt16BE();
        if (options.adcReferenceMv == null) {
          frame.analogSamples[ANALOG_CHANNELS.MASK[abit][0]] = valA;
        } else {
          frame.analogSamples[ANALOG_CHANNELS.MASK[abit][0]] = Math.round(
            (valA * options.adcReferenceMv) / 1023,
          );
        }
      }
    }
  }
}

type LegacyChannelsKey =
  | `ADC${0 | 1 | 2 | 3 | 4 | 5}`
  | `DIO${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

function parseReceived16BitPacketIO(
  frame: IncomingFrameOf<FrameType.RxPacket16Io>,
  reader: BufferReader,
): void {
  const data = {
    sampleQuantity: reader.nextUInt8(),
    channelMask: reader.nextUInt16BE(),
    channels: {} as Record<LegacyChannelsKey, 1>,
    analogSamples: [] as Record<LegacyChannelsKey, number>[],
    digitalSamples: [] as string[],
  };

  for (let a = 0; a <= 5; a++) {
    if (data.channelMask & Math.pow(2, a + 9)) {
      data.channels[`ADC${a}` as LegacyChannelsKey] = 1;
    }
  }

  if (data.channelMask & 0x1ff) {
    for (let i = 0; i < data.sampleQuantity; i++) {
      data.digitalSamples.push(reader.nextUInt16BE().toString(2));
    }
    for (let d = 0; d <= 8; d++) {
      if (data.channelMask & Math.pow(2, d)) {
        data.channels[`DIO${d}` as LegacyChannelsKey] = 1;
      }
    }
  }

  for (let si = 0; si < data.sampleQuantity; si++) {
    const sample = {} as Record<LegacyChannelsKey, number>;
    for (let j = 0; j <= 5; j++) {
      if (data.channels[`ADC${j}` as LegacyChannelsKey]) {
        sample[`ADC${j}` as LegacyChannelsKey] = reader.nextUInt16BE();
      }
    }
    data.analogSamples.push(sample);
  }

  frame.data = data;
}

function parseAtCommand(
  frame:
    | {
        type: FrameType.AtCommand;
        id: Uint8;
        command: AtCommand;
        commandParameter: Uint8Array;
      }
    | {
        type: FrameType.AtCommandQueueParameterValue;
        id: Uint8;
        command: AtCommand;
        commandParameter: Uint8Array;
      },
  reader: BufferReader,
): void {
  frame.id = reader.nextUInt8();
  frame.command = reader.nextString(2, 'utf8') as AtCommand;
  frame.commandParameter = reader.nextAll();
}

export type NodeIdentification = {
  remote16: string;
  remote64: string;
  nodeIdentifier: string;
} & (
  | Record<string, never>
  | {
      remoteParent16: string;
      deviceType: Uint8;
      sourceEvent: Uint8;
      digiProfileID: string;
      digiManufacturerID: string;
    }
);

const frameParser = {
  [FrameType.NodeIdentification]: (
    frame: {
      type: FrameType.NodeIdentification;
      sender64: string;
      sender16: string;
      receiveOptions: Uint8;
    } & NodeIdentification,
    reader: BufferReader,
  ) => {
    frame.sender64 = reader.nextString(8, 'hex');
    frame.sender16 = reader.nextString(2, 'hex');
    frame.receiveOptions = reader.nextUInt8();
    parseNodeIdentificationPayload(frame, reader);
  },

  [FrameType.ZigbeeReceivePacket]: (
    frame: {
      type: FrameType.ZigbeeReceivePacket;
      remote64: string;
      remote16: string;
      receiveOptions: number;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.remote16 = reader.nextString(2, 'hex');
    frame.receiveOptions = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.ZigbeeExplicitRx]: (
    frame: {
      type: FrameType.ZigbeeExplicitRx;
      remote64: string;
      remote16: string;
      sourceEndpoint: string;
      destinationEndpoint: string;
      clusterId: string;
      profileId: string;
      receiveOptions: Uint8;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.remote16 = reader.nextString(2, 'hex');
    frame.sourceEndpoint = reader.nextString(1, 'hex');
    frame.destinationEndpoint = reader.nextString(1, 'hex');
    frame.clusterId = reader.nextString(2, 'hex');
    frame.profileId = reader.nextString(2, 'hex');
    frame.receiveOptions = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.XbeeSensorRead]: (
    frame: {
      type: FrameType.XbeeSensorRead;
      remote64: string;
      remote16: string;
      receiveOptions: Uint8;
      sensors: Uint8;
      sensorValues: {
        AD0: number;
        AD1: number;
        AD2: number;
        AD3: number;
        T: number;
        temperature?: number;
        relativeHumidity?: number;
        trueHumidity?: number;
        waterPresent: boolean;
      };
    },
    reader: BufferReader,
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.remote16 = reader.nextString(2, 'hex');
    frame.receiveOptions = reader.nextUInt8();
    frame.sensors = reader.nextUInt8();
    frame.sensorValues = {
      AD0: Math.round((1000 * (reader.nextUInt16BE() * 5.1)) / 255.0),
      AD1: Math.round((1000 * (reader.nextUInt16BE() * 5.1)) / 255.0),
      AD2: Math.round((1000 * (reader.nextUInt16BE() * 5.1)) / 255.0),
      AD3: Math.round((1000 * (reader.nextUInt16BE() * 5.1)) / 255.0),
      T: reader.nextUInt16BE(),
      temperature: undefined,
      relativeHumidity: undefined,
      trueHumidity: undefined,
      waterPresent: frame.sensors === 0x60,
    };

    if (frame.sensors === 2 || frame.sensors === 3) {
      if (frame.sensorValues.T < 2048) {
        frame.sensorValues.temperature = frame.sensorValues.T / 16;
      } else {
        frame.sensorValues.temperature = -(frame.sensorValues.T & 0x7ff) / 16;
      }
    }

    if (frame.sensors === 1 || frame.sensors === 3) {
      frame.sensorValues.relativeHumidity =
        Math.round(
          100 *
            ((frame.sensorValues.AD3 / frame.sensorValues.AD2 - 0.16) / 0.0062),
        ) / 100;
    }

    if (
      frame.sensors === 3 &&
      frame.sensorValues.relativeHumidity !== undefined &&
      frame.sensorValues.temperature !== undefined
    ) {
      frame.sensorValues.trueHumidity =
        Math.round(
          100 *
            (frame.sensorValues.relativeHumidity /
              (1.0546 - 0.00216 * frame.sensorValues.temperature)),
        ) / 100;
    }
  },

  [FrameType.ModemStatus]: (
    frame: {
      type: FrameType.ModemStatus;
      modemStatus: number;
    },
    reader: BufferReader,
  ) => {
    frame.modemStatus = reader.nextUInt8();
  },

  [FrameType.ZigbeeIoDataSampleRx]: (
    frame: {
      type: FrameType.ZigbeeIoDataSampleRx;
      remote64: string;
      remote16: string;
      receiveOptions: Uint8;
    } & (
      | Record<string, never>
      | {
          receiveOptions: 0;
          digitalSamples: Record<string, number>;
          analogSamples: Record<string, number>;
          numSamples: Uint8;
        }
    ),
    reader: BufferReader,
    options: { adcReferenceMv?: number | null },
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.remote16 = reader.nextString(2, 'hex');
    frame.receiveOptions = reader.nextUInt8();
    parseIOSamplePayload(frame as unknown as IOSampleTarget, reader, options);
  },

  [FrameType.AtCommandResponse]: (
    frame: {
      type: FrameType.AtCommandResponse;
      id: Uint8;
      commandStatus: Uint8;
    } & (
      | {
          command: AtCommand.ND;
          nodeIdentification: NodeIdentification;
        }
      | {
          command: Exclude<AtCommand, AtCommand.ND>;
          commandData: Uint8Array;
        }
    ),
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.command = reader.nextString(2, 'utf8') as AtCommand;
    frame.commandStatus = reader.nextUInt8();
    if (
      frame.command === 'ND' &&
      frame.commandStatus === CommandStatus.Ok &&
      reader.buf.length > reader.tell()
    ) {
      const ndFrame = frame as unknown as {
        nodeIdentification: NodeIdentificationTarget;
      };
      ndFrame.nodeIdentification = {} as NodeIdentificationTarget;
      parseNodeIdentificationPayload(ndFrame.nodeIdentification, reader);
    } else {
      (frame as unknown as { commandData: Uint8Array }).commandData =
        reader.nextAll();
    }
  },

  [FrameType.RemoteCommandResponse]: (
    frame: {
      type: FrameType.RemoteCommandResponse;
      id: Uint8;
      remote64: string;
      remote16: string;
      commandStatus: Uint8;
    } & (
      | {
          command: AtCommand.ND;
          nodeIdentification: NodeIdentification;
        }
      | {
          command: Exclude<AtCommand, AtCommand.ND>;
          commandData: Uint8Array;
        }
    ),
    reader: BufferReader,
    options: { adcReferenceMv?: number | null },
  ) => {
    frame.id = reader.nextUInt8();
    frame.remote64 = reader.nextString(8, 'hex');
    frame.remote16 = reader.nextString(2, 'hex');
    frame.command = reader.nextString(2, 'utf8') as AtCommand;
    frame.commandStatus = reader.nextUInt8();
    if (frame.command === 'IS') {
      parseIOSamplePayload(frame as unknown as IOSampleTarget, reader, options);
    } else if (
      frame.command === 'ND' &&
      frame.commandStatus === CommandStatus.Ok
    ) {
      const ndFrame = frame as unknown as {
        nodeIdentification: NodeIdentificationTarget;
      };
      ndFrame.nodeIdentification = {} as NodeIdentificationTarget;
      parseNodeIdentificationPayload(ndFrame.nodeIdentification, reader);
    } else {
      (frame as unknown as { commandData: Uint8Array }).commandData =
        reader.nextAll();
    }
  },

  [FrameType.ZigbeeTransmitStatus]: (
    frame: {
      type: FrameType.ZigbeeTransmitStatus;
      id: Uint8;
      remote16: string;
      transmitRetryCount: number;
      deliveryStatus: number;
      discoveryStatus: number;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.remote16 = reader.nextString(2, 'hex');
    frame.transmitRetryCount = reader.nextUInt8();
    frame.deliveryStatus = reader.nextUInt8();
    frame.discoveryStatus = reader.nextUInt8();
  },

  [FrameType.RouteInformation]: (
    frame: {
      type: FrameType.RouteInformation;
      /** `0x11` = Unicast NACK, `0x12` = Trace Route. */
      sourceEvent: Uint8;
      /** Length of the data bytes that follow. */
      dataLength: Uint8;
      /** Big-endian system timer value at the time of frame generation. */
      timestamp: number;
      ackTimeoutCount: Uint8;
      txBlockedCount: Uint8;
      reserved: Uint8;
      destination64: string;
      source64: string;
      /** Address of the node that generated this route information frame. */
      responder64: string;
      /** Address of the node that received the original transmission. */
      receiver64: string;
    },
    reader: BufferReader,
  ) => {
    frame.sourceEvent = reader.nextUInt8();
    frame.dataLength = reader.nextUInt8();
    frame.timestamp = reader.nextUInt32BE();
    frame.ackTimeoutCount = reader.nextUInt8();
    frame.txBlockedCount = reader.nextUInt8();
    frame.reserved = reader.nextUInt8();
    frame.destination64 = reader.nextString(8, 'hex');
    frame.source64 = reader.nextString(8, 'hex');
    frame.responder64 = reader.nextString(8, 'hex');
    frame.receiver64 = reader.nextString(8, 'hex');
  },

  [FrameType.AggregateAddressingUpdate]: (
    frame: {
      type: FrameType.AggregateAddressingUpdate;
      /** Always `0x00` in current DigiMesh firmware. */
      formatId: Uint8;
      /** New 64-bit aggregate address. */
      newAddress64: string;
      /** Previous 64-bit aggregate address that was replaced. */
      oldAddress64: string;
    },
    reader: BufferReader,
  ) => {
    frame.formatId = reader.nextUInt8();
    frame.newAddress64 = reader.nextString(8, 'hex');
    frame.oldAddress64 = reader.nextString(8, 'hex');
  },

  [FrameType.RouteRecord]: (
    frame: {
      type: FrameType.RouteRecord;
      remote64: string;
      remote16: string;
      receiveOptions: Uint8;
      hopCount: Uint8;
      addresses: Uint16[];
    },
    reader: BufferReader,
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.remote16 = reader.nextString(2, 'hex');
    frame.receiveOptions = reader.nextUInt8();
    frame.hopCount = reader.nextUInt8();
    frame.addresses = [];
    for (let i = 0; i < frame.hopCount; i++) {
      frame.addresses.push(reader.nextUInt16BE());
    }
  },

  [FrameType.AtCommand]: parseAtCommand,
  [FrameType.AtCommandQueueParameterValue]: parseAtCommand,

  [FrameType.RemoteAtCommandRequest]: (
    frame: {
      type: FrameType.RemoteAtCommandRequest;
      id: Uint8;
      destination64: string;
      destination16: string;
      remoteCommandOptions: Uint8;
      command: AtCommand;
      commandParameter: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.destination64 = reader.nextString(8, 'hex');
    frame.destination16 = reader.nextString(2, 'hex');
    frame.remoteCommandOptions = reader.nextUInt8();
    frame.command = reader.nextString(2, 'utf8') as AtCommand;
    frame.commandParameter = reader.nextAll();
  },

  [FrameType.ZigbeeTransmitRequest]: (
    frame: {
      type: FrameType.ZigbeeTransmitRequest;
      id: Uint8;
      destination64: string;
      destination16: string;
      broadcastRadius: Uint8;
      options: Uint8;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.destination64 = reader.nextString(8, 'hex');
    frame.destination16 = reader.nextString(2, 'hex');
    frame.broadcastRadius = reader.nextUInt8();
    frame.options = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.ExplicitAddressingZigbeeCommandFrame]: (
    frame: {
      type: FrameType.ExplicitAddressingZigbeeCommandFrame;
      id: Uint8;
      destination64: string;
      destination16: string;
      sourceEndpoint: Uint8;
      destinationEndpoint: Uint8;
      clusterId: Uint16;
      profileId: Uint16;
      broadcastRadius: Uint8;
      options: Uint8;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.destination64 = reader.nextString(8, 'hex');
    frame.destination16 = reader.nextString(2, 'hex');
    frame.sourceEndpoint = reader.nextUInt8();
    frame.destinationEndpoint = reader.nextUInt8();
    frame.clusterId = reader.nextUInt16BE();
    frame.profileId = reader.nextUInt16BE();
    frame.broadcastRadius = reader.nextUInt8();
    frame.options = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.TxRequest64]: (
    frame: {
      type: FrameType.TxRequest64;
      id: Uint8;
      destination64: string;
      options: number;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.destination64 = reader.nextString(8, 'hex');
    frame.options = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.TxRequest16]: (
    frame: {
      type: FrameType.TxRequest16;
      id: Uint8;
      destination16: string;
      options: number;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.destination16 = reader.nextString(2, 'hex');
    frame.options = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.TxStatus]: (
    frame: {
      type: FrameType.TxStatus;
      id: Uint8;
      deliveryStatus: Uint8;
    },
    reader: BufferReader,
  ) => {
    frame.id = reader.nextUInt8();
    frame.deliveryStatus = reader.nextUInt8();
  },

  [FrameType.RxPacket64]: (
    frame: {
      type: FrameType.RxPacket64;
      remote64: string;
      rssi: Uint8;
      receiveOptions: Uint8;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.rssi = reader.nextUInt8();
    frame.receiveOptions = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.RxPacket16]: (
    frame: {
      type: FrameType.RxPacket16;
      remote16: string;
      rssi: Uint8;
      receiveOptions: Uint8;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.remote16 = reader.nextString(2, 'hex');
    frame.rssi = reader.nextUInt8();
    frame.receiveOptions = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.RxPacket64Io]: (
    frame: {
      type: FrameType.RxPacket64Io;
      remote64: string;
      rssi: Uint8;
      receiveOptions: Uint8;
      data: Uint8Array;
    },
    reader: BufferReader,
  ) => {
    frame.remote64 = reader.nextString(8, 'hex');
    frame.rssi = reader.nextUInt8();
    frame.receiveOptions = reader.nextUInt8();
    frame.data = reader.nextAll();
  },

  [FrameType.RxPacket16Io]: (
    frame: {
      type: FrameType.RxPacket16Io;
      remote16: string;
      rssi: Uint8;
      receiveOptions: Uint8;
      data: {
        sampleQuantity: Uint8;
        channelMask: Uint16;
        channels: { [k in LegacyChannelsKey]?: number };
        analogSamples: Array<Partial<Record<LegacyChannelsKey, Uint16>>>;
        digitalSamples: string[];
      };
    },
    reader: BufferReader,
  ) => {
    frame.remote16 = reader.nextString(2, 'hex');
    frame.rssi = reader.nextUInt8();
    frame.receiveOptions = reader.nextUInt8();
    parseReceived16BitPacketIO(frame, reader);
  },
};

export default frameParser;

export type IncomingFrame = Parameters<
  (typeof frameParser)[keyof typeof frameParser]
>[0];

export type IncomingFrameOf<FT extends FrameType> = Extract<
  IncomingFrame,
  { type: FT }
>;
