const sorts={rating:'freelancer_rating DESC NULLS LAST,freelancer_review_count DESC,lower(last_name),lower(first_name),user_id',name:'lower(last_name),lower(first_name),lower(username),user_id'};
export function createFreelancerRepository(database){
  return {async list(query){
    const values=[],where=[];const bind=value=>{values.push(value);return `$${values.length}`;};
    if(query.search)where.push(`strpos(lower(concat_ws(' ',p.first_name,p.last_name,p.first_name,p.username)),lower(${bind(query.search)}))>0`);
    if(query.skill)where.push(`EXISTS(SELECT 1 FROM workify.user_skills us JOIN workify.skills sk ON sk.id=us.skill_id WHERE us.user_id=p.user_id AND sk.slug=${bind(query.skill)})`);
    if(query.minRating!==undefined)where.push(`p.freelancer_rating>=${bind(query.minRating)}`);
    const limit=bind(query.pageSize),offset=bind((query.page-1)*query.pageSize),sort=sorts[query.sort];
    return (await database.query(`WITH matches AS (SELECT p.* FROM workify.v_public_profiles p ${where.length?`WHERE ${where.join(' AND ')}`:''}),
      page AS (SELECT m.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'slug',s.slug,'name',s.name) ORDER BY s.name,s.id)
        FROM workify.user_skills us JOIN workify.skills s ON s.id=us.skill_id WHERE us.user_id=m.user_id),'[]'::jsonb) AS skills
        FROM matches m ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset})
      SELECT (SELECT count(*) FROM matches)::int AS total,COALESCE((SELECT jsonb_agg(page ORDER BY ${sort}) FROM page),'[]'::jsonb) AS items`,values)).rows[0];
  }};
}
