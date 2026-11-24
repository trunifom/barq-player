export type Symbology = 'EAN13' | 'EAN8' | 'QRCode' | 'Code128' | 'UPCA';

export type CatalogStatus = 'unchecked' | 'known' | 'unknown' | 'inactive';

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface BarcodeItem {
  id: string;
  collectionId: string;
  position: number;
  symbology: Symbology;
  value: string; // Zwingend als String speichern (fuehrende Nullen erhalten)
  quantity: number;
  source: 'camera' | 'image' | 'manual' | 'import' | 'sequence';
  capturedAt: string;
  catalogStatus: CatalogStatus;
  catalogCheckedAt?: string;
  label?: string;
}
