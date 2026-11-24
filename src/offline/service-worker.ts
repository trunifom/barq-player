/**
 * Registrierung des Service Workers (vite-plugin-pwa, `registerType: 'prompt'`).
 *
 * Dieses Modul importiert das virtuelle Modul `virtual:pwa-register` und wird deshalb nur vom Einstiegspunkt
 * (`main.ts`) dynamisch geladen – nie von Code, der in Tests läuft. Die Policy entscheidet über jede Aktivierung.
 */
import { registerSW } from 'virtual:pwa-register';
import type { UpdatePolicy } from './update-policy';

/**
 * Registriert den Service Worker und verbindet ihn mit der Update-Policy.
 * - `onOfflineReady`: Precache vollständig → App ist offline nutzbar (inkl. `wasm/zxing_reader.wasm`).
 * - `onNeedRefresh`: neue Version wartet → nur melden, nie automatisch aktivieren.
 * @param policy - Update-Policy.
 */
export function registerServiceWorker(policy: UpdatePolicy): void {
  const updateSW = registerSW({
    immediate: true,
    onOfflineReady: () => policy.markOfflineReady(),
    onNeedRefresh: () => policy.markUpdateAvailable(),
    onRegisterError: (error: unknown) => policy.markError(error)
  });
  // `true` weist den wartenden Worker an, sich zu aktivieren, und lädt die Seite neu – nur über UpdatePolicy.apply() erreichbar.
  policy.setApplier(() => updateSW(true));
}
