export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function options(values,current){return values.map(([v,t,disabled])=>`<option value="${esc(v)}" ${v===current?'selected':''}${disabled?' disabled':''}>${esc(t)}</option>`).join('')}
