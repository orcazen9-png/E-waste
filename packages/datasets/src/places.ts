import type { PlaceRef } from '@ewaste/shared';

/**
 * Field footprint for the seed dataset: the Maharashtra districts where the
 * pilot is scoped, plus Delhi and Bengaluru so the national rollup is not a
 * single-state average. Coordinates are district centroids.
 */
export interface District {
  district: string;
  state: string;
  lat: number;
  lon: number;
  /** Multiplier on national reference prices - proximity to processing capacity. */
  priceFactor: number;
  /** Rough share of seeded activity. */
  weight: number;
  localities: string[];
}

export const DISTRICTS: District[] = [
  {
    district: 'Pune',
    state: 'Maharashtra',
    lat: 18.5204,
    lon: 73.8567,
    priceFactor: 1.0,
    weight: 0.3,
    localities: ['Bhosari', 'Kothrud', 'Hadapsar', 'Pimpri', 'Katraj', 'Wagholi'],
  },
  {
    district: 'Mumbai Suburban',
    state: 'Maharashtra',
    lat: 19.1136,
    lon: 72.8697,
    priceFactor: 1.08,
    weight: 0.2,
    localities: ['Andheri East', 'Kurla', 'Malad', 'Govandi', 'Bhandup'],
  },
  {
    district: 'Thane',
    state: 'Maharashtra',
    lat: 19.2183,
    lon: 72.9781,
    priceFactor: 1.05,
    weight: 0.12,
    localities: ['Wagle Estate', 'Dombivli', 'Bhiwandi', 'Ulhasnagar'],
  },
  {
    district: 'Nashik',
    state: 'Maharashtra',
    lat: 19.9975,
    lon: 73.7898,
    priceFactor: 0.95,
    weight: 0.1,
    localities: ['Satpur', 'Ambad', 'Panchavati'],
  },
  {
    district: 'Nagpur',
    state: 'Maharashtra',
    lat: 21.1458,
    lon: 79.0882,
    priceFactor: 0.92,
    weight: 0.1,
    localities: ['Hingna', 'Kamptee', 'Butibori'],
  },
  {
    district: 'Chhatrapati Sambhajinagar',
    state: 'Maharashtra',
    lat: 19.8762,
    lon: 75.3433,
    priceFactor: 0.9,
    weight: 0.06,
    localities: ['Waluj', 'Chikalthana'],
  },
  {
    district: 'New Delhi',
    state: 'Delhi',
    lat: 28.6139,
    lon: 77.209,
    priceFactor: 1.12,
    weight: 0.07,
    localities: ['Mundka', 'Seelampur', 'Mayapuri'],
  },
  {
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    lat: 12.9716,
    lon: 77.5946,
    priceFactor: 1.06,
    weight: 0.05,
    localities: ['Peenya', 'Bommanahalli', 'Yelahanka'],
  },
];

export function placeIn(district: District, locality: string, jitter = 0): PlaceRef {
  return {
    locality,
    district: district.district,
    state: district.state,
    point: {
      lat: district.lat + jitter,
      lon: district.lon + jitter * 0.9,
    },
  };
}

export const DISTRICT_INDEX = new Map(DISTRICTS.map((d) => [d.district, d]));
