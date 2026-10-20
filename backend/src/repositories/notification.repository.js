export function createNotificationRepository(database) {
  return {
    async list(recipientId, {read, page, pageSize}) {
      return (await database.query(`WITH own AS (SELECT * FROM workify.notifications WHERE recipient_id=$1),
        matches AS (SELECT * FROM own WHERE $2::text='all' OR ($2='unread' AND read_at IS NULL) OR ($2='read' AND read_at IS NOT NULL)),
        page AS (SELECT * FROM matches ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4)
        SELECT (SELECT count(*) FROM matches)::int AS total,
          (SELECT count(*) FROM own WHERE read_at IS NULL)::int AS unread_count,
          COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items`,
      [recipientId, read, pageSize, (page-1)*pageSize])).rows[0];
    },
    async unread(recipientId) {
      return Number((await database.query('SELECT count(*) FROM workify.notifications WHERE recipient_id=$1 AND read_at IS NULL',[recipientId])).rows[0].count);
    },
    async markRead(recipientId,id) {
      return (await database.query('UPDATE workify.notifications SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=$1 AND recipient_id=$2 RETURNING id,read_at',[id,recipientId])).rows[0];
    },
    async markAllRead(recipientId) {
      return (await database.query('UPDATE workify.notifications SET read_at=clock_timestamp() WHERE recipient_id=$1 AND read_at IS NULL',[recipientId])).rowCount;
    },
  };
}
