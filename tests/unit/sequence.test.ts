import { describe, expect, it } from 'vitest';
import { AppError, type ErrorCode } from '../../src/domain/errors';
import { isValidGtin } from '../../src/domain/checksum';
import {
  endFromCount,
  generateSequence,
  generateSequenceList,
  parseSequenceTemplate,
  previewSequence,
  validateSequenceDefinition
} from '../../src/domain/sequence';
import type { SequenceDefinition } from '../../src/domain/types';

/** Unabhängige Referenz der Prüfziffer (Spezifikation 6.1). */
function ref13(body12: string): string {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
}

/** Beispiel aus der Aufgabe: 2 063701 028{XX}{C}, Schritt +12. */
function exampleDef(over: Partial<SequenceDefinition> = {}): SequenceDefinition {
  return {
    id: 's1',
    symbology: 'EAN13',
    prefix: '2063701028',
    suffixBeforeCheckDigit: '',
    variableWidth: 2,
    start: '0',
    end: '96',
    step: '12',
    checksumMode: 'gs1-mod10',
    overflow: 'stop',
    ...over
  };
}

function codeOf(fn: () => unknown): ErrorCode {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error('kein Fehler geworfen');
}

describe('Beispiel 2 063701 028{XX}{C} mit Schritt +12', () => {
  it('erzeugt 9 gültige EAN-13 mit unabhängig berechneter Prüfziffer', () => {
    const list = generateSequenceList(exampleDef());
    expect(list).toHaveLength(9);
    const fields = ['00', '12', '24', '36', '48', '60', '72', '84', '96'];
    list.forEach((code, i) => {
      const body = `2063701028${fields[i]}`;
      expect(code).toBe(body + ref13(body));
      expect(code).toHaveLength(13);
      expect(isValidGtin(code, 'EAN13')).toBe(true);
    });
  });

  it('zählt nur das Nutzdatenfeld: die Prüfziffer wird nie hochgezählt', () => {
    const list = generateSequenceList(exampleDef());
    const checks = new Set(list.map((c) => c.slice(-1)));
    expect(checks.size).toBeGreaterThan(1); // variiert abhängig vom Körper
    expect(list.map((c) => c.slice(10, 12))).toEqual(['00', '12', '24', '36', '48', '60', '72', '84', '96']);
  });

  it('Überlauf bei +12 im Zwei-Stellen-Feld: Endwert 100 wird gemeldet und gestoppt', () => {
    const def = exampleDef({ end: '100' });
    expect(codeOf(() => generateSequence(def))).toBe('ERR_SEQUENCE_OVERFLOW');
    expect(previewSequence(def).ok).toBe(false);
  });

  it('Startwert ausserhalb des Feldes ist Überlauf', () => {
    expect(codeOf(() => generateSequence(exampleDef({ start: '100', end: '100' })))).toBe('ERR_SEQUENCE_OVERFLOW');
  });

  it('Template parst zu genau dieser Definition', () => {
    const t = parseSequenceTemplate('2 063701 028{XX}{C}', 'EAN13');
    expect(t).toEqual({ prefix: '2063701028', suffixBeforeCheckDigit: '', variableWidth: 2, checksumMode: 'gs1-mod10' });
    const list = generateSequenceList(exampleDef(t));
    expect(list[0]).toBe('2063701028' + '00' + ref13('206370102800'));
  });
});

describe('Spezifikationsbeispiel fünfstelliges Feld', () => {
  it('Start 289, Schritt 12, Breite 5 → 00289, 00301, 00313, 00325', () => {
    const def = exampleDef({ prefix: '2063701', variableWidth: 5, start: '289', end: '325', step: '12' });
    const list = generateSequenceList(def);
    expect(list.map((c) => c.slice(7, 12))).toEqual(['00289', '00301', '00313', '00325']);
    list.forEach((c) => expect(isValidGtin(c, 'EAN13')).toBe(true));
  });

  it('führende Nullen bleiben als String erhalten', () => {
    const def = exampleDef({ prefix: '2063701', variableWidth: 5, start: '0', end: '24', step: '12' });
    const list = generateSequenceList(def);
    expect(list.map((c) => c.slice(7, 12))).toEqual(['00000', '00012', '00024']);
    expect(list.every((c) => typeof c === 'string')).toBe(true);
  });

  it('Endwert außerhalb des Schrittrasters: Reihe endet auf dem letzten Rasterwert mit Warnung', () => {
    const def = exampleDef({ prefix: '2063701', variableWidth: 5, start: '289', end: '400', step: '12' });
    const list = generateSequenceList(def);
    expect(list.at(-1)?.slice(7, 12)).toBe('00397'); // 289 + 9*12
    const issues = validateSequenceDefinition(def);
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'end')).toBe(true);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });
});

describe('Grenzfälle', () => {
  it('einwertige Folge (start = end)', () => {
    const list = generateSequenceList(exampleDef({ start: '5', end: '5' }));
    expect(list).toHaveLength(1);
    expect(list[0]?.slice(10, 12)).toBe('05');
  });

  it('Schritt größer als Bereich liefert einen Wert samt Warnungen', () => {
    const def = exampleDef({ prefix: '20637010289', variableWidth: 1, start: '0', end: '9', step: '12' });
    expect(generateSequenceList(def)).toHaveLength(1);
    expect(validateSequenceDefinition(def).some((i) => i.severity === 'warning')).toBe(true);
  });

  it('Schritt 1 über das ganze Feld erzeugt 100 Werte, alle gültig', () => {
    const list = generateSequenceList(exampleDef({ end: '99', step: '1' }));
    expect(list).toHaveLength(100);
    expect(new Set(list).size).toBe(100);
    list.forEach((c) => expect(isValidGtin(c, 'EAN13')).toBe(true));
  });

  it('Feld mit 1 Stelle: +12 kann keinen zweiten Wert aufnehmen (endFromCount meldet Überlauf)', () => {
    expect(codeOf(() => endFromCount('0', '12', 2, 1))).toBe('ERR_SEQUENCE_OVERFLOW');
    expect(endFromCount('0', '12', 1, 1)).toBe('0');
    expect(endFromCount('0', '12', 9, 2)).toBe('96');
    expect(codeOf(() => endFromCount('0', '12', 10, 2))).toBe('ERR_SEQUENCE_OVERFLOW');
  });

  it('endFromCount prüft Eingaben', () => {
    expect(codeOf(() => endFromCount('x', '1', 1, 2))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => endFromCount('0', '0', 1, 2))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => endFromCount('0', '1', 0, 2))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => endFromCount('0', '1', 1, 0))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });

  it('Präfix + Feld + Suffix muss exakt 12 Stellen ergeben', () => {
    expect(codeOf(() => generateSequence(exampleDef({ prefix: '206370102' })))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => generateSequence(exampleDef({ prefix: '20637010289' })))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    const ok = exampleDef({ prefix: '206370', suffixBeforeCheckDigit: '28', variableWidth: 4, start: '0', end: '24', step: '12' });
    const list = generateSequenceList(ok);
    expect(list[1]?.slice(0, 12)).toBe('206370001228');
  });

  it('ungültige Feldbreiten', () => {
    for (const w of [0, -1, 1.5, 13, Number.NaN]) {
      expect(validateSequenceDefinition(exampleDef({ variableWidth: w })).some((i) => i.field === 'variableWidth')).toBe(true);
    }
  });

  it('ungültige Zahlenfelder (untrusted JSON)', () => {
    for (const bad of ['', '-1', '1.5', 'abc', ' 1', '1e3']) {
      expect(validateSequenceDefinition(exampleDef({ start: bad })).some((i) => i.field === 'start' && i.severity === 'error')).toBe(true);
      expect(validateSequenceDefinition(exampleDef({ end: bad })).some((i) => i.field === 'end' && i.severity === 'error')).toBe(true);
      expect(validateSequenceDefinition(exampleDef({ step: bad })).some((i) => i.field === 'step' && i.severity === 'error')).toBe(true);
    }
    expect(validateSequenceDefinition(exampleDef({ step: '0' })).some((i) => i.field === 'step')).toBe(true);
    expect(codeOf(() => generateSequence(exampleDef({ end: '5', start: '6' })))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });

  it('Nicht-String-Werte aus kaputtem JSON werden abgefangen', () => {
    const broken = { ...exampleDef(), start: 5 as unknown as string, prefix: null as unknown as string };
    expect(() => generateSequence(broken)).toThrow(AppError);
  });

  it('EAN: Präfix/Suffix nur Ziffern', () => {
    expect(validateSequenceDefinition(exampleDef({ prefix: '20637010A8' })).some((i) => i.field === 'prefix')).toBe(true);
    expect(validateSequenceDefinition(exampleDef({ prefix: '2 063701 0', suffixBeforeCheckDigit: '' })).some((i) => i.field === 'prefix')).toBe(true);
  });

  it('EAN braucht gs1-mod10; Überlaufregel nur stop', () => {
    expect(codeOf(() => generateSequence(exampleDef({ checksumMode: 'none' })))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => generateSequence(exampleDef({ overflow: 'wrap' as unknown as 'stop' })))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });

  it('nicht unterstützte Symbologie', () => {
    expect(codeOf(() => generateSequence(exampleDef({ symbology: 'UPCA' as unknown as 'EAN13' })))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });

  it('wirft sofort, nicht erst beim ersten next()', () => {
    expect(() => generateSequence(exampleDef({ end: '100' }))).toThrow(AppError);
  });

  it('Generator ist lazy und liefert Werte bei Bedarf', () => {
    const def = exampleDef({ prefix: '2063701', variableWidth: 5, start: '0', end: '99999', step: '1', maxItems: 100_000 });
    const it = generateSequence(def);
    expect(it.next().value).toBe('2063701' + '00000' + ref13('206370100000'));
    expect(it.next().value).toBe('2063701' + '00001' + ref13('206370100001'));
  });
});

describe('Obergrenzen', () => {
  const big = exampleDef({ prefix: '2063701', variableWidth: 5, start: '0', end: '99999', step: '1' });

  it('Standardgrenze 10000 greift', () => {
    expect(codeOf(() => generateSequence(big))).toBe('ERR_SEQUENCE_LIMIT_EXCEEDED');
    expect(previewSequence(big).ok).toBe(false);
  });

  it('exakt an der Grenze ist erlaubt', () => {
    const def = exampleDef({ prefix: '2063701', variableWidth: 5, start: '0', end: '9999', step: '1' });
    expect(previewSequence(def).count).toBe(10_000);
  });

  it('erhöhtes maxItems bis zur harten Grenze', () => {
    expect(previewSequence({ ...big, maxItems: 100_000 }).count).toBe(100_000);
  });

  it('maxItems außerhalb 1..100000 ist ungültig', () => {
    for (const m of [0, -5, 100_001, 1.5]) {
      expect(validateSequenceDefinition({ ...big, maxItems: m }).some((i) => i.field === 'maxItems')).toBe(true);
    }
  });
});

describe('previewSequence', () => {
  it('zeigt Anzahl sowie erste und letzte Werte', () => {
    const p = previewSequence(exampleDef(), 2);
    expect(p.ok).toBe(true);
    expect(p.count).toBe(9);
    expect(p.first).toEqual(['2063701028' + '00' + ref13('206370102800'), '2063701028' + '12' + ref13('206370102812')]);
    expect(p.last).toEqual(['2063701028' + '84' + ref13('206370102884'), '2063701028' + '96' + ref13('206370102896')]);
  });

  it('begrenzt die Beispielzahl auf die Anzahl der Werte', () => {
    const p = previewSequence(exampleDef({ start: '5', end: '5' }), 5);
    expect(p.first).toHaveLength(1);
    expect(p.last).toHaveLength(1);
  });

  it('liefert bei Fehlern keine Beispiele', () => {
    const p = previewSequence(exampleDef({ end: '100' }));
    expect(p).toMatchObject({ ok: false, count: null, first: [], last: [] });
    expect(p.issues.some((i) => i.code === 'ERR_SEQUENCE_OVERFLOW')).toBe(true);
  });
});

describe('EAN-8, QR und Code 128', () => {
  it('EAN-8: 7 Nutzdatenstellen + Prüfziffer', () => {
    const def: SequenceDefinition = {
      id: 'e8', symbology: 'EAN8', prefix: '123', suffixBeforeCheckDigit: '', variableWidth: 4,
      start: '0', end: '24', step: '12', checksumMode: 'gs1-mod10', overflow: 'stop'
    };
    const list = generateSequenceList(def);
    expect(list).toHaveLength(3);
    list.forEach((c) => {
      expect(c).toHaveLength(8);
      expect(isValidGtin(c, 'EAN8')).toBe(true);
    });
    expect(list[1]?.slice(0, 7)).toBe('1230012');
  });

  it('QR-Text: Präfix + Feld + Suffix ohne Prüfziffer', () => {
    const def: SequenceDefinition = {
      id: 'q', symbology: 'QRCode', prefix: 'LOT A-', suffixBeforeCheckDigit: '-X', variableWidth: 3,
      start: '1', end: '3', step: '1', checksumMode: 'none', overflow: 'stop'
    };
    expect(generateSequenceList(def)).toEqual(['LOT A-001-X', 'LOT A-002-X', 'LOT A-003-X']);
  });

  it('Code 128 analog; Steuerzeichen und gs1-mod10 werden abgelehnt', () => {
    const def: SequenceDefinition = {
      id: 'c', symbology: 'Code128', prefix: 'A', suffixBeforeCheckDigit: '', variableWidth: 2,
      start: '9', end: '10', step: '1', checksumMode: 'none', overflow: 'stop'
    };
    expect(generateSequenceList(def)).toEqual(['A09', 'A10']);
    expect(codeOf(() => generateSequence({ ...def, prefix: 'A\n' }))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => generateSequence({ ...def, suffixBeforeCheckDigit: '\u0000' }))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    expect(codeOf(() => generateSequence({ ...def, checksumMode: 'gs1-mod10' }))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });

  it('Überlauf gilt auch für Nicht-EAN', () => {
    const def: SequenceDefinition = {
      id: 'q', symbology: 'QRCode', prefix: 'P', suffixBeforeCheckDigit: '', variableWidth: 2,
      start: '0', end: '100', step: '1', checksumMode: 'none', overflow: 'stop'
    };
    expect(codeOf(() => generateSequence(def))).toBe('ERR_SEQUENCE_OVERFLOW');
  });

  it('Feldbreite bei Nicht-EAN höchstens 20; Breite 20 mit großen BigInt-Werten', () => {
    const base: SequenceDefinition = {
      id: 'q', symbology: 'QRCode', prefix: '', suffixBeforeCheckDigit: '', variableWidth: 20,
      start: '99999999999999999990', end: '99999999999999999999', step: '3', checksumMode: 'none', overflow: 'stop'
    };
    expect(generateSequenceList(base)).toEqual([
      '99999999999999999990', '99999999999999999993', '99999999999999999996', '99999999999999999999'
    ]);
    expect(validateSequenceDefinition({ ...base, variableWidth: 21 }).some((i) => i.field === 'variableWidth')).toBe(true);
  });
});

describe('parseSequenceTemplate', () => {
  it('akzeptiert optionales {C} und Suffix', () => {
    expect(parseSequenceTemplate('2063701028{XX}', 'EAN13').variableWidth).toBe(2);
    expect(parseSequenceTemplate('206370{XXXX}28{C}', 'EAN13')).toEqual({
      prefix: '206370', suffixBeforeCheckDigit: '28', variableWidth: 4, checksumMode: 'gs1-mod10'
    });
  });

  it('bei QR/Code 128 bleiben Leerzeichen erhalten, kein {C}', () => {
    expect(parseSequenceTemplate('A B-{XXX}', 'QRCode')).toEqual({
      prefix: 'A B-', suffixBeforeCheckDigit: '', variableWidth: 3, checksumMode: 'none'
    });
    expect(codeOf(() => parseSequenceTemplate('A{XX}{C}', 'Code128'))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });

  it('lehnt fehlerhafte Schablonen ab', () => {
    for (const bad of ['', 'abc', '2063{X}{Y}', '{XX}{XX}', '2063{xx}', '{X}{C}x', '20{XX}{C', '{}']) {
      expect(codeOf(() => parseSequenceTemplate(bad, 'EAN13'))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
    }
  });

  it('Template ist nicht selbst gültig: Längenprüfung erfolgt in der Definition', () => {
    const t = parseSequenceTemplate('20{XX}{C}', 'EAN13');
    expect(codeOf(() => generateSequence(exampleDef(t)))).toBe('ERR_SEQUENCE_CONFIG_INVALID');
  });
});
