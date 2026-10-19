const columns=`o.id,o.project_id,o.customer_id,o.freelancer_id,o.proposal_id,o.invitation_id,o.title_snapshot,o.agreed_price::text AS agreed_price,
  o.initial_deadline_at,o.deadline_at,o.status,o.created_at,o.updated_at,o.completed_at,o.cancelled_at,COALESCE(o.completed_at,o.cancelled_at) AS closed_at,
  (o.deadline_at<clock_timestamp() AND o.status IN ('IN_PROGRESS','SUBMITTED','REVISION_REQUESTED')) AS is_overdue,
  p.status AS project_status,cu.username AS customer_username,cp.first_name AS customer_first_name,cp.last_name AS customer_last_name,
  fu.username AS freelancer_username,fp.first_name AS freelancer_first_name,fp.last_name AS freelancer_last_name`;
const joins=`JOIN workify.projects p ON p.id=o.project_id JOIN workify.users cu ON cu.id=o.customer_id JOIN workify.profiles cp ON cp.user_id=cu.id
  JOIN workify.users fu ON fu.id=o.freelancer_id JOIN workify.profiles fp ON fp.user_id=fu.id`;
const modes={customer:'customer_id',freelancer:'freelancer_id'};
const statuses={active:['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED'],history:['COMPLETED','CANCELLED']};
export function createOrderRepository(database){return {
  async list(actorId,query){
    const values=[actorId,statuses[query.scope]],where=[`o.${modes[query.mode]}=$1`,'o.status=ANY($2::text[])'];
    if(query.status){values.push(query.status);where.push(`o.status=$${values.length}`);}
    values.push(query.pageSize,(query.page-1)*query.pageSize);const limit=`$${values.length-1}`,offset=`$${values.length}`;
    const order=query.scope==='history'?'COALESCE(o.completed_at,o.cancelled_at) DESC,o.id DESC':'o.created_at DESC,o.id DESC';
    const pageOrder=query.scope==='history'?'closed_at DESC,id DESC':'created_at DESC,id DESC';
    return (await database.query(`WITH matches AS (SELECT o.id FROM workify.orders o WHERE ${where.join(' AND ')}),
      page AS (SELECT ${columns} FROM workify.orders o JOIN matches m ON m.id=o.id ${joins} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
      SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY ${pageOrder}) FROM page),'[]'::jsonb) AS items`,values)).rows[0];
  },
  async find(id,actorId){return (await database.query(`SELECT ${columns},o.description_snapshot,o.cancelled_by,o.cancellation_reason,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'originalName',f.original_name,'mimeType',f.mime_type,'sizeBytes',f.size_bytes,'createdAt',f.created_at) ORDER BY f.created_at,f.id)
      FROM workify.order_files ofile JOIN workify.stored_files f ON f.id=ofile.file_id WHERE ofile.order_id=o.id AND f.deleted_at IS NULL),'[]'::jsonb) AS files,
    submission.id AS last_submission_id,submission.version AS last_submission_version,submission.status AS last_submission_status,submission.created_at AS last_submission_created_at,
    deadline.id AS pending_deadline_id,deadline.previous_deadline_at,deadline.proposed_deadline_at,deadline.created_at AS deadline_request_created_at,
    COALESCE(deadline.proposed_deadline_at>clock_timestamp() AND deadline.previous_deadline_at=o.deadline_at,false) AS deadline_request_current
    FROM workify.orders o ${joins}
    LEFT JOIN LATERAL (SELECT id,version,status,created_at FROM workify.order_submissions WHERE order_id=o.id ORDER BY version DESC LIMIT 1) submission ON true
    LEFT JOIN LATERAL (SELECT id,previous_deadline_at,proposed_deadline_at,created_at FROM workify.order_deadline_requests WHERE order_id=o.id AND status='PENDING' LIMIT 1) deadline ON true
    WHERE o.id=$1 AND (o.customer_id=$2 OR o.freelancer_id=$2)`,[id,actorId])).rows[0];},
};}
