// Regenerates data/sales.csv with several demo companies and plenty of rows for
// full multi-tenant testing. Deterministic (seeded) so the playground is stable.
//   npx tsx scripts/generate-sales.ts
import { writeFileSync } from 'fs';
import { join } from 'path';

// Tiny seeded PRNG (mulberry32) — reproducible data without a dependency.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260606);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// region doubles as a "cost centre" dimension (the NSW-only row-scope example).
const REGIONS = ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia'];
const PRODUCTS = ['Standard Freight', 'Express Freight', 'Refrigerated', 'Bulk Haul', 'Last Mile'];

// tenantId = the company. easyreporting is the platform/owner tenant (MGL).
const TENANTS: { id: string; rows: number }[] = [
  { id: 'easyreporting', rows: 360 },
  { id: 'globex', rows: 300 },
  { id: 'initech', rows: 260 },
  { id: 'umbrella', rows: 220 },
];

function dateInYear(year: number): string {
  const month = between(1, 12);
  const day = between(1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const header = 'date,region,tenantId,product,units_sold,revenue,cost,profit_margin';
const lines: string[] = [header];

for (const tenant of TENANTS) {
  for (let i = 0; i < tenant.rows; i++) {
    const region = pick(REGIONS);
    const product = pick(PRODUCTS);
    const units = between(20, 400);
    const unitPrice = between(18, 95);
    const revenue = units * unitPrice;
    // Cost is 45%–85% of revenue, so margin lands in a believable 0.15–0.55 band.
    const cost = Math.round(revenue * (0.45 + rand() * 0.4));
    const margin = Number(((revenue - cost) / revenue).toFixed(3));
    const date = dateInYear(2024);
    lines.push(`${date},${region},${tenant.id},${product},${units},${revenue},${cost},${margin}`);
  }
}

const out = join(process.cwd(), 'data', 'sales.csv');
writeFileSync(out, lines.join('\n') + '\n');
const total = lines.length - 1;
console.log(`Wrote ${total} rows to ${out}`);
for (const t of TENANTS) console.log(`  ${t.id}: ${t.rows}`);
