import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withTransaction} from '../../src/repositories/transaction.js';
import {createAuthRepository} from '../../src/repositories/auth.repository.js';
import {createAuthService} from '../../src/services/auth.service.js';
import {createAccessTokens} from '../../src/utils/tokens.js';
import {createFileRepository} from '../../src/repositories/file.repository.js';
import {createFileService} from '../../src/services/file.service.js';
import {createLocalStorage} from '../../src/storage/local-storage.js';
import {createProjectRepository} from '../../src/repositories/project.repository.js';
import {createProjectService} from '../../src/services/project.service.js';
import {createProfileRepository} from '../../src/repositories/profile.repository.js';
import {createProfileService} from '../../src/services/profile.service.js';
import {createFreelancerRepository} from '../../src/repositories/freelancer.repository.js';
import {createFreelancerService} from '../../src/services/freelancer.service.js';
import {createProposalRepository} from '../../src/repositories/proposal.repository.js';
import {createProposalService} from '../../src/services/proposal.service.js';
import {createInvitationRepository} from '../../src/repositories/invitation.repository.js';
import {createInvitationService} from '../../src/services/invitation.service.js';
import {createAssignmentRepository} from '../../src/repositories/assignment.repository.js';
import {createAssignmentService} from '../../src/services/assignment.service.js';
import {createOrderRepository} from '../../src/repositories/order.repository.js';
import {createOrderService} from '../../src/services/order.service.js';
import {createOrderWorkRepository} from '../../src/repositories/order-work.repository.js';
import {createOrderWorkService} from '../../src/services/order-work.service.js';
import {createApiRouter} from '../../src/routes/index.js';
import {startApp} from './http.js';
export const future=(days=30)=>new Date(Date.now()+days*86400000).toISOString();
export async function marketplace(context,pool,config,{failEvent=()=>false,failWorkEvent=()=>false}={}){
  const directory=await mkdtemp(join(tmpdir(),'workify-invitations-'));context.after(()=>rm(directory,{recursive:true,force:true}));
  const tx=op=>withTransaction(pool,c=>{const assignments=createAssignmentRepository(c),original=assignments.createdEvent;assignments.createdEvent=async(...args)=>{if(failEvent())throw new Error('injected order event failure');return original(...args);};return op(c,assignments);});
  const authService=await createAuthService({repository:createAuthRepository(pool),accessTokens:createAccessTokens(config.auth),sessionTtlDays:30,transaction:op=>withTransaction(pool,c=>op(createAuthRepository(c)))});
  const fileService=createFileService({repository:createFileRepository(pool),storage:createLocalStorage(directory),transaction:op=>withTransaction(pool,c=>op(createFileRepository(c)))});
  const profileService=createProfileService({repository:createProfileRepository(pool),transaction:op=>withTransaction(pool,c=>op(createProfileRepository(c)))});
  const projectService=createProjectService({repository:createProjectRepository(pool),fileService,transaction:op=>withTransaction(pool,c=>op(createProjectRepository(c),createFileRepository(c)))});
  const proposalService=createProposalService({repository:createProposalRepository(pool),assignmentService:createAssignmentService(),transaction:op=>tx((c,a)=>op(createProposalRepository(c),a))});
  const invitationService=createInvitationService({repository:createInvitationRepository(pool),assignmentService:createAssignmentService(),transaction:op=>tx((c,a)=>op(createInvitationRepository(c),a,createProposalRepository(c)))});
  const freelancerService=createFreelancerService({repository:createFreelancerRepository(pool)});
  const orderService=createOrderService({repository:createOrderRepository(pool)});
  const orderWorkService=createOrderWorkService({repository:createOrderWorkRepository(pool),orders:createOrderRepository(pool),fileService,
    transaction:op=>withTransaction(pool,c=>{const repo=createOrderWorkRepository(c),event=repo.event;repo.event=async(...args)=>{if(failWorkEvent(args[2]))throw new Error('injected work event failure');return event(...args);};return op(repo,createOrderRepository(c),createFileRepository(c));})});
  const app=await startApp(context,createApiRouter({authService,authConfig:config.auth,fileService,profileService,projectService,proposalService,freelancerService,invitationService,orderService,orderWorkService,healthService:{check:async()=>({status:'ok'})}}));
  const api=(actor,path,method='GET',body)=>app.request(`/api${path}`,{method,headers:{...(actor?{Authorization:`Bearer ${actor.token}`}:{ }),'Content-Type':'application/json','X-Workify-Client':'browser'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {...app,api,async register(patch={}){const suffix=randomUUID().replaceAll('-','');const result=await api(null,'/auth/register','POST',{email:`${suffix}@example.invalid`,username:`i_${suffix}`,firstName:'Участник',lastName:'Тест',password:'invitation test password',...patch});assert.equal(result.response.status,201);return {id:result.body.user.id,token:result.body.accessToken,user:result.body.user};},
    async project(owner,{file=false,draft=false}={}){let fileId;if(file){const form=new FormData();form.append('file',new Blob(['Задание по приглашению'],{type:'text/plain'}),'Задание.txt');const uploaded=await app.request('/api/files',{method:'POST',headers:{Authorization:`Bearer ${owner.token}`},body:form});assert.equal(uploaded.response.status,201);fileId=uploaded.body.file.id;}
      const category=(await api(null,'/categories')).body.categories[0];const result=await api(owner,'/projects','POST',{title:`Проект ${randomUUID()}`,description:'Задание исполнителю',categoryId:category.id,budget:'3000.00',fileIds:fileId?[fileId]:[]});assert.equal(result.response.status,201);const project=result.body.project;if(!draft)assert.equal((await api(owner,`/projects/${project.id}/publish`,'POST',{})).response.status,200);return {...project,fileId};},
    async order(customer,freelancer,{type='proposal',file=true,project}={}){project??=await this.project(customer,{file});const source=type==='proposal'?await this.proposal(freelancer,project):await this.invitation(customer,project,freelancer);const accepted=type==='proposal'?await api(customer,`/proposals/${source.id}/accept`,'POST',{}):await this.act(freelancer,source,'accept');assert.equal(accepted.response.status,200);return {...accepted.body[type].order,project};},
    invite:(owner,project,author,patch={})=>api(owner,`/projects/${project.id}/invitations`,'POST',{freelancerId:author.id,message:'Приглашаю выполнить проект',offeredPrice:'2400.50',offeredDeadlineAt:future(),expiresAt:future(7),...patch}),
    async invitation(owner,project,author,patch={}){const result=await this.invite(owner,project,author,patch);assert.equal(result.response.status,201,JSON.stringify(result.body));return result.body.invitation;},
    async proposal(author,project){const result=await api(author,`/projects/${project.id}/proposals`,'POST',{message:'Готов выполнить',offeredPrice:'2000.00',offeredDeadlineAt:future()});assert.equal(result.response.status,201);return result.body.proposal;},
    act:(actor,source,action,body={})=>api(actor,`/invitations/${source.id}/${action}`,'POST',body),
  };
}
