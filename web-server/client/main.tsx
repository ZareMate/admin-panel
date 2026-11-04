import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import './theme.css';
async function start() {
 const fragment=new URLSearchParams(location.hash.slice(1)),ticket=fragment.get('minecraftLogin');
 if(ticket!==null) {
  history.replaceState(null,'',location.pathname+location.search);
  try {
   const response=await fetch('/api/auth/minecraft/redeem',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
   if(!response.ok){const body=await response.json();throw new Error(body.error||'Minecraft sign-in failed');}
  }catch(error){const url=new URL(location.href);url.searchParams.set('loginError',error instanceof Error?error.message:'Minecraft sign-in failed');history.replaceState(null,'',url.pathname+url.search);}
 }
 createRoot(document.getElementById('root')!).render(<App/>);
}
void start();
