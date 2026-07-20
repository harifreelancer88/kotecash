(function(g){
  var H=g.WealthHelpers,A=g.WealthApi;
  var types=['stock','mutual_fund','epf','nps','ppf','ssy','fixed_deposit','gold','bond','crypto','cash_equivalent','other'], src=['manual','market','nav','account_snapshot','import'], modes=['manual','market','not_priced','account_level'], valuationModes=['holdings','manual_snapshot','formula','hybrid'];
  var stockFields=['symbol','isin','exchange','scheme_code'];
  var metaFields={
    stock:[],
    mutual_fund:['scheme_name','folio','amfi_code','plan_type','option_type','fund_house','category'],
    epf:['employer_label','uan_masked'],
    nps:['pran_masked','tier','pension_fund_manager','scheme_preference'],
    ppf:['account_label','opened_date','maturity_date','interest_rate'],
    ssy:['account_label','opened_date','maturity_date','interest_rate'],
    fixed_deposit:['institution','reference_masked','principal','start_date','maturity_date','interest_rate','compounding_frequency','maturity_amount'],
    gold:['form','quantity','unit','purity'],
    bond:['issuer','coupon_rate','maturity_date'],
    crypto:['wallet_label'],
    cash_equivalent:['institution','account_label'],
    other:['institution','label']
  };
  function parseMeta(raw){ if(!raw)return {}; if(typeof raw==='object')return raw; try{return JSON.parse(String(raw));}catch(e){return {};} }
  function metaInput(f,m){ var type=/date/.test(f)?'date':/rate|principal|amount|quantity/.test(f)?'number':'text'; return H.field('as_meta_'+f,H.typeLabel(f),type,m[f]); }
  function providerLabel(v){return ({manual:'Manual',nse_bhavcopy:'NSE official close',yahoo_finance:'Yahoo fallback',mfapi:'MFAPI mutual-fund NAV'}[v]||v||'Manual');}
  function marketSettings(a){return '<div class="mt-3 p-3 rounded border"><div class="text-xs font-semibold mb-2">Market-data settings</div>'+H.select('as_price_provider','Provider',[{value:'manual',label:'Manual'},{value:'nse_bhavcopy',label:'NSE official close'},{value:'yahoo_finance',label:'Yahoo fallback'},{value:'mfapi',label:'MFAPI mutual-fund NAV'}],a.price_provider||'manual')+H.field('as_provider_symbol','Provider symbol','text',a.provider_symbol)+H.field('as_provider_exchange','Provider exchange','text',a.provider_exchange)+H.field('as_provider_scheme_code','Provider scheme code','text',a.provider_scheme_code)+'<label class="wealth-check"><input id="as_auto_refresh" type="checkbox" '+(a.automatic_price_refresh?'checked':'')+'> Automatic refresh</label><p class="text-xs" style="color:var(--c-sub);">Last price date: '+H.esc(a.last_provider_trade_date||'—')+' · Last source: '+providerLabel(a.price_provider)+'</p>'+(a.automatic_price_refresh&&!a.provider_symbol&&!a.provider_scheme_code?'<p class="text-xs text-[#C44B4B]">Provider mapping is missing.</p>':'')+'</div>'; }
  function stockInputs(a,type){ return type==='stock'||type==='mutual_fund'?stockFields.map(function(f){return H.field('as_'+f,H.typeLabel(f),'text',a[f]);}).join(''):''; }
  function actions(a){
    var html='<div class="wealth-actions"><button class="wealth-action" onclick="WealthAssets.form('+a.id+')">Edit</button><button class="wealth-action" onclick="WealthAssets.deactivate('+a.id+')">Deactivate</button><button class="wealth-action" onclick="WealthPrices.form(null,'+a.id+')">Add price</button><button class="wealth-action" onclick="WealthPerformance.asset('+a.id+')">Performance</button>';
    if(a.can_delete) html+='<button class="wealth-action danger" onclick="WealthAssets.permanentDelete('+a.id+')">Delete permanently</button>';
    if(g.WealthMarketPrices) html+=g.WealthMarketPrices.button({asset_id:a.id,symbol:a.symbol,exchange:a.exchange,is_active:a.is_active,asset_type:a.asset_type});
    return html+'</div>';
  }
  async function render(){
    var rows=await A.assets({active:document.getElementById('wealthAssetActive')?.value,q:document.getElementById('wealthAssetQ')?.value,asset_type:document.getElementById('wealthAssetType')?.value});
    await Promise.all(rows.map(async function(a){try{var d=await A.assetDeleteCheck(a.id); a.can_delete=!!d.can_delete; a.delete_dependencies=d.dependencies||{};}catch(e){a.can_delete=false;}}));
    var body=rows.map(function(a){return '<tr><td class="p-2">'+H.esc(a.name)+'</td><td>'+H.typeLabel(a.asset_type)+'</td><td>'+H.esc(a.symbol)+'</td><td>'+H.esc(a.isin)+'</td><td>'+H.esc(a.exchange)+'</td><td>'+H.esc(a.scheme_code)+'</td><td>'+H.typeLabel(a.valuation_mode||a.pricing_mode)+'</td><td>'+H.typeLabel(a.price_source)+'</td><td>'+(a.is_active?'Active':'Inactive')+'</td><td>'+actions(a)+'</td></tr>';}).join('');
    return '<div class="card p-4"><div class="wealth-header"><div class="section-title">Assets</div><button class="btn-primary px-3 py-2 rounded-lg text-xs wealth-primary" onclick="WealthAssets.form()">Add</button></div><div class="wealth-filters"><input id="wealthAssetQ" placeholder="Search" class="px-3 py-2 border rounded" oninput="WealthRouter.load(\'assets\')"><select id="wealthAssetType" onchange="WealthRouter.load(\'assets\')"><option value="">All types</option>'+types.map(function(t){return '<option value="'+t+'">'+H.typeLabel(t)+'</option>';}).join('')+'</select><select id="wealthAssetActive" onchange="WealthRouter.load(\'assets\')"><option value="true">Active</option><option value="false">Inactive</option><option value="">All</option></select></div>'+H.table(['Name','Type','Symbol','ISIN','Exchange','Scheme','Valuation','Source','Status','Actions'],body)+'</div>';
  }
  async function form(id){
    var a=id?(await A.assets({active:''})).find(function(x){return x.id===id;}):{};
    var m=parseMeta(a.metadata), type=a.asset_type||'stock';
    var body=H.field('as_name','Name','text',a.name)+H.select('as_type','Type',types.map(function(x){return {value:x,label:H.typeLabel(x)};}),type)+'<div id="as_type_fields">'+stockInputs(a,type)+(metaFields[type]||[]).map(function(f){return metaInput(f,m);}).join('')+'</div>'+H.field('as_currency','Currency','text',a.currency||'INR')+H.select('as_src','Price source',src.map(function(x){return {value:x,label:H.typeLabel(x)};}),a.price_source||'manual')+H.select('as_mode','Pricing mode',modes.map(function(x){return {value:x,label:H.typeLabel(x)};}),a.pricing_mode||'manual')+H.select('as_val_mode','Valuation mode',valuationModes.map(function(x){return {value:x,label:H.typeLabel(x)};}),a.valuation_mode||'')+marketSettings(a)+'<label class="wealth-check"><input id="as_active" type="checkbox" '+(a.is_active!==0?'checked':'')+'> Active</label>'+H.field('as_notes','Notes','text',a.notes)+'<div id="wealthFormError" class="text-sm text-[#C44B4B]"></div><button class="btn-primary px-4 py-2 rounded-lg w-full" onclick="WealthAssets.save('+(id||0)+')">Save</button>';
    openModal((id?'Edit':'Add')+' asset',body);
    document.getElementById('as_type').onchange=function(){var t=this.value, box=document.getElementById('as_type_fields'); box.innerHTML=stockInputs(a,t)+(metaFields[t]||[]).map(function(f){return metaInput(f,m);}).join('');};
  }
  async function save(id){
    try{
      var rows=id?await A.assets({active:''}):[], existing=id?(rows.find(function(x){return x.id===id;})||{}):{}, meta=parseMeta(existing.metadata), t=H.val('as_type');
      (metaFields[t]||[]).forEach(function(f){var v=H.val('as_meta_'+f); if(v!=='')meta[f]=v;});
      var b={name:H.val('as_name'),asset_type:t,symbol:H.val('as_symbol'),isin:H.val('as_isin'),exchange:H.val('as_exchange'),scheme_code:H.val('as_scheme_code'),currency:H.val('as_currency')||'INR',price_source:H.val('as_src'),pricing_mode:H.val('as_mode'),valuation_mode:H.val('as_val_mode')||null,is_active:H.val('as_active'),notes:H.val('as_notes'),metadata:meta,price_provider:H.val('as_price_provider'),provider_symbol:H.val('as_provider_symbol'),provider_exchange:H.val('as_provider_exchange'),provider_scheme_code:H.val('as_provider_scheme_code'),automatic_price_refresh:!!document.getElementById('as_auto_refresh')?.checked};
      await A.save('/api/wealth/assets'+(id?'/'+id:''),b,id?'PUT':'POST'); closeModal(); toast('Asset saved'); WealthRouter.load('assets');
    }catch(e){document.getElementById('wealthFormError').textContent=e.message;}
  }
  async function deactivate(id){ if(confirm('Deactivate this asset?')){ await A.del('/api/wealth/assets/'+id); toast('Asset deactivated'); WealthRouter.load('assets'); } }
  async function permanentDelete(id){ if(confirm('Permanently delete this empty asset? This cannot be undone.')){ await A.del('/api/wealth/assets/'+id+'/permanent'); toast('Asset deleted'); WealthRouter.load('assets'); } }
  g.WealthAssets={render:render,form:form,save:save,deactivate:deactivate,permanentDelete:permanentDelete};
})(window);
