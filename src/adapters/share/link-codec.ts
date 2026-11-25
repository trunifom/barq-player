/**
 * Teilen per Link: Der Inhalt einer Sammlung wird komprimiert (gzip, falls der Browser `CompressionStream` kennt) und
 * URL-sicher (Base64URL) im Hash der App-Adresse transportiert: `…/#/collections?import=<Nutzlast>`.
 *
 * Es wird nichts an einen Server gesendet – der Hash-Teil einer URL verlässt den Browser nicht. Beim Öffnen wird der
 * Inhalt vollständig geprüft und erst nach Bestätigung importiert. Die entpackte Größe ist begrenzt, damit kein
 * manipulierter Link den Speicher füllen kann.
 */
import { AppError } from '../../domain/errors';

/** Längste Link-Nutzlast, die noch bequem per Messenger geteilt werden kann. */
export const MAX_LINK_PAYLOAD = 6000;
/** Obergrenze für den entpackten Inhalt eines Links (Bytes). */
export const MAX_DECODED_BYTES = 2 * 1024 * 1024;

const PREFIX_GZIP = 'g.';
const PREFIX_RAW = 'r.';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function brokenLink(cause?: unknown): AppError {
  return new AppError('ERR_IMPORT_SCHEMA_INVALID', {
    details: 'Link-Nutzlast ungültig',
    ...(cause === undefined ? {} : { cause }),
    userMessage: 'Der Link ist beschädigt oder unvollständig (z. B. vom Messenger abgeschnitten). Bitte den Link erneut teilen oder die Datei verwenden.'
  });
}

async function pipeThrough(bytes: Uint8Array, stream: { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }, limit: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Schreibfehler (z. B. beschädigte gzip-Daten) dürfen nie unbehandelt bleiben; sie werden nach dem Lesen gemeldet.
  let writeError: unknown;
  const writing = writer
    .write(bytes)
    .then(() => writer.close())
    .catch((e: unknown) => {
      writeError = e;
    });
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new AppError('ERR_IMPORT_SCHEMA_INVALID', { details: 'Link zu groß', userMessage: 'Der Link enthält zu viele Daten und wird aus Sicherheitsgründen nicht importiert.' });
    }
    chunks.push(value);
  }
  await writing;
  if (writeError !== undefined) throw writeError;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** @returns `true`, wenn der Browser gzip-Kompression kennt. */
export function supportsCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/**
 * Kodiert Text als Link-Nutzlast.
 * @param text - Inhalt (JSON einer geteilten Sammlung).
 * @returns Nutzlast mit Präfix `g.` (gzip) oder `r.` (unkomprimiert).
 */
export async function encodeSharePayload(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (supportsCompression()) {
    const packed = await pipeThrough(bytes, new CompressionStream('gzip') as unknown as { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }, Number.MAX_SAFE_INTEGER);
    return PREFIX_GZIP + toBase64Url(packed);
  }
  return PREFIX_RAW + toBase64Url(bytes);
}

/**
 * Dekodiert eine Link-Nutzlast.
 * @param payload - Nutzlast aus {@link encodeSharePayload}.
 * @returns ursprünglicher Text.
 * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID`, wenn die Nutzlast beschädigt, zu groß oder nicht entpackbar ist.
 */
export async function decodeSharePayload(payload: string): Promise<string> {
  try {
    const gz = payload.startsWith(PREFIX_GZIP);
    if (!gz && !payload.startsWith(PREFIX_RAW)) throw brokenLink();
    const bytes = fromBase64Url(payload.slice(2));
    if (!gz) {
      if (bytes.length > MAX_DECODED_BYTES) throw brokenLink();
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    if (!supportsCompression()) {
      throw new AppError('ERR_IMPORT_SCHEMA_INVALID', { details: 'Kein DecompressionStream', userMessage: 'Dieser Browser kann den komprimierten Link nicht öffnen. Bitte die Datei verwenden oder einen aktuellen Browser nutzen.' });
    }
    const raw = await pipeThrough(bytes, new DecompressionStream('gzip') as unknown as { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }, MAX_DECODED_BYTES);
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch (error: unknown) {
    throw error instanceof AppError ? error : brokenLink(error);
  }
}

/**
 * Baut den Link zur App.
 * @param baseUrl - Adresse der App (ein vorhandener Hash-Teil wird entfernt).
 * @param payload - Nutzlast.
 * @returns vollständiger Link.
 */
export function buildShareLink(baseUrl: string, payload: string): string {
  return `${baseUrl.split('#')[0] ?? baseUrl}#/collections?import=${payload}`;
}
