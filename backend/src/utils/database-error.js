const postgresCodes = {
  P2002: '23505',
  P2003: '23503',
  P2011: '23502',
  P2000: '22003',
  P2034: '40001',
  P1001: 'ECONNREFUSED',
  P1002: 'ETIMEDOUT',
  P1008: 'ETIMEDOUT',
  P1017: 'ECONNRESET',
};

// приведение ошибок Prisma к кодам, которые уже обрабатывают сервисы и middleware
export function databaseError(error) {
  const code =
    error?.meta?.driverAdapterError?.cause?.originalCode ??
    (error?.code === 'P2010' ? error.meta?.code : undefined) ??
    postgresCodes[error?.code];

  if (!code) {
    return error;
  }

  return Object.assign(new Error('Database operation failed', { cause: error }), { code });
}
