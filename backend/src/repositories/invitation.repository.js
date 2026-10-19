import {createSourceRepository} from './source.repository.js';
import {sourceColumns,sourceJoins} from './source-projection.js';
const expired='(s.offered_deadline_at<=clock_timestamp() OR s.expires_at<=clock_timestamp())';
const columns=`${sourceColumns},s.expires_at,COALESCE(${expired},false) AS expired`;
const joins=`${sourceJoins} LEFT JOIN workify.orders o ON o.invitation_id=s.id`;
export function createInvitationRepository(database){return {
  ...createSourceRepository(database),
  async candidate(id){return (await database.query('SELECT user_id FROM workify.v_public_profiles WHERE user_id=$1',[id])).rows[0];},
  async availableProjects(customerId,freelancerId){return (await database.query(`SELECT p.id,p.title,p.budget::text AS budget,p.desired_deadline_at FROM workify.projects p
    WHERE p.customer_id=$1 AND p.status='OPEN'
    AND NOT EXISTS(SELECT 1 FROM workify.orders o WHERE o.project_id=p.id AND o.status IN ('IN_PROGRESS','SUBMITTED','REVISION_REQUESTED','COMPLETED'))
    AND NOT EXISTS(SELECT 1 FROM workify.project_invitations i WHERE i.project_id=p.id AND i.freelancer_id=$2 AND i.status='PENDING'
      AND i.offered_deadline_at>clock_timestamp() AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp()))
    ORDER BY p.created_at DESC,p.id DESC LIMIT 100`,[customerId,freelancerId])).rows;},
  async context(id){return (await database.query('SELECT id,project_id,customer_id,freelancer_id FROM workify.project_invitations WHERE id=$1',[id])).rows[0];},
  async lockInvitation(id){return (await database.query(`SELECT *,offered_price::text AS offered_price,
    offered_deadline_at>clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) AS current
    FROM workify.project_invitations WHERE id=$1 FOR UPDATE`,[id])).rows[0];},
  async find(id,actorId){return (await database.query(`SELECT ${columns} FROM workify.project_invitations s ${joins} WHERE s.id=$1 AND (s.customer_id=$2 OR s.freelancer_id=$2)`,[id,actorId])).rows[0];},
  async list(query,{customerId,freelancerId,projectId}){
    const values=[],where=[];const bind=value=>{values.push(value);return `$${values.length}`;};
    if(customerId)where.push(`s.customer_id=${bind(customerId)}`);if(freelancerId)where.push(`s.freelancer_id=${bind(freelancerId)}`);if(projectId)where.push(`s.project_id=${bind(projectId)}`);if(query.status)where.push(`s.status=${bind(query.status)}`);
    const limit=bind(query.pageSize),offset=bind((query.page-1)*query.pageSize);
    return (await database.query(`WITH matches AS (SELECT s.id FROM workify.project_invitations s WHERE ${where.join(' AND ')}),
      page AS (SELECT ${columns} FROM workify.project_invitations s JOIN matches m ON m.id=s.id ${joins} ORDER BY s.created_at DESC,s.id DESC LIMIT ${limit} OFFSET ${offset})
      SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items`,values)).rows[0];
  },
  async pending(projectId,freelancerId){return (await database.query("SELECT id FROM workify.project_invitations WHERE project_id=$1 AND freelancer_id=$2 AND status='PENDING'",[projectId,freelancerId])).rows[0];},
  async create(project,input){return (await database.query(`INSERT INTO workify.project_invitations (project_id,customer_id,freelancer_id,message,offered_price,offered_deadline_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[project.id,project.customer_id,input.freelancerId,input.message,input.offeredPrice,input.offeredDeadlineAt,input.expiresAt])).rows[0].id;},
  async decide(id,status,reason){await database.query('UPDATE workify.project_invitations SET status=$2,closure_reason=$3,decided_at=clock_timestamp() WHERE id=$1',[id,status,reason]);},
  async expire(projectId){return (await database.query(`UPDATE workify.project_invitations SET status='EXPIRED',decided_at=clock_timestamp(),
    closure_reason=CASE WHEN offered_deadline_at<=clock_timestamp() THEN 'TERMS_EXPIRED' ELSE 'TIME_EXPIRED' END
    WHERE project_id=$1 AND status='PENDING' AND (offered_deadline_at<=clock_timestamp() OR expires_at<=clock_timestamp()) RETURNING *`,[projectId])).rows;},
  async notify(recipientId,type,row,message,metadata={}){await database.query(`INSERT INTO workify.notifications(recipient_id,event_type,project_id,invitation_id,message,metadata)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[recipientId,type,row.project_id,row.id,message,JSON.stringify(metadata)]);},
};}
