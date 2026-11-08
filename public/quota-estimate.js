export function resetAfterMs(value) {
  if (!value) return null;
  const units = {h:3600000, m:60000, s:1000, ms:1, 'µs':0.001, 'μs':0.001, ns:0.000001};
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|µs|μs|ns|h|m|s)/g)];
  if (!parts.length || parts.map(part => part[0]).join('') !== value) return null;
  return parts.reduce((total, part) => total + Number(part[1]) * units[part[2]], 0);
}

export function estimateQuota(remaining, limit, reset, snapshotTime, now = Date.now()) {
  const duration = resetAfterMs(reset);
  const capturedAt = Date.parse(snapshotTime);
  const estimated = remaining != null && limit != null && duration !== null && Number.isFinite(capturedAt) && now >= capturedAt + duration;
  return {remaining: estimated ? limit : remaining, estimated};
}
