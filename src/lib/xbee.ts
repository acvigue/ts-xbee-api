import { EventEmitter } from 'node:events';
import * as stream from 'node:stream';

import { Address64, addressToHex } from './address.js';
import { toHex } from './buffer-tools.js';
import { AtCommand, FrameType, ReceiveOption } from './constants.js';
import { XBeeBuilder, XBeeParser } from './codec.js';
import { IncomingFrame, IncomingFrameOf } from './frame-parser.js';

export interface XBeeOptions {
  /** 1 is default, 2 is with escaping (set ATAP=2 on the XBee). */
  apiMode?: 1 | 2;
  /**
   * Reference voltage for ADC conversion, in mV. `null` disables conversion.
   * Defaults to 1200.
   */
  adcReferenceMv?: number | null;
  /** Default timeout in ms when neither `signal` nor `timeoutMs` is passed to a method. */
  defaultTimeoutMs?: number;
}

/** Per-request cancellation / timeout options. */
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Options for {@link XBee.transmit}. */
export interface TransmitOptions {
  /**
   * Transmit options bit-field. Combine protocol-specific flags, e.g.
   * `digimesh.TxOption.DisableAck | digimesh.TxMode.DigiMesh`.
   */
  options?: number;
  /** Max hops a broadcast will traverse. `0` = firmware default (NH). */
  broadcastRadius?: number;
  /** 16-bit destination network address. Defaults to `'fffe'` (unknown). */
  destination16?: string;
}

/** Result of a successful {@link XBee.transmit}. */
export interface TransmitResult {
  /**
   * Coordinator's delivery status for the transmission. `0x00` is success;
   * any other value is a failure code (see {@link DeliveryStatus}).
   */
  deliveryStatus: number;
  /** Application-layer retries the coordinator performed before giving up. */
  transmitRetryCount: number;
  /** Discovery status bit-field (route/address discovery info). */
  discoveryStatus: number;
  /** 16-bit destination network address the coordinator ultimately used. */
  remote16: string;
}

/**
 * A promise-based, AbortSignal-aware interface to an XBee module over a
 * bidirectional byte stream (e.g. a `serialport` or a TCP socket).
 */
export class XBee implements AsyncDisposable, Disposable {
  readonly #serial: stream.Duplex;
  readonly #builder: XBeeBuilder;
  readonly #parser: XBeeParser;
  readonly #emitter = new EventEmitter();
  readonly #defaultTimeoutMs: number;

  #lastModemStatus: IncomingFrameOf<FrameType.ModemStatus> | null = null;

  /**
   * Tail of the outbound ZigbeeTransmitRequest chain. Each call to
   * {@link transmit} awaits this promise before writing, then replaces it
   * with its own "done" promise. The effect is strict FIFO: the next TX
   * Request only hits the wire after the previous TX Status arrives
   * (or times out / aborts), so pacing is adaptive to the coordinator's
   * actual throughput rather than a guessed inter-frame delay.
   */
  #txTail: Promise<void> = Promise.resolve();

  constructor(serial: stream.Duplex, options: XBeeOptions = {}) {
    this.#serial = serial;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.#builder = new XBeeBuilder({ apiMode: options.apiMode });
    this.#builder.pipe(serial);
    this.#parser = new XBeeParser({
      apiMode: options.apiMode,
      adcReferenceMv: options.adcReferenceMv,
    });
    serial.pipe(this.#parser);
    this.#parser.on('data', (frame: IncomingFrame) => {
      if (frame.type === FrameType.ModemStatus) {
        this.#lastModemStatus = frame;
      }
      this.#emitter.emit(String(frame.type), frame);
      this.#emitter.emit('frame', frame);
    });
    this.#emitter.setMaxListeners(Infinity);
  }

  /** Closes the underlying stream. MUST be called when done, or the process may hang. */
  close(): void {
    this.#serial.destroy();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  /**
   * Returns an async iterable of every frame of the given type received after
   * iteration begins. Call `break` or `return` on the loop to unsubscribe.
   */
  frames<FT extends FrameType>(
    frameType: FT,
  ): AsyncIterable<IncomingFrameOf<FT>> {
    return createFrameIterable<IncomingFrameOf<FT>>((push) => {
      const handler = (frame: IncomingFrame) =>
        push(frame as IncomingFrameOf<FT>);
      this.#emitter.on(String(frameType), handler);
      return () => this.#emitter.off(String(frameType), handler);
    });
  }

  /** Async iterable of every incoming frame regardless of type. */
  allFrames(): AsyncIterable<IncomingFrame> {
    return createFrameIterable<IncomingFrame>((push) => {
      this.#emitter.on('frame', push);
      return () => this.#emitter.off('frame', push);
    });
  }

  /**
   * Scans the network for devices. Each discovered device yields an
   * AT_COMMAND_RESPONSE frame containing a nodeIdentification payload.
   * Iteration ends after the configured timeout.
   */
  async *scanNetwork(
    opts: RequestOptions = {},
  ): AsyncGenerator<IncomingFrameOf<FrameType.AtCommandResponse>> {
    await this.setParameter(AtCommand.NT, Uint8Array.from([0x3c]));

    const frameId = this.#builder.nextFrameId();
    const signal = this.#resolveSignal(opts, 60_000);

    const iter = createFrameIterable<
      IncomingFrameOf<FrameType.AtCommandResponse>
    >((push) => {
      const handler = (frame: IncomingFrame) => {
        const specific = frame as IncomingFrameOf<FrameType.AtCommandResponse>;
        if (specific.id === frameId) push(specific);
      };
      this.#emitter.on(String(FrameType.AtCommandResponse), handler);
      return () =>
        this.#emitter.off(String(FrameType.AtCommandResponse), handler);
    }, signal);

    // Eagerly obtain the iterator so the subscription is live before we write.
    const iterator = iter[Symbol.asyncIterator]();

    this.#builder.write({
      type: FrameType.AtCommand,
      id: frameId,
      command: AtCommand.ND,
      commandParameter: new Uint8Array(),
    });

    try {
      while (true) {
        let result: IteratorResult<
          IncomingFrameOf<FrameType.AtCommandResponse>
        >;
        try {
          result = await iterator.next();
        } catch (err) {
          if (isAbortError(err)) return;
          throw err;
        }
        if (result.done) return;
        yield result.value;
      }
    } finally {
      await iterator.return?.();
    }
  }

  /**
   * Enqueues an AT parameter change. The change is applied when `setParameter`
   * is next called or when the AC command is issued.
   */
  async enqueueSetParameter(
    parameter: AtCommand,
    value: Uint8Array,
    opts: RequestOptions = {},
  ): Promise<void> {
    await this.#setParameterInternal(
      FrameType.AtCommandQueueParameterValue,
      parameter,
      value,
      opts,
    );
  }

  async setParameter(
    parameter: AtCommand,
    value: Uint8Array | undefined = undefined,
    opts: RequestOptions = {},
  ): Promise<void> {
    await this.#setParameterInternal(
      FrameType.AtCommand,
      parameter,
      value ?? new Uint8Array(),
      opts,
    );
  }

  /** Reads the raw bytes returned by an AT command. */
  async getParameter(
    parameter: AtCommand,
    opts: RequestOptions = {},
  ): Promise<Uint8Array> {
    const frameId = this.#builder.nextFrameId();
    const responsePromise = this.#awaitAtCommandResponse(frameId, opts);
    this.#builder.write({
      type: FrameType.AtCommand,
      id: frameId,
      command: parameter,
      commandParameter: new Uint8Array(),
    });

    const response = await responsePromise;
    return 'commandData' in response ? response.commandData : new Uint8Array();
  }

  /** The most recently observed modem status, or null if none has been seen. */
  latestModemStatus(): number | null {
    return this.#lastModemStatus?.modemStatus ?? null;
  }

  /** Waits for the next modem status frame. */
  async waitForModemStatus(opts: RequestOptions = {}): Promise<number> {
    const frame = await this.#awaitFrame(
      FrameType.ModemStatus,
      () => true,
      opts,
    );
    return frame.modemStatus;
  }

  /** Returns the current device's 64-bit serial address. */
  async address(opts: RequestOptions = {}): Promise<Address64> {
    const hi = await this.getParameter(AtCommand.SH, opts);
    const lo = await this.getParameter(AtCommand.SL, opts);
    const hiHex = toHex(hi).padStart(8, '0');
    const loHex = toHex(lo).padStart(8, '0');
    return Address64.fromHex(hiHex + loHex);
  }

  /** Runs an AT command on a remote device and awaits the response. */
  async setRemoteParameter(
    remoteAddress: Address64 | string,
    parameter: AtCommand,
    value: Uint8Array,
    opts: RequestOptions = {},
  ): Promise<void> {
    const frameId = this.#builder.nextFrameId();
    const signal = this.#resolveSignal(opts);
    const responsePromise = this.#awaitFrame(
      FrameType.RemoteCommandResponse,
      (f) => f.id === frameId,
      { signal },
    );
    this.#builder.write({
      type: FrameType.RemoteAtCommandRequest,
      id: frameId,
      destination64: addressToHex(remoteAddress),
      command: parameter,
      commandParameter: value,
    });
    await responsePromise;
  }

  /**
   * Sends `data` to the given 64-bit destination and resolves when the
   * coordinator's TX Status frame arrives (matched by frame ID). Rejects
   * on timeout/abort.
   *
   * Concurrent calls are serialized internally: the next TX Request is not
   * written to the stream until the previous call's TX Status has been
   * received (or its wait aborted). This gates pacing on the coordinator's
   * own ack instead of a fixed inter-frame delay.
   *
   * The returned {@link TransmitResult} carries the raw `deliveryStatus`;
   * a non-zero value indicates a coordinator-reported delivery failure.
   * Callers that want to treat failure as an exception should check it.
   */
  transmit(
    data: Uint8Array,
    destination: Address64 | string,
    opts: TransmitOptions & RequestOptions = {},
  ): Promise<TransmitResult> {
    const waitForTurn = this.#txTail;
    let releaseTurn!: () => void;
    this.#txTail = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });

    return (async () => {
      try {
        // Prior rejections shouldn't poison subsequent sends — each TX
        // is independent once the wire is free.
        await waitForTurn.catch(() => undefined);

        const frameId = this.#builder.nextFrameId();
        const statusPromise = this.#awaitFrame(
          FrameType.ZigbeeTransmitStatus,
          (f) => f.id === frameId,
          opts,
        );

        this.#builder.write({
          type: FrameType.ZigbeeTransmitRequest,
          id: frameId,
          destination64: addressToHex(destination),
          destination16: opts.destination16 ?? 'fffe',
          broadcastRadius: opts.broadcastRadius ?? 0,
          options: opts.options ?? 0,
          data,
        });

        const status = await statusPromise;
        return {
          deliveryStatus: status.deliveryStatus,
          transmitRetryCount: status.transmitRetryCount,
          discoveryStatus: status.discoveryStatus,
          remote16: status.remote16,
        };
      } finally {
        releaseTurn();
      }
    })();
  }

  /**
   * Writes a synthetic "packet received" frame to the stream. Useful when
   * emulating an XBee with software, since real XBees generate these frames
   * themselves and hosts never need to produce one.
   */
  emulateReceivedPacket(data: Uint8Array, source: Address64 | string): void {
    this.#builder.write({
      type: FrameType.ZigbeeReceivePacket,
      sender64: addressToHex(source),
      data,
      receiveOptions: new Set([ReceiveOption.PacketAcknowledged]),
    });
  }

  // ------- internal helpers -------

  async #setParameterInternal(
    type: FrameType.AtCommand | FrameType.AtCommandQueueParameterValue,
    parameter: AtCommand,
    value: Uint8Array,
    opts: RequestOptions,
  ): Promise<void> {
    const frameId = this.#builder.nextFrameId();
    const responsePromise = this.#awaitAtCommandResponse(frameId, opts);
    this.#builder.write({
      type,
      id: frameId,
      command: parameter,
      commandParameter: value,
    });
    await responsePromise;
  }

  async #awaitAtCommandResponse(
    frameId: number,
    opts: RequestOptions,
  ): Promise<IncomingFrameOf<FrameType.AtCommandResponse>> {
    return this.#awaitFrame(
      FrameType.AtCommandResponse,
      (f) => f.id === frameId,
      opts,
    );
  }

  #awaitFrame<FT extends FrameType>(
    frameType: FT,
    filter: (f: IncomingFrameOf<FT>) => boolean,
    opts: RequestOptions,
  ): Promise<IncomingFrameOf<FT>> {
    const signal = this.#resolveSignal(opts);
    return new Promise<IncomingFrameOf<FT>>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const handler = (frame: IncomingFrame) => {
        const specific = frame as IncomingFrameOf<FT>;
        if (filter(specific)) {
          cleanup();
          resolve(specific);
        }
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => {
        this.#emitter.off(String(frameType), handler);
        signal.removeEventListener('abort', onAbort);
      };
      this.#emitter.on(String(frameType), handler);
      signal.addEventListener('abort', onAbort);
    });
  }

  #resolveSignal(
    opts: RequestOptions,
    overrideDefaultMs?: number,
  ): AbortSignal {
    const effectiveDefault = overrideDefaultMs ?? this.#defaultTimeoutMs;
    const timeoutMs = opts.timeoutMs ?? effectiveDefault;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;
  }
}

/**
 * Builds an AsyncIterable that subscribes when iteration starts and
 * unsubscribes when it ends. Optionally terminates on abort.
 */
function createFrameIterable<T>(
  subscribe: (push: (value: T) => void) => () => void,
  signal?: AbortSignal,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const queue: T[] = [];
      let waiting: ((result: IteratorResult<T>) => void) | null = null;
      let waitingReject: ((reason: unknown) => void) | null = null;
      let terminated = false;

      const unsubscribe = subscribe((value) => {
        if (terminated) return;
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          waitingReject = null;
          resolve({ value, done: false });
        } else {
          queue.push(value);
        }
      });

      const activeSignal = signal;
      const onAbort = () => {
        if (terminated || !activeSignal) return;
        terminated = true;
        unsubscribe();
        if (waitingReject) {
          const reject = waitingReject;
          waiting = null;
          waitingReject = null;
          reject(activeSignal.reason);
        }
      };

      if (activeSignal) {
        if (activeSignal.aborted) {
          terminated = true;
          unsubscribe();
        } else {
          activeSignal.addEventListener('abort', onAbort);
        }
      }

      return {
        async next(): Promise<IteratorResult<T>> {
          if (terminated && queue.length === 0) {
            return { value: undefined, done: true };
          }
          const head = queue.shift();
          if (head !== undefined) {
            return { value: head, done: false };
          }
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiting = resolve;
            waitingReject = reject;
          });
        },
        async return(): Promise<IteratorResult<T>> {
          terminated = true;
          unsubscribe();
          signal?.removeEventListener('abort', onAbort);
          if (waiting) {
            const w = waiting;
            waiting = null;
            waitingReject = null;
            w({ value: undefined, done: true });
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  );
}
