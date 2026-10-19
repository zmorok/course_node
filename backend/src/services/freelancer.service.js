export function createFreelancerService({repository}){
  return {async list(query){const result=await repository.list(query);return {...result,page:query.page,pageSize:query.pageSize,items:result.items.map(row=>({
    id:row.user_id,username:row.username,firstName:row.first_name,lastName:row.last_name,headline:row.headline,city:row.city,country:row.country,
    avatarFileId:row.avatar_file_id,skills:row.skills,freelancerRating:row.freelancer_rating,freelancerReviewCount:Number(row.freelancer_review_count),
  }))};}};
}
