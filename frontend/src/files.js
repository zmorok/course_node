import { api } from './api.js';
export async function uploadFile(file) {
  const body=new FormData();body.append('file',file);
  return (await api('/files',{method:'POST',body})).file;
}
