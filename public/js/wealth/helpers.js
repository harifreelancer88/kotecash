(function(g){
  function esc(v){return String(v??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function finite(n){return Number.isFinite(Number(n));}
  function money(v){ if(v===null||v===undefined||v==='') return '—'; var n=Number(v); if(!Number.isFinite(n)) return '—'; return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n); }
  function qty(v){ if(v===null||v===undefined||v==='') return '—'; var n=Number(v); if(!Number.isFinite(n)) return '—'; return n.toLocaleString('en-IN',{maximumFractionDigits:8}); }
  function price(v){ if(v===null||v===undefined||v==='') return '—'; var n=Number(v); if(!Number.isFinite(n)) return '—'; return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:8,minimumFractionDigits: n%1?2:0}); }
  function pct(v){ if(v===null||v===undefined||!Number.isFinite(Number(v))) return '—'; return (Number(v)*100).toFixed(2)+'%'; }
  function typeLabel(t){return String(t||'').replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
  function splitHelp(){return 'Enter 2 for a 2-for-1 split.';}
  function clean(s){return String(s||'').replace(/nan|infinity/ig,'—');}
  function table(headers,rows){return '<div class="overflow-x-auto wealth-table"><table class="min-w-full text-xs"><thead><tr>'+headers.map(h=>'<th class="text-left p-2">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows||'<tr><td colspan="'+headers.length+'" class="p-3" style="color:var(--c-sub);">No data yet.</td></tr>')+'</tbody></table></div>';}
  function loading(tab){return '<div class="card p-5"><div class="section-title">Wealth '+esc(typeLabel(tab))+'</div><p class="text-sm" style="color:var(--c-sub);">Loading…</p></div>';}
  function error(msg,tab){return '<div class="card p-5"><div class="section-title">Wealth '+esc(typeLabel(tab))+'</div><div class="text-sm text-[#C44B4B]">'+esc(msg||'Unable to load data')+'</div><button class="btn-primary px-3 py-2 rounded-lg text-xs mt-3" onclick="WealthRouter.load(\''+esc(tab)+'\')">Retry</button></div>';}
  function warnList(w){return (w||[]).length?'<div class="card p-3 text-xs text-[#8a5a00] bg-[#fff7e6]">'+w.map(esc).join('<br>')+'</div>':'';}
  function field(id,label,type,value,extra){return '<label class="block text-xs mb-2"><span style="color:var(--c-sub);">'+esc(label)+'</span><input id="'+id+'" type="'+(type||'text')+'" value="'+esc(value||'')+'" '+(extra||'')+' class="w-full px-3 py-2 rounded-lg border text-sm" style="border-color:var(--c-focus);background:#fff;color:var(--c-ink);"></label>';}
  function select(id,label,opts,value){return '<label class="block text-xs mb-2"><span style="color:var(--c-sub);">'+esc(label)+'</span><select id="'+id+'" class="w-full px-3 py-2 rounded-lg border text-sm" style="border-color:var(--c-focus);background:#fff;color:var(--c-ink);">'+opts.map(o=>'<option value="'+esc(o.value)+'" '+(String(o.value)===String(value)?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select></label>';}
  function val(id){var el=document.getElementById(id); return el?(el.type==='checkbox'?el.checked:el.value):'';}
  var H={esc,finite,money,qty,price,pct,typeLabel,splitHelp,clean,table,loading,error,warnList,field,select,val}; g.WealthHelpers=H; if(typeof module!=='undefined') module.exports=H;
})(typeof window!=='undefined'?window:globalThis);
