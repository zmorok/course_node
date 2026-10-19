export const sourceColumns=`s.id,s.project_id,s.customer_id,s.freelancer_id,s.message,s.offered_price::text AS offered_price,
  s.offered_deadline_at,s.status,s.decided_at,s.closure_reason,s.created_at,s.updated_at,
  p.title AS project_title,p.status AS project_status,
  cu.username AS customer_username,cp.first_name AS customer_first_name,cp.last_name AS customer_last_name,
  fu.username AS freelancer_username,fp.first_name AS freelancer_first_name,fp.last_name AS freelancer_last_name,
  o.id AS order_id,o.status AS order_status,o.title_snapshot,o.description_snapshot,o.agreed_price::text AS agreed_price,o.initial_deadline_at,o.deadline_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'originalName',f.original_name,'mimeType',f.mime_type,'sizeBytes',f.size_bytes,'createdAt',f.created_at) ORDER BY f.created_at,f.id)
    FROM workify.order_files ofile JOIN workify.stored_files f ON f.id=ofile.file_id WHERE ofile.order_id=o.id AND f.deleted_at IS NULL),'[]'::jsonb) AS order_files`;
export const sourceJoins=`JOIN workify.projects p ON p.id=s.project_id
  JOIN workify.users cu ON cu.id=s.customer_id JOIN workify.profiles cp ON cp.user_id=cu.id
  JOIN workify.users fu ON fu.id=s.freelancer_id JOIN workify.profiles fp ON fp.user_id=fu.id`;
