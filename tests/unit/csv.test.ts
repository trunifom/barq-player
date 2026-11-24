import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { MAX_CSV_ROWS, detectDelimiter, parseCsv, protectFormula, serializeCsv, unprotectFormula } from '../../src/domain/csv';

const cells = (text: string): string[][] => parseCsv(text).rows.map((r) => r.cells);

describe('parseCsv', () => {
  it('liest einfache Zeilen, alles bleibt String (führende Nullen!)', () => {
    expect(cells('a,b,c\n0012,0,\n')).toEqual([['a', 'b', 'c'], ['0012', '0', '']]);
  });

  it('akzeptiert CRLF, CR, LF und fehlendes Schlussnewline', () => {
    expect(cells('a,b\r\nc,d\re,f\ng,h')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]);
  });

  it('entfernt BOM', () => {
    expect(cells('﻿a,b')).toEqual([['a', 'b']]);
  });

  it('Anführungszeichen: Trennzeichen, doppelte Anführungszeichen und Zeilenumbrüche im Feld', () => {
    const r = parseCsv('"a,b","say ""hi""","l1\nl2"\nx,y,z');
    expect(r.rows[0]?.cells).toEqual(['a,b', 'say "hi"', 'l1\nl2']);
    expect(r.rows[1]?.line).toBe(3); // Zeilenumbruch im Feld zählt mit
  });

  it('merkt sich Startzeilen und überspringt Leerzeilen (gezählt)', () => {
    const r = parseCsv('h\n\nx\n\n\ny');
    expect(r.rows.map((x) => [x.line, x.cells[0]])).toEqual([[1, 'h'], [3, 'x'], [6, 'y']]);
    expect(r.skippedBlankLines).toBe(3);
  });

  it('leerer Text ergibt keine Zeilen', () => {
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('\n\n').rows).toEqual([]);
  });

  it('abschließendes Trennzeichen erzeugt leere letzte Zelle; leere quoted Zelle zählt als Inhalt', () => {
    expect(cells('a,b,\n"",x')).toEqual([['a', 'b', ''], ['', 'x']]);
    expect(parseCsv('""\n').rows).toHaveLength(1);
  });

  it('erkennt Semikolon und Tab automatisch', () => {
    expect(parseCsv('a;b;c\n1;2;3').delimiter).toBe(';');
    expect(cells('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
    expect(parseCsv('a,b').delimiter).toBe(',');
    expect(parseCsv('abc').delimiter).toBe(',');
  });

  it('explizites Trennzeichen überschreibt Erkennung', () => {
    expect(parseCsv('a;b,c', ',').rows[0]?.cells).toEqual(['a;b', 'c']);
  });

  it('wirft bei nicht geschlossenem Anführungszeichen mit Zeilennummer', () => {
    expect(() => parseCsv('a,b\n"offen,x\ny')).toThrow(AppError);
    try {
      parseCsv('a,b\n"offen,x\ny');
    } catch (e: unknown) {
      expect((e as AppError).code).toBe('ERR_IMPORT_CSV_INVALID');
      expect((e as AppError).userMessage).toContain('Zeile 2');
    }
  });

  it('wirft bei Zeichen nach schließendem Anführungszeichen und Anführungszeichen mitten im Feld', () => {
    expect(() => parseCsv('"a"b,c')).toThrow(AppError);
    expect(() => parseCsv('a"b,c')).toThrow(AppError);
    expect(() => parseCsv('"a""b""c"x')).toThrow(AppError);
  });

  it('begrenzt die Zeilenzahl', () => {
    const big = 'x\n'.repeat(MAX_CSV_ROWS + 1);
    expect(() => parseCsv(big)).toThrow(AppError);
    expect(parseCsv('x\n'.repeat(MAX_CSV_ROWS)).rows).toHaveLength(MAX_CSV_ROWS);
  });
});

describe('detectDelimiter', () => {
  it('ignoriert Trennzeichen in Anführungszeichen und schaut nur auf die erste Zeile', () => {
    expect(detectDelimiter('"a;b;c",d\n1;2;3;4')).toBe(',');
    expect(detectDelimiter('a;b\n1,2,3,4')).toBe(';');
  });
});

describe('Formelschutz', () => {
  it.each(['=1+1', '+49', '-5', '@SUM(A1)', '\tx', '\rx', "'=x", "''+x"])('schützt %j und stellt es wieder her', (raw) => {
    const p = protectFormula(raw);
    expect(p).toBe(`'${raw}`);
    expect(unprotectFormula(p)).toBe(raw);
  });

  it.each(['abc', '', "'abc", '12', '0012', 'a=b', ' =x'])('lässt %j unverändert', (raw) => {
    expect(protectFormula(raw)).toBe(raw);
    expect(unprotectFormula(raw)).toBe(raw);
  });

  it('Export → Import ist verlustfrei, auch für gefährliche und führende-Null-Werte', () => {
    const values = ['0012', '=cmd|calc', "'=x", '+1', '-2', '@x', 'a,b', 'say "hi"', 'l1\nl2', ' pad ', '', '4006381333931'];
    const text = serializeCsv([values]);
    const back = parseCsv(text).rows[0]?.cells.map(unprotectFormula);
    // leere Einzelzelle am Ende bleibt erhalten, da die Zeile mehrere Zellen hat
    expect(back).toEqual(values);
  });

  it('Export enthält nie eine ungeschützte Formel am Zellanfang', () => {
    const text = serializeCsv([['=1+1', '+1', '-1', '@a']]);
    expect(text).toBe("'=1+1,'+1,'-1,'@a\r\n");
  });
});

describe('serializeCsv', () => {
  it('quotet nur bei Bedarf und endet mit CRLF', () => {
    expect(serializeCsv([['a', 'b,c', 'd"e', 'f\ng', ' x']])).toBe('a,"b,c","d""e","f\ng"," x"\r\n');
  });

  it('unterstützt Semikolon als Trennzeichen', () => {
    expect(serializeCsv([['a', 'b;c', 'd,e']], ';')).toBe('a;"b;c";d,e\r\n');
  });

  it('leere Liste ergibt leeren Text', () => {
    expect(serializeCsv([])).toBe('');
  });
});
