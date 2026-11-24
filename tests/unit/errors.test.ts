import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  ERROR_CATALOG,
  ErrorLogger,
  isAppError,
  sanitizeContext,
  toAppError,
  type ErrorCode
} from '../../src/domain/errors';

describe('AppError', () => {
  it('übernimmt Standardtexte aus dem Katalog', () => {
    const e = new AppError('ERR_CHECKSUM_INVALID');
    expect(e.code).toBe('ERR_CHECKSUM_INVALID');
    expect(e.userMessage).toBe(ERROR_CATALOG.ERR_CHECKSUM_INVALID.userMessage);
    expect(e.recoveryHint).toBe(ERROR_CATALOG.ERR_CHECKSUM_INVALID.recoveryHint);
    expect(e.message).toBe('ERR_CHECKSUM_INVALID');
    expect(e.name).toBe('AppError');
    expect(e).toBeInstanceOf(Error);
  });

  it('erlaubt Überschreiben von Texten und speichert details/cause', () => {
    const cause = new TypeError('boom');
    const e = new AppError('ERR_STORAGE_WRITE_FAILED', {
      details: 'put() failed',
      cause,
      userMessage: 'Eigener Text',
      recoveryHint: 'Eigener Hinweis'
    });
    expect(e.message).toBe('ERR_STORAGE_WRITE_FAILED: put() failed');
    expect(e.details).toBe('put() failed');
    expect(e.cause).toBe(cause);
    expect(e.userMessage).toBe('Eigener Text');
    expect(e.recoveryHint).toBe('Eigener Hinweis');
  });

  it('hat für jeden Code deutsche Meldung und Handlungsempfehlung', () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(code).toMatch(/^ERR_[A-Z_]+$/);
      expect(entry.userMessage.length).toBeGreaterThan(10);
      expect(entry.recoveryHint.length).toBeGreaterThan(10);
    }
  });

  it('enthält alle in der Aufgabe geforderten Codes', () => {
    const required: ErrorCode[] = [
      'ERR_CHECKSUM_INVALID',
      'ERR_SEQUENCE_OVERFLOW',
      'ERR_CAMERA_PERMISSION_DENIED',
      'ERR_WASM_LOAD_FAILED',
      'ERR_STORAGE_WRITE_FAILED',
      'ERR_IMPORT_SCHEMA_INVALID'
    ];
    for (const code of required) expect(ERROR_CATALOG[code]).toBeDefined();
  });
});

describe('isAppError / toAppError', () => {
  it('erkennt AppError per Type Guard', () => {
    expect(isAppError(new AppError('ERR_UNKNOWN'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('x')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('lässt AppError unverändert', () => {
    const e = new AppError('ERR_DECODE_FAILED');
    expect(toAppError(e)).toBe(e);
  });

  it('umhüllt Error mit Ursache und Details', () => {
    const src = new RangeError('zu groß');
    const e = toAppError(src);
    expect(e.code).toBe('ERR_UNKNOWN');
    expect(e.cause).toBe(src);
    expect(e.details).toBe('RangeError: zu groß');
  });

  it('umhüllt Nicht-Errors (String, undefined) und nutzt Fallback-Code', () => {
    expect(toAppError('kaputt', 'ERR_PLAYBACK_FAILED').details).toBe('kaputt');
    expect(toAppError('kaputt', 'ERR_PLAYBACK_FAILED').code).toBe('ERR_PLAYBACK_FAILED');
    expect(toAppError(undefined).details).toBe('undefined');
  });
});

describe('sanitizeContext', () => {
  it('maskiert sensible Schlüssel, lässt andere unberührt', () => {
    const out = sanitizeContext({ value: '4006381333931', Raw: 'x', token: 't', line: 4, ok: true });
    expect(out.value).toBe('[redacted]');
    expect(out.Raw).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.line).toBe(4);
    expect(out.ok).toBe(true);
  });
});

describe('ErrorLogger', () => {
  const fixedNow = (): string => '2026-11-24T10:00:00.000Z';

  it('protokolliert Fehler ohne details und ohne sensible Kontextwerte', () => {
    const logger = new ErrorLogger(10, fixedNow);
    const returned = logger.logError(
      new AppError('ERR_CHECKSUM_INVALID', { details: 'Wert 4006381333930 falsch', cause: new TypeError('t') }),
      { line: 3, value: '4006381333930' }
    );
    expect(returned.code).toBe('ERR_CHECKSUM_INVALID');
    const [entry] = logger.entries;
    expect(entry?.level).toBe('error');
    expect(entry?.code).toBe('ERR_CHECKSUM_INVALID');
    expect(entry?.timestamp).toBe('2026-11-24T10:00:00.000Z');
    expect(JSON.stringify(entry)).not.toContain('4006381333930');
    expect(entry?.context.line).toBe(3);
    expect(entry?.context.causeName).toBe('TypeError');
  });

  it('normalisiert unbekannte Fehlerwerte', () => {
    const logger = new ErrorLogger();
    const e = logger.logError('seltsam');
    expect(e.code).toBe('ERR_UNKNOWN');
    expect(logger.entries[0]?.code).toBe('ERR_UNKNOWN');
    expect(logger.entries[0]?.context.causeName).toBeNull();
  });

  it('hält höchstens `capacity` Einträge (Ringpuffer)', () => {
    const logger = new ErrorLogger(3, fixedNow);
    for (let i = 0; i < 5; i++) logger.log('info', `m${i}`);
    expect(logger.entries.map((x) => x.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('gibt eine Kopie der Einträge zurück', () => {
    const logger = new ErrorLogger();
    logger.log('warn', 'a');
    const copy = logger.entries as unknown[];
    expect(copy).not.toBe(logger.entries);
  });

  it('benachrichtigt Listener und erlaubt Abmelden', () => {
    const logger = new ErrorLogger();
    const spy = vi.fn();
    const off = logger.subscribe(spy);
    logger.log('info', 'eins');
    off();
    logger.log('info', 'zwei');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ein werfender Listener blockiert das Logging nicht und wird markiert', () => {
    const logger = new ErrorLogger(10, fixedNow);
    logger.subscribe(() => {
      throw new SyntaxError('listener kaputt');
    });
    logger.log('info', 'x');
    const messages = logger.entries.map((e) => e.message);
    expect(messages).toContain('x');
    expect(messages).toContain('Log-Listener hat einen Fehler geworfen');
  });

  it('clear leert den Log', () => {
    const logger = new ErrorLogger();
    logger.log('info', 'x');
    logger.clear();
    expect(logger.entries).toHaveLength(0);
  });

  it('lehnt ungültige Kapazität ab', () => {
    expect(() => new ErrorLogger(0)).toThrow(AppError);
    expect(() => new ErrorLogger(1.5)).toThrow(AppError);
  });
});
