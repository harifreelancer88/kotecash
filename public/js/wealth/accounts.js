(function(g){
  var H=g.WealthHelpers,A=g.WealthApi;
  var types=['brokerage','mutual_fund','epf','nps','ppf','ssy','fixed_deposit','gold','bond','crypto','other'];
  var modes=['holdings','manual_snapshot','formula','hybrid'];
  var metaFields={
    brokerage:[],
    mutual_fund:['folio','fund_house','category'],
    epf:['employer_label','uan_masked'],
    nps:['pran_masked','tier','pension_fund_manager','scheme_preference'],
    ppf:['account_label','opened_date','maturity_date','interest_rate'],
    ssy:['account_label','opened_date','maturity_date','interest_rate'],
    fixed_deposit:['reference_masked','principal','start_date','maturity_date','interest_rate','compounding_frequency','maturity_amount'],
    gold:['form','quantity','unit','purity'],
    bond:['issuer','coupon_rate','maturity_date'],
    crypto:['wallet_label'],
    other:['label']
  };
  function parseMeta(raw){ if(!raw)return {}; if(typeof raw==='object')return raw; try{return JSON.parse(String(raw));}catch(e){return {};} }
  function metaInput(f,m){
    var label=H.typeLabel(f), type=/date/.test(f)?'date':/rate|principal|amount|quantity/.test(f)?'number':'text';
    return H.field('wa_meta_'+f,label,type,m[f]);
  }
  function valuationLabel(a){ return a.valuation_message||H.typeLabel(a.valuation_source)+(a.valuation_date?' · '+a.valuation_date:''); }
  function actions(a){
    var html='<div class="wealth-actions"><button class="wealth-action" onclick="WealthAccounts.form('+a.id+')">Edit</button><button class="wealth-action" onclick="WealthAccounts.deactivate('+a.id+')">Deactivate</button><button class="wealth-action" onclick="WealthRouter.go(\'holdings\')">Holdings</button><button class="wealth-action" onclick="WealthPerformance.account('+a.id+')">Performance</button>';
    if(a.can_delete) html+='<button class="wealth-action danger" onclick="WealthAccounts.permanentDelete('+a.id+')">Delete permanently</button>';
    if(a.valuation_source==='legacy_balance_history'||a.valuation_source==='legacy_portfolio_value') html+='<button class="wealth-action" onclick="WealthAccounts.createFromLegacy('+a.id+')">Create valuation</button>';
    return html+'</div>';
  }
  async function render(){
    var rows=await A.accounts();
    await Promise.all(rows.map(async function(a){ try{var d=await A.accountDeleteCheck(a.id); a.can_delete=!!d.can_delete; a.delete_dependencies=d.dependencies||{};}catch(e){a.can_delete=false;} }));
    var body=rows.map(function(a){
      var warn=(a.valuation_warnings||[]).filter(function(w){return /legacy/.test(w);}).map(H.esc).join('<br>');
      return '<tr><td class="p-2">'+H.esc(a.name)+'</td><td class="p-2">'+H.typeLabel(a.account_type)+'</td><td class="p-2">'+H.esc(a.institution)+'</td><td class="p-2">'+H.esc(a.account_number_masked)+'</td><td class="p-2 mono">'+H.money(a.currentValue)+'</td><td class="p-2"><div>'+H.esc(valuationLabel(a))+'</div>'+(warn?'<div class="wealth-warning">'+warn+'</div>':'')+'</td><td class="p-2">'+(a.include_in_net_worth!==0?'Yes':'No')+'</td><td class="p-2">'+(a.is_active?'Active':'Inactive')+'</td><td class="p-2">'+actions(a)+'</td></tr>';
    }).join('');
    return '<div class="card p-4"><div class="wealth-header"><div><div class="section-title">Investment accounts</div><p class="text-xs" style="color:var(--c-sub);">Valuation modes: holdings, manual snapshot, formula, or hybrid.</p></div><button class="btn-primary px-3 py-2 rounded-lg text-xs wealth-primary" onclick="WealthAccounts.form()">Add</button></div>'+H.table(['Name','Type','Institution','Masked #','Current value','Valuation provenance','Net worth','Status','Actions'],body)+'</div>';
  }
  async function form(id){
    var a=id?(await A.accounts({active:''})).find(function(x){return x.id===id;}):{};
    var m=parseMeta(a.metadata);
    var type=a.account_type||'brokerage';
    var body=H.field('wa_name','Name','text',a.name)+H.select('wa_type','Account type',types.map(function(x){return {value:x,label:H.typeLabel(x)};}),type)+'<div id="wa_type_fields">'+(metaFields[type]||[]).map(function(f){return metaInput(f,m);}).join('')+'</div>'+H.field('wa_inst','Institution','text',a.institution)+H.field('wa_mask','Masked account/reference','text',a.account_number_masked)+H.field('wa_currency','Currency','text',a.currency||'INR')+H.field('wa_open','Opened at','date',a.opened_at)+H.select('wa_mode','Valuation mode',modes.map(function(x){return {value:x,label:H.typeLabel(x)};}),a.valuation_mode||'manual_snapshot')+(!id?H.field('wa_opening','Opening value','number','0'):'')+'<label class="wealth-check"><input id="wa_net" type="checkbox" '+(a.include_in_net_worth!==0?'checked':'')+'> Include in net worth</label><label class="wealth-check"><input id="wa_active" type="checkbox" '+(a.is_active!==0?'checked':'')+'> Active</label>'+H.field('wa_notes','Notes','text',a.notes)+'<div id="wealthFormError" class="text-sm text-[#C44B4B]"></div><button class="btn-primary px-4 py-2 rounded-lg w-full" onclick="WealthAccounts.save('+ (id||0)+')">Save</button>';
    openModal((id?'Edit':'Add')+' account',body);
    document.getElementById('wa_type').onchange=function(){var t=this.value, box=document.getElementById('wa_type_fields'); box.innerHTML=(metaFields[t]||[]).map(function(f){return metaInput(f,m);}).join('');};
  }
  async function save(id){
    try{
      var rows=id?await A.accounts({active:''}):[], existing=id?(rows.find(function(x){return x.id===id;})||{}):{}, meta=parseMeta(existing.metadata), t=H.val('wa_type');
      (metaFields[t]||[]).forEach(function(f){var v=H.val('wa_meta_'+f); if(v!=='')meta[f]=v;});
      var b={name:H.val('wa_name'),account_type:t,institution:H.val('wa_inst'),account_number_masked:H.val('wa_mask'),currency:H.val('wa_currency')||'INR',opened_at:H.val('wa_open'),include_in_net_worth:H.val('wa_net'),is_active:H.val('wa_active'),valuation_mode:H.val('wa_mode'),notes:H.val('wa_notes'),metadata:meta};
      if(!id)b.opening_value=Number(H.val('wa_opening')||0);
      await A.save('/api/wealth/accounts'+(id?'/'+id:''),b,id?'PUT':'POST'); closeModal(); toast('Account saved'); WealthRouter.load('accounts');
    }catch(e){document.getElementById('wealthFormError').textContent=e.message;}
  }
  async function deactivate(id){ if(confirm('Deactivate this account?')){ await A.del('/api/wealth/accounts/'+id); toast('Account deactivated'); WealthRouter.load('accounts'); } }
  async function permanentDelete(id){ if(confirm('Permanently delete this empty account? This cannot be undone.')){ await A.del('/api/wealth/accounts/'+id+'/permanent'); toast('Account deleted'); WealthRouter.load('accounts'); } }
  async function createFromLegacy(id){
    try{
      var preview=await A.legacyValuationPreview({account_id:id});
      var body='<div class="space-y-2 text-sm"><p><b>Account:</b> '+H.esc(preview.account_name)+'</p><p><b>Current legacy value:</b> '+H.money(preview.current_value)+'</p><p><b>Source:</b> '+H.typeLabel(preview.source)+'</p>'+H.field('legacy_date','Valuation date','date',preview.valuation_date||'')+'<div id="wealthFormError" class="text-sm text-[#C44B4B]"></div><button class="btn-primary px-4 py-2 rounded-lg w-full" onclick="WealthAccounts.confirmLegacy('+id+')">Create valuation from current legacy value</button></div>';
      openModal('Create valuation',body);
    }catch(e){alert(e.message);}
  }
  async function confirmLegacy(id){ try{await A.createValuationFromLegacy({account_id:id,valuation_date:H.val('legacy_date'),confirm:true}); closeModal(); toast('Valuation created'); WealthRouter.load('accounts');}catch(e){document.getElementById('wealthFormError').textContent=e.message;} }
  g.WealthAccounts={render:render,form:form,save:save,deactivate:deactivate,permanentDelete:permanentDelete,createFromLegacy:createFromLegacy,confirmLegacy:confirmLegacy};
})(window);
