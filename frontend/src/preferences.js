export function getLanguage(){try{return globalThis.localStorage?.getItem('workify-language')==='en'?'en':'ru';}catch{return 'ru';}}
export function getTheme(){try{return globalThis.localStorage?.getItem('workify-theme')==='dark'?'dark':'light';}catch{return 'light';}}
export function applyPreferences(){if(typeof document!=='undefined'){document.documentElement.lang=getLanguage();document.documentElement.dataset.theme=getTheme();document.title=getLanguage()==='en'?'Workify — projects and orders':'Workify — проекты и заказы';}}
export function setLanguage(value){if(!['ru','en'].includes(value))return;try{globalThis.localStorage?.setItem('workify-language',value);}catch{}applyPreferences();}
export function setTheme(value){if(!['light','dark'].includes(value))return;try{globalThis.localStorage?.setItem('workify-theme',value);}catch{}applyPreferences();}
applyPreferences();
