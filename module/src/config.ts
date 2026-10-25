export function validateConfigValue(key: string, value: string): void {
  if (key === 'blocked_domains') {
    let domains: unknown;
    try { domains = JSON.parse(value); } catch { throw new Error('blocked_domains must be a JSON array of domains'); }
    if (!Array.isArray(domains) || !domains.every((d) => typeof d === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(d))) {
      throw new Error('blocked_domains must contain domain names without paths or protocols');
    }
    return;
  }
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number`);
  if (['classify_min_confidence', 'compile_min_verified_rate'].includes(key)) {
    if (n > 1) throw new Error(`${key} must be between 0 and 1`);
  } else if (key.startsWith('price.')) {
    if (n > 1_000_000) throw new Error(`${key} exceeds the price limit`);
  } else {
    if (!Number.isInteger(n) || n > 0xffff_ffff) throw new Error(`${key} must be a whole number within the u32 range`);
    if (key === 'page_cap' && (n < 1 || n > 50)) throw new Error('page_cap must be between 1 and 50');
    if (key === 'compile_max_attempts' && (n < 1 || n > 10)) throw new Error('compile_max_attempts must be between 1 and 10');
    if (key === 'creao_max_concurrency' && n > 20) throw new Error('creao_max_concurrency must be between 0 and 20');
    if (key.startsWith('bonus_rate.') && n > 100) throw new Error(`${key} must be between 0 and 100`);
  }
}
