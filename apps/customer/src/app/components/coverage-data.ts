export interface CoverageArea {
  id: string;
  name: string;
  zone: string;
  lga: string | null;
  status: string;
  technology: string | null;
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
  COVERED: 'Covered',
  IN_PROGRESS: 'In progress',
  PLANNED: 'Planned',
};

export const TECH_LABELS: Record<string, string> = {
  FIBER: 'Fiber',
  RADIO: 'Radio',
};

export const TECH_COLORS: Record<string, string> = {
  FIBER: '#F15925',
  RADIO: '#F59E0B',
};
