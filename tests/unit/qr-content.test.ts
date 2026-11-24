import { describe, expect, it } from 'vitest';
import { classifyQrContent } from '../../src/domain/qr-content';

describe('classifyQrContent', () => {
  it.each([
    ['https://example.org/a?b=1', 'url', 'https', false],
    ['HTTP://EXAMPLE.ORG', 'url', 'http', false],
    ['tel:+41791234567', 'url', 'tel', false],
    ['mailto:a@b.ch', 'url', 'mailto', false],
    ['javascript:alert(1)', 'url', 'javascript', true],
    ['  JavaScript:alert(1)', 'url', 'javascript', true],
    ['data:text/html;base64,AAAA', 'url', 'data', true],
    ['file:///etc/passwd', 'url', 'file', true],
    ['vbscript:x', 'url', 'vbscript', true]
  ] as const)('%s → %s (%s, riskant=%s)', (text, kind, scheme, risky) => {
    expect(classifyQrContent(text)).toMatchObject({ kind, scheme, risky });
  });

  it('WLAN, Kontakte und Text', () => {
    expect(classifyQrContent('WIFI:T:WPA;S:Netz;P:geheim;;')).toMatchObject({ kind: 'wifi', risky: false });
    expect(classifyQrContent('BEGIN:VCARD\nFN:Max')).toMatchObject({ kind: 'contact' });
    expect(classifyQrContent('MECARD:N:Max;;')).toMatchObject({ kind: 'contact' });
    expect(classifyQrContent('4006381333931')).toMatchObject({ kind: 'text', risky: false });
    expect(classifyQrContent('')).toMatchObject({ kind: 'text' });
    expect(classifyQrContent('a:b')).toMatchObject({ kind: 'text' }); // Schema braucht mindestens 2 Zeichen
  });

  it('liefert immer einen deutschen Hinweis', () => {
    for (const t of ['https://x.y', 'javascript:1', 'WIFI:S:x;;', 'plain']) {
      expect(classifyQrContent(t).notice.length).toBeGreaterThan(5);
    }
    expect(classifyQrContent('javascript:1').notice).toContain('nie');
  });
});
