import { describe, expect, it } from 'vitest';
import {
  appendCheckDigit,
  calculateCheckDigit,
  gs1CheckDigit,
  isValidGtin,
  validateGtin
} from '../../src/domain/checksum';
import { AppError } from '../../src/domain/errors';

/** Unabhängige Referenz laut Spezifikation 6.1: S = d1 + 3*d2 + d3 + … + 3*d12. */
function referenceEan13Check(body12: string): string {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
}

describe('gs1CheckDigit – bekannte Testvektoren', () => {
  it.each([
    ['400638133393', '1'], // EAN-13 4006381333931
    ['590123412345', '7'], // EAN-13 5901234123457
    ['978020137962', '4'], // ISBN-13 9780201379624
    ['7351353', '7'], // EAN-8 73513537
    ['9638507', '4'], // EAN-8 96385074
    ['03600029145', '2'] // UPC-A 036000291452
  ])('Körper %s → Prüfziffer %s', (body, check) => {
    expect(gs1CheckDigit(body)).toBe(check);
  });

  it('Nullkörper ergibt Prüfziffer 0 (führende Nullen bleiben erhalten)', () => {
    expect(gs1CheckDigit('000000000000')).toBe('0');
    expect(appendCheckDigit('000000000000', 'EAN13')).toBe('0000000000000');
  });

  it('stimmt für 2000 deterministische Körper mit der unabhängigen Referenz überein', () => {
    let seed = 123456789;
    for (let n = 0; n < 2000; n++) {
      let body = '';
      for (let i = 0; i < 12; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        body += String(seed % 10);
      }
      expect(gs1CheckDigit(body)).toBe(referenceEan13Check(body));
    }
  });

  it('Beispiel 2 063701 028{XX}{C}: 206370102800 → Referenzwert', () => {
    expect(gs1CheckDigit('206370102800')).toBe(referenceEan13Check('206370102800'));
  });

  it('wirft ERR_SYNTAX_INVALID bei leerem Körper und Nicht-Ziffern', () => {
    for (const bad of ['', 'abc', '12 34', '12-34', '１２３']) {
      expect(() => gs1CheckDigit(bad)).toThrow(AppError);
      try {
        gs1CheckDigit(bad);
      } catch (e: unknown) {
        expect((e as AppError).code).toBe('ERR_SYNTAX_INVALID');
      }
    }
  });
});

describe('calculateCheckDigit / appendCheckDigit', () => {
  it('prüft die Körperlänge je Symbologie', () => {
    expect(calculateCheckDigit('400638133393', 'EAN13')).toBe('1');
    expect(calculateCheckDigit('7351353', 'EAN8')).toBe('7');
    expect(calculateCheckDigit('03600029145', 'UPCA')).toBe('2');
    expect(() => calculateCheckDigit('7351353', 'EAN13')).toThrow(AppError);
    expect(() => calculateCheckDigit('40063813339', 'EAN13')).toThrow(AppError);
    expect(() => calculateCheckDigit('4006381333931', 'EAN13')).toThrow(AppError);
    expect(() => calculateCheckDigit('73513530', 'EAN8')).toThrow(AppError);
  });

  it('appendCheckDigit liefert vollständige Codes', () => {
    expect(appendCheckDigit('400638133393', 'EAN13')).toBe('4006381333931');
    expect(appendCheckDigit('7351353', 'EAN8')).toBe('73513537');
    expect(appendCheckDigit('03600029145', 'UPCA')).toBe('036000291452');
  });
});

describe('validateGtin', () => {
  it('erkennt gültige Codes', () => {
    expect(validateGtin('4006381333931', 'EAN13')).toEqual({ syntax: 'valid', checksum: 'valid' });
    expect(validateGtin('73513537', 'EAN8')).toEqual({ syntax: 'valid', checksum: 'valid' });
    expect(validateGtin('036000291452', 'UPCA')).toEqual({ syntax: 'valid', checksum: 'valid' });
    expect(validateGtin('0000000000000', 'EAN13').checksum).toBe('valid');
  });

  it('meldet falsche Prüfziffer getrennt von der Syntax und nennt die erwartete Ziffer', () => {
    const r = validateGtin('4006381333930', 'EAN13');
    expect(r.syntax).toBe('valid');
    expect(r.checksum).toBe('invalid');
    expect(r.expectedCheckDigit).toBe('1');
    expect(r.errorCode).toBe('ERR_CHECKSUM_INVALID');
    expect(r.reason).toContain('erwartet 1');
  });

  it('meldet falsche Längen als Syntaxfehler (nicht aus Länge geraten)', () => {
    for (const [value, sym] of [
      ['73513537', 'EAN13'],
      ['4006381333931', 'EAN8'],
      ['400638133393', 'EAN13'],
      ['40063813339311', 'EAN13'],
      ['', 'EAN8']
    ] as const) {
      const r = validateGtin(value, sym);
      expect(r.syntax).toBe('invalid');
      expect(r.checksum).toBe('unchecked');
      expect(r.errorCode).toBe('ERR_SYNTAX_INVALID');
    }
  });

  it('meldet ungültige Zeichen (Buchstaben, Leerzeichen, Minus)', () => {
    for (const v of ['400638133393X', '4006 381333931', '-006381333931']) {
      expect(validateGtin(v, 'EAN13').syntax).toBe('invalid');
    }
  });

  it('korrigiert nie still: Eingabe bleibt Eingabe', () => {
    const r = validateGtin('4006381333930', 'EAN13');
    expect(isValidGtin('4006381333930', 'EAN13')).toBe(false);
    expect(r.expectedCheckDigit).not.toBe('0');
  });

  it('isValidGtin Kurzform', () => {
    expect(isValidGtin('4006381333931', 'EAN13')).toBe(true);
    expect(isValidGtin('4006381333932', 'EAN13')).toBe(false);
    expect(isValidGtin('abc', 'EAN8')).toBe(false);
  });
});
