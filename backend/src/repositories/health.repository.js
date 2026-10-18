export function createHealthRepository(database) {
  return {
    async ping() {
      const result = await database.query('SELECT 1 AS ready');
      return result.rows[0]?.ready === 1;
    },
  };
}
