import './ui/styles/main.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main class="container">
      <h1>BarQPlayer</h1>
      <p>Projektgeruest bereit. Siehe <code>docs/Barcode_Lager_App_Dokumentation.md</code> fuer Spezifikation und Architektur.</p>
    </main>
  `;
}
