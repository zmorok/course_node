export function createAssignmentRepository(database){
  async function create(project,source,column){return (await database.query(`INSERT INTO workify.orders (project_id,customer_id,freelancer_id,${column},title_snapshot,description_snapshot,agreed_price,initial_deadline_at,deadline_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,[project.id,project.customer_id,source.freelancer_id,source.id,project.title,project.description,source.offered_price,source.offered_deadline_at])).rows[0].id;}
  return {
    async blockingOrder(projectId){return (await database.query("SELECT 1 FROM workify.orders WHERE project_id=$1 AND status IN ('IN_PROGRESS','SUBMITTED','REVISION_REQUESTED','COMPLETED') LIMIT 1",[projectId])).rowCount>0;},
    createFromProposal:(project,proposal)=>create(project,proposal,'proposal_id'),
    createFromInvitation:(project,invitation)=>create(project,invitation,'invitation_id'),
    async copyFiles(projectId,orderId){await database.query('INSERT INTO workify.order_files (order_id,file_id) SELECT $2,file_id FROM workify.project_files WHERE project_id=$1',[projectId,orderId]);},
    async startProject(projectId){await database.query("UPDATE workify.projects SET status='IN_PROGRESS' WHERE id=$1",[projectId]);},
    async closeOtherProposals(projectId){return (await database.query("UPDATE workify.proposals SET status='REJECTED',closure_reason='OTHER_SOURCE_ACCEPTED',decided_at=clock_timestamp() WHERE project_id=$1 AND status='PENDING' RETURNING *",[projectId])).rows;},
    async closeInvitations(projectId){
      return (await database.query(`UPDATE workify.project_invitations SET status='EXPIRED',decided_at=clock_timestamp(),closure_reason=CASE
        WHEN offered_deadline_at<=clock_timestamp() THEN 'TERMS_EXPIRED'
        WHEN expires_at<=clock_timestamp() THEN 'TIME_EXPIRED' ELSE 'OTHER_SOURCE_ACCEPTED' END
        WHERE project_id=$1 AND status='PENDING' RETURNING *`,[projectId])).rows;
    },
    async createdEvent(orderId,actorId){await database.query("INSERT INTO workify.order_events (order_id,actor_id,event_type) VALUES ($1,$2,'ORDER_CREATED')",[orderId,actorId]);},
    async notifyOrder(userId,projectId,orderId){await database.query("INSERT INTO workify.notifications (recipient_id,event_type,project_id,order_id,message) VALUES ($1,'ORDER_CREATED',$2,$3,'Создан заказ по согласованному предложению')",[userId,projectId,orderId]);},
    async notifyInvitation(row){await database.query("INSERT INTO workify.notifications (recipient_id,event_type,project_id,invitation_id,message,metadata) VALUES ($1,'INVITATION_STATUS_CHANGED',$2,$3,'Приглашение закрыто',jsonb_build_object('status','EXPIRED','reason',$4::text))",[row.freelancer_id,row.project_id,row.id,row.closure_reason]);},
  };
}
