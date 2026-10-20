import {createSourceRepository} from './source.repository.js';
import {createOrderRepository} from './order.repository.js';
import {createOrderWorkRepository} from './order-work.repository.js';
import {createComplaintRepository} from './complaint.repository.js';
import {createWarningRepository} from './warning.repository.js';
const userColumns=`u.id,u.email,u.username,u.role,CASE WHEN u.status='BLOCKED' AND (u.blocked_until IS NULL OR u.blocked_until>statement_timestamp()) THEN 'BLOCKED' ELSE 'ACTIVE' END AS status,
  u.blocked_by,u.blocked_at,u.blocked_until,u.block_reason,u.last_unblocked_at,u.created_at,p.first_name,p.last_name,p.headline,p.phone`;
const complaintColumns=`c.id,c.order_id,c.reporter_id,c.target_id,c.status,c.reason,c.assigned_admin_id,c.created_at,c.claimed_at,c.resolved_at,
  o.title_snapshot,o.project_id,ru.username AS reporter_username,tu.username AS target_username`;
const complaintJoins=`JOIN workify.orders o ON o.id=c.order_id JOIN workify.projects p ON p.id=o.project_id JOIN workify.users ru ON ru.id=c.reporter_id JOIN workify.users tu ON tu.id=c.target_id`;
export function createAdminRepository(database){
  async function page(select,from,where,values,query,sort){values.push(query.pageSize,(query.page-1)*query.pageSize);return (await database.query(`WITH matches AS (SELECT ${select} FROM ${from}${where.length?` WHERE ${where.join(' AND ')}`:''}),
    page AS (SELECT * FROM matches ORDER BY ${sort} LIMIT $${values.length-1} OFFSET $${values.length}) SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY ${sort}) FROM page),'[]'::jsonb) AS items`,values)).rows[0];}
  return {
    ...createSourceRepository(database),orders:createOrderRepository(database),work:createOrderWorkRepository(database),complaints:createComplaintRepository(database),warnings:createWarningRepository(database),
    async lockUsers(ids){return (await database.query('SELECT id,role,status,blocked_by,blocked_at,blocked_until,block_reason,last_unblocked_at FROM workify.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[...new Set(ids)]])).rows;},
    async users(query){const values=[],where=[],bind=value=>{values.push(value);return `$${values.length}`;};if(query.search)where.push(`strpos(lower(concat_ws(' ',u.username,u.email,p.first_name,p.last_name)),lower(${bind(query.search)}))>0`);if(query.role)where.push(`u.role=${bind(query.role)}`);if(query.status)where.push(`(CASE WHEN u.status='BLOCKED' AND (u.blocked_until IS NULL OR u.blocked_until>statement_timestamp()) THEN 'BLOCKED' ELSE 'ACTIVE' END)=${bind(query.status)}`);return page(userColumns,'workify.users u JOIN workify.profiles p ON p.user_id=u.id',where,values,query,query.sort==='name'?'lower(last_name),lower(first_name),id':'created_at DESC,id DESC');},
    async user(id){return (await database.query(`SELECT ${userColumns},r.customer_rating,r.freelancer_rating,r.customer_review_count,r.freelancer_review_count FROM workify.users u JOIN workify.profiles p ON p.user_id=u.id LEFT JOIN workify.v_user_ratings r ON r.user_id=u.id WHERE u.id=$1`,[id])).rows[0];},
    async sanctions(id,query){return page(`a.id,a.complaint_id,a.action_type,a.reason,a.created_at,a.expires_at,p.first_name,p.last_name,
      ((a.action_type='WARNING' OR a.created_at>COALESCE(u.last_unblocked_at,'-infinity'::timestamptz)) AND (a.expires_at IS NULL OR a.expires_at>statement_timestamp())) AS current`,
      'workify.moderation_actions a JOIN workify.users u ON u.id=a.target_id JOIN workify.profiles p ON p.user_id=a.admin_id',['a.target_id=$1'],[id],query,'created_at DESC,id DESC');},
    async queue(actorId,query){const values=[],where=[],bind=value=>{values.push(value);return `$${values.length}`;};for(const [key,column] of [['id','c.id'],['status','c.status'],['orderId','c.order_id'],['projectId','o.project_id'],['categoryId','p.category_id'],['assignedAdminId','c.assigned_admin_id']])if(query[key])where.push(`${column}=${bind(query[key])}`);
      for(const [key,column] of [['reporter','ru.username'],['target','tu.username'],['reason','c.reason']])if(query[key])where.push(`strpos(lower(${column}),lower(${bind(query[key])}))>0`);if(query.userId){const arg=bind(query.userId);where.push(`(${arg} IN (c.reporter_id,c.target_id))`);}if(query.assignment==='mine')where.push(`c.assigned_admin_id=${bind(actorId)}`);if(query.assignment==='unassigned')where.push('c.assigned_admin_id IS NULL');if(query.createdFrom)where.push(`c.created_at>=${bind(query.createdFrom)}`);if(query.createdTo)where.push(`c.created_at<=${bind(query.createdTo)}`);return page(complaintColumns,`workify.complaints c ${complaintJoins}`,where,values,query,'created_at,id');},
    async complaint(id,lock=false){return (await database.query(`SELECT c.*,o.project_id FROM workify.complaints c JOIN workify.orders o ON o.id=c.order_id WHERE c.id=$1${lock?' FOR UPDATE OF c':''}`,[id])).rows[0];},
    async project(id){return (await database.query(`SELECT p.id,p.title,p.description,p.status,p.category_id,p.budget::text AS budget,p.desired_deadline_at,c.name AS category_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'originalName',f.original_name,'sizeBytes',f.size_bytes) ORDER BY f.id) FROM workify.project_files pf JOIN workify.stored_files f ON f.id=pf.file_id AND f.deleted_at IS NULL WHERE pf.project_id=p.id),'[]'::jsonb) AS files
      FROM workify.projects p LEFT JOIN workify.categories c ON c.id=p.category_id WHERE p.id=$1`,[id])).rows[0];},
    async source(order){const table=order.proposal_id?'proposals':'project_invitations',id=order.proposal_id??order.invitation_id;return (await database.query(`SELECT id,message,offered_price::text AS price,offered_deadline_at,status,created_at,decided_at FROM workify.${table} WHERE id=$1`,[id])).rows[0];},
    async reviews(id,query){return page('r.id,r.author_id,r.recipient_id,r.rating,r.text,r.deleted_at,r.created_at','workify.reviews r',['r.order_id=$1'],[id],query,'created_at,id');},
    async claim(id,actorId){await database.query("UPDATE workify.complaints SET status='IN_REVIEW',assigned_admin_id=$2,claimed_at=clock_timestamp() WHERE id=$1",[id,actorId]);},
    async finish(id,status,note){await database.query('UPDATE workify.complaints SET status=$2,resolution_note=$3,resolved_at=clock_timestamp() WHERE id=$1',[id,status,note]);},
    async action(actorId,targetId,type,reason,expiresAt,complaintId=null){return (await database.query('INSERT INTO workify.moderation_actions(admin_id,target_id,action_type,reason,expires_at,complaint_id,created_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING id',[actorId,targetId,type,reason,expiresAt,complaintId])).rows[0].id;},
    async block(target,actorId,reason,expiresAt){await database.query("UPDATE workify.users SET status='BLOCKED',blocked_by=$2,blocked_at=clock_timestamp(),blocked_until=$3,block_reason=$4 WHERE id=$1",[target.id,actorId,expiresAt,reason]);},
    async revokeSessions(id){await database.query('UPDATE workify.auth_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',[id]);},
    async unblock(id){await database.query("UPDATE workify.users SET status='ACTIVE',blocked_by=NULL,blocked_at=NULL,blocked_until=NULL,block_reason=NULL,last_unblocked_at=clock_timestamp() WHERE id=$1",[id]);},
    async notify(recipientId,type,message,{complaintId=null,actionId=null}={}){await database.query('INSERT INTO workify.notifications(recipient_id,event_type,message,complaint_id,moderation_action_id) VALUES($1,$2,$3,$4,$5)',[recipientId,type,message,complaintId,actionId]);},
  };
}
