import { fileInclude, fileData, plain, userInclude } from './database-tools.js';

export const sourceInclude = {
  project: true,
  customer: userInclude,
  freelancer: userInclude,
  order: { include: { files: fileInclude } },
};

export function sourceData({ project, customer, freelancer, order, ...row }, now) {
  return {
    ...plain(row),
    project_title: project.title,
    project_status: project.status,
    customer_username: customer.username,
    customer_first_name: customer.profile.first_name,
    customer_last_name: customer.profile.last_name,
    freelancer_username: freelancer.username,
    freelancer_first_name: freelancer.profile.first_name,
    freelancer_last_name: freelancer.profile.last_name,
    order_id: order?.id ?? null,
    order_status: order?.status ?? null,
    title_snapshot: order?.title_snapshot ?? null,
    description_snapshot: order?.description_snapshot ?? null,
    agreed_price:
      order?.agreed_price == null
        ? null
        : String(
            order.agreed_price instanceof Object
              ? order.agreed_price.toFixed(2)
              : order.agreed_price,
          ),
    initial_deadline_at: order?.initial_deadline_at ?? null,
    deadline_at: order?.deadline_at ?? null,
    order_files: order?.files.map((link) => fileData(link)) ?? [],
    expired:
      row.status === 'PENDING' &&
      (row.offered_deadline_at <= now || (row.expires_at != null && row.expires_at <= now)),
  };
}
