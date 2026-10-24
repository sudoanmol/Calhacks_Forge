// Pure scoring of one canary order, kept apart from IO so it can be unit tested.

export const VALUE_STATUSES = ['extracted', 'verified', 'stale', 'mismatch', 'unverifiable', 'corrected'] as const;

export type ValueRow = { status: string; metric: string };

export type Score = {
  values: number;
  byStatus: Record<string, number>;
  failedPages: number;
  verifiedRate: number;
};

export const scoreValues = (rows: ValueRow[]): Score => {
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const verified = byStatus.verified ?? 0;
  return {
    values: rows.length,
    byStatus,
    // Page-level failures are ingested as one unverifiable row with metric "_page".
    failedPages: rows.filter((r) => r.metric === '_page').length,
    verifiedRate: rows.length ? verified / rows.length : 0,
  };
};

export type Verdict = { pass: boolean; reasons: string[] };

export const judge = (finalStatus: string, score: Score, minVerifiedRate: number): Verdict => {
  const reasons: string[] = [];
  if (finalStatus !== 'auditing') reasons.push(`order ended as ${finalStatus}, expected auditing`);
  if (score.values === 0) reasons.push('no values ingested');
  if (score.failedPages > 0) reasons.push(`${score.failedPages} source page(s) unverifiable`);
  if (score.values > 0 && score.verifiedRate < minVerifiedRate) {
    reasons.push(`verified rate ${(score.verifiedRate * 100).toFixed(1)}% is below ${(minVerifiedRate * 100).toFixed(0)}%`);
  }
  return { pass: reasons.length === 0, reasons };
};
