// Small UI helpers: sidebar collapse and active nav behavior
export function initUI(){
  const sidebar = document.querySelector('.sidebar');

  // active nav behavior
  // nav items updated by main router; keep compatibility by wiring nav-link active toggle
  document.querySelectorAll('.nav-link').forEach(item=>{
    item.addEventListener('click', ()=>{
      document.querySelectorAll('.nav-link').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  const activeLink = document.querySelector('.nav-link.active');
  if(activeLink) activeLink.classList.add('active');

  // make sidebar scrollable if content is taller
  if(sidebar){
    sidebar.style.maxHeight = 'calc(100vh - 48px)';
    sidebar.style.overflowY = 'auto';
    sidebar.style.paddingRight = '6px';
  }
}
