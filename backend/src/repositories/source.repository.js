import {createAuditRepository} from './audit.repository.js';
// Shared locking for both ways of assigning a project.
export function createSourceRepository(database){return {
  async projectContext(id){return (await database.query('SELECT id,customer_id FROM workify.projects WHERE id=$1',[id])).rows[0];},
  async lockUsers(ids){return (await database.query('SELECT id,role,status,blocked_until FROM workify.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[...new Set(ids)]])).rows;},
  async lockProject(id){return (await database.query('SELECT * FROM workify.projects WHERE id=$1 FOR UPDATE',[id])).rows[0];},
  audit:createAuditRepository(database).audit,
};}
