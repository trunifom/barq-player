import './ui/styles/main.css';
import { bootstrap } from './app/bootstrap';

const host = document.querySelector<HTMLDivElement>('#app');
if (host) {
  bootstrap(host, { win: window, doc: document });
}
