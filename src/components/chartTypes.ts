import { Aggregation } from '@/lib/data/types';

export interface ChartConfig {
  id: string;
  title: string;
  type: 'line' | 'area' | 'bar';
  datasetId: string;
  x: string;
  y: string;
  aggregation: Aggregation;
}
