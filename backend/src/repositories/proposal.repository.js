import {createSourceRepository} from './source.repository.js';
import {sourceColumns,sourceJoins} from './source-projection.js';
const columns=`${sourceColumns},(s.offered_deadline_at<=clock_timestamp()) AS expired`;
const joins=`${sourceJoins} LEFT JOIN workify.orders o ON o.proposal_id=s.id`;
export function createProposalRepository(database){
  const repo={
    ...createSourceRepository(database),
    async proposalContext(id){return (await database.query('SELECT id,project_id,customer_id,freelancer_id FROM workify.proposals WHERE id=$1',[id])).rows[0];},
    async lockProposal(id){return (await database.query('SELECT *,offered_price::text AS offered_price,offered_deadline_at>clock_timestamp() AS current FROM workify.proposals WHERE id=$1 FOR UPDATE',[id])).rows[0];},
    async find(id,actorId){return (await database.query(`SELECT ${columns} FROM workify.proposals s ${joins}
      WHERE s.id=$1 AND (s.customer_id=$2 OR s.freelancer_id=$2)`,[id,actorId])).rows[0];},
    async list(query,{freelancerId,projectId}){
      const values=[],where=[];const bind=value=>{values.push(value);return `$${values.length}`;};
      if(freelancerId)where.push(`s.freelancer_id=${bind(freelancerId)}`);
      if(projectId)where.push(`s.project_id=${bind(projectId)}`);
      if(query.status)where.push(`s.status=${bind(query.status)}`);
      const limit=bind(query.pageSize),offset=bind((query.page-1)*query.pageSize);
      return (await database.query(`WITH matches AS (SELECT s.id FROM workify.proposals s WHERE ${where.join(' AND ')}),
        page AS (SELECT ${columns} FROM workify.proposals s JOIN matches m ON m.id=s.id ${joins} ORDER BY s.created_at DESC,s.id DESC LIMIT ${limit} OFFSET ${offset})
        SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items`,values)).rows[0];
    },
    async pending(projectId,freelancerId){return (await database.query("SELECT id FROM workify.proposals WHERE project_id=$1 AND freelancer_id=$2 AND status='PENDING'",[projectId,freelancerId])).rows[0];},
    async create(project,freelancerId,input){
      return (await database.query(`INSERT INTO workify.proposals (project_id,customer_id,freelancer_id,message,offered_price,offered_deadline_at)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,[project.id,project.customer_id,freelancerId,input.message,input.offeredPrice,input.offeredDeadlineAt])).rows[0].id;
    },
    async decide(id,status,reason){await database.query('UPDATE workify.proposals SET status=$2,closure_reason=$3,decided_at=clock_timestamp() WHERE id=$1',[id,status,reason]);},
    async expire(projectId){return (await database.query("UPDATE workify.proposals SET status='REJECTED',closure_reason='TERMS_EXPIRED',decided_at=clock_timestamp() WHERE project_id=$1 AND status='PENDING' AND offered_deadline_at<=clock_timestamp() RETURNING *",[projectId])).rows;},
    async notify(recipientId,type,projectId,proposalId,message,metadata={}){
      await database.query(`INSERT INTO workify.notifications (recipient_id,event_type,project_id,proposal_id,message,metadata)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,[recipientId,type,projectId,proposalId,message,JSON.stringify(metadata)]);
    },
  };
  return repo;
}
