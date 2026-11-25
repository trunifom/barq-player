import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { parseCsv } from '../../src/domain/csv';
import {
  itemsToCsv,
  mapCsvItems,
  parseCatalogCsv,
  parseItemsCsv,
  parseSymbologyName,
  suggestCsvMapping
} from '../../src/domain/csv-items';
import type { BarcodeItem } from '../../src/domain/types';

const dataRows = (text: string) => parseCsv(text).rows.slice(1);

describe('suggestCsvMapping / parseSymbologyName', () => {
  it('erkennt deutsche und englische Kopfzeilen', () => {
    expect(suggestCsvMapping(['Format', 'EAN', 'Anzahl', 'Bezeichnung'])).toEqual({ symbology: 0, value: 1, quantity: 2, label: 3 });
    expect(suggestCsvMapping(['symbology', 'value', 'quantity', 'label'])).toEqual({ symbology: 0, value: 1, quantity: 2, label: 3 });
    expect(suggestCsvMapping(['x', 'y'])).toEqual({});
  });

  it('eine Spalte wird nur einem Feld zugeordnet', () => {
    expect(suggestCsvMapping(['Code', 'Code'])).toEqual({ value: 0 });
  });

  it.each([
    ['EAN13', 'EAN13'], ['EAN-13', 'EAN13'], ['ean 13', 'EAN13'], ['EAN8', 'EAN8'], ['QR', 'QRCode'], ['QR-Code', 'QRCode'],
    ['qrcode', 'QRCode'], ['Code 128', 'Code128'], ['code128', 'Code128'], ['UPC-A', 'UPCA'], ['upc', 'UPCA']
  ])('%s → %s', (text, sym) => {
    expect(parseSymbologyName(text)).toBe(sym);
  });

  it('unbekannt → null', () => {
    expect(parseSymbologyName('DataMatrix')).toBeNull();
    expect(parseSymbologyName('')).toBeNull();
  });
});

describe('mapCsvItems', () => {
  const csv = 'symbology,value,quantity,label\nEAN13,4006381333931,3,Stift\nEAN13,4006381333930,1,falsch\nQR,hello,,\nEAN13,00,0,x\n,5901234123457,2,\n';

  it('trennt gültige und fehlerhafte Zeilen zeilengenau; Fehler erscheinen nie in rows', () => {
    const r = mapCsvItems(dataRows(csv), { symbology: 0, value: 1, quantity: 2, label: 3 }, { defaultSymbology: 'EAN13' });
    expect(r.rows.map((x) => [x.line, x.symbology, x.value, x.quantity, x.label])).toEqual([
      [2, 'EAN13', '4006381333931', 3, 'Stift'],
      [4, 'QRCode', 'hello', 1, undefined],
      [6, 'EAN13', '5901234123457', 2, undefined]
    ]);
    expect(r.errors.map((e) => [e.line, e.code])).toEqual([[3, 'ERR_CHECKSUM_INVALID'], [5, 'ERR_SYNTAX_INVALID']]);
    expect(r.errors[0]?.message).toContain('Zeile 3');
  });

  it('Menge: leer = 1, ungültig/0/zu groß = Fehler', () => {
    const rows = dataRows('v,q\n4006381333931,\n4006381333931,0\n4006381333931,10000\n4006381333931,abc\n4006381333931,9999\n');
    const r = mapCsvItems(rows, { value: 0, quantity: 1 }, { defaultSymbology: 'EAN13' });
    expect(r.rows.map((x) => x.quantity)).toEqual([1, 9999]);
    expect(r.errors).toHaveLength(3);
  });

  it('durch Tabellenprogramm verlorene führende Null: Fehler mit Hinweis, keine Autokorrektur', () => {
    const r = mapCsvItems(dataRows('v\n123456789012\n'), { value: 0 }, { defaultSymbology: 'EAN13' });
    expect(r.rows).toEqual([]);
    expect(r.errors[0]?.message).toContain('führende Nullen');
  });

  it('führende Nullen bleiben bei gültigen Werten erhalten', () => {
    const r = mapCsvItems(dataRows('v\n0000000000000\n'), { value: 0 }, { defaultSymbology: 'EAN13' });
    expect(r.rows[0]?.value).toBe('0000000000000');
  });

  it('macht den Formelschutz rückgängig, QR-Inhalt bleibt exakt', () => {
    const r = mapCsvItems(dataRows("s,v\nQR,'=1+1\nQR,plain\n"), { symbology: 0, value: 1 });
    expect(r.rows.map((x) => x.value)).toEqual(['=1+1', 'plain']);
  });

  it('unbekannte oder fehlende Symbologie je Zeile', () => {
    const r = mapCsvItems(dataRows('s,v\nDataMatrix,1\n,4006381333931\n'), { symbology: 0, value: 1 });
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.message)).toEqual(['Zeile 2: Unbekannte Symbologie „DataMatrix“.', 'Zeile 3: Symbologie fehlt.']);
  });

  it('komplett leere Zeilen werden ignoriert', () => {
    const r = mapCsvItems([{ line: 2, cells: ['', ' '] }], { value: 0 }, { defaultSymbology: 'QRCode' });
    expect(r).toEqual({ rows: [], errors: [] });
  });

  it('Zeilen mit zu wenigen Zellen werden als fehlender Wert gemeldet', () => {
    const r = mapCsvItems([{ line: 2, cells: ['x'] }], { value: 3 }, { defaultSymbology: 'QRCode' });
    expect(r.errors).toHaveLength(1);
  });

  it('strukturelle Fehler werfen', () => {
    expect(() => mapCsvItems([], {}, { defaultSymbology: 'EAN13' })).toThrow(AppError);
    expect(() => mapCsvItems([], { value: 0 })).toThrow(AppError);
  });
});

describe('parseItemsCsv', () => {
  it('Ende-zu-Ende mit Kopfzeilenerkennung und Semikolon', () => {
    const r = parseItemsCsv('Format;Code;Menge\nEAN-13;4006381333931;2\n', {});
    expect(r.delimiter).toBe(';');
    expect(r.mapping).toEqual({ symbology: 0, value: 1, quantity: 2 });
    expect(r.rows).toHaveLength(1);
  });

  it('leere Datei und fehlende Zuordnung werfen', () => {
    expect(() => parseItemsCsv('')).toThrow(AppError);
    expect(() => parseItemsCsv('a,b\n1,2\n')).toThrow(AppError);
  });

  it('manuelle Zuordnung überschreibt die Erkennung', () => {
    const r = parseItemsCsv('x,y\nfoo,4006381333931\n', { mapping: { value: 1 }, defaultSymbology: 'EAN13' });
    expect(r.rows[0]?.value).toBe('4006381333931');
  });
});

describe('itemsToCsv Round-Trip', () => {
  const item = (position: number, symbology: BarcodeItem['symbology'], value: string, extra: Partial<BarcodeItem> = {}): BarcodeItem => ({
    id: `i${position}`, collectionId: 'c', position, symbology, value, quantity: 1, source: 'manual', capturedAt: 't',
    syntaxStatus: 'valid', checksumStatus: 'valid', catalogStatus: 'unchecked', ...extra
  });

  it('exportiert sortiert, nummeriert ab 1 und lässt sich verlustfrei wieder einlesen', () => {
    const items = [
      item(2, 'QRCode', '=HYPERLINK("x")', { quantity: 5, label: 'Formel, "gefährlich"' }),
      item(0, 'EAN13', '0000000000000'),
      item(1, 'Code128', '+12 AB', { label: 'x' })
    ];
    const csv = itemsToCsv(items, 'Lager A');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('collection,position,symbology,value,quantity,label,purpose,note,tags,expiresAt,source,syntaxStatus,checksumStatus,catalogStatus');
    expect(lines[1]?.startsWith('Lager A,1,EAN13,0000000000000,1')).toBe(true);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    const back = parseItemsCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.rows.map((r) => [r.symbology, r.value, r.quantity, r.label])).toEqual([
      ['EAN13', '0000000000000', 1, undefined],
      ['Code128', '+12 AB', 1, 'x'],
      ['QRCode', '=HYPERLINK("x")', 5, 'Formel, "gefährlich"']
    ]);
  });

  it('Sammlungsname mit Formelzeichen wird geschützt', () => {
    expect(itemsToCsv([], '=evil')).toContain("'=evil".slice(0, 0)); // Kopfzeile existiert
    expect(itemsToCsv([item(0, 'QRCode', 'x')], '=evil').split('\r\n')[1]?.startsWith("'=evil,")).toBe(true);
  });
});

describe('parseCatalogCsv', () => {
  const meta = { source: 'artikel.csv', importedAt: '2026-11-24T10:00:00.000Z' };

  it('liest Kennung, Aktiv-Status und Bezeichnung; führende Nullen bleiben', () => {
    const r = parseCatalogCsv('EAN;Aktiv;Bezeichnung\n0012345678905;ja;Stift\n4006381333931;nein;Block\n5901234123457;;Heft\n', meta);
    expect(r.errors).toEqual([]);
    expect(r.products).toEqual([
      { value: '0012345678905', active: true, source: 'artikel.csv', importedAt: meta.importedAt, label: 'Stift' },
      { value: '4006381333931', active: false, source: 'artikel.csv', importedAt: meta.importedAt, label: 'Block' },
      { value: '5901234123457', active: true, source: 'artikel.csv', importedAt: meta.importedAt, label: 'Heft' }
    ]);
  });

  it('ohne Aktiv-Spalte sind alle aktiv', () => {
    expect(parseCatalogCsv('gtin\n1\n2\n', meta).products.every((p) => p.active)).toBe(true);
  });

  it('meldet fehlende Kennung, Duplikate und unbekannten Status zeilengenau', () => {
    const r = parseCatalogCsv('code,aktiv\n1,1\n,1\n1,1\n2,vielleicht\n3,0\n', meta);
    expect(r.products.map((p) => p.value)).toEqual(['1', '3']);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });

  it('strukturelle Fehler werfen', () => {
    expect(() => parseCatalogCsv('', meta)).toThrow(AppError);
    expect(() => parseCatalogCsv('foo,bar\n1,2\n', meta)).toThrow(AppError);
  });
});

describe('Zusatzangaben in CSV (Wort, Nutzen, Satz, Tags, Ablaufdatum)', () => {
  const item = (position: number, symbology: BarcodeItem['symbology'], value: string, extra: Partial<BarcodeItem> = {}): BarcodeItem => ({
    id: `i${position}`,
    collectionId: 'c',
    position,
    symbology,
    value,
    quantity: 1,
    source: 'manual',
    capturedAt: '2026-01-01T00:00:00.000Z',
    syntaxStatus: 'valid',
    checksumStatus: 'valid',
    catalogStatus: 'unchecked',
    ...extra
  });

  it('erkennt deutsche und englische Spaltennamen', () => {
    expect(suggestCsvMapping(['Code', 'Wort', 'Nutzen', 'Satz', 'Tags', 'Ablaufdatum'])).toEqual({ value: 0, label: 1, purpose: 2, note: 3, tags: 4, expiresAt: 5 });
    expect(suggestCsvMapping(['value', 'label', 'purpose', 'note', 'tags', 'expiresAt'])).toEqual({ value: 0, label: 1, purpose: 2, note: 3, tags: 4, expiresAt: 5 });
    expect(suggestCsvMapping(['EAN', 'Gültig bis', 'MHD'])).toEqual({ value: 0, expiresAt: 1 });
  });

  it('liest Zusatzangaben, normalisiert deutsche Daten und zerlegt Tags', () => {
    const r = parseItemsCsv('Code;Wort;Nutzen;Satz;Tags;Ablaufdatum\n4006381333931;Apfel;Test;Ein Satz;"Obst, #Aktion";31.12.2026\n', { defaultSymbology: 'EAN13' });
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ label: 'Apfel', purpose: 'Test', note: 'Ein Satz', tags: ['Obst', 'Aktion'], expiresAt: '2026-12-31' });
  });

  it('meldet ungültiges Datum und zu lange Texte zeilengenau, ohne die Zeile zu übernehmen', () => {
    const long = 'x'.repeat(501);
    const r = parseItemsCsv(`Code,Ablaufdatum,Satz\n4006381333931,2026-02-30,\n5901234123457,2026-12-31,${long}\n9780201379624,2026-12-31,ok\n`, { defaultSymbology: 'EAN13' });
    expect(r.rows.map((x) => x.value)).toEqual(['9780201379624']);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(r.errors[0]?.message).toContain('Ablaufdatum');
    expect(r.errors[1]?.message).toContain('Satz');
  });

  it('Export und Import erhalten alle Angaben; gefährliche Texte werden entschärft und beim Lesen wiederhergestellt', () => {
    const items = [item(0, 'EAN13', '4006381333931', { label: '=cmd()', purpose: '+Nutzen', note: '@Satz, mit Komma', tags: ['a', 'b'], expiresAt: '2026-12-31' })];
    const csv = itemsToCsv(items, 'L');
    expect(csv).not.toMatch(/(^|,)[=+@]/m);
    const back = parseItemsCsv(csv).rows[0];
    expect(back).toMatchObject({ label: '=cmd()', purpose: '+Nutzen', note: '@Satz, mit Komma', tags: ['a', 'b'], expiresAt: '2026-12-31' });
  });
});
