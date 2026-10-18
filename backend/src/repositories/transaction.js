export async function withTransaction(pool, operation) {
  const client = await pool.connect();
  let started = false;
  let releaseError;
  try {
    await client.query('BEGIN');
    started = true;
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError;
      }
    } else {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
