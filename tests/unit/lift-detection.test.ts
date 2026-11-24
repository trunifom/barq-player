import { describe, expect, it } from 'vitest';
import { DEFAULT_LIFT_OPTIONS, LiftAnalyzer, type MotionSample } from '../../src/domain/lift-detection';

/** Telefon flach auf dem Tisch: Schwerkraft ca. 9,81 m/s² auf z. */
const flat = (t: number, noise = 0): MotionSample => ({ x: noise, y: -noise, z: 9.81 + noise, t });

/** Läuft die Ruhelagen-Messung durch (800 ms, 20 Messwerte) und gibt die Zeit danach zurück. */
function settle(a: LiftAnalyzer, until = 800): number {
  for (let t = 0; t < until; t += 40) expect(a.push(flat(t, 0.02))).toBeNull();
  return until;
}

describe('LiftAnalyzer', () => {
  it('Standardwerte sind konservativ', () => {
    expect(DEFAULT_LIFT_OPTIONS).toEqual({ settleMs: 800, tiltDegrees: 25, deviationMs2: 3, consecutive: 3 });
    expect(Object.isFrozen(DEFAULT_LIFT_OPTIONS)).toBe(true);
  });

  it('löst in Ruhe nie aus, auch nicht bei leichtem Rauschen (lange Beobachtung)', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    for (let i = 0; i < 500; i++, t += 20) expect(a.push(flat(t, (i % 5) * 0.05))).toBeNull();
    expect(a.settled).toBe(true);
  });

  it('während der Ruhelagen-Messung wird nie ausgelöst (auch nicht bei Bewegung)', () => {
    const a = new LiftAnalyzer();
    for (let t = 0; t < 790; t += 40) expect(a.push({ x: 8, y: 0, z: 2, t })).toBeNull();
    expect(a.settled).toBe(false);
  });

  it('Kippen ≥ 25° über mindestens 3 Messwerte → tilt', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    // 40° gekippt, Betrag bleibt 9,81
    const rad = (40 * Math.PI) / 180;
    const tilted = (time: number): MotionSample => ({ x: 9.81 * Math.sin(rad), y: 0, z: 9.81 * Math.cos(rad), t: time });
    expect(a.push(tilted(t))).toBeNull();
    expect(a.push(tilted((t += 20)))).toBeNull();
    expect(a.push(tilted((t += 20)))).toBe('tilt');
  });

  it('kleines Kippen (10°) löst nicht aus', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    const rad = (10 * Math.PI) / 180;
    for (let i = 0; i < 100; i++, t += 20) expect(a.push({ x: 9.81 * Math.sin(rad), y: 0, z: 9.81 * Math.cos(rad), t })).toBeNull();
  });

  it('kräftige Beschleunigung (Betrag +4 m/s²) über 3 Messwerte → shake', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    const hit = (time: number): MotionSample => ({ x: 0, y: 0, z: 13.9, t: time });
    expect(a.push(hit(t))).toBeNull();
    expect(a.push(hit((t += 20)))).toBeNull();
    expect(a.push(hit((t += 20)))).toBe('shake');
  });

  it('einzelne Ausreißer lösen nicht aus; die Serie wird unterbrochen', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    for (let i = 0; i < 50; i++, t += 20) {
      const spike = i % 3 !== 2; // zwei Ausreißer, dann ein normaler Wert
      expect(a.push(spike ? { x: 0, y: 0, z: 14, t } : flat(t))).toBeNull();
    }
  });

  it('löst genau EINMAL aus, danach null bis reset()', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    const hit = (time: number): MotionSample => ({ x: 0, y: 0, z: 14, t: time });
    a.push(hit(t));
    a.push(hit((t += 20)));
    expect(a.push(hit((t += 20)))).toBe('shake');
    expect(a.push(hit((t += 20)))).toBeNull();
    a.reset();
    expect(a.settled).toBe(false);
    t += 100;
    for (let i = 0; i <= 20; i++, t += 40) a.push({ x: 0, y: 0, z: 14, t }); // 800 ms neue Ruhelage (andere Lage ist neue Basis)
    expect(a.settled).toBe(true);
    expect(a.push({ x: 0, y: 0, z: 14, t: t + 20 })).toBeNull();
  });


  it('Schwerelosigkeit/Ausfall (Betrag ≈ 0) wird als starke Veränderung gewertet', () => {
    const a = new LiftAnalyzer();
    let t = settle(a);
    a.push({ x: 0, y: 0, z: 0, t });
    a.push({ x: 0, y: 0, z: 0, t: (t += 20) });
    expect(a.push({ x: 0, y: 0, z: 0, t: (t += 20) })).toBe('tilt');
  });

  it('ignoriert nicht endliche Messwerte', () => {
    const a = new LiftAnalyzer();
    expect(a.push({ x: Number.NaN, y: 0, z: 9.8, t: 0 })).toBeNull();
    expect(a.push({ x: 0, y: 0, z: Infinity, t: 10 })).toBeNull();
    expect(a.push({ x: 0, y: 0, z: 9.8, t: Number.NaN })).toBeNull();
    expect(a.settled).toBe(false);
  });

  it('eigene Schwellen: consecutive=1 löst sofort aus; engere Winkel', () => {
    const a = new LiftAnalyzer({ settleMs: 100, consecutive: 1, tiltDegrees: 5 });
    for (let t = 0; t < 100; t += 20) a.push(flat(t));
    const rad = (10 * Math.PI) / 180;
    expect(a.push({ x: 9.81 * Math.sin(rad), y: 0, z: 9.81 * Math.cos(rad), t: 120 })).toBe('tilt');
  });

  it('die Ruhelage kann eine beliebige Lage sein (z. B. hochkant)', () => {
    const a = new LiftAnalyzer();
    for (let t = 0; t < 800; t += 40) a.push({ x: 0, y: 9.81, z: 0, t });
    for (let t = 800; t < 2000; t += 20) expect(a.push({ x: 0.02, y: 9.8, z: 0, t })).toBeNull();
  });

  it('wenn das erste Messfenster leer bleibt (nur ein später Wert): Ruhelage = erster Wert nach dem Fenster', () => {
    const a = new LiftAnalyzer({ settleMs: 100 });
    expect(a.push(flat(0))).toBeNull(); // Start des Fensters (zählt zur Ruhelage)
    expect(a.push(flat(500))).toBeNull(); // nach dem Fenster: Basis steht, kein Auslöser
    expect(a.settled).toBe(true);
  });
});
