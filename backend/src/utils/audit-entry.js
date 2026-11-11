import { auditData } from './audit-data.js';
import { currentAuditContext } from './audit-context.js';

// подготовка записи аудита с контекстом запроса и удалением чувствительных данных
export function auditEntry(actorId, action, entityType, entityId, metadata = {}, snapshots = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('Audit metadata must be an object');
  }

  const context = currentAuditContext();

  return {
    actorId,
    action,
    entityType,
    entityId,
    metadata: JSON.stringify(
      auditData({ ...metadata, ...(context.requestId ? { requestId: context.requestId } : {}) }),
    ),
    oldData: snapshots.oldData ? JSON.stringify(auditData(snapshots.oldData)) : null,
    newData: snapshots.newData ? JSON.stringify(auditData(snapshots.newData)) : null,
    ip: context.ip ?? null,
  };
}
