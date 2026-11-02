import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportHandler, validateSupportAnswer} from '../api/support.js';
import {getSupportArticles} from '../src/support-content.js';
import {createServer} from 'node:http';

const response=()=>({statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=JSON.parse(value);this.writableEnded=true;}});
const request=body=>({method:'POST',headers:{authorization:'Bearer test-identity'},body:body || {message:'¿Cómo instalo la app?',language:'es'}});
function setup(overrides={}) {
  const calls=[];
  const handler=createSupportHandler({settings:()=>({apiKey:'private-test-placeholder',model:'model-test'}),
    authenticate:async(token)=>{calls.push(['auth',token]);return 'test-user';},
    reserve:async uid=>calls.push(['reserve',uid]),
    generate:async value=>{calls.push(['generate',value]);return {answer:'Usa la opción Instalar del navegador.',sourceIds:['install'],needsHuman:false};},...overrides});
  return {handler,calls};
}

test('support uses authenticated identity and reserved budget before generation, returning cited text only',async()=>{
  const {handler,calls}=setup();const res=response();await handler(request(),res);
  assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.deepEqual(calls.map(x=>x[0]),['auth','reserve','generate']);
  const input=calls[2][1];assert.equal(input.message,'¿Cómo instalo la app?');assert.equal(input.language,'es');
  assert.equal(input.articles.length,8);assert.ok(input.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(input).sort(),['articles','config','language','message','signal']);
  assert.deepEqual(res.value,{answer:'Usa la opción Instalar del navegador.',sourceIds:['install'],needsHuman:false});
  assert.ok(!JSON.stringify(res.value).includes('private-test-placeholder'));
});

test('support rejects methods, long bodies, extra history/GPS fields and unsupported languages without paid work',async()=>{
  const {handler,calls}=setup();
  const invalid=[{message:'',language:'es'},{message:'x'.repeat(1201),language:'es'},
    {message:'hola',language:'xx'},{message:'hola',language:'es',history:['private']},
    {message:'hola',language:'es',lat:18},{message:12,language:'es'}];
  for(const body of invalid){const res=response();await handler(request(body),res);assert.equal(res.statusCode,400);}
  const res=response();await handler({...request(),method:'GET'},res);assert.equal(res.statusCode,405);
  assert.equal(calls.length,0);
});

test('support fails closed without configuration or valid identity and never calls the model',async()=>{
  for(const override of [{settings:()=>null},{authenticate:async()=>{throw new Error('private-token-details');}}]){
    const {handler,calls}=setup(override);const res=response();await handler(request(),res);
    assert.ok([401,503].includes(res.statusCode));assert.ok(!calls.some(x=>x[0]==='generate'));
    assert.ok(!JSON.stringify(res.value).includes('private-token-details'));
  }
  for(const authorization of [undefined,['malformed'],'not-a-bearer-token']){
    const {handler,calls}=setup();const res=response();await handler({...request(),headers:{authorization}},res);
    assert.equal(res.statusCode,401);assert.equal(calls.length,0);
  }
});

test('support never spends after rate limit or database failure',async()=>{
  for(const code of ['SUPPORT_RATE_LIMIT','SUPPORT_UNAVAILABLE']){
    const {handler,calls}=setup({reserve:async()=>{throw Object.assign(new Error('private-database'),{code});}});
    const res=response();await handler(request(),res);assert.equal(res.statusCode,code==='SUPPORT_RATE_LIMIT'?429:503);
    assert.ok(!calls.some(x=>x[0]==='generate'));assert.ok(!JSON.stringify(res.value).includes('private-database'));
  }
});

test('support rejects invented citations, incomplete answers and unsafe output shapes',async()=>{
  const articles=getSupportArticles('es');
  for(const value of [{answer:'invented',sourceIds:['missing'],needsHuman:false},
    {answer:'invented',sourceIds:[],needsHuman:false},{answer:'x'.repeat(1201),sourceIds:['gps'],needsHuman:false},
    {answer:'',sourceIds:['gps'],needsHuman:true},{answer:'hello',sourceIds:['gps'],needsHuman:'yes'}]) {
    assert.throws(()=>validateSupportAnswer(value,articles));
  }
  assert.deepEqual(validateSupportAnswer({answer:'No tengo información suficiente.',sourceIds:[],needsHuman:true},articles),
    {answer:'No tengo información suficiente.',sourceIds:[],needsHuman:true});
  const {handler}=setup({generate:async()=>({answer:'not grounded',sourceIds:['not-real'],needsHuman:false})});
  const res=response();await handler(request(),res);assert.equal(res.statusCode,502);
});

test('support bounds generation time and hides provider failures',async()=>{
  const {handler}=setup({timeoutMs:5,generate:async({signal})=>new Promise((_,reject)=>
    signal.addEventListener('abort',()=>reject(new Error('provider-key-in-exception')),{once:true}))});
  const res=response();await handler(request(),res);assert.equal(res.statusCode,502);
  assert.deepEqual(res.value,{error:'SUPPORT_UNAVAILABLE'});
});

test('the actual provider adapter sends only the current question and localized articles with bounded output',async()=>{
  const previous=globalThis.fetch;
  let providerRequest;
  globalThis.fetch=async(url,options)=>{
    providerRequest={url,options,body:JSON.parse(options.body)};
    return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({
      answer:'Use Install in a supported browser.',sourceIds:['install'],needsHuman:false})}]}}]}),
      {headers:{'Content-Type':'application/json'}});
  };
  try {
    const handler=createSupportHandler({settings:()=>({apiKey:'provider-test-key',model:'test-model',serviceAccount:'never-send-this'}),
      authenticate:async()=> 'private-user-id', reserve:async()=>{}});
    const res=response();await handler(request({message:'How can I install the app?',language:'en'}),res);
    assert.equal(res.statusCode,200);
    assert.equal(new URL(providerRequest.url).hostname,'generativelanguage.googleapis.com');
    assert.deepEqual(providerRequest.body.contents,[{role:'user',parts:[{text:'How can I install the app?'}]}]);
    assert.equal(providerRequest.body.generationConfig.maxOutputTokens,384);
    const serialized=JSON.stringify(providerRequest.body);
    for(const privateValue of ['never-send-this','private-user-id','provider-test-key','test-identity'])assert.ok(!serialized.includes(privateValue));
    assert.ok(serialized.includes('How do I install SafeRoute'));
    assert.ok(!serialized.includes('¿Cómo instalo SafeRoute'));
    assert.equal(providerRequest.options.headers['x-goog-api-key'],'provider-test-key');
  } finally {globalThis.fetch=previous;}
});

test('support handles a real Node HTTP request body without Vercel-specific helpers',async()=>{
  const {handler}=setup();
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await fetch(`http://127.0.0.1:${server.address().port}/api/support`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-identity'},
      body:JSON.stringify({message:'¿Cómo instalo la app?',language:'es'})});
    assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
    assert.deepEqual((await result.json()).sourceIds,['install']);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
