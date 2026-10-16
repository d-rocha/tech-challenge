// PostgreSQL stores microseconds; .NET can serialize seven fractional digits before persistence.
// Compare the complete record while retaining a validated creation instant at JS millisecond precision.
export function persistedRecord(record) {
  const timestamp = record?.data_cadastro;
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error('Invalid UTC creation timestamp');
  }
  const instant = Date.parse(timestamp);
  if (new Date(instant).toISOString().slice(0, 19) !== timestamp.slice(0, 19)) throw new Error('Invalid UTC creation timestamp');
  return { ...record, data_cadastro: instant };
}
