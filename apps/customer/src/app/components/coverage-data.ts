export interface CoverageArea {
  id: string;
  name: string;
  zone: string;
  lga: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

export const ZONE_LABELS: Record<string, string> = {
  LAGOS_MAINLAND: 'Lagos Mainland',
  LAGOS_ISLAND: 'Lagos Island',
  IKORODU: 'Ikorodu',
  OTHER: 'Other',
};

export const STATUS_COLORS: Record<string, string> = {
  COVERED: '#16A34A',
  IN_PROGRESS: '#F59E0B',
  PLANNED: '#94A3B8',
};

export const STATUS_LABELS: Record<string, string> = {
  COVERED: 'Fiber covered',
  IN_PROGRESS: 'In progress',
  PLANNED: 'Planned',
};
