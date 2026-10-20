import React,{useState} from 'react';
import {uploadFile} from './files.js';
import {FileLink} from './PortfolioPanel.jsx';
import {ErrorMessage} from './Ui.jsx';
export function ImageAttachments({files=[],onChange,disabled=false,onBusy=()=>{}}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(null);
 async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;setBusy(true);onBusy(true);setError(null);try{const saved=await uploadFile(file);onChange([...files,saved]);}catch(problem){setError(problem);}finally{setBusy(false);onBusy(false);}}
 return <div className="portfolio-attachments"><h3>Изображения · {files.length}/8</h3>{files.map(file=><div className="attachment-row" key={file.id}><FileLink file={file} privateFile/><button className="text-button" type="button" disabled={busy||disabled} onClick={()=>onChange(files.filter(item=>item.id!==file.id))}>Убрать изображение</button></div>)}<label className="upload-label">{busy?'Загружаем…':'Добавить изображение'}<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp" disabled={busy||disabled||files.length>=8} onChange={upload}/></label><p className="profile-help">PNG, JPEG, WebP, GIF, BMP. До 10 МБ на файл. Убранные новые загрузки доступны в свободных файлах профиля.</p><ErrorMessage error={error}/></div>;
}
