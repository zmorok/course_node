import test from 'node:test';import assert from 'node:assert/strict';
import {english} from '../src/en.js';import {t,locale,errorText,uiMessage} from '../src/i18n.js';
import {getLanguage,getTheme,setLanguage,setTheme,applyPreferences,subscribePreferences,getPreferencesSnapshot} from '../src/preferences.js';
test('every English catalog entry is translated and preserves interpolation placeholders',()=>{
 assert(Object.keys(english).length>=950);
 for(const [key,value] of Object.entries(english)){assert(value.trim(),key);if(key!=='Русский')assert(!/[А-Яа-яЁё]/.test(value),key);assert.deepEqual((value.match(/\{\d+\}/g)??[]).sort(),(key.match(/\{\d+\}/g)??[]).sort(),key);}
 assert.equal(t('Мои проекты',[],'en'),'My projects');assert.equal(t('Импортировано: {0}. Повторных записей: {1}.',[3,2],'en'),'Imported: 3. Duplicate records: 2.');
 assert.equal(t(' Страница ',[],'en'),' Page ');assert.equal(t('Описание клиента',[],'en'),'Описание клиента');
});

test('stored interface messages translate in both directions after a language change',()=>{
 const message=uiMessage('Импортировано: {0}. Повторных записей: {1}.',[3,2]);
 assert.equal(t(message,[],'ru'),'Импортировано: 3. Повторных записей: 2.');
 assert.equal(t(message,[],'en'),'Imported: 3. Duplicate records: 2.');
 assert.equal(t(message,[],'ru'),'Импортировано: 3. Повторных записей: 2.');
});

test('preferences notify subscribers and work when browser storage rejects writes',()=>{
 const savedStorage=globalThis.localStorage,savedWindow=globalThis.window,savedDocument=globalThis.document;
 let unsubscribe;
 try {
  globalThis.window=new EventTarget();globalThis.document={documentElement:{dataset:{}}};
  globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('Storage blocked');}};
  const snapshots=[];unsubscribe=subscribePreferences(()=>snapshots.push(getPreferencesSnapshot()));
  setLanguage('en');setTheme('dark');
  assert.deepEqual(snapshots,['en:light','en:dark']);
  assert.equal(document.documentElement.lang,'en');assert.equal(document.documentElement.dataset.theme,'dark');
  setLanguage('invalid');assert.equal(snapshots.length,2);
  const values=new Map([['workify-language','ru'],['workify-theme','light']]);
  globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const event=new Event('storage');event.key='workify-language';window.dispatchEvent(event);
  assert.equal(getPreferencesSnapshot(),'ru:light');assert.equal(snapshots.at(-1),'ru:light');
  unsubscribe();unsubscribe=undefined;setLanguage('en');assert.equal(snapshots.length,3);
  setLanguage('ru');setTheme('light');
 } finally {unsubscribe?.();globalThis.localStorage=savedStorage;globalThis.window=savedWindow;globalThis.document=savedDocument;}
});
test('language and theme persist independently and apply document attributes',()=>{
 const savedStorage=globalThis.localStorage,savedDocument=globalThis.document,values=new Map();
 try{globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};globalThis.document={documentElement:{dataset:{}}};
 assert.equal(getLanguage(),'ru');assert.equal(getTheme(),'light');setLanguage('en');setTheme('dark');applyPreferences();assert.equal(getLanguage(),'en');assert.equal(getTheme(),'dark');assert.equal(document.documentElement.lang,'en');assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(locale(),'en-GB');assert.equal(errorText('Неверные данные'),'Could not complete the request. Check the form and try again.');setTheme('light');assert.equal(getLanguage(),'en');setLanguage('invalid');assert.equal(getLanguage(),'en');
 }finally{globalThis.localStorage=savedStorage;globalThis.document=savedDocument;}
});
