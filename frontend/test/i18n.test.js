import test from 'node:test';import assert from 'node:assert/strict';
import {english} from '../src/en.js';import {t,locale,errorText} from '../src/i18n.js';
import {getLanguage,getTheme,setLanguage,setTheme,applyPreferences} from '../src/preferences.js';
test('every English catalog entry is translated and preserves interpolation placeholders',()=>{
 assert(Object.keys(english).length>=950);
 for(const [key,value] of Object.entries(english)){assert(value.trim(),key);if(key!=='Русский')assert(!/[А-Яа-яЁё]/.test(value),key);assert.deepEqual((value.match(/\{\d+\}/g)??[]).sort(),(key.match(/\{\d+\}/g)??[]).sort(),key);}
 assert.equal(t('Мои проекты',[],'en'),'My projects');assert.equal(t('Импортировано: {0}. Повторных записей: {1}.',[3,2],'en'),'Imported: 3. Duplicate records: 2.');
 assert.equal(t(' Страница ',[],'en'),' Page ');assert.equal(t('Описание клиента',[],'en'),'Описание клиента');
});
test('language and theme persist independently and apply document attributes',()=>{
 const savedStorage=globalThis.localStorage,savedDocument=globalThis.document,values=new Map();
 try{globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};globalThis.document={documentElement:{dataset:{}}};
 assert.equal(getLanguage(),'ru');assert.equal(getTheme(),'light');setLanguage('en');setTheme('dark');applyPreferences();assert.equal(getLanguage(),'en');assert.equal(getTheme(),'dark');assert.equal(document.documentElement.lang,'en');assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(locale(),'en-GB');assert.equal(errorText('Неверные данные'),'Could not complete the request. Check the form and try again.');setTheme('light');assert.equal(getLanguage(),'en');setLanguage('invalid');assert.equal(getLanguage(),'en');
 }finally{globalThis.localStorage=savedStorage;globalThis.document=savedDocument;}
});
