// Minimal i18n loader: fetches JSON files from assets/lang and provides translate function
export async function loadTranslations(lang){
  try{
    const resp = await fetch(`assets/lang/${lang}.json`);
    if(!resp.ok) throw new Error('Idioma não encontrado');
    return await resp.json();
  }catch(e){
    console.warn('i18n load failed', e);
    return {};
  }
}

export function translateDocument(trans){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    const text = key.split('.').reduce((o,k)=>o&&o[k], trans) || '';
    if(el.placeholder !== undefined && el.hasAttribute('data-i18n-placeholder')){
      el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });
}
