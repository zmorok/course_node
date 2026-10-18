export const env = {
  port: Number(process.env.PORT || 3000),
  uploadDir: process.env.UPLOAD_DIR || '/app/uploads',
  database: {
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'workify',
    user: process.env.PGUSER || 'workify',
    password: process.env.PGPASSWORD,
  },
};
