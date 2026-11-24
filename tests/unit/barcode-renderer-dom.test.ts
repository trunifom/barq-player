// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderSymbol } from '../../src/adapters/renderer/barcode-renderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('SVG im DOM (jsdom)', () => {
  it('ist wohlgeformtes XML und hat die erwarteten Attribute', () => {
    const s = renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 4 });
    const doc = new DOMParser().parseFromString(s.svg, 'image/svg+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const svg = doc.documentElement;
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('viewBox')).toBe('0 0 113 77');
    expect(svg.getAttribute('width')).toBe('452');
    expect(svg.getAttribute('height')).toBe('308');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('EAN-13 4006381333931');
  });

  it('enthält genau einen weißen Hintergrund und einen schwarzen Pfad', () => {
    const s = renderSymbol({ symbology: 'QRCode', value: 'hello' });
    const doc = new DOMParser().parseFromString(s.svg, 'image/svg+xml');
    const rects = [...doc.getElementsByTagName('rect')];
    const paths = [...doc.getElementsByTagName('path')];
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute('fill')).toBe('#FFFFFF');
    expect(rects[0]?.getAttribute('width')).toBe(String(s.modulesWide));
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill')).toBe('#000000');
  });

  it('lässt sich per innerHTML einfügen; Pfad hat so viele Teilpfade wie Rechtecke', () => {
    const s = renderSymbol({ symbology: 'Code128', value: 'AB 12' });
    const host = document.createElement('div');
    host.innerHTML = s.svg;
    const path = host.querySelector('path');
    expect(path).not.toBeNull();
    expect((path?.getAttribute('d') ?? '').split('M').length - 1).toBe(s.rects.length);
    expect(host.querySelector('svg')?.getAttribute('shape-rendering')).toBe('crispEdges');
  });

  it('Sonderzeichen im aria-label führen nicht zu Markup-Injektion', () => {
    const s = renderSymbol({ symbology: 'QRCode', value: '"><img src=x onerror=alert(1)>' });
    const host = document.createElement('div');
    host.innerHTML = s.svg;
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('QR-Code "><img src=x onerror=alert(1)>');
  });
});
