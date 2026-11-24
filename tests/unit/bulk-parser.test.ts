import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { MAX_BULK_LINES, MAX_QR_BYTES, parseBulkInput } from '../../src/domain/bulk-parser';

describe('parseBulkInput – EAN-13', () => {
  it('liest gültige Codes, auch mit Darstellungsleerzeichen, und behält Strings', () => {
    const r = parseBulkInput('4006381333931\n5901234123457\n2 063701 028009', { symbology: 'EAN13' });
    expect(r.errors).toEqual([]);
    expect(r.entries.map((e) => e.value)).toEqual(['4006381333931', '5901234123457', '2063701028009']);
    expect(r.entries.every((e) => e.syntaxStatus === 'valid' && e.checksumStatus === 'valid' && e.quantity === 1)).toBe(true);
  });

  it('führende Nullen bleiben erhalten', () => {
    const r = parseBulkInput('0000000000000', { symbology: 'EAN13' });
    expect(r.entries[0]?.value).toBe('0000000000000');
    expect(r.ok).toBe(true);
  });

  it('meldet Prüfziffernfehler zeilengenau mit erwarteter Ziffer und korrigiert nicht', () => {
    const r = parseBulkInput('4006381333931\n4006381333930', { symbology: 'EAN13' });
    expect(r.entries).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    const e = r.errors[0];
    expect(e?.line).toBe(2);
    expect(e?.code).toBe('ERR_CHECKSUM_INVALID');
    expect(e?.message).toContain('Zeile 2');
    expect(e?.message).toContain('erwartet 1');
    expect(e?.raw).toBe('4006381333930');
    expect(r.ok).toBe(false);
  });

  it('meldet falsche Länge und ungültige Zeichen, ohne Format zu raten', () => {
    const r = parseBulkInput('73513537\n400638133393\n40063813339311\n40063813339X1\n4006-3813-33931', { symbology: 'EAN13' });
    expect(r.entries).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.errors.every((e) => e.code === 'ERR_SYNTAX_INVALID')).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('überspringt Leerzeilen, zählt sie und behält echte Zeilennummern', () => {
    const r = parseBulkInput('\n4006381333931\n   \n\t\nabc\n', { symbology: 'EAN13' });
    expect(r.entries[0]?.line).toBe(2);
    expect(r.errors[0]?.line).toBe(5);
    expect(r.skippedEmptyLines).toBe(4); // 1, 3, 4 und die letzte (nach \n)
  });

  it('akzeptiert CRLF, CR und BOM', () => {
    const r = parseBulkInput('﻿4006381333931\r\n5901234123457\r4006381333931', { symbology: 'EAN13' });
    expect(r.errors).toEqual([]);
    expect(r.entries).toHaveLength(3);
  });

  it('leere und nur-leere Eingaben sind nicht ok', () => {
    for (const t of ['', '   ', '\n\n']) {
      const r = parseBulkInput(t, { symbology: 'EAN13' });
      expect(r.entries).toEqual([]);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(false);
    }
  });

  it('Einzel-Element-Liste', () => {
    expect(parseBulkInput('4006381333931', { symbology: 'EAN13' }).ok).toBe(true);
  });
});

describe('parseBulkInput – EAN-8 und UPC-A', () => {
  it('EAN-8', () => {
    const r = parseBulkInput('73513537\n96385074\n73513530', { symbology: 'EAN8' });
    expect(r.entries.map((e) => e.value)).toEqual(['73513537', '96385074']);
    expect(r.errors[0]?.code).toBe('ERR_CHECKSUM_INVALID');
  });

  it('UPC-A', () => {
    const r = parseBulkInput('036000291452', { symbology: 'UPCA' });
    expect(r.entries[0]?.symbology).toBe('UPCA');
  });

  it('13-stelliger Code ist kein EAN-8', () => {
    expect(parseBulkInput('4006381333931', { symbology: 'EAN8' }).errors).toHaveLength(1);
  });
});

describe('parseBulkInput – Code 128', () => {
  it('trimmt Zeilenränder, behält innere Leerzeichen, setzt checksum not-applicable', () => {
    const r = parseBulkInput('  AB 12  \nX-9', { symbology: 'Code128' });
    expect(r.entries.map((e) => e.value)).toEqual(['AB 12', 'X-9']);
    expect(r.entries[0]?.checksumStatus).toBe('not-applicable');
  });

  it('lehnt Nicht-ASCII, Steuerzeichen und zu lange Werte ab', () => {
    const r = parseBulkInput(`Müller\nA\u0001B\n${'x'.repeat(81)}\n${'x'.repeat(80)}`, { symbology: 'Code128' });
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(r.entries).toHaveLength(1);
  });
});

describe('parseBulkInput – QR (Text)', () => {
  it('lässt Inhalte unverändert (kein Trimmen, kein Entfernen von Leerzeichen, Unicode)', () => {
    const r = parseBulkInput(' https://example.org/a b \nÄÖÜ 😀\n4006 3813 33931', { symbology: 'QRCode' });
    expect(r.entries.map((e) => e.value)).toEqual([' https://example.org/a b ', 'ÄÖÜ 😀', '4006 3813 33931']);
    expect(r.entries[0]?.syntaxStatus).toBe('valid');
    expect(r.entries[0]?.checksumStatus).toBe('not-applicable');
  });

  it('lehnt Steuerzeichen ab, erlaubt Tab', () => {
    const r = parseBulkInput('a\tb\na\u0007b\na\u007fb', { symbology: 'QRCode' });
    expect(r.entries.map((e) => e.value)).toEqual(['a\tb']);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('begrenzt auf UTF-8-Bytes, nicht Zeichen', () => {
    const ok = 'a'.repeat(MAX_QR_BYTES);
    const tooLong = 'a'.repeat(MAX_QR_BYTES + 1);
    const multibyte = 'ä'.repeat(MAX_QR_BYTES / 2 + 1); // 2 Bytes je Zeichen
    const r = parseBulkInput([ok, tooLong, multibyte].join('\n'), { symbology: 'QRCode' });
    expect(r.entries).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('URLs und Befehle werden nur als Text behandelt', () => {
    const r = parseBulkInput('javascript:alert(1)\n=cmd|calc', { symbology: 'QRCode' });
    expect(r.entries.map((e) => e.value)).toEqual(['javascript:alert(1)', '=cmd|calc']);
  });
});

describe('Duplikate', () => {
  const text = '4006381333931\n5901234123457\n4006381333931\n4006381333931';

  it('keep (Standard): jede Zeile bleibt eigener Eintrag', () => {
    const r = parseBulkInput(text, { symbology: 'EAN13' });
    expect(r.entries).toHaveLength(4);
  });

  it('merge: gleiche Werte werden zur Menge, erste Fundstelle bleibt', () => {
    const r = parseBulkInput(text, { symbology: 'EAN13', duplicates: 'merge' });
    expect(r.entries.map((e) => [e.value, e.quantity, e.line])).toEqual([
      ['4006381333931', 3, 1],
      ['5901234123457', 1, 2]
    ]);
  });

  it('merge vergleicht normalisierte Werte', () => {
    const r = parseBulkInput('4006381333931\n4006 3813 33931', { symbology: 'EAN13', duplicates: 'merge' });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.quantity).toBe(2);
  });
});

describe('Eingabeschutz', () => {
  it('wirft ERR_BULK_INPUT_INVALID bei zu vielen Zeilen', () => {
    const text = Array.from({ length: MAX_BULK_LINES + 1 }, () => '4006381333931').join('\n');
    expect(() => parseBulkInput(text, { symbology: 'EAN13' })).toThrow(AppError);
    try {
      parseBulkInput(text, { symbology: 'EAN13' });
    } catch (e: unknown) {
      expect((e as AppError).code).toBe('ERR_BULK_INPUT_INVALID');
    }
  });

  it('genau MAX_BULK_LINES Zeilen sind erlaubt', () => {
    const text = Array.from({ length: MAX_BULK_LINES }, () => '4006381333931').join('\n');
    expect(parseBulkInput(text, { symbology: 'EAN13' }).entries).toHaveLength(MAX_BULK_LINES);
  });

  it('wirft bei Nicht-String', () => {
    expect(() => parseBulkInput(42 as unknown as string, { symbology: 'EAN13' })).toThrow(AppError);
    expect(() => parseBulkInput(null as unknown as string, { symbology: 'EAN13' })).toThrow(AppError);
  });

  it('Fehlerzeilen landen nie in den Einträgen (keine stille Autokorrektur)', () => {
    const r = parseBulkInput('4006381333930', { symbology: 'EAN13' });
    expect(r.entries).toHaveLength(0);
    expect(r.errors[0]?.raw).toBe('4006381333930');
  });
});
