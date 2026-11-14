// Reportar / Sugestão: formulários do Google embutidos (links no bloco #report-forms de pages/reportar.html)
export function initReportPage(root, params) {
  let forms = {};
  try { forms = JSON.parse(root.querySelector('#report-forms').textContent); } catch (e) { return; }
  const frame = root.querySelector('#report-frame');
  const link = root.querySelector('#report-link');
  const tabs = [...root.querySelectorAll('[data-form]')];
  function show(kind) {
    const url = forms[kind] || forms.bug;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.form === kind)));
    frame.src = `${url}?embedded=true`;
    link.href = url;
  }
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.form)));
  show(params.get('tipo') === 'sugestao' ? 'idea' : 'bug');
}
