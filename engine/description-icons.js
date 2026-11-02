// Description text stays plain text until this rendering boundary. Icons reuse
// the game's assets, inherit text colour, and never parse authored HTML.
const icons = {
 '⚔':{id:'damage',label:'Damage',url:new URL('../assets/img/ui/damage.svg',import.meta.url).href},
 'ϟ':{id:'energy',label:'Energy',url:new URL('../assets/img/ui/hud-energy.png',import.meta.url).href},
 '♥':{id:'health',label:'Health',url:new URL('../assets/img/ui/hud-health.png',import.meta.url).href}
};
export function renderDescriptionIcons(element,text) {
 const value=String(text??'');
 element.textContent=value;
 if(!/[⚔ϟ♥]/.test(value))return;
 const doc=element.ownerDocument??document,nodes=[];
 for(const part of value.split(/([⚔ϟ♥])/)){
  if(!part)continue;
  const spec=Object.hasOwn(icons,part)?icons[part]:null;
  if(spec){
   const icon=doc.createElement('span');
   icon.className=`nest-description-${spec.id}-icon`;
   icon.setAttribute('role','img');icon.setAttribute('aria-label',spec.label);
   Object.assign(icon.style,{display:'inline-block',width:'.9em',height:'.9em',verticalAlign:'-.08em',backgroundColor:'currentColor',maskImage:`url("${spec.url}")`,webkitMaskImage:`url("${spec.url}")`,maskPosition:'center',webkitMaskPosition:'center',maskSize:'contain',webkitMaskSize:'contain',maskRepeat:'no-repeat',webkitMaskRepeat:'no-repeat'});
   if(spec.id==='energy'){icon.style.width='1.15em';icon.style.height='1.15em';icon.style.verticalAlign='-.18em';}
   if(spec.id==='health')icon.style.marginInline='.12em';
   if(spec.id==='damage'){icon.style.marginInlineStart='.1em';icon.style.marginInlineEnd='.06em';}
   nodes.push(icon);
  }else{const span=doc.createElement('span');span.textContent=part;nodes.push(span);}
 }
 element.replaceChildren(...nodes);
}
