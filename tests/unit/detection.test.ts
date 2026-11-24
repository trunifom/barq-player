import { describe, expect, it } from 'vitest';
import { DEFAULT_WHITELIST, interpretDetection, symbologyFromDetectorFormat, toDetectorFormats } from '../../src/domain/detection';

describe('Formatzuordnung', () => {
  it('Standard-Whitelist: EAN-13, EAN-8, QR, Code 128 (UPC-A optional)', () => {
    expect([...DEFAULT_WHITELIST]).toEqual(['EAN13', 'EAN8', 'QRCode', 'Code128']);
    expect(Object.isFrozen(DEFAULT_WHITELIST)).toBe(true);
    expect(toDetectorFormats(DEFAULT_WHITELIST)).toEqual(['ean_13', 'ean_8', 'qr_code', 'code_128']);
    expect(toDetectorFormats(['UPCA', 'UPCA', 'QRCode'])).toEqual(['upc_a', 'qr_code']);
  });

  it('symbologyFromDetectorFormat', () => {
    expect(symbologyFromDetectorFormat('ean_13')).toBe('EAN13');
    expect(symbologyFromDetectorFormat('upc_a')).toBe('UPCA');
    expect(symbologyFromDetectorFormat('data_matrix')).toBeNull();
    expect(symbologyFromDetectorFormat('toString')).toBeNull(); // kein Prototyp-Zugriff
    expect(symbologyFromDetectorFormat('')).toBeNull();
  });
});

describe('interpretDetection', () => {
  const wl = DEFAULT_WHITELIST;

  it('akzeptiert gültige Codes unverändert (Format kommt vom Decoder)', () => {
    expect(interpretDetection('ean_13', '4006381333931', wl)).toEqual({ ok: true, symbology: 'EAN13', value: '4006381333931' });
    expect(interpretDetection('ean_13', '0000000000000', wl)).toEqual({ ok: true, symbology: 'EAN13', value: '0000000000000' });
    expect(interpretDetection('ean_8', '73513537', wl)).toEqual({ ok: true, symbology: 'EAN8', value: '73513537' });
    expect(interpretDetection('code_128', 'AB 12', wl)).toEqual({ ok: true, symbology: 'Code128', value: 'AB 12' });
    expect(interpretDetection('qr_code', ' Text mit Rand ', wl)).toEqual({ ok: true, symbology: 'QRCode', value: ' Text mit Rand ' });
  });

  it('EAN-13 mit führender 0 bleibt EAN-13 (keine Umdeutung in UPC-A)', () => {
    expect(interpretDetection('ean_13', '0036000291452', wl)).toMatchObject({ ok: true, symbology: 'EAN13', value: '0036000291452' });
  });

  it('einzige Normalisierung: UPC-A mit 13 Ziffern und führender 0 → 12 Ziffern', () => {
    const upc = [...wl, 'UPCA' as const];
    expect(interpretDetection('upc_a', '0036000291452', upc)).toEqual({ ok: true, symbology: 'UPCA', value: '036000291452' });
    expect(interpretDetection('upc_a', '036000291452', upc)).toEqual({ ok: true, symbology: 'UPCA', value: '036000291452' });
    // 13-stellig ohne führende 0 → keine Normalisierung, Validierung schlägt fehl
    expect(interpretDetection('upc_a', '1036000291452', upc)).toMatchObject({ ok: false, reason: 'invalid-value' });
  });

  it('lehnt nicht freigegebene und unbekannte Formate ab', () => {
    expect(interpretDetection('upc_a', '036000291452', wl)).toMatchObject({ ok: false, reason: 'format-not-allowed' });
    expect(interpretDetection('data_matrix', 'x', wl)).toMatchObject({ ok: false, reason: 'unknown-format' });
    expect(interpretDetection('qr_code', 'x', ['EAN13'])).toMatchObject({ ok: false, reason: 'format-not-allowed' });
  });

  it('lehnt ungültige Werte ab, ohne zu korrigieren', () => {
    expect(interpretDetection('ean_13', '4006381333930', wl)).toMatchObject({ ok: false, reason: 'invalid-value', code: 'ERR_CHECKSUM_INVALID' });
    expect(interpretDetection('ean_13', '123', wl)).toMatchObject({ ok: false, code: 'ERR_SYNTAX_INVALID' });
    expect(interpretDetection('code_128', 'Müller', wl)).toMatchObject({ ok: false, reason: 'invalid-value' });
    expect(interpretDetection('qr_code', '', wl)).toMatchObject({ ok: false, reason: 'invalid-value' });
    expect(interpretDetection('qr_code', 'a\u0007b', wl)).toMatchObject({ ok: false, reason: 'invalid-value' });
  });

  it('mehrzeilige QR-Texte (vCard/WLAN) sind erlaubt, URLs und Befehle bleiben Text', () => {
    expect(interpretDetection('qr_code', 'BEGIN:VCARD\r\nFN:Max\nEND:VCARD', wl)).toMatchObject({ ok: true, value: 'BEGIN:VCARD\r\nFN:Max\nEND:VCARD' });
    expect(interpretDetection('qr_code', 'javascript:alert(1)', wl)).toMatchObject({ ok: true, value: 'javascript:alert(1)' });
  });
});
