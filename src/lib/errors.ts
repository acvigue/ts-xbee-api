export interface ParseState {
  buffer: Uint8Array;
  offset: number;
  length: number;
  total: number;
  checksum: number;
  b: number;
  escapeNext: boolean;
  waiting: boolean;
}

export class ChecksumMismatchError extends Error {
  readonly name = 'ChecksumMismatchError';
  constructor(
    readonly parseState: ParseState,
    readonly actualChecksum: number,
  ) {
    super(
      `Checksum mismatch: ${actualChecksum.toString(
        16,
      )} != ${parseState.checksum.toString(16)}`,
    );
  }
}

export class UnknownFrameTypeError extends Error {
  readonly name = 'UnknownFrameTypeError';
  constructor(readonly frameType: number) {
    super(
      `Frame parsing/building not supported for frame type 0x${frameType.toString(16)}`,
    );
  }
}

export class XBeeTimeoutError extends Error {
  readonly name = 'XBeeTimeoutError';
  constructor(message = 'XBee operation timed out') {
    super(message);
  }
}
