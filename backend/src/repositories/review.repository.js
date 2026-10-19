import {createSourceRepository} from './source.repository.js';
const columns=`r.id,r.order_id,r.author_id,r.recipient_id,r.rating,r.text,r.deleted_at,r.created_at,r.updated_at,o.title_snapshot,o.status AS order_status,o.customer_id,o.freelancer_id,
  ap.first_name AS author_first_name,ap.last_name AS author_last_name,rp.first_name AS recipient_first_name,rp.last_name AS recipient_last_name`;
const joins=`JOIN workify.orders o ON o.id=r.order_id JOIN workify.profiles ap ON ap.user_id=r.author_id JOIN workify.profiles rp ON rp.user_id=r.recipient_id`;
const modes={customer:'customer_id',freelancer:'freelancer_id'};
export function createReviewRepository(database){
  async function list(query,{actorId,userId}={}){
    const isPublic=Boolean(userId),written=!isPublic&&query.direction==='written';
    const values=[userId??actorId,query.pageSize,(query.page-1)*query.pageSize];
    const where=isPublic?`r.recipient_id=$1 AND r.recipient_id=o.${modes[query.mode]} AND EXISTS(SELECT 1 FROM workify.v_public_profiles p WHERE p.user_id=$1)`:`o.${modes[query.mode]}=$1 AND r.${written?'author_id':'recipient_id'}=$1`;
    return (await database.query(`WITH matches AS (SELECT ${columns} FROM workify.reviews r ${joins} WHERE ${where} AND o.status IN ('COMPLETED','CANCELLED') ${written?'':'AND r.deleted_at IS NULL'}),
      page AS (SELECT * FROM matches ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3)
      SELECT (SELECT count(*) FROM matches)::int AS total,(SELECT round(avg(rating) FILTER(WHERE deleted_at IS NULL),2)::text FROM matches) AS rating,
      (SELECT count(*) FROM matches WHERE deleted_at IS NULL)::int AS "visibleCount",
      ${isPublic?'EXISTS(SELECT 1 FROM workify.v_public_profiles p WHERE p.user_id=$1)':'true'} AS available,
      COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items`,values)).rows[0];
  }
  return {
    ...createSourceRepository(database),list,
    async orderContext(id){return (await database.query('SELECT * FROM workify.orders WHERE id=$1',[id])).rows[0];},
    async lockOrder(id){return (await database.query('SELECT * FROM workify.orders WHERE id=$1 FOR UPDATE',[id])).rows[0];},
    async context(id){return (await database.query('SELECT r.id,r.author_id,r.order_id,o.project_id,o.customer_id,o.freelancer_id FROM workify.reviews r JOIN workify.orders o ON o.id=r.order_id WHERE r.id=$1',[id])).rows[0];},
    async lockOwn(orderId,actorId){return (await database.query('SELECT * FROM workify.reviews WHERE order_id=$1 AND author_id=$2 FOR UPDATE',[orderId,actorId])).rows[0];},
    async find(id){return (await database.query(`SELECT ${columns} FROM workify.reviews r ${joins} WHERE r.id=$1`,[id])).rows[0];},
    async forOrder(orderId){return (await database.query(`SELECT ${columns} FROM workify.reviews r ${joins} WHERE r.order_id=$1 ORDER BY r.created_at,r.id`,[orderId])).rows;},
    async create(order,actorId,recipientId,input){return (await database.query(`INSERT INTO workify.reviews(order_id,customer_id,freelancer_id,author_id,recipient_id,rating,text,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,statement_timestamp(),statement_timestamp()) RETURNING id`,[order.id,order.customer_id,order.freelancer_id,actorId,recipientId,input.rating,input.text])).rows[0].id;},
    async update(id,input){await database.query('UPDATE workify.reviews SET rating=$2,text=$3 WHERE id=$1',[id,input.rating,input.text]);},
    async hide(id){await database.query('UPDATE workify.reviews SET deleted_at=clock_timestamp() WHERE id=$1',[id]);},
    async restore(id){await database.query('UPDATE workify.reviews SET deleted_at=NULL WHERE id=$1',[id]);},
  };
}
