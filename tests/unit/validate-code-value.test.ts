import { describe, expect, it } from 'vitest';
import { parseBulkInput, validateCodeValue } from '../../src/domain/bulk-parser';

describe('validateCodeValue (Einzelwert)', () => {
  it('EAN: normalisiert Darstellungsleerzeichen, meldet Prüfziffernfehler', () => {
    expect(validateCodeValue('4006 3813 33931', 'EAN13')).toMatchObject({ ok: true, value: '4006381333931', checksum: 'valid' });
    expect(validateCodeValue('4006381333930', 'EAN13')).toMatchObject({ ok: false, code: 'ERR_CHECKSUM_INVALID' });
  });

  it('leere und nur-Leerraum-Werte sind ungültig', () => {
    for (const sym of ['EAN13', 'EAN8', 'UPCA', 'Code128', 'QRCode'] as const) {
      expect(validateCodeValue('', sym)).toMatchObject({ ok: false, code: 'ERR_SYNTAX_INVALID' });
      expect(validateCodeValue('  \t ', sym)).toMatchObject({ ok: false });
    }
  });

  it('QR einzeilig (Standard): Zeilenumbrüche sind Steuerzeichen', () => {
    expect(validateCodeValue('a\nb', 'QRCode')).toMatchObject({ ok: false });
    expect(validateCodeValue('a\r\nb', 'QRCode')).toMatchObject({ ok: false });
  });

  it('QR mehrzeilig (Einzelwerte wie vCard/WLAN): LF, CRLF und Tab erlaubt, andere Steuerzeichen nicht', () => {
    const opts = { multiline: true };
    expect(validateCodeValue('a\nb', 'QRCode', opts)).toMatchObject({ ok: true, value: 'a\nb' });
    expect(validateCodeValue('a\r\nb\tc', 'QRCode', opts)).toMatchObject({ ok: true, value: 'a\r\nb\tc' });
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u000bb', 'a\u000cb', 'a\u001bb', 'a\u007fb']) {
      expect(validateCodeValue(bad, 'QRCode', opts), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it('multiline betrifft nur QR; Code 128 und EAN bleiben streng', () => {
    expect(validateCodeValue('A\nB', 'Code128', { multiline: true })).toMatchObject({ ok: false });
    expect(validateCodeValue('4006381333931\n', 'EAN13', { multiline: true })).toMatchObject({ ok: false });
  });

  it('QR-Längengrenze gilt in beiden Modi', () => {
    expect(validateCodeValue('a'.repeat(2001), 'QRCode', { multiline: true })).toMatchObject({ ok: false });
    expect(validateCodeValue('a'.repeat(2000), 'QRCode', { multiline: true })).toMatchObject({ ok: true });
  });

  it('Bulk-Parser bleibt einzeilig (jede Zeile ein Code)', () => {
    const r = parseBulkInput('eins\nzwei', { symbology: 'QRCode' });
    expect(r.entries.map((e) => e.value)).toEqual(['eins', 'zwei']);
  });
});
