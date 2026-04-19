/*
 * xbee-api
 * https://github.com/jouz/xbee-api
 *
 * Copyright (c) 2013 Jan Kolkmeier
 * Licensed under the MIT license.
 */

import { BufferBuilder } from './buffer-tools.js';
import {
  AtCommand,
  BROADCAST_16_XB,
  FrameType,
  ReceiveOption,
  UNKNOWN_16,
  UNKNOWN_64,
} from './constants.js';

type Uint8 = number;
type Uint16 = number;

type AtCommandFrame =
  | {
      type: FrameType.AtCommand;
      id?: Uint8;
      command: AtCommand;
      commandParameter: Uint8Array;
    }
  | {
      type: FrameType.AtCommandQueueParameterValue;
      id?: Uint8;
      command: AtCommand;
      commandParameter: Uint8Array;
    };

type RemoteAtCommandFrame = {
  type: FrameType.RemoteAtCommandRequest;
  id?: Uint8;
  destination64?: string;
  destination16?: string;
  remoteCommandOptions?: number;
  command: AtCommand;
  commandParameter: Uint8Array;
};

type ZigbeeTransmitRequestFrame = {
  type: FrameType.ZigbeeTransmitRequest;
  id?: Uint8;
  destination64?: string;
  destination16?: string;
  broadcastRadius?: Uint8;
  options?: Uint8;
  data: Uint8Array;
};

type ExplicitAddressingFrame = {
  type: FrameType.ExplicitAddressingZigbeeCommandFrame;
  id?: Uint8;
  destination64?: string;
  destination16?: string;
  sourceEndpoint: Uint8;
  destinationEndpoint: Uint8;
  clusterId: Uint16 | string;
  profileId: Uint16 | string;
  broadcastRadius?: Uint8;
  options?: Uint8;
  data: Uint8Array;
};

type CreateSourceRouteFrame = {
  type: FrameType.CreateSourceRoute;
  id?: Uint8;
  destination64: string;
  destination16: string;
  addresses: number[];
};

type TxRequest64Frame = {
  type: FrameType.TxRequest64;
  id?: Uint8;
  destination64?: string;
  options?: number;
  data: Uint8Array;
};

type TxRequest16Frame = {
  type: FrameType.TxRequest16;
  id?: Uint8;
  destination16?: string;
  options?: number;
  data: Uint8Array;
};

type ZigbeeReceivePacketFrame = {
  type: FrameType.ZigbeeReceivePacket;
  sender64?: string;
  sender16?: string;
  receiveOptions?: Set<ReceiveOption>;
  data: Uint8Array;
};

export type OutgoingFrame =
  | AtCommandFrame
  | RemoteAtCommandFrame
  | ZigbeeTransmitRequestFrame
  | ExplicitAddressingFrame
  | CreateSourceRouteFrame
  | TxRequest64Frame
  | TxRequest16Frame
  | ZigbeeReceivePacketFrame;

export type OutgoingFrameOf<FT extends FrameType> = Extract<
  OutgoingFrame,
  { type: FT }
>;

export class FrameBuilder {
  #frameId = 0;

  nextFrameId(): number {
    this.#frameId = this.#frameId >= 0xff ? 1 : this.#frameId + 1;
    return this.#frameId;
  }

  getFrameId(frame: { id?: Uint8 }): Uint8 {
    if (frame.id == null) {
      frame.id = this.nextFrameId();
    }
    return frame.id;
  }

  has(type: FrameType): boolean {
    return type in FrameBuilder.#handlers;
  }

  build(frame: OutgoingFrame, builder: BufferBuilder): void {
    const handler = FrameBuilder.#handlers[frame.type];
    if (!handler) {
      throw new Error(
        `Unsupported outgoing frame type: 0x${frame.type.toString(16)}`,
      );
    }
    handler(this, frame as never, builder);
  }

  static readonly #handlers: Partial<
    Record<
      FrameType,
      (self: FrameBuilder, frame: OutgoingFrame, builder: BufferBuilder) => void
    >
  > = {
    [FrameType.AtCommand]: (self, frame: OutgoingFrame, b) => {
      const f = frame as AtCommandFrame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.command, 'utf8');
      b.appendBuffer(f.commandParameter);
    },
    [FrameType.AtCommandQueueParameterValue]: (self, frame, b) => {
      const f = frame as AtCommandFrame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.command, 'utf8');
      b.appendBuffer(f.commandParameter);
    },
    [FrameType.RemoteAtCommandRequest]: (self, frame, b) => {
      const f = frame as RemoteAtCommandFrame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.destination64 ?? UNKNOWN_64, 'hex');
      b.appendString(f.destination16 ?? UNKNOWN_16, 'hex');
      b.appendUInt8(f.remoteCommandOptions ?? 0x02);
      b.appendString(f.command, 'utf8');
      b.appendBuffer(f.commandParameter);
    },
    [FrameType.ZigbeeTransmitRequest]: (self, frame, b) => {
      const f = frame as ZigbeeTransmitRequestFrame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.destination64 ?? UNKNOWN_64, 'hex');
      b.appendString(f.destination16 ?? UNKNOWN_16, 'hex');
      b.appendUInt8(f.broadcastRadius ?? 0x00);
      b.appendUInt8(f.options ?? 0x00);
      b.appendBuffer(f.data);
    },
    [FrameType.ExplicitAddressingZigbeeCommandFrame]: (self, frame, b) => {
      const f = frame as ExplicitAddressingFrame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.destination64 ?? UNKNOWN_64, 'hex');
      b.appendString(f.destination16 ?? UNKNOWN_16, 'hex');
      b.appendUInt8(f.sourceEndpoint);
      b.appendUInt8(f.destinationEndpoint);
      if (typeof f.clusterId === 'number') b.appendUInt16BE(f.clusterId);
      else b.appendString(f.clusterId, 'hex');
      if (typeof f.profileId === 'number') b.appendUInt16BE(f.profileId);
      else b.appendString(f.profileId, 'hex');
      b.appendUInt8(f.broadcastRadius ?? 0x00);
      b.appendUInt8(f.options ?? 0x00);
      b.appendBuffer(f.data);
    },
    [FrameType.CreateSourceRoute]: (_self, frame, b) => {
      const f = frame as CreateSourceRouteFrame;
      b.appendUInt8(f.type);
      b.appendUInt8(0); // Frame ID is always zero for this
      b.appendString(f.destination64, 'hex');
      b.appendString(f.destination16, 'hex');
      b.appendUInt8(0); // Route command options always zero
      b.appendUInt8(f.addresses.length);
      for (const addr of f.addresses) {
        b.appendUInt16BE(addr);
      }
    },
    [FrameType.TxRequest64]: (self, frame, b) => {
      const f = frame as TxRequest64Frame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.destination64 ?? UNKNOWN_64, 'hex');
      b.appendUInt8(f.options ?? 0x00);
      b.appendBuffer(f.data);
    },
    [FrameType.TxRequest16]: (self, frame, b) => {
      const f = frame as TxRequest16Frame;
      b.appendUInt8(f.type);
      b.appendUInt8(self.getFrameId(f));
      b.appendString(f.destination16 ?? BROADCAST_16_XB, 'hex');
      b.appendUInt8(f.options ?? 0x00);
      b.appendBuffer(f.data);
    },
    [FrameType.ZigbeeReceivePacket]: (_self, frame, b) => {
      const f = frame as ZigbeeReceivePacketFrame;
      b.appendUInt8(f.type);
      b.appendString(f.sender64 ?? UNKNOWN_64, 'hex');
      b.appendString(f.sender16 ?? UNKNOWN_16, 'hex');
      b.appendUInt8(
        Array.from(f.receiveOptions ?? []).reduce((acc, bit) => acc | bit, 0),
      );
      b.appendBuffer(f.data);
    },
  };
}
