import {createSourceRepository} from './source.repository.js';
const columns=`c.*,o.title_snapshot,o.status AS order_status,tp.first_name AS target_first_name,tp.last_name AS target_last_name,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'original_name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'sha256',f.sha256,'created_at',f.created_at) ORDER BY cf.created_at,f.id)
  FROM workify.complaint_files cf JOIN workify.stored_files f ON f.id=cf.file_id AND f.deleted_at IS NULL WHERE cf.complaint_id=c.id),'[]'::jsonb) AS files`;
const joins=`JOIN workify.orders o ON o.id=c.order_id JOIN workify.profiles tp ON tp.user_id=c.target_id`;
export function createComplaintRepository(database){return {
  ...createSourceRepository(database),
  async context(id){return (await database.query('SELECT * FROM workify.orders WHERE id=$1',[id])).rows[0];},
  async lockOrder(id){return (await database.query('SELECT * FROM workify.orders WHERE id=$1 FOR UPDATE',[id])).rows[0];},
  async ownForOrder(orderId,actorId){return (await database.query(`SELECT ${columns} FROM workify.complaints c ${joins} WHERE c.order_id=$1 AND c.reporter_id=$2`,[orderId,actorId])).rows[0];},
  async own(id,actorId){return (await database.query(`SELECT ${columns} FROM workify.complaints c ${joins} WHERE c.id=$1 AND c.reporter_id=$2`,[id,actorId])).rows[0];},
  async list(actorId,query){const mode=query.mode==='customer'?'customer_id':'freelancer_id';return (await database.query(`WITH matches AS (SELECT ${columns} FROM workify.complaints c ${joins} WHERE c.reporter_id=$1 AND c.${mode}=$1 AND ($2::text IS NULL OR c.status=$2)),
    page AS (SELECT * FROM matches ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4)
    SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items`,[actorId,query.status??null,query.pageSize,(query.page-1)*query.pageSize])).rows[0];},
  async create(order,actorId,input){const target=actorId===order.customer_id?order.freelancer_id:order.customer_id;return (await database.query(`INSERT INTO workify.complaints(order_id,customer_id,freelancer_id,reporter_id,target_id,reason,description,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,statement_timestamp(),statement_timestamp()) RETURNING id`,[order.id,order.customer_id,order.freelancer_id,actorId,target,input.reason,input.description])).rows[0].id;},
  async attach(id,fileIds){if(fileIds.length)await database.query('INSERT INTO workify.complaint_files(complaint_id,file_id) SELECT $1,unnest($2::uuid[])',[id,fileIds]);},
};}
