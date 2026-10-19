import {createSourceRepository} from './source.repository.js';
export function createOrderWorkRepository(database){return {
  ...createSourceRepository(database),
  async context(id){return (await database.query('SELECT id,project_id,customer_id,freelancer_id FROM workify.orders WHERE id=$1',[id])).rows[0];},
  async lockOrder(id){return (await database.query('SELECT id FROM workify.orders WHERE id=$1 FOR UPDATE',[id])).rows[0];},
  async submission(orderId,id){return (await database.query('SELECT * FROM workify.order_submissions WHERE id=$1 AND order_id=$2 FOR UPDATE',[id,orderId])).rows[0];},
  async deadlineRequest(orderId,id){return (await database.query('SELECT * FROM workify.order_deadline_requests WHERE id=$1 AND order_id=$2 FOR UPDATE',[id,orderId])).rows[0];},
  async createSubmission(order,input){return (await database.query(`INSERT INTO workify.order_submissions(order_id,freelancer_id,version,comment,links)
    SELECT $1,$2,COALESCE(max(version),0)+1,$3,$4 FROM workify.order_submissions WHERE order_id=$1 RETURNING *`,[order.id,order.freelancer_id,input.comment,input.links])).rows[0];},
  async attachFiles(id,ids){if(ids.length)await database.query('INSERT INTO workify.submission_files(submission_id,file_id) SELECT $1,unnest($2::uuid[])',[id,ids]);},
  async submitOrder(id){await database.query("UPDATE workify.orders SET status='SUBMITTED' WHERE id=$1",[id]);},
  async reviewSubmission(id,actorId,status,comment){await database.query('UPDATE workify.order_submissions SET status=$3,reviewed_by=$2,reviewed_at=clock_timestamp(),review_comment=$4 WHERE id=$1',[id,actorId,status,comment]);},
  async requestRevision(id){await database.query("UPDATE workify.orders SET status='REVISION_REQUESTED' WHERE id=$1",[id]);},
  async completeOrder(order){await database.query("UPDATE workify.orders SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[order.id]);await database.query("UPDATE workify.projects SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[order.project_id]);},
  async createDeadline(order,input){return (await database.query(`INSERT INTO workify.order_deadline_requests(order_id,freelancer_id,previous_deadline_at,proposed_deadline_at,reason)
    SELECT $1,$2,$3,$4,$5 WHERE $4::timestamptz>clock_timestamp() AND $3::timestamptz<>$4::timestamptz RETURNING *`,[order.id,order.freelancer_id,order.deadline_at,input.proposedDeadlineAt,input.reason])).rows[0];},
  async decideDeadline(id,actorId,status,reason){return (await database.query('UPDATE workify.order_deadline_requests SET status=$3,decided_by=$2,decided_at=clock_timestamp(),decision_reason=$4 WHERE id=$1 RETURNING *',[id,actorId,status,reason])).rows[0];},
  async changeDeadline(orderId,requestId){return (await database.query(`UPDATE workify.orders o SET deadline_at=d.proposed_deadline_at FROM workify.order_deadline_requests d
    WHERE o.id=$1 AND d.id=$2 AND d.order_id=o.id AND d.previous_deadline_at=o.deadline_at AND d.proposed_deadline_at>clock_timestamp() RETURNING o.id`,[orderId,requestId])).rowCount===1;},
  async event(orderId,actorId,type,submissionId,requestId,metadata){await database.query('INSERT INTO workify.order_events(order_id,actor_id,event_type,submission_id,deadline_request_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[orderId,actorId,type,submissionId,requestId,JSON.stringify(metadata)]);},
  async notify(recipientId,type,order,message,metadata){await database.query('INSERT INTO workify.notifications(recipient_id,event_type,project_id,order_id,message,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[recipientId,type,order.project_id,order.id,message,JSON.stringify(metadata)]);},
  async listSubmissions(orderId,query){return (await database.query(`WITH matches AS (SELECT * FROM workify.order_submissions WHERE order_id=$1),page AS (
    SELECT s.id,s.version,s.comment,s.links,s.status,s.reviewed_by AS "reviewedBy",s.reviewed_at AS "reviewedAt",s.review_comment AS "reviewComment",s.created_at AS "createdAt",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'originalName',f.original_name,'mimeType',f.mime_type,'sizeBytes',f.size_bytes,'createdAt',f.created_at) ORDER BY f.created_at,f.id)
      FROM workify.submission_files sf JOIN workify.stored_files f ON f.id=sf.file_id WHERE sf.submission_id=s.id AND f.deleted_at IS NULL),'[]'::jsonb) AS files
    FROM matches s ORDER BY version DESC LIMIT $2 OFFSET $3)
    SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY version DESC) FROM page),'[]'::jsonb) AS items`,[orderId,query.pageSize,(query.page-1)*query.pageSize])).rows[0];},
  async listDeadlines(orderId,query){return (await database.query(`WITH matches AS (SELECT d.*,o.status AS order_status,o.deadline_at FROM workify.order_deadline_requests d JOIN workify.orders o ON o.id=d.order_id WHERE d.order_id=$1),page AS (
    SELECT id,previous_deadline_at AS "previousDeadlineAt",proposed_deadline_at AS "proposedDeadlineAt",reason,status,decided_by AS "decidedBy",decided_at AS "decidedAt",decision_reason AS "decisionReason",created_at AS "createdAt",
    (status='PENDING' AND order_status IN ('IN_PROGRESS','REVISION_REQUESTED') AND previous_deadline_at=deadline_at AND proposed_deadline_at>clock_timestamp()) AS "isCurrent"
    FROM matches ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3)
    SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY "createdAt" DESC,id DESC) FROM page),'[]'::jsonb) AS items`,[orderId,query.pageSize,(query.page-1)*query.pageSize])).rows[0];},
};}
