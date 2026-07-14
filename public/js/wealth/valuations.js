(function(g){
  var H=g.WealthHelpers,A=g.WealthApi;
  async function render(){
    var rows=await A.valuations({account_id:document.getElementById('valAccountFilter')?.value,date_from:document.getElementById('valFrom')?.value,date_to:document.getElementById('valTo')?.value});
    var accounts=await A.accounts({active:''}); g.WealthValAccounts=accounts;
    var opts='<option value="">All accounts</option>'+accounts.map(function(a){return '<option value="'+a.id+'">'+H.esc(a.name)+' · '+H.typeLabel(a.account_type)+'</option>';}).join('');
    var body=(rows||[]).map(function(v){return '<tr><td>'+H.esc(v.valuation_date)+'</td><td>'+H.esc((accounts.find(function(a){return a.id===v.account_id;})||{}).name||v.account_id)+'</td><td>'+H.esc(v.asset_id||'Account total')+'</td><td>'+H.money(v.invested_value)+'</td><td class="mono font-bold">'+H.money(v.current_value)+'</td><td>'+H.money(v.contribution_total)+'</td><td>'+H.typeLabel(v.source)+'</td><td>'+H.esc(v.notes)+'</td><td><div class="wealth-actions"><button class="wealth-action" onclick="WealthValuations.form('+v.id+')">Edit</button><button class="wealth-action danger" onclick="WealthValuations.remove('+v.id+')">Delete</button></div></td></tr>';}).join('');
    if(!(rows||[]).length) body=emptyState(accounts);
    return '<div class="card p-4"><div class="wealth-header"><div><div class="section-title">Valuations</div><p class="text-xs" style="color:var(--c-sub);">Manual valuation snapshots do not create Ledger movements.</p></div><button class="btn-primary px-3 py-2 rounded-lg text-xs wealth-primary" onclick="WealthValuations.form()">Add valuation</button></div><div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3"><select id="valAccountFilter">'+opts+'</select><input id="valFrom" type="date"><input id="valTo" type="date"><button class="wealth-action" onclick="WealthRouter.load(\'valuations\')">Filter</button></div>'+H.table(['Date','Account','Asset','Invested','Current','Contributed','Source','Notes','Actions'],body)+'</div>';
  }
  function emptyState(accounts){
    var legacy=accounts.filter(function(a){return ['legacy_balance_history','legacy_portfolio_value','formula','hybrid_fallback'].indexOf(a.valuation_source)>=0;});
    if(!legacy.length) return '';
    return '<tr><td colspan="9" class="p-3"><div class="space-y-2"><div class="font-semibold">No manual valuation snapshots yet.</div>'+legacy.map(function(a){var can=a.valuation_source==='legacy_balance_history'||a.valuation_source==='legacy_portfolio_value';return '<div class="wealth-empty-row"><span>'+H.esc(a.name)+' · '+H.esc(a.valuation_message||H.typeLabel(a.valuation_source))+' · '+H.money(a.currentValue)+'</span>'+(can?'<button class="wealth-action" onclick="WealthValuations.createFromLegacy('+a.id+')">Create from legacy value</button>':'')+'</div>';}).join('')+'</div></td></tr>';
  }
  async function form(id){
    var rows=id?await A.valuations({}):[], v=id?(rows||[]).find(function(x){return x.id===id;}):{valuation_date:new Date().toISOString().slice(0,10),source:'manual'};
    var accounts=await A.accounts({active:''}), assets=await A.assets({active:''});
    var body=H.select('val_acc','Account',accounts.map(function(a){return {value:a.id,label:a.name+' · '+H.typeLabel(a.account_type)};}),v.account_id)+H.select('val_asset','Asset (optional)',[{value:'',label:'Account-level total'}].concat(assets.map(function(a){return {value:a.id,label:a.name+' · '+H.typeLabel(a.asset_type)};})),v.asset_id)+H.field('val_date','Valuation date','date',v.valuation_date)+H.field('val_invested','Invested value','number',v.invested_value)+H.field('val_current','Current value','number',v.current_value)+H.field('val_contrib','Contribution total','number',v.contribution_total)+H.field('val_emp','Employer contribution','number',v.employer_contribution)+H.field('val_ee','Employee contribution','number',v.employee_contribution)+H.field('val_interest','Accrued interest','number',v.accrued_interest)+H.select('val_source','Source',['manual','import','formula','migration'].map(function(x){return {value:x,label:H.typeLabel(x)};}),v.source||'manual')+H.field('val_notes','Notes','text',v.notes)+'<div id="wealthFormError" class="text-sm text-[#C44B4B]"></div><button class="btn-primary px-4 py-2 rounded-lg w-full" onclick="WealthValuations.save('+(id||0)+')">Save valuation</button>';
    openModal((id?'Edit':'Add')+' valuation',body);
  }
  async function save(id){
    try{
      var b={account_id:Number(H.val('val_acc')),asset_id:H.val('val_asset')||null,valuation_date:H.val('val_date'),invested_value:H.val('val_invested')===''?null:Number(H.val('val_invested')),current_value:Number(H.val('val_current')),contribution_total:H.val('val_contrib')===''?null:Number(H.val('val_contrib')),employer_contribution:H.val('val_emp')===''?null:Number(H.val('val_emp')),employee_contribution:H.val('val_ee')===''?null:Number(H.val('val_ee')),accrued_interest:H.val('val_interest')===''?null:Number(H.val('val_interest')),source:H.val('val_source'),notes:H.val('val_notes')};
      await A.save('/api/wealth/valuation-snapshots'+(id?'/'+id:''),b,id?'PUT':'POST'); closeModal(); toast('Valuation saved'); WealthRouter.load('valuations');
    }catch(e){document.getElementById('wealthFormError').textContent=e.message;}
  }
  async function remove(id){ if(confirm('Delete this valuation snapshot? Historical net-worth snapshots keep already-calculated values.')){ await A.del('/api/wealth/valuation-snapshots/'+id); toast('Valuation deleted'); WealthRouter.load('valuations'); } }
  async function createFromLegacy(id){
    try{
      var p=await A.legacyValuationPreview({account_id:id});
      var body='<div class="space-y-2 text-sm"><p><b>Account:</b> '+H.esc(p.account_name)+'</p><p><b>Current legacy value:</b> '+H.money(p.current_value)+'</p><p><b>Source:</b> '+H.typeLabel(p.source)+'</p>'+H.field('legacy_date','Valuation date','date',p.valuation_date||'')+'<div id="wealthFormError" class="text-sm text-[#C44B4B]"></div><button class="btn-primary px-4 py-2 rounded-lg w-full" onclick="WealthValuations.confirmLegacy('+id+')">Create valuation from current legacy value</button></div>';
      openModal('Create valuation',body);
    }catch(e){alert(e.message);}
  }
  async function confirmLegacy(id){ try{await A.createValuationFromLegacy({account_id:id,valuation_date:H.val('legacy_date'),confirm:true}); closeModal(); toast('Valuation created'); WealthRouter.load('valuations');}catch(e){document.getElementById('wealthFormError').textContent=e.message;} }
  g.WealthValuations={render:render,form:form,save:save,remove:remove,createFromLegacy:createFromLegacy,confirmLegacy:confirmLegacy};
})(window);
