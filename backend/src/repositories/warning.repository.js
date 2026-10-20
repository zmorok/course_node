import {createSourceRepository} from './source.repository.js';
export function createWarningRepository(database){return {
  ...createSourceRepository(database),
  async list(actorId,query){return (await database.query(`WITH matches AS (SELECT a.moderation_action_id,a.warning_id,a.action_type,a.reason,a.created_at,a.expires_at,a.complaint_id,w.message,p.first_name,p.last_name
    FROM workify.v_user_sanctions a LEFT JOIN workify.warnings w ON w.id=a.warning_id JOIN workify.profiles p ON p.user_id=a.admin_id WHERE a.user_id=$1 AND ($2::text IS NULL OR a.action_type=$2)),
    page AS (SELECT * FROM matches ORDER BY created_at DESC,moderation_action_id DESC LIMIT $3 OFFSET $4)
    SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,moderation_action_id DESC) FROM page),'[]'::jsonb) AS items`,[actorId,query.type??null,query.pageSize,(query.page-1)*query.pageSize])).rows[0];},
  // Reused by the complaint-resolution transaction in the administrative stage.
  async create(adminId,targetId,input,complaintId=null){const action=(await database.query(`INSERT INTO workify.moderation_actions(admin_id,target_id,complaint_id,action_type,reason,expires_at,created_at)
    VALUES($1,$2,$3,'WARNING',$4,$5,statement_timestamp()) RETURNING id,created_at`,[adminId,targetId,complaintId,input.message,input.expiresAt])).rows[0];
    const warning=(await database.query(`INSERT INTO workify.warnings(moderation_action_id,user_id,issued_by,message,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[action.id,targetId,adminId,input.message,input.expiresAt,action.created_at])).rows[0];return {id:warning.id,actionId:action.id};},
  async notify(targetId,actionId){await database.query("INSERT INTO workify.notifications(recipient_id,event_type,moderation_action_id,message) VALUES($1,'MODERATION_ACTION',$2,'Вам выдано предупреждение администратора')",[targetId,actionId]);},
};}
