/**
 * Persistenz von Wiedergabesitzungen und ihrem Ereignisprotokoll (Spezifikation 16, 19.4).
 * Gespeichert werden nur Positionsangaben und Ereignisse – nie Anzeigen als „gebucht“.
 */
import type { PlaybackEvent, SessionRecord, SessionStatus } from '../domain/types';
import { guardWrite, type BarqDatabase } from '../adapters/persistence/db';

/** Dienst für Sitzungen und Ereignisse. */
export class SessionService {
  /** @param db - Datenbank. */
  constructor(private readonly db: BarqDatabase) {}

  /**
   * Legt eine Sitzung an oder überschreibt sie.
   * @param session - Sitzungskopf.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async saveSession(session: SessionRecord): Promise<void> {
    await guardWrite(() => this.db.sessions.put({ ...session }));
  }

  /**
   * Setzt den Status einer Sitzung.
   * @param id - Sitzungs-ID.
   * @param status - neuer Status.
   * @returns `false`, wenn die Sitzung nicht existiert.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async setStatus(id: string, status: SessionStatus): Promise<boolean> {
    return guardWrite(async () => (await this.db.sessions.update(id, { status })) === 1);
  }

  /**
   * Hängt Ereignisse an (idempotent über die Ereignis-ID).
   * @param events - Ereignisse der Zustandsmaschine.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async appendEvents(events: readonly PlaybackEvent[]): Promise<void> {
    if (events.length === 0) return;
    await guardWrite(() => this.db.events.bulkPut(events.map((e) => ({ ...e }))));
  }

  /** @returns Sitzungen, neueste zuerst. */
  async listSessions(): Promise<SessionRecord[]> {
    return (await this.db.sessions.toArray()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** @returns Ereignisse einer Sitzung in zeitlicher Reihenfolge (bei Gleichstand nach ID-Länge/ID). */
  async listEvents(sessionId: string): Promise<PlaybackEvent[]> {
    const events = await this.db.events.where('sessionId').equals(sessionId).toArray();
    const seq = (id: string): number => Number(id.slice(id.lastIndexOf('-') + 1)) || 0;
    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || seq(a.id) - seq(b.id));
  }
}
