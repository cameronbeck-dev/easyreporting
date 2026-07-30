import { describe, it, expect } from 'vitest';
import { getDialect, postgresDialect, sqlServerDialect } from '@/lib/data/sql/dialect';

describe('getDialect', () => {
  it('resolves postgres and sqlserver', () => {
    expect(getDialect('postgres')).toBe(postgresDialect);
    expect(getDialect('sqlserver')).toBe(sqlServerDialect);
  });

  it('fails closed on an unknown driver', () => {
    expect(() => getDialect('oracle')).toThrow('Unsupported SQL driver');
  });
});

describe('sqlServerDialect — identifier quoting', () => {
  it('bare identifier → [name]', () => {
    expect(sqlServerDialect.quoteIdent('revenue')).toBe('[revenue]');
  });

  it('dotted identifier → [table].[column]', () => {
    expect(sqlServerDialect.quoteIdent('orders.revenue')).toBe('[orders].[revenue]');
  });

  it('escapes a literal ] by doubling it', () => {
    expect(sqlServerDialect.quoteIdent('we]rd')).toBe('[we]]rd]');
  });

  it('quoteAlias brackets the whole (possibly dotted) name literally', () => {
    expect(sqlServerDialect.quoteAlias('orders.revenue')).toBe('[orders.revenue]');
  });

  it('placeholder uses @pN', () => {
    expect(sqlServerDialect.placeholder(1)).toBe('@p1');
    expect(sqlServerDialect.placeholder(7)).toBe('@p7');
  });
});

describe('sqlServerDialect — IN lists', () => {
  it('expands to one placeholder per element and binds each scalar', () => {
    const r = sqlServerDialect.inList('[region]', ['North', 'South'], 3, false);
    expect(r.sql).toBe('[region] IN (@p3, @p4)');
    expect(r.values).toEqual(['North', 'South']);
  });

  it('negated → NOT IN', () => {
    const r = sqlServerDialect.inList('[region]', ['North'], 1, true);
    expect(r.sql).toBe('[region] NOT IN (@p1)');
    expect(r.values).toEqual(['North']);
  });
});

describe('sqlServerDialect — contains is case-insensitive', () => {
  it('lowercases both sides', () => {
    expect(sqlServerDialect.containsExpr('[region]', '@p1')).toBe('LOWER([region]) LIKE LOWER(@p1)');
  });
});

describe('sqlServerDialect — date buckets (version-safe, no DATE_TRUNC)', () => {
  const col = '[date]';
  it('day truncates via CAST AS date', () => {
    expect(sqlServerDialect.dateBucketExpr('day', col)).toBe('CAST([date] AS date)');
  });
  it('week truncates to Monday independent of DATEFIRST', () => {
    expect(sqlServerDialect.dateBucketExpr('week', col)).toBe(
      'CAST(DATEADD(WEEK, DATEDIFF(WEEK, 0, [date]), 0) AS date)',
    );
  });
  it('month uses DATEFROMPARTS', () => {
    expect(sqlServerDialect.dateBucketExpr('month', col)).toBe(
      'DATEFROMPARTS(YEAR([date]), MONTH([date]), 1)',
    );
  });
  it('quarter maps to the first month of the quarter', () => {
    expect(sqlServerDialect.dateBucketExpr('quarter', col)).toBe(
      'DATEFROMPARTS(YEAR([date]), (DATEPART(QUARTER, [date]) - 1) * 3 + 1, 1)',
    );
  });
  it('never emits DATE_TRUNC', () => {
    for (const u of ['day', 'week', 'month', 'quarter']) {
      expect(sqlServerDialect.dateBucketExpr(u, col)).not.toContain('DATE_TRUNC');
    }
  });
});

describe('sqlServerDialect — paging & top-N use OFFSET/FETCH', () => {
  it('topN keeps the first N rows of an ordered query', () => {
    expect(sqlServerDialect.topNClause(5)).toBe('OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
  });
  it('paging supplies a stable ORDER BY and OFFSET/FETCH', () => {
    expect(sqlServerDialect.pagingClause('@p1', '@p2')).toBe(
      'ORDER BY (SELECT NULL) OFFSET @p2 ROWS FETCH NEXT @p1 ROWS ONLY',
    );
  });
});

describe('sqlServerDialect — null-safe equality', () => {
  it('expands IS NOT DISTINCT FROM into portable T-SQL', () => {
    expect(sqlServerDialect.nullSafeEq('g.d0', 'r.rk')).toBe(
      '(g.d0 = r.rk OR (g.d0 IS NULL AND r.rk IS NULL))',
    );
  });
});

describe('sqlServerDialect — type mapping', () => {
  it('bit → boolean', () => {
    expect(sqlServerDialect.mapSqlType('bit')).toBe('boolean');
  });
  it('numeric families → number', () => {
    for (const t of ['int', 'bigint', 'smallint', 'tinyint', 'decimal(18,2)', 'numeric', 'money', 'smallmoney', 'float', 'real']) {
      expect(sqlServerDialect.mapSqlType(t)).toBe('number');
    }
  });
  it('date/time families → date', () => {
    for (const t of ['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset']) {
      expect(sqlServerDialect.mapSqlType(t)).toBe('date');
    }
  });
  it('everything else → string', () => {
    for (const t of ['nvarchar(50)', 'varchar', 'char(1)', 'uniqueidentifier', 'text']) {
      expect(sqlServerDialect.mapSqlType(t)).toBe('string');
    }
  });
});

describe('sqlServerDialect — introspection SQL uses @pN and information_schema', () => {
  it('list tables', () => {
    expect(sqlServerDialect.listTablesSql()).toContain('information_schema.tables');
    expect(sqlServerDialect.listTablesSql()).toContain('@p1');
  });
  it('list columns', () => {
    const sql = sqlServerDialect.listColumnsSql();
    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain('@p1');
    expect(sql).toContain('@p2');
  });
  it('default schema is dbo', () => {
    expect(sqlServerDialect.defaultSchema).toBe('dbo');
    expect(postgresDialect.defaultSchema).toBe('public');
  });
});
