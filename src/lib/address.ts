import { fromHex, toHex } from './buffer-tools.js';

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

function validateHex(
  hex: string,
  expectedBytes: number,
  label: string,
): string {
  const stripped = stripHexPrefix(hex).toLowerCase();
  if (stripped.length !== expectedBytes * 2) {
    throw new Error(
      `Invalid ${label}: expected ${expectedBytes * 2} hex chars, got ${stripped.length}`,
    );
  }
  if (!/^[0-9a-f]+$/.test(stripped)) {
    throw new Error(`Invalid ${label}: contains non-hex characters`);
  }
  return stripped;
}

/** A 64-bit XBee address (e.g. serial number). */
export class Address64 {
  readonly #hex: string;

  private constructor(hex: string) {
    this.#hex = hex;
  }

  static fromHex(hex: string): Address64 {
    return new Address64(validateHex(hex, 8, '64-bit address'));
  }

  static fromBytes(bytes: Uint8Array): Address64 {
    if (bytes.length !== 8) {
      throw new Error(
        `Invalid 64-bit address: expected 8 bytes, got ${bytes.length}`,
      );
    }
    return new Address64(toHex(bytes));
  }

  /** Hex-string representation (16 lowercase hex chars, no prefix). */
  toString(): string {
    return this.#hex;
  }

  toBytes(): Uint8Array {
    return fromHex(this.#hex);
  }

  equals(other: Address64): boolean {
    return this.#hex === other.#hex;
  }
}

/** A 16-bit XBee network address. */
export class Address16 {
  readonly #hex: string;

  private constructor(hex: string) {
    this.#hex = hex;
  }

  static fromHex(hex: string): Address16 {
    return new Address16(validateHex(hex, 2, '16-bit address'));
  }

  static fromBytes(bytes: Uint8Array): Address16 {
    if (bytes.length !== 2) {
      throw new Error(
        `Invalid 16-bit address: expected 2 bytes, got ${bytes.length}`,
      );
    }
    return new Address16(toHex(bytes));
  }

  static fromNumber(n: number): Address16 {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
      throw new Error(`Invalid 16-bit address: ${n} is out of range`);
    }
    return new Address16(n.toString(16).padStart(4, '0'));
  }

  toString(): string {
    return this.#hex;
  }

  toBytes(): Uint8Array {
    return fromHex(this.#hex);
  }

  toNumber(): number {
    return parseInt(this.#hex, 16);
  }

  equals(other: Address16): boolean {
    return this.#hex === other.#hex;
  }
}

/** Coerces an address-like value to its canonical hex string (internal helper). */
export function addressToHex(addr: Address64 | Address16 | string): string {
  return typeof addr === 'string'
    ? stripHexPrefix(addr).toLowerCase()
    : addr.toString();
}
