/*
 * xbee-api
 * https://github.com/jouz/xbee-api
 *
 * Copyright (c) 2013 Jan Kolkmeier
 * Licensed under the MIT license.
 */

import * as stream from 'node:stream';

import { BufferBuilder, BufferReader } from './buffer-tools.js';
import * as C from './constants.js';
import { FrameType } from './constants.js';
import {
  ChecksumMismatchError,
  ParseState,
  UnknownFrameTypeError,
} from './errors.js';
import { FrameBuilder, OutgoingFrame } from './frame-builder.js';
import frameParser, { IncomingFrame } from './frame-parser.js';

export interface ParserOptions {
  /** 1 is default, 2 is with escaping (set ATAP=2 on the XBee). */
  apiMode: 1 | 2;
  /** If true, only raw byte frames are emitted (after validation), not parsed objects. */
  rawFrames: boolean;
  /**
   * When null, do not convert ADC values to millivolts.
   *
   * When a number, this is the reference voltage (in mV) used for ADC conversion.
   */
  adcReferenceMv: number | null;
}

export interface BuilderOptions {
  /** 1 is default, 2 is with escaping (set ATAP=2 on the XBee). */
  apiMode: 1 | 2;
}

const DEFAULT_PARSER_OPTIONS: ParserOptions = {
  apiMode: 1,
  rawFrames: false,
  adcReferenceMv: 1200,
};

const DEFAULT_BUILDER_OPTIONS: BuilderOptions = {
  apiMode: 1,
};

const BUFFER_SIZE = 512;

/**
 * Transform stream: bytes in, {@link IncomingFrame} out. When
 * {@link ParserOptions.rawFrames} is true, emits raw per-frame `Uint8Array`s instead.
 */
export class XBeeParser extends stream.Transform {
  readonly #options: ParserOptions;

  constructor(options: Partial<ParserOptions> = {}) {
    super({ objectMode: true });
    this.#options = { ...DEFAULT_PARSER_OPTIONS, ...options };
  }

  get options(): Readonly<ParserOptions> {
    return this.#options;
  }

  static frameType(buffer: Uint8Array): FrameType | number {
    return buffer[3];
  }

  static canParse(buffer: Uint8Array): boolean {
    const type = XBeeParser.frameType(buffer);
    return type in frameParser;
  }

  static parseFrame(
    rawFrame: Uint8Array,
    options: ParserOptions,
  ): IncomingFrame {
    const reader = new BufferReader(rawFrame.subarray(3, rawFrame.length - 1));

    const frame = {
      type: reader.nextUInt8(),
    };
    if (!(frame.type in frameParser)) {
      throw new UnknownFrameTypeError(frame.type);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (frameParser as any)[frame.type](frame, reader, options);

    return frame as unknown as IncomingFrame;
  }

  readonly #parseState: ParseState = {
    buffer: new Uint8Array(BUFFER_SIZE),
    offset: 0,
    length: 0,
    total: 0,
    checksum: 0x00,
    b: 0x00,
    escapeNext: false,
    waiting: true,
  };

  _transform(
    buffer: Uint8Array,
    encoding: BufferEncoding,
    cb: stream.TransformCallback,
  ): void {
    const S = this.#parseState;
    for (let i = 0; i < buffer.length; i++) {
      S.b = buffer[i];
      if (
        (S.waiting || (this.#options.apiMode === 2 && !S.escapeNext)) &&
        S.b === C.START_BYTE
      ) {
        S.buffer = new Uint8Array(BUFFER_SIZE);
        S.length = 0;
        S.total = 0;
        S.checksum = 0x00;
        S.offset = 0;
        S.escapeNext = false;
        S.waiting = false;
      }

      if (this.#options.apiMode === 2 && S.b === C.ESCAPE) {
        S.escapeNext = true;
        continue;
      }

      if (S.escapeNext) {
        S.b = 0x20 ^ S.b;
        S.escapeNext = false;
      }

      if (!S.waiting) {
        if (S.buffer.length > S.offset) {
          S.buffer[S.offset++] = S.b;
        } else {
          S.waiting = true;
        }
      }

      if (S.offset === 1) continue;

      if (S.offset === 2) {
        S.length = S.b << 8;
        continue;
      }
      if (S.offset === 3) {
        S.length += S.b;
        continue;
      }

      if (S.offset > 3) {
        if (S.offset < S.length + 4) {
          S.total += S.b;
          continue;
        } else {
          S.checksum = S.b;
        }
      }

      if (S.length > 0 && S.offset === S.length + 4) {
        const actualChecksum = 0xff - (S.total % 0x100);
        if (S.checksum !== actualChecksum) {
          this.emit('error', new ChecksumMismatchError(S, actualChecksum));
        }

        const rawFrame = S.buffer.subarray(0, S.offset);
        if (this.#options.rawFrames) {
          this.push(rawFrame);
        } else if (!XBeeParser.canParse(rawFrame)) {
          this.emit(
            'error',
            new UnknownFrameTypeError(XBeeParser.frameType(rawFrame)),
          );
        } else {
          try {
            this.push(XBeeParser.parseFrame(rawFrame, this.#options));
          } catch (err) {
            this.emit('error', err);
          }
        }

        S.waiting = true;
        S.length = 0;
      }
    }
    cb();
  }
}

/**
 * Transform stream: {@link OutgoingFrame} in, encoded byte buffers out.
 */
export class XBeeBuilder extends stream.Transform {
  readonly #options: BuilderOptions;
  readonly #frameBuilder = new FrameBuilder();

  constructor(options: Partial<BuilderOptions> = {}) {
    super({ objectMode: true });
    this.#options = { ...DEFAULT_BUILDER_OPTIONS, ...options };
  }

  get options(): Readonly<BuilderOptions> {
    return this.#options;
  }

  /**
   * Builds the raw bytes of a single frame. If `frame.id` is omitted, a fresh
   * frame id is assigned using the supplied builder's counter.
   */
  static buildFrame(
    frame: OutgoingFrame,
    options: { apiMode: 1 | 2 } = { apiMode: 1 },
    frameBuilder = new FrameBuilder(),
  ): Uint8Array {
    let packet = new Uint8Array(BUFFER_SIZE);
    let payload = packet.subarray(3);
    let builder = new BufferBuilder(payload);

    if (!frameBuilder.has(frame.type)) {
      throw new UnknownFrameTypeError(frame.type);
    }

    frameBuilder.build(frame, builder);

    let checksum = 0;
    for (let i = 0; i < builder.length; i++) checksum += payload[i];
    builder.appendUInt8(255 - (checksum % 256));

    payload = payload.subarray(0, builder.length);

    builder = new BufferBuilder(packet);
    builder.appendUInt8(C.START_BYTE);
    builder.appendUInt16BE(payload.length - 1);

    packet = packet.subarray(0, (builder.length as number) + payload.length);

    return options.apiMode === 2 ? XBeeBuilder.escape(packet) : packet;
  }

  _transform(
    frame: OutgoingFrame,
    encoding: BufferEncoding,
    cb: stream.TransformCallback,
  ): void {
    try {
      const packet = XBeeBuilder.buildFrame(
        frame,
        this.#options,
        this.#frameBuilder,
      );
      this.push(packet);
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  private static escape(buffer: Uint8Array): Uint8Array {
    const escapeBuffer = new Uint8Array(buffer.length * 2);

    let offset = 0;
    escapeBuffer[offset++] = buffer[0];
    for (let i = 1; i < buffer.length; i++) {
      if (C.ESCAPE_BYTES.includes(buffer[i])) {
        escapeBuffer[offset++] = C.ESCAPE;
        escapeBuffer[offset++] = buffer[i] ^ C.ESCAPE_WITH;
      } else {
        escapeBuffer[offset++] = buffer[i];
      }
    }

    return buffer.subarray(0, offset);
  }

  static canBuild(type: FrameType): boolean {
    return new FrameBuilder().has(type);
  }

  /** @internal Used by XBee for automatic frame-id tracking. */
  nextFrameId(): number {
    return this.#frameBuilder.nextFrameId();
  }
}
